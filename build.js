// Zet de website klaar in dist/ voor Netlify: alleen de bestanden die bezoekers nodig hebben.
// Start: node build.js

const fs = require("fs");
const path = require("path");
const { fontCss, fontFiles, PUBLIC_FILES } = require("./lib/api");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, "fonts"), { recursive: true });

for (const f of PUBLIC_FILES) fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f));

// de lokale server maakt font.css bij elk verzoek; online is het een vast bestand
fs.writeFileSync(path.join(DIST, "font.css"), fontCss(ROOT));
const { busorama, hosted } = fontFiles(ROOT);
for (const f of [busorama, ...hosted.map((h) => h.file)].filter(Boolean))
  fs.copyFileSync(path.join(ROOT, "fonts", f), path.join(DIST, "fonts", f));

const data = path.join(ROOT, "data", "showtimes.json");
const info = fs.existsSync(data)
  ? (() => { const p = JSON.parse(fs.readFileSync(data, "utf8")); return `${p.showings.length} voorstellingen, opgehaald ${new Date(p.scrapedAt).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" })}`; })()
  : "GEEN programma gevonden; de site toont dan demodata";

console.log(`dist/ klaar: ${fs.readdirSync(DIST).length} onderdelen. Programma: ${info}.`);
