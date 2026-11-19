// De zoeklogica van draaiter: welke voorstellingen passen bij een plek, tijd en keuze.
// Gedeeld door de lokale server (serve.js) en de Netlify-functie (netlify/functions/api.js).

const fs = require("fs");
const path = require("path");
const { cinemaKind, isKidsFilm } = require("../kinds");
const { ownWebsite, safeUrl } = require("../scrapers/websites");

const RADIUS_KM = 12;
const PAGE = 24;          // voorstellingen per keer
const MAX_SHOWINGS = 120; // bovengrens, hoe vaak je ook op "meer" drukt

// Ticketlinks gaan altijd naar de bioscoop zelf; een Filmladder-link uit oudere data wordt hier vervangen.
const ticketLink = (cinemaId, url) => safeUrl(url) || ownWebsite(cinemaId);
const cinemaLink = (c) => safeUrl(c.url) || ownWebsite(c.id);

const kidsMemo = new WeakMap(); // per filmobject één keer bepalen
const isKids = (film) => {
  if (!film) return false;
  if (!kidsMemo.has(film)) kidsMemo.set(film, isKidsFilm(film));
  return kidsMemo.get(film);
};

function km(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function toFilm(f) {
  const id = f.imdb?.id || "";
  const q = encodeURIComponent(f.title);
  return {
    title: f.title,
    director: f.director || "",
    year: f.year || null,
    country: f.country || "",
    cast: f.cast || [],
    plot: f.plot || "",
    poster: f.poster || "",
    backdrop: f.backdrop || "",
    trailer: f.trailer || "", // YouTube-sleutel
    tmdb: Boolean(f.tmdb),
    genres: (f.genres || []).slice(0, 2),
    sfeer: f.sfeer || "",
    release: f.release || "", // Nederlandse bioscooprelease, JJJJ-MM-DD
    // zonder Claude: de bekendste vergelijkbare films uit TMDB; minder dan drie is meestal toeval
    likes: f.likes?.length ? f.likes.slice(0, 3) : (f.similar || []).length >= 3 ? f.similar.slice(0, 3) : [],
    // zonder IMDb-nummer gaat de link naar de zoekpagina; fout linken is erger dan zoeken
    imdb: { id, score: f.imdb?.score || f.imdbScore || null, url: id ? `https://www.imdb.com/title/${id}/` : `https://www.imdb.com/find/?q=${q}&s=tt` },
    letterboxd: { score: null, url: id ? `https://letterboxd.com/imdb/${id}/` : `https://letterboxd.com/search/films/${q}/` },
  };
}

// only: de bioscopen die de bezoeker heeft aangevinkt (leeg = alle in de regio)
// cat: "kids" (alleen kinderfilms), "filmhuis" of "pathe" (alleen die bioscopen), of leeg
function showtimesFor(program, pos, from, only, limit, cat) {
  const filmOk = (s) => cat !== "kids" || isKids(program.films[s.filmKey]);
  const cinemaOk = (c) => (cat !== "filmhuis" && cat !== "pathe") || cinemaKind(c) === cat;
  // bioscopen zonder passend komend programma doen niet mee; die zou je alleen maar leeg aanklikken
  const active = new Set();
  for (const s of program.showings) if (new Date(s.start) >= from && filmOk(s)) active.add(s.cinemaId);
  const all = Object.values(program.cinemas).filter((c) => active.has(c.id) && cinemaOk(c))
    .map((c) => ({ ...c, dist: km(pos, c) })).sort((a, b) => a.dist - b.dist);
  let near = all.filter((c) => c.dist <= RADIUS_KM);
  const far = near.length === 0;
  if (far) near = all.slice(0, 3);
  const chosen = near.filter((c) => only.has(c.id));
  const byId = new Map((chosen.length ? chosen : near).map((c) => [c.id, c]));

  const showings = [];
  let more = false;
  for (const s of program.showings) { // gesorteerd op tijd
    if (!byId.has(s.cinemaId) || new Date(s.start) < from || !filmOk(s)) continue;
    if (showings.length === limit) { more = true; break; }
    const c = byId.get(s.cinemaId);
    showings.push({
      id: s.id, start: s.start, ticketUrl: ticketLink(s.cinemaId, s.ticketUrl), filmKey: s.filmKey,
      cinema: { id: c.id, name: c.name, lat: c.lat, lon: c.lon, url: cinemaLink(c) },
      film: toFilm(program.films[s.filmKey]),
    });
  }
  const cinemas = near.map((c) => ({ id: c.id, name: c.name, lat: c.lat, lon: c.lon }));
  return { source: "live", far, more, updated: program.scrapedAt, cinemas, showings };
}

// Alle voorstellingen van één film in de regio, binnen een tijdvak (de pop-up vraagt één dag).
function filmShowings(program, pos, key, from, to) {
  const all = Object.values(program.cinemas).map((c) => ({ ...c, dist: km(pos, c) })).sort((a, b) => a.dist - b.dist);
  const inRange = all.filter((c) => c.dist <= RADIUS_KM);
  const hits = (cinemas) => {
    const byId = new Map(cinemas.map((c) => [c.id, c]));
    const out = [];
    for (const s of program.showings) {
      const t = new Date(s.start);
      if (s.filmKey !== key || !byId.has(s.cinemaId) || t < from || t >= to) continue;
      const c = byId.get(s.cinemaId);
      out.push({ id: s.id, start: s.start, ticketUrl: ticketLink(s.cinemaId, s.ticketUrl), filmKey: key, cinema: { id: c.id, name: c.name, lat: c.lat, lon: c.lon, url: cinemaLink(c) } });
      if (out.length === 150) break;
    }
    return out;
  };
  // buiten bereik van elke bioscoop: de drie dichtstbijzijnde, net als de hoofdlijst
  return { showings: hits(inRange.length ? inRange : all.slice(0, 3)) };
}

// Eén verzoek afhandelen. route is "/api/showtimes" of "/api/film"; params is een URLSearchParams.
// Geeft { status, body } terug; de aanroeper maakt er een HTTP-antwoord van.
function handleQuery(program, route, params, note) {
  if (!program?.showings?.length) return { status: 200, body: { source: "demo", error: note } };
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const from = new Date(params.get("from") || Date.now());
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || isNaN(from))
    return { status: 400, body: { source: "error", error: "Ongeldige locatie of tijd" } };
  if (route === "/api/film") {
    const key = params.get("key") || "";
    const to = new Date(params.get("to") || NaN);
    if (!Object.hasOwn(program.films, key) || isNaN(to)) return { status: 400, body: { error: "Onbekende film of tijd" } };
    return { status: 200, body: filmShowings(program, { lat, lon }, key, from, to) };
  }
  const only = new Set((params.get("cinemas") || "").split(",").filter(Boolean).slice(0, 60));
  const limit = Math.min(MAX_SHOWINGS, Math.max(1, Number.parseInt(params.get("limit"), 10) || PAGE));
  const cat = ["kids", "filmhuis", "pathe"].find((c) => c === params.get("cat")) || "";
  return { status: 200, body: showtimesFor(program, { lat, lon }, from, only, limit, cat) };
}

