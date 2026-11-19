// Lokale server voor draaiter: de website, de zoekfunctie, en elke drie uur een verse oogst.
// Start: node serve.js   (online doet Netlify het serveren en GitHub Actions het ophalen)

const http = require("http");
const fs = require("fs");
const path = require("path");
require("./serve-env")();
const { runScrape, OUT } = require("./scrape");
const { handleQuery, fontCss, fontFiles, FONT_FILES, PUBLIC_FILES } = require("./lib/api");

const PORT = process.env.PORT || 4180;
const REFRESH_MS = 3 * 3600e3; // elke drie uur een verse oogst; vaker is nergens voor nodig

// ---------- programma ----------

let program = null;
let scraping = null;

function loadProgram() {
  try { program = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { program = null; }
}

function refresh() {
  if (scraping) return scraping;
  console.log("Programma's ophalen");
  scraping = runScrape()
    .then((r) => { program = r; console.log(`Programma bijgewerkt: ${r.showings.length} voorstellingen`); })
    .catch((e) => console.error("Ophalen mislukt:", e.message))
    .finally(() => { scraping = null; });
  return scraping;
}

// ---------- http ----------

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
const PUBLIC = new Set(PUBLIC_FILES);

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/showtimes" || url.pathname === "/api/film") {
      const { status, body } = handleQuery(program, url.pathname, url.searchParams, scraping ? "programma wordt opgehaald" : undefined);
      return sendJson(res, status, body);
    }

    if (url.pathname === "/font.css") {
      res.writeHead(200, { "Content-Type": TYPES[".css"], "Cache-Control": "no-store" });
      return res.end(fontCss(__dirname));
    }

    // alleen de bestanden van de app zelf; geen .env, geen servercode, geen data
    const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const { busorama, hosted } = fontFiles(__dirname);
    if (name === `fonts/${busorama}` || hosted.some((f) => name === `fonts/${f.file}`)) {
      return fs.readFile(path.join(__dirname, name), (err, data) => {
        const type = FONT_FILES[path.basename(name)]?.[0] || "font/woff2";
        res.writeHead(err ? 404 : 200, err ? {} : { "Content-Type": type, "Cache-Control": "max-age=86400" });
        res.end(err ? "Niet gevonden" : data);
      });
    }
    if (!PUBLIC.has(name)) {
      res.writeHead(404);
      return res.end("Niet gevonden");
    }
    fs.readFile(path.join(__dirname, name), (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end("Niet gevonden");
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(name)], "Cache-Control": "no-store" });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    console.log(`draaiter draait op http://localhost:${PORT}`);
    loadProgram();
    const age = program ? Date.now() - new Date(program.scrapedAt) : Infinity;
    if (age > REFRESH_MS) refresh();
    setInterval(refresh, REFRESH_MS);
  });
