// Haalt het programma op bij alle bioscopen in scrapers/cinemas.js en schrijft data/showtimes.json.
// Los te draaien met: node scrape.js   (de server doet het ook zelf, elke paar uur)

const fs = require("fs");
const path = require("path");
const listCinemas = require("./scrapers/cinemas");
const { allowedByRobots, filmKey } = require("./scrapers/util");

const DATA_DIR = path.join(__dirname, "data");
const OUT = path.join(DATA_DIR, "showtimes.json");
const OMDB_CACHE = path.join(DATA_DIR, "omdb-cache.json");
const filmladder = require("./scrapers/filmladder");
const tmdb = require("./enrich-tmdb");
const sfeer = require("./enrich-sfeer");
const SFEER_CACHE = path.join(DATA_DIR, "sfeer-cache.json");
const TMDB_CACHE = path.join(DATA_DIR, "tmdb-cache.json");
const MAX_TMDB_PER_RUN = 600; // nieuwe titels per ronde; de rest volgt drie uur later
const DETAIL_CACHE = path.join(DATA_DIR, "film-cache.json");
const DETAIL_TTL = 30 * 864e5;
const MAX_DETAILS_PER_RUN = 150; // rem op de eerste keer; de rest volgt bij de volgende ronde
const OMDB_HIT_TTL =30 * 864e5, OMDB_MISS_TTL = 3 * 864e5;

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } };
const filled = (f) => [f.director, f.year, f.country, f.cast?.length, f.plot].filter(Boolean).length;

// OMDb, optioneel: IMDb-nummer en -score, en wat de bioscoop zelf niet vermeldt.
async function omdbLookup(film, key, cache) {
  const imdbId = film.imdb?.id;
  const ck = imdbId || filmKey(film.title);
  const hit = cache[ck];
  if (hit && Date.now() - hit.at < (hit.data ? OMDB_HIT_TTL : OMDB_MISS_TTL)) return hit.data;
  const q = new URLSearchParams(imdbId ? { i: imdbId, apikey: key } : { t: film.title, type: "movie", apikey: key });
  if (!imdbId && film.year) q.set("y", film.year);
  let data = null;
  try {
    const r = await (await fetch(`https://www.omdbapi.com/?${q}`, { signal: AbortSignal.timeout(10000) })).json();
    if (r.Response === "True") {
      // alleen accepteren als de regisseur klopt, of als we er geen hebben om mee te vergelijken
      const ours = filmKey(film.director || ""), theirs = filmKey(r.Director || "");
      const sameDirector = imdbId || !ours || !theirs || ours.split(" ").some((w) => w.length > 2 && theirs.includes(w));
      if (sameDirector) data = { id: r.imdbID, score: Number(r.imdbRating) || null, year: parseInt(r.Year, 10) || null, country: r.Country, director: r.Director, actors: r.Actors, plot: r.Plot };
    }
  } catch { return null; } // storing: niet cachen, volgende keer opnieuw
  cache[ck] = { at: Date.now(), data };
  return data;
}

const known = (v) => (v && v !== "N/A" ? v : "");

// Wat de bron (bioscoop of Filmladder) zelf over een film zei, zonder latere aanvullingen.
// Elke ronde begint hiermee. Anders bevestigt een foute TMDB-koppeling zichzelf: de regisseur
// die TMDB ooit invulde, zou de volgende keer als bewijs gelden dat de koppeling klopt.
const SOURCE_FIELDS = ["title", "director", "year", "country", "cast", "plot", "poster", "genres", "imdbScore", "release", "detailUrl"];
const snapshot = (film) => JSON.parse(JSON.stringify(Object.fromEntries(SOURCE_FIELDS.filter((k) => film[k] !== undefined).map((k) => [k, film[k]]))));

function sourceOnly(film) {
  // oudere data heeft geen "base"; daar is alleen de titel en de filmpagina zeker van de bron
  const base = film.base || {
    title: film.title, director: "", year: null, country: "", cast: [], plot: "",
    poster: String(film.poster || "").startsWith("https://image.tmdb.org") ? "" : film.poster || "",
    imdbScore: film.imdbScore, detailUrl: film.detailUrl,
  };
  return { ...snapshot(base), base: snapshot(base) };
}