// ---------- lettertypen ----------
// Busorama als er een gelicentieerd bestand in fonts/ staat; Poiret One en Jost zelf gehost (open licentie).

const FONT_FILES = { "busorama.woff2": ["font/woff2", "woff2"], "busorama.woff": ["font/woff", "woff"], "busorama.ttf": ["font/ttf", "truetype"], "busorama.otf": ["font/otf", "opentype"] };
const HOSTED = [
  { family: "Poiret One", file: "poiret-one.woff2", weight: "400" },
  { family: "Jost", file: "jost.woff2", weight: "300 700" },
];

function fontFiles(root) {
  const fonts = path.join(root, "fonts");
  const busorama = Object.keys(FONT_FILES).find((f) => fs.existsSync(path.join(fonts, f)));
  return { busorama, hosted: HOSTED.filter((f) => fs.existsSync(path.join(fonts, f.file))) };
}

function fontCss(root) {
  const { busorama, hosted } = fontFiles(root);
  const local = `local("ITC Busorama"), local("ITC Busorama Std"), local("Busorama ITC"), local("Busorama")`;
  const src = busorama ? `${local}, url("fonts/${busorama}") format("${FONT_FILES[busorama][1]}")` : local;
  let css = `@font-face { font-family: "Busorama"; src: ${src}; font-display: swap; }\n`;
  for (const f of hosted)
    css += `@font-face { font-family: "${f.family}"; src: url("fonts/${f.file}") format("woff2"); font-weight: ${f.weight}; font-display: swap; }\n`;
  return css;
}

// de bestanden die samen de website vormen; de rest (servercode, sleutels, caches) gaat nooit mee
const PUBLIC_FILES = ["index.html", "app.js", "data.js", "styles.css", "logo.svg"];

module.exports = { handleQuery, fontCss, fontFiles, FONT_FILES, PUBLIC_FILES };
