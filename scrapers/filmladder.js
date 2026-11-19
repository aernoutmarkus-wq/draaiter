// Filmladder publiceert het programma van vrijwel alle Nederlandse bioscopen en staat het ophalen
// van bioscoop- en filmpagina's toe (robots.txt). Eén verzoek per bioscoop, hooguit twee keer per dag.
// We gebruiken dit voor bioscopen die we niet rechtstreeks kunnen lezen, zoals Pathé (blokkeert bots).

const { getText, cleanTitle, plain, amsterdamDate } = require("./util");
const { ownWebsite } = require("./websites");

const BASE = "https://www.filmladder.nl";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parse(cinema, html) {
  const own = ownWebsite(cinema.id || cinema.slug); // leeg als we de eigen site niet kennen
  const showings = [], seen = new Set();

  for (const block of html.split('<div class="hall">').slice(1)) {
    const link = block.match(/class="movie-link text-link"[^>]*title="([^"]*)"[^>]*href="([^"]*)"/);
    if (!link) continue;
    const title = cleanTitle(link[1]);
    const slug = (link[2].match(/\/film\/([^\/"?#]+)/) || [])[1];
    const src = (block.match(/class="poster" src="([^"]+)"/) || [])[1] || "";
    const poster = src.startsWith("https://") ? src.replace("/small_", "/medium_") : ""; // geen poster = lokaal plaatje
    const imdbScore = Number((block.match(/class="star-rating">\s*<a [^>]*>\s*(\d\.\d)/) || [])[1]) || null;
    const film = { title, director: "", year: null, country: "", cast: [], plot: "", poster, imdbScore, detailUrl: slug ? `${BASE}/film/${slug}` : "" };
    // Filmladders eigen kaartjeslinks gebruiken we niet: de bezoeker gaat rechtstreeks naar de bioscoop
    // niet elke bioscoop heeft zo'n link; dan staat de tijd er kaal
    for (const m of block.matchAll(/itemprop="startDate" content="([^"]+)"[^>]*>\s*(?:<a [^>]*href="(https:\/\/www\.filmladder\.nl\/kaartjes\/\d+)")?/g)) {
      const start = new Date(m[1]);
      const id = `${cinema.id}-${slug || title}-${+start}`;
      if (isNaN(start) || seen.has(id)) continue;
      seen.add(id);
      showings.push({ id, start, ticketUrl: own, film });
    }
  }

  // naam en ligging staan op de pagina zelf
  const meta = { url: own };
  const name = plain((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "").replace(/\s*\(.*$/, "");
  const geo = html.match(/\[\s*(5[0-3]\.\d+)\s*,\s*([3-7]\.\d+)\s*\]/);
  if (name) meta.name = name;
  if (geo) Object.assign(meta, { lat: Number(geo[1]), lon: Number(geo[2]) });
  return { showings, cinema: meta, hasGeo: Boolean(geo) };
}

// Filmladder serveert willekeurig een oude of een nieuwe opmaak. De nieuwe heeft geen datums,
// alleen acht dagkolommen vanaf vandaag, en geen coördinaten; wel plot, poster en IMDb-cijfer.
const DAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const isNewLayout = (html) => html.includes('class="showtimes-scroll') || html.includes('class="hall cv-auto"');

function amsterdamToday() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day, weekday: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() };
}

function parseNew(cinema, html) {
  const own = ownWebsite(cinema.id || cinema.slug); // leeg als we de eigen site niet kennen
  const today = amsterdamToday();
  const showings = [], seen = new Set();

  for (const block of html.split('class="hall cv-auto"').slice(1)) {
    const slug = (block.match(/href="\/film\/([^"\/?#]+)"/) || [])[1];
    const title = cleanTitle((block.match(/<div class="flex-1">([\s\S]*?)<\/div>/) || [])[1] || "");
    if (!title) continue;
    const src = (block.match(/class="hall-image[^"]*poster"[^>]*src="([^"]+)"/) || [])[1] || "";
    const film = {
      title, director: "", year: null, country: "", cast: [],
      plot: plain((block.match(/class="hall-synopsis">([\s\S]*?)<\/a>/) || [])[1] || ""),
      poster: src.startsWith("https://") ? src.replace("/small_", "/medium_") : "",
      imdbScore: Number((block.match(/IMDb-beoordeling ([\d.]+) van 10/) || [])[1]) || null,
      detailUrl: slug ? `${BASE}/film/${slug}` : "",
    };
    const cols = block.split('class="showtime-col').slice(1);
    // de eerste kolom hoort vandaag te zijn; klopt de weekdag niet, dan vertrouwen we de pagina niet
    const first = (cols[0]?.match(/data-day="([a-z]{2})"/) || [])[1];
    if (cols.length && first !== DAYS[today.weekday]) throw new Error("dagkolommen beginnen niet bij vandaag");
    cols.forEach((col, i) => {
      for (const m of col.matchAll(/class="showtime"[^>]*href="(\/kaartjes\/\d+)"[^>]*>\s*(\d{2}):(\d{2})\s*</g)) {
        const start = amsterdamDate(today.y, today.m, today.d + i, +m[2], +m[3]);
        const id = `${cinema.id}-${slug || title}-${+start}`;
        if (seen.has(id)) continue;
        seen.add(id);
        showings.push({ id, start, ticketUrl: own, film });
      }
    });
  }
  const meta = { url: own };
  const name = plain((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "").replace(/\s*\(.*$/, "");
  if (name) meta.name = name;
  return { showings, cinema: meta, hasGeo: false };
}

module.exports = async function filmladder(cinema) {
  const url = `${BASE}/bioscoop/${cinema.slug}`;
  const knowsPlace = Number.isFinite(cinema.lat) && Number.isFinite(cinema.lon);
  let last;
  // Hooguit drie pogingen: de oude opmaak is preciezer en bevat de ligging; de nieuwe volstaat
  // zodra we al weten waar de bioscoop staat.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(4000);
    const html = await getText(url, "text/html");
    if (isNewLayout(html)) {
      last = parseNew(cinema, html);
      if (knowsPlace) return last;
    } else {
      const res = parse(cinema, html);
      if (res.hasGeo) return res;
    }
  }
  if (last && knowsPlace) return last;
  throw new Error(last ? "ligging onbekend (alleen nieuwe opmaak gekregen)" : "onvolledige pagina");
};

module.exports.urls = (cinema) => [`${BASE}/bioscoop/${cinema.slug}`];

// Alle bioscopen die Filmladder kent.
module.exports.discover = async function discover() {
  const html = await getText(`${BASE}/bioscopen`, "text/html");
  const names = new Map();
  // de namen staan er in twee vormen, afhankelijk van de opmaak die we krijgen
  for (const m of html.matchAll(/"name":"([^"\\]+)","url":"[^"]*\/bioscoop\/([a-z0-9-]+)"/g)) names.set(m[2], plain(m[1]));
  for (const m of html.matchAll(/\/bioscoop\/([a-z0-9-]+)"[^>]*>\s*(?:<span[^>]*>)?\s*([^<]{2,80}?)\s*</g)) if (!names.has(m[1])) names.set(m[1], plain(m[2]));
  const slugs = [...new Set([...html.matchAll(/\/bioscoop\/([a-z0-9-]+?)(?:\/popup)?"/g)].map((m) => m[1]))];
  return slugs.map((slug) => ({ slug, name: names.get(slug) || "" }));
};
module.exports.discoverUrl = `${BASE}/bioscopen`;

// Regisseur, acteurs, jaar en plot van de filmpagina.
module.exports.details = async function details(url) {
  const html = await getText(url, "text/html");
  const people = (prop) =>
    [...html.matchAll(new RegExp(`itemprop="${prop}"[^>]*>\\s*<span itemprop="name">([^<]*)<`, "g"))].map((m) => plain(m[1])).filter(Boolean);
  return {
    director: people("director").join(", "),
    cast: people("actor").slice(0, 2),
    year: Number.parseInt((html.match(/itemprop="copyrightYear" content="(\d{4})"/) || [])[1], 10) || null,
    plot: plain((html.match(/itemprop="description"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || ""),
  };
};
