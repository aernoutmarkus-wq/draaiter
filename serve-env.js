// Leest .env in (KEY=waarde per regel). Bestaande omgevingsvariabelen gaan voor.
const fs = require("fs");
const path = require("path");

module.exports = function loadEnv() {
  let text;
  try { text = fs.readFileSync(path.join(__dirname, ".env"), "utf8"); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
};
