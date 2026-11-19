// Netlify-functie: /api/showtimes en /api/film, net als de lokale server.
// Het programma (data/showtimes.json) gaat bij elke uitrol mee in de functie; zie netlify.toml.

const fs = require("fs");
const path = require("path");
const { handleQuery } = require("../../lib/api");

// Waar het bestand na het inpakken staat, verschilt per bundelaar; probeer de gangbare plekken.
const CANDIDATES = [
  path.join(__dirname, "..", "..", "data", "showtimes.json"),
  path.join(process.cwd(), "data", "showtimes.json"),
  path.join(process.env.LAMBDA_TASK_ROOT || "/var/task", "data", "showtimes.json"),
];

let program, loadedFrom;
function load() {
  if (program !== undefined) return program;
  for (const file of CANDIDATES) {
    try { program = JSON.parse(fs.readFileSync(file, "utf8")); loadedFrom = file; return program; } catch {}
  }
  program = null; // geen programma meegeleverd: de app valt terug op demodata
  return program;
}

exports.handler = async (event) => {
  const route = /\/film\/?$/.test(event.path || "") ? "/api/film" : "/api/showtimes";
  const params = new URLSearchParams(event.rawQuery ?? new URLSearchParams(event.queryStringParameters || {}).toString());
  const { status, body } = handleQuery(load(), route, params, program === null ? "programma niet gevonden" : undefined);
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // het programma verandert hooguit elke zes uur; een minuut bewaren scheelt aanroepen bij drukte
      "Cache-Control": "public, max-age=60",
    },
    body: JSON.stringify(body),
  };
};

// voor de test: waar kwam het programma vandaan
exports._loadedFrom = () => (load(), loadedFrom);
