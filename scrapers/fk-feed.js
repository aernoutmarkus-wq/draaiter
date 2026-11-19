// Sites op het gedeelde filmtheaterplatform (Hartlooper, Springhaver, The Movies, KINO).
// Hun eigen agenda leest /fk-feed/agenda; wij lezen hetzelfde bestand, één verzoek per site.

const { getText, plain, cleanTitle, amsterdamDate } = require("./util");

module.exports = async function fkFeed(cinema) {
  const origin = new URL(cinema.url).origin;
  const feed = JSON.parse(await getText(`${origin}/fk-feed/agenda`, "application/json"));
  const out = [];

  for (const item of Object.values(feed)) {
    if (!item || !item.title || !Array.isArray(item.times)) continue;
    const film = {
      title: cleanTitle(item.title),
      director: plain(item.director_name?.value),
      year: Number.parseInt(item.year, 10) || null,
      country: plain(item.country),
      cast: plain(item.starring_short).split(",").map((s) => s.trim()).filter(Boolean).slice(0, 2),
      plot: plain(item.synopsis || item.storyline),
      poster: String(item.poster || "").startsWith("https://") ? item.poster : "",
      // Nederlandse releasedatum zoals de bioscoop hem opgeeft: "20261105" -> "2026-11-05"
      release: String(item.dates?.release || "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3").match(/^\d{4}-\d{2}-\d{2}$/)?.[0] || "",
    };
    for (const t of item.times) {
      const m = String(t.program_start || "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
      if (!m || /sold|uitverkocht/i.test(t.ticket_status || "")) continue;
      out.push({
        id: `${cinema.id}-${t.provider_id || t.child_id}`,
        start: amsterdamDate(+m[1], +m[2], +m[3], +m[4], +m[5]),
        ticketUrl: t.provider_id ? `${origin}/tickets/${encodeURIComponent(t.provider_id)}` : item.permalink || cinema.url,
        film,
      });
    }
  }
  return out;
};

module.exports.urls = (cinema) => [`${new URL(cinema.url).origin}/fk-feed/agenda`];
