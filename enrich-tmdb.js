// TMDB: poster, beeld, trailer en de filmgegevens die bioscopen niet vermelden.
// Gratis sleutel is voor niet-commercieel gebruik; bronvermelding staat in de app.

const { filmKey } = require("./scrapers/util");

const BASE = (process.env.TMDB_BASE_URL || "https://api.themoviedb.org/3").replace(/\/$/, "");
const IMG = "https://image.tmdb.org/t/p";
const HIT_TTL = 30 * 864e5, MISS_TTL = 3 * 864e5;
const GAP_MS = 250; // ruim binnen wat TMDB toestaat

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const regionName = new Intl.DisplayNames("nl", { type: "region" });
let last = 0;

async function call(pathname, params, key, retry = true) {
  const u = new URL(BASE + pathname);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  const headers = { Accept: "application/json" };
  // lange "API Read Access Token" gaat in de header, korte v3-sleutel in de url
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  else u.searchParams.set("api_key", key);

  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();

  const r = await fetch(u, { headers, signal: AbortSignal.timeout(10000) });
  if (r.status === 429 && retry) { await sleep(3000); return call(pathname, params, key, false); }
  if (r.status === 401) throw Object.assign(new Error("TMDB weigert de sleutel"), { fatal: true });
  if (!r.ok) throw new Error(`TMDB HTTP ${r.status}`);
  return r.json();
}

const sameWords = (a, b) => {
  const x = filmKey(a || ""), y = filmKey(b || "");
  return Boolean(x && y) && x.split(" ").some((w) => w.length > 2 && y.includes(w));
};

// "Youri - Film&Ontbijt" -> ook proberen als "Youri"; "3x3 Eyes (1991)" -> jaar 1991
function queries(film) {
  const year = (film.title.match(/\((19|20)\d{2}\)\s*$/) || [])[0]?.slice(1, 5);
  const base = film.title.replace(/\s*\((19|20)\d{2}\)\s*$/, "").trim();
  const short = base.split(/\s+[-–|]\s+|:\s+/)[0].trim();
  return { year: Number(year) || film.year || null, titles: [...new Set([base, short].filter((t) => t.length > 1))] };
}

function pickTrailer(videos) {
  const yt = (videos?.results || []).filter((v) => v.site === "YouTube" && v.key);
  const rank = (v) => (v.type === "Trailer" ? 0 : v.type === "Teaser" ? 2 : 9) + (v.iso_639_1 === "nl" ? 0 : 0.5) + (v.official ? 0 : 0.2);
  const best = yt.filter((v) => rank(v) < 9).sort((a, b) => rank(a) - rank(b))[0];
  return best ? best.key : "";
}

// De Nederlandse bioscooprelease. TMDB kent per land meerdere data (première, bioscoop, digitaal);
// wij willen de bioscoop (type 3, of 2 = beperkt). Bij een heruitbreng staan er meer: de recentste telt,
// zolang die niet verder dan twee maanden in de toekomst ligt.
function nlRelease(releaseDates) {
  const nl = (releaseDates?.results || []).find((r) => r.iso_3166_1 === "NL");
  const limit = Date.now() + 60 * 864e5;
  const dates = (nl?.release_dates || [])
    .filter((r) => (r.type === 3 || r.type === 2) && r.release_date && +new Date(r.release_date) <= limit)
    .map((r) => r.release_date.slice(0, 10))
    .sort();
  return dates.pop() || "";
}

function shape(d) {
  const crew = d.credits?.crew || [];
  return {
    id: d.id,
    imdbId: d.imdb_id || "",
    year: Number.parseInt(d.release_date, 10) || null,
    country: (d.production_countries || []).slice(0, 2).map((c) => regionName.of(c.iso_3166_1) || c.name).join(" / "),
    director: crew.filter((c) => c.job === "Director").map((c) => c.name).join(", "),
    cast: (d.credits?.cast || []).slice(0, 2).map((c) => c.name),
    plot: d.overview || "",
    poster: d.poster_path ? `${IMG}/w342${d.poster_path}` : "",
    backdrop: d.backdrop_path ? `${IMG}/w780${d.backdrop_path}` : "",
    trailer: pickTrailer(d.videos),
    score: d.vote_count >= 20 ? Math.round(d.vote_average * 10) / 10 : null,
    genres: (d.genres || []).map((g) => g.name).filter(Boolean).slice(0, 3),
    release: nlRelease(d.release_dates),
    // vergelijkbare films, de bekendste eerst; grondstof voor "voor liefhebbers van"
    similar: (d.recommendations?.results || [])
      .filter((r) => r.title && r.vote_count >= 300 && Number.parseInt(r.release_date, 10))
      .sort((a, b) => b.vote_count - a.vote_count)
      .slice(0, 6)
      .map((r) => ({ title: r.title, year: Number.parseInt(r.release_date, 10) })),
  };
}

