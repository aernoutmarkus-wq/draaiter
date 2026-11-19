// Gedeeld gereedschap voor de scrapers: beleefd ophalen, robots.txt, tekst opschonen.

const USER_AGENT = "DraaiterBot/0.1 (bioscoopagenda; haalt alleen programma's op)";
const UA_TOKEN = "draaiterbot";
const MIN_GAP_MS = 1500; // nooit sneller dan dit achter elkaar bij dezelfde site
const HOST_GAP_MS = { "www.filmladder.nl": 3000 }; // veel paginas bij één site: extra rustig

const lastHit = new Map();

async function politeFetch(url, accept = "*/*") {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) || 0) + (HOST_GAP_MS[host] || MIN_GAP_MS) - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(20000) });
  return res;
}

async function getText(url, accept) {
  const res = await politeFetch(url, accept);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ---------- robots.txt ----------

const robotsCache = new Map();

function parseRobots(text) {
  const groups = [];
  let current = null, lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  return groups;
}

function ruleMatches(pattern, target) {
  const re = "^" + pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*").replace(/\\\$$/, "$");
  return new RegExp(re).test(target);
}

// Mag deze url worden opgehaald? Volgt de eigen groep als die bestaat, anders "*".
// De langste passende regel wint; bij twijfel (robots.txt onbereikbaar) is het antwoord nee.
async function allowedByRobots(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    let groups = [];
    try {
      const res = await politeFetch(`${u.origin}/robots.txt`, "text/plain");
      if (res.ok) groups = parseRobots(await res.text());
      else if (res.status >= 500 || res.status === 403 || res.status === 401) groups = null;
    } catch {
      groups = null;
    }
    robotsCache.set(u.origin, groups);
  }
  const groups = robotsCache.get(u.origin);
  if (groups === null) return false;
  const group = groups.find((g) => g.agents.includes(UA_TOKEN)) || groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  const target = u.pathname + u.search;
  let best = null;
  for (const rule of group.rules)
    if (ruleMatches(rule.pattern, target) && (!best || rule.pattern.length > best.pattern.length)) best = rule;
  return best ? best.allow : true;
}

// ---------- tekst ----------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", egrave: "è", euml: "ë", iuml: "ï", ouml: "ö", uuml: "ü", aacute: "á", agrave: "à", ccedil: "ç", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…" };

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function plain(html) {
  return decodeEntities(String(html || "").replace(/<br\s*\/?>|<\/p>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

// "Fatherland (ENG subs) - Filmvoorstelling" -> "Fatherland"
function cleanTitle(raw) {
  return plain(raw)
    .replace(/\s+-\s+Filmvoorstelling$/i, "")
    .replace(/\s*\((?:en|eng|nl|engelse?|nederlandse?)\s+(?:subs?|subtitles|ondertitel(?:s|ing)?)\)/gi, "")
    .trim();
}

function filmKey(title) {
  return title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ---------- tijd ----------

// Lokale tijd in Nederland -> Date, ook als de server ergens anders staat.
function amsterdamDate(y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(guess)).map((p) => [p.type, Number(p.value)])
  );
  const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return new Date(guess - (shown - guess));
}

module.exports = { USER_AGENT, getText, allowedByRobots, plain, cleanTitle, filmKey, amsterdamDate };