async function runScrape({ log = console.log } = {}) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const previous = readJson(OUT, null);
  const cinemas = {}, films = {}, showings = [], report = [], fetchedAt = {};
  const now = Date.now();

  // vorige oogst van één bioscoop overnemen (bij storing, of als die nog vers genoeg is)
  const keepPrevious = (id) => {
    const kept = (previous?.showings || []).filter((s) => s.cinemaId === id && +new Date(s.start) > now);
    for (const s of kept) {
      if (!films[s.filmKey] && previous.films[s.filmKey]) films[s.filmKey] = sourceOnly(previous.films[s.filmKey]);
      showings.push(s);
    }
    if (previous?.fetchedAt?.[id]) fetchedAt[id] = previous.fetchedAt[id];
    return kept.length;
  };

  const hadShowings = new Set((previous?.showings || []).filter((s) => +new Date(s.start) > now).map((s) => s.cinemaId));

  for (const cinema of await listCinemas()) {
    const { scraper, ...info } = cinema;
    // naam en ligging van vorige keer als uitgangspunt; sommige scrapers leveren die zelf
    cinemas[cinema.id] = { ...previous?.cinemas?.[cinema.id], ...info };
    const last = previous?.fetchedAt?.[cinema.id];
    // REFETCH_EMPTY=1: bioscopen zonder komende voorstellingen toch opnieuw proberen
    const retryEmpty = process.env.REFETCH_EMPTY && !hadShowings.has(cinema.id);
    if (!retryEmpty && last && now - new Date(last) < (cinema.refreshHours || 0) * 3600e3) {
      keepPrevious(cinema.id);
      continue;
    }
    try {
      for (const url of scraper.urls(cinema))
        if (!(await allowedByRobots(url))) throw new Error("robots.txt staat het niet toe");
      const res = await scraper({ ...cinemas[cinema.id], scraper }); // met de ligging van vorige keer, als die er is
      if (!Array.isArray(res)) Object.assign(cinemas[cinema.id], res.cinema);
      const found = (Array.isArray(res) ? res : res.showings).filter((s) => +s.start > now - 30 * 6e4);
      for (const s of found) {
        const key = filmKey(s.film.title);
        const detailUrl = films[key]?.detailUrl || s.film.detailUrl;
        const poster = films[key]?.poster || s.film.poster;
        const genres = films[key]?.genres?.length ? films[key].genres : s.film.genres;
        const imdbScore = films[key]?.imdbScore || s.film.imdbScore;
        const release = films[key]?.release || s.film.release;
        if (!films[key] || filled(s.film) > filled(films[key])) films[key] = { ...s.film };
        if (detailUrl) films[key].detailUrl = detailUrl;
        if (poster) films[key].poster = poster;
        if (genres?.length) films[key].genres = genres;
        if (imdbScore) films[key].imdbScore = imdbScore;
        if (release) films[key].release = release;
        showings.push({ id: s.id, cinemaId: cinema.id, filmKey: key, start: s.start.toISOString(), ticketUrl: s.ticketUrl });
      }
      fetchedAt[cinema.id] = new Date(now).toISOString();
      report.push({ cinema: cinema.id, ok: true, count: found.length });
      log(`  ${cinemas[cinema.id].name}: ${found.length} voorstellingen`);
    } catch (e) {
      // site plat of veranderd: houd de vorige oogst van deze bioscoop aan
      const kept = keepPrevious(cinema.id);
      report.push({ cinema: cinema.id, ok: false, error: e.message, kept });
      log(`  ${cinemas[cinema.id].name || cinema.id}: MISLUKT (${e.message}); ${kept} oude voorstellingen aangehouden`);
    }
  }

  // Een bioscoop zonder bekende ligging kunnen we niet "in de buurt" tonen.
  for (const [id, c] of Object.entries(cinemas)) if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) delete cinemas[id];
  for (let i = showings.length - 1; i >= 0; i--) if (!cinemas[showings[i].cinemaId]) showings.splice(i, 1);

  // Vanaf hier wordt aangevuld. Bewaar eerst wat de bron zelf zei, zodat een volgende ronde
  // daar weer vanaf kan beginnen (zie sourceOnly).
  for (const film of Object.values(films)) film.base ||= snapshot(film);

  // Filmgegevens die de bioscooppagina niet geeft, van de filmpagina. Eén keer per film; daarna uit de cache.
  const detailCache = readJson(DETAIL_CACHE, {});
  let fetched = 0;
  for (const film of Object.values(films)) {
    const url = film.detailUrl; // blijft bewaard, zodat een volgende ronde het kan afmaken
    if (!url || filled(film) >= 3) continue;
    let hit = detailCache[url];
    if (!hit || now - hit.at > DETAIL_TTL) {
      if (fetched >= MAX_DETAILS_PER_RUN || !(await allowedByRobots(url))) continue;
      try { hit = detailCache[url] = { at: now, data: await filmladder.details(url) }; fetched++; } catch { continue; }
    }
    film.director ||= hit.data.director;
    film.year ||= hit.data.year;
    if (!film.cast?.length) film.cast = hit.data.cast || [];
    film.plot ||= hit.data.plot;
  }
  fs.writeFileSync(DETAIL_CACHE, JSON.stringify(detailCache));
  if (fetched) log(`  Filmgegevens: ${fetched} filmpagina's opgehaald`);

  const tmdbKey = process.env.TMDB_API_KEY;
  if (tmdbKey) {
    const cache = readJson(TMDB_CACHE, {});
    let matched = 0, asked = 0;
    try {
      for (const film of Object.values(films)) {
        if (asked >= MAX_TMDB_PER_RUN) break;
        let res;
        try { res = await tmdb.lookup(film, tmdbKey, cache); } catch (e) { if (e.fatal) throw e; continue; }
        if (!res.cached) asked++;
        if (res.data) { tmdb.apply(film, res.data); matched++; }
      }
      log(`  TMDB: ${matched} van ${Object.keys(films).length} titels gevonden`);
    } catch (e) {
      log(`  TMDB: gestopt (${e.message})`);
    }
    fs.writeFileSync(TMDB_CACHE, JSON.stringify(cache));
  }

  // Sfeertekst en "voor liefhebbers van", geschreven door Claude; alleen nieuwe titels kosten iets.
  // Staat uit tot SFEER=aan in .env staat; een sleutel alleen is niet genoeg (kost geld per titel).
  if (process.env.ANTHROPIC_API_KEY && /^(aan|1|true)$/i.test(process.env.SFEER || "")) {
    const cache = readJson(SFEER_CACHE, {});
    try {
      await sfeer.enrichAll(Object.values(films), cache, {
        log,
        verify: tmdbKey ? (title, year) => tmdb.isKnownFilm(title, year, tmdbKey) : undefined,
      });
    } catch (e) {
      log(`  Sfeer: gestopt (${e.message})`);
    }
    fs.writeFileSync(SFEER_CACHE, JSON.stringify(cache));
  }

  const omdbKey = process.env.OMDB_API_KEY;
  if (omdbKey) {
    const cache = readJson(OMDB_CACHE, {});
    let matched = 0;
    for (const film of Object.values(films)) {
      const o = await omdbLookup(film, omdbKey, cache);
      if (!o) continue;
      matched++;
      film.imdb = { id: o.id, score: o.score };
      film.year ||= o.year;
      film.country ||= known(o.country);
      film.director ||= known(o.director);
      if (!film.cast?.length && known(o.actors)) film.cast = o.actors.split(",").map((s) => s.trim()).slice(0, 2);
      film.plot ||= known(o.plot);
    }
    fs.writeFileSync(OMDB_CACHE, JSON.stringify(cache));
    log(`  OMDb: ${matched} van ${Object.keys(films).length} titels gevonden`);
  }

  showings.sort((a, b) => a.start.localeCompare(b.start));
  const result = { scrapedAt: new Date().toISOString(), cinemas, films, showings, report, fetchedAt };
  fs.writeFileSync(OUT + ".tmp", JSON.stringify(result));
  fs.renameSync(OUT + ".tmp", OUT);
  return result;
}

module.exports = { runScrape, OUT };

if (require.main === module) {
  try { require("./serve-env")(); } catch {}
  console.log("Programma's ophalen");
  runScrape().then((r) => console.log(`Klaar: ${r.showings.length} voorstellingen, ${Object.keys(r.films).length} titels -> data/showtimes.json`));
}
