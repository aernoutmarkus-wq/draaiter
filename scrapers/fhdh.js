// Filmhuis Den Haag: de agenda op hun site leest /api/program; wij lezen hetzelfde bestand.

const { getText, cleanTitle, plain, amsterdamDate } = require("./util");

module.exports = async function fhdh(cinema) {
  const origin = new URL(cinema.url).origin;
  const days = JSON.parse(await getText(`${origin}/api/program?lang=nl`, "application/json"));
  const out = [], seen = new Set();

  for (const day of Object.values(days)) {
    for (const item of Object.values(day?.films || {})) {
      if (!item?.title) continue;
      const film = {
        title: cleanTitle(item.title),
        director: plain(item.director),
        year: null, country: "", cast: [],
        plot: plain(item.description),
        poster: item.poster ? origin + item.poster : "",
        genres: typeof item.genre === "string" && item.genre ? [plain(item.genre)] : [],
      };
      for (const p of item.programs || []) {
        const d = String(p.starts_at_date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const t = String(p.starts_at_time || "").match(/^(\d{2}):(\d{2})$/);
        const id = `${cinema.id}-${p.program_id || p.id}`;
        if (!d || !t || p.is_sold_out || seen.has(id)) continue;
        seen.add(id);
        out.push({
          id,
          start: amsterdamDate(+d[1], +d[2], +d[3], +t[1], +t[2]),
          ticketUrl: item.uri ? origin + item.uri : cinema.url, // filmpagina; daar staat de bestelknop
          film,
        });
      }
    }
  }
  return out;
};

module.exports.urls = (cinema) => [`${new URL(cinema.url).origin}/api/program?lang=nl`];
