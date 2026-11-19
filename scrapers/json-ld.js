// Sites die hun voorstellingen als schema.org-gegevens in de pagina zetten (Kriterion, LantarenVenster).
// Dat formaat is bedoeld om door machines gelezen te worden; werkt voor elke site die het gebruikt.

const { getText, cleanTitle, plain, amsterdamDate } = require("./util");

const types = (node) => [].concat(node?.["@type"] || []);

// Een voorstelling is een ScreeningEvent, of een Event dat een Movie vertoont.
function* events(node) {
  if (Array.isArray(node)) for (const n of node) yield* events(n);
  else if (node && typeof node === "object") {
    if (types(node).includes("ScreeningEvent") || (types(node).includes("Event") && types(node.workPresented).includes("Movie"))) yield node;
    if (node["@graph"]) yield* events(node["@graph"]);
  }
}

// "2026-11-22T11:15" zonder tijdzone is Nederlandse tijd.
function parseStart(value) {
  const s = String(value || "");
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return new Date(s);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  return m ? amsterdamDate(+m[1], +m[2], +m[3], +m[4], +m[5]) : new Date(NaN);
}

module.exports = async function jsonLd(cinema) {
  const html = await getText(cinema.programUrl || cinema.url, "text/html");
  const out = [], seen = new Set();
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    for (const e of events(data)) {
      const start = parseStart(e.startDate);
      const work = e.workPresented || {};
      const title = cleanTitle(work.name || e.name || "");
      if (!title || isNaN(start) || /Cancelled/i.test(e.eventStatus || "")) continue;
      const offer = [].concat(e.offers || [])[0] || {};
      if (/SoldOut/i.test(offer.availability || "")) continue;
      const id = `${cinema.id}-${offer.url ? offer.url.replace(/\/$/, "").split("/").pop() : +start + title}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const description = plain(e.description);
      out.push({
        id, start,
        ticketUrl: offer.url || e.url || cinema.url,
        film: {
          title,
          director: [].concat(work.director || []).map((d) => plain(d.name)).filter(Boolean).join(", "),
          year: Number.parseInt(work.dateCreated, 10) || null,
          country: "",
          cast: [].concat(work.actor || []).map((a) => plain(a.name)).filter(Boolean).slice(0, 2),
          // Kriterion vult hier een standaardzin in; dat is geen plot
          plot: /^Filmvoorstelling van /.test(description) ? "" : description,
          poster: typeof work.image === "string" && work.image.startsWith("https://") ? work.image : "",
        },
      });
    }
  }
  return out;
};

module.exports.urls = (cinema) => [cinema.programUrl || cinema.url];
