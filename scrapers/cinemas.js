// Welke bioscopen we ophalen en met welke scraper.
// Rechtstreeks van de eigen site waar dat kan; de rest van Nederland via Filmladder.

const fs = require("fs");
const path = require("path");
const fkFeed = require("./fk-feed");
const jsonLd = require("./json-ld");
const fhdh = require("./fhdh");
const filmladder = require("./filmladder");
const { allowedByRobots } = require("./util");
const { ownWebsite } = require("./websites");

// Eigen site: verser, met filmgegevens en een ticketlink naar de voorstelling zelf.
const direct = [
  { id: "kriterion", name: "Kriterion", lat: 52.3625, lon: 4.9106, url: "https://www.kriterion.nl/", scraper: jsonLd, filmladderSlug: "kriterion-amsterdam" },
  { id: "themovies", name: "The Movies", lat: 52.3847, lon: 4.8846, url: "https://themovies.nl/", scraper: fkFeed, filmladderSlug: "the-movies-amsterdam" },
  { id: "hartlooper", name: "Louis Hartlooper Complex", lat: 52.0853, lon: 5.1247, url: "https://hartlooper.nl/", scraper: fkFeed, filmladderSlug: "louis-hartlooper-complex-utrecht" },
  { id: "springhaver", name: "Springhaver", lat: 52.0893, lon: 5.1195, url: "https://springhaver.nl/", scraper: fkFeed, filmladderSlug: "springhaver-utrecht" },
  { id: "kino", name: "KINO Rotterdam", lat: 51.9165, lon: 4.4737, url: "https://kinorotterdam.nl/", scraper: fkFeed, filmladderSlug: "kino-rotterdam" },
  { id: "lantarenvenster", name: "LantarenVenster", lat: 51.9049, lon: 4.4865, url: "https://www.lantarenvenster.nl/", programUrl: "https://www.lantarenvenster.nl/film/", scraper: jsonLd, filmladderSlug: "lantarenvenster-rotterdam" },
  { id: "filmhuisdenhaag", name: "Filmhuis Den Haag", lat: 52.0766, lon: 4.3155, url: "https://filmhuisdenhaag.nl/", scraper: fhdh, filmladderSlug: "filmhuis-den-haag-den-haag" },
];

const LIST_CACHE = path.join(__dirname, "..", "data", "filmladder-cinemas.json");
const LIST_TTL = 7 * 864e5;
const FILMLADDER_REFRESH_HOURS = 12;

async function filmladderSlugs() {
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(LIST_CACHE, "utf8")); } catch {}
  if (cached && typeof cached.slugs?.[0] !== "object") cached = null; // oude vorm zonder namen
  if (cached && Date.now() - cached.at < LIST_TTL) return cached.slugs;
  try {
    if (!(await allowedByRobots(filmladder.discoverUrl))) throw new Error("robots.txt");
    const slugs = await filmladder.discover();
    if (slugs.length < 20) throw new Error("lijst te kort");
    fs.mkdirSync(path.dirname(LIST_CACHE), { recursive: true });
    fs.writeFileSync(LIST_CACHE, JSON.stringify({ at: Date.now(), slugs }));
    return slugs;
  } catch {
    return cached?.slugs || []; // liever een oude lijst dan geen
  }
}

module.exports = async function listCinemas() {
  const covered = new Set(direct.map((c) => c.filmladderSlug));
  const rest = (await filmladderSlugs())
    .filter(({ slug }) => !covered.has(slug))
    .map(({ slug, name }) => ({ id: slug, slug, ...(name && { name }), url: ownWebsite(slug), scraper: filmladder, refreshHours: FILMLADDER_REFRESH_HOURS }));
  return [...direct.map(({ filmladderSlug, ...c }) => c), ...rest];
};