// Bestaat deze film, en kennen genoeg mensen hem? Controle op de titels die Claude voorstelt.
const knownCache = new Map();
async function isKnownFilm(title, year, key) {
  const ck = `${filmKey(title)}|${year || ""}`;
  if (knownCache.has(ck)) return knownCache.get(ck);
  const res = await call("/search/movie", { query: title, language: "nl-NL", include_adult: "false" }, key);
  const want = filmKey(title);
  const ok = (res.results || []).slice(0, 8).some((c) => {
    const same = filmKey(c.title || "") === want || filmKey(c.original_title || "") === want;
    const cy = Number.parseInt(c.release_date, 10);
    return same && c.vote_count >= 300 && (!year || !cy || Math.abs(cy - year) <= 1);
  });
  knownCache.set(ck, ok);
  return ok;
}

// Zoekt de film bij een titel. Liever geen treffer dan de verkeerde film:
// met een bekende regisseur moet die kloppen, zonder regisseur moet de titel exact gelijk zijn.
async function find(film, key) {
  const { year, titles } = queries(film);
  for (const title of titles) {
    // de ingekorte titel ("Shorts" uit "Shorts: Land of the Free") is alleen te vertrouwen
    // als een regisseur de treffer kan bevestigen
    if (title !== titles[0] && !film.director) break;
    const res = await call("/search/movie", { query: title, language: "nl-NL", region: "NL", include_adult: "false" }, key);
    const want = filmKey(title);
    const ranked = (res.results || []).slice(0, 8)
      .map((c, i) => {
        const exact = filmKey(c.title || "") === want || filmKey(c.original_title || "") === want;
        const cy = Number.parseInt(c.release_date, 10);
        const yearOk = year && cy && Math.abs(cy - year) <= 1;
        return { c, exact, score: (exact ? 4 : 0) + (yearOk ? 3 : 0) - i * 0.1 };
      })
      .sort((a, b) => b.score - a.score);

    for (const { c, exact } of ranked.slice(0, film.director ? 3 : 1)) {
      if (!film.director && !exact) continue;
      // zonder regisseur is het jaar de enige controle: een gelijknamige film uit een ander jaar valt af
      const cy = Number.parseInt(c.release_date, 10);
      if (!film.director && year && cy && Math.abs(cy - year) > 1) continue;
      const d = await call(`/movie/${c.id}`, { language: "nl-NL", append_to_response: "credits,videos,recommendations,release_dates", include_video_language: "nl,en,null" }, key);
      const directors = (d.credits?.crew || []).filter((p) => p.job === "Director").map((p) => p.name).join(" ");
      if (film.director && directors && !sameWords(film.director, directors)) continue;
      // TMDB kent geen regisseur: dan kan niets de ingekorte titel bevestigen
      if (!directors && title !== titles[0]) continue;
      return shape(d);
    }
  }
  return null;
}

async function lookup(film, key, cache) {
  // v3: strengere regel voor ingekorte titels; oudere cacheregels tellen niet meer mee
  const ck = `v6|${filmKey(film.title)}|${filmKey(film.director || "")}`;
  const hit = cache[ck];
  if (hit && Date.now() - hit.at < (hit.data ? HIT_TTL : MISS_TTL)) return { data: hit.data, cached: true };
  const data = await find(film, key);
  cache[ck] = { at: Date.now(), data };
  return { data, cached: false };
}

// Vult een film aan. De bioscoop blijft de baas over regisseur en plot (Nederlands, zelf geschreven);
// TMDB levert beeld, trailer, IMDb-nummer en wat er ontbreekt.
function apply(film, t) {
  film.tmdb = { id: t.id, score: t.score };
  if (t.imdbId) film.imdb = { id: t.imdbId, score: film.imdb?.score ?? null };
  film.year = t.year || film.year;
  film.country ||= t.country;
  film.director ||= t.director;
  if (!film.cast?.length) film.cast = t.cast;
  film.plot ||= t.plot;
  film.poster = t.poster || film.poster || "";
  film.backdrop = t.backdrop;
  film.trailer = t.trailer;
  if (t.genres?.length) film.genres = t.genres;
  film.release ||= t.release; // de bioscoop weet het beter; TMDB vult aan
  film.similar = t.similar || [];
}

// Een eerdere koppeling bleek fout: haal weg wat van TMDB kwam.
function clear(film) {
  if (!film.tmdb) return;
  const fromTmdb = (url) => String(url || "").startsWith(IMG);
  delete film.tmdb; delete film.backdrop; delete film.trailer; delete film.similar; delete film.genres; delete film.imdb;
  if (fromTmdb(film.poster)) film.poster = "";
}

module.exports = { lookup, apply, clear, isKnownFilm };
