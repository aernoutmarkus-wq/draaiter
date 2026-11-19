// ---------- instellingen ----------

const RADIUS_KM = 12;        // bioscopen binnen deze straal tellen als "in de buurt"
const PAGE = 24;             // voorstellingen per keer; "Toon meer" haalt er steeds zoveel bij
const PRESET_TIMES = ["15:00", "19:00", "20:30"]; // snelkeuze voor een latere dag
const DAYS_AHEAD = 5;        // zo ver vooruit kun je kiezen
const FIRST_SLOT = 9 * 60, LAST_SLOT = 23 * 60 + 30; // tijdkeuze loopt van 09:00 tot 23:30
const AFFILIATE = {          // later te vullen; tot die tijd gaat de link kaal naar de verkoper
  param: "ref",
  id: "",
};

// ---------- staat ----------

const state = {
  pos: null,           // {lat, lon}
  place: "",           // tekst in de kop
  fromGps: false,
  live: true,          // "Nu": de tijd loopt mee
  when: new Date(),
  limit: PAGE,
  data: null,          // {showings, cinemas, far, more, source, error}
  cinemas: new Set(),  // aangevinkte bioscopen; leeg = alle in de regio
  cat: "",             // "", "kids", "filmhuis" of "pathe"
  trailers: new Set(), // de voorstelling waarvan de trailer speelt (in de pop-up)
};

const $ = (s) => document.querySelector(s);
const el = {
  place: $("#place"), city: $("#city"), locate: $("#locate"),
  time: $("#time"), now: $("#now"), note: $("#note"), list: $("#list"), demo: $("#demo"),
  presets: $("#presets"), adders: [...document.querySelectorAll("[data-add]")], back: $('[data-add="-30"]'),
  detail: $("#detail"),
  cinemas: $("#cinemas"), more: $("#more"), cats: [...document.querySelectorAll("[data-cat]")],
  days: $("#days"),
};

// ---------- hulpjes ----------

const pad = (n) => String(n).padStart(2, "0");
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 864e5);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nl = (n) => n.toFixed(1).replace(".", ",");

function km(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function distLabel(d) {
  if (d == null) return "";
  return d < 1 ? `${Math.round(d * 100) * 10} m` : `${nl(d)} km`;
}

function relLabel(date) {
  const min = Math.round((date - new Date()) / 6e4);
  if (min < 0 || min >= 180) return "";
  if (min < 1) return "nu";
  if (min < 60) return `over ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `over ${h} u ${m}` : `over ${h} uur`;
}

// Link naar de voorstelling zelf als de bron die levert; anders de site van de bioscoop.
// Nooit naar Filmladder: dan liever geen knop.
function ticketUrl(s) {
  const own = [s.ticketUrl, s.cinema.url].find((x) => x && !/filmladder\.nl/i.test(x));
  let u;
  try { u = new URL(own); } catch { return ""; }
  if (!/^https?:$/.test(u.protocol)) return "";
  if (AFFILIATE.id) u.searchParams.set(AFFILIATE.param, AFFILIATE.id);
  return u.href;
}

// ---------- data ----------
// De server (serve.js) levert het opgehaalde programma. Is dat er niet, dan valt de app terug op demodata.

let requestSeq = 0;

async function refresh() {
  if (!state.pos) return;
  if (state.live) state.when = new Date();
  if (state.data) render(); // bediening direct bijwerken; de lijst volgt

  const mine = ++requestSeq, pos = state.pos, from = state.when;
  let data;
  try {
    const q = new URLSearchParams({ lat: pos.lat.toFixed(3), lon: pos.lon.toFixed(3), from: from.toISOString(), limit: state.limit });
    if (state.cinemas.size) q.set("cinemas", [...state.cinemas].join(","));
    if (state.cat) q.set("cat", state.cat);
    const j = await (await fetch(`/api/showtimes?${q}`)).json();
    data = j.source === "live"
      ? { ...j, showings: j.showings.map((s) => ({ ...s, start: new Date(s.start) })) }
      : { ...demoShowtimes(pos, from), source: "demo", error: j.error };
  } catch {
    data = { ...demoShowtimes(pos, from), source: "demo" };
  }
  if (mine !== requestSeq) return; // er is intussen iets anders gevraagd

  const withDist = (c) => ({ ...c, dist: c.lat != null && c.lon != null ? km(pos, c) : null });
  for (const s of data.showings) s.cinema = withDist(s.cinema);
  data.cinemas = (data.cinemas || []).map(withDist).sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9));
  data.showings.sort((a, b) => a.start - b.start || (a.cinema.dist ?? 1e9) - (b.cinema.dist ?? 1e9));
  // een aangevinkte bioscoop die hier niet (meer) bestaat, telt niet mee
  const known = new Set(data.cinemas.map((c) => c.id));
  for (const id of [...state.cinemas]) if (!known.has(id)) state.cinemas.delete(id);
  state.data = data;
  render();
}

function demoShowtimes(pos, from) {
  const withDist = CINEMAS.map((c) => ({ ...c, dist: km(pos, c) })).sort((a, b) => a.dist - b.dist);
  let near = withDist.filter((c) => c.dist <= RADIUS_KM);
  const far = near.length === 0;
  if (far) near = withDist.slice(0, 3);
  const chosen = near.filter((c) => state.cinemas.has(c.id));

  const out = [];
  for (const dayOffset of [0, 1]) {
    const base = startOfDay(from);
    base.setDate(base.getDate() + dayOffset);
    for (const cinema of chosen.length ? chosen : near) {
      for (const [filmId, times] of cinema.program) {
        for (const t of times) {
          const [h, m] = t.split(":").map(Number);
          const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m);
          if (start >= from) out.push({ id: `${cinema.id}-${filmId}-${+start}`, start, cinema, film: FILMS[filmId] });
        }
      }
    }
  }
  out.sort((a, b) => a.start - b.start || a.cinema.dist - b.cinema.dist);
  return { showings: out.slice(0, state.limit), more: out.length > state.limit, far, cinemas: near.map(({ id, name, lat, lon }) => ({ id, name, lat, lon })) };
}

// ---------- tekenen ----------

// Zonder sfeertekst tonen we de plot, maar kort: de eerste zinnen tot ongeveer 220 tekens.
function shorten(text, max = 220) {
  const t = String(text || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "));
  return end > 80 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" ")) + "…";
}

const httpUrl = (u) => /^https?:\/\//.test(u || "");
const ytKey = (k) => (/^[\w-]{6,20}$/.test(k || "") ? k : "");

// Trailer: eerst een stilstaand beeld met een knop; YouTube laadt pas na een klik.
function trailerHtml(s) {
  const f = s.film, key = ytKey(f.trailer);
  if (key && state.trailers.has(s.id))
    return `<div class="trailer"><iframe src="https://www.youtube-nocookie.com/embed/${key}?autoplay=1&rel=0" title="Trailer ${esc(f.title)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
  const still = httpUrl(f.backdrop) ? `<img src="${esc(f.backdrop)}" alt="" referrerpolicy="no-referrer">` : "";
  if (key) return `<button class="trailer trailer--still" type="button" data-trailer="${esc(s.id)}">${still}<span class="play">▶ Trailer</span></button>`;
  return still ? `<div class="trailer trailer--still">${still}</div>` : "";
}

// "Sinds 5 nov (week 2)". De week telt vanaf de releasedag en geldt voor de dag van deze voorstelling.
// Na een jaar is een weeknummer geen informatie meer; dan alleen de datum.
function releaseLabel(s) {
  const m = String(s.film.release || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const rel = new Date(+m[1], +m[2] - 1, +m[3]);
  const days = dayDiff(s.start, rel);
  const sameYear = rel.getFullYear() === new Date().getFullYear();
  const date = rel.toLocaleDateString("nl-NL", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  if (days < 0) return `Voorpremière · release ${date}`;
  const week = Math.floor(days / 7) + 1;
  return week <= 52 ? `Sinds ${date} <span>(week ${week})</span>` : `Release ${date}`;
}

function filmBits(s) {
  const f = s.film;
  const meta = [
    f.director && `<strong>${esc(f.director)}</strong>`,
    f.year, f.country && esc(f.country),
  ].filter(Boolean).join(" · ");
  const lbUrl = f.letterboxd.url || (f.letterboxd.slug ? `https://letterboxd.com/film/${f.letterboxd.slug}/` : "");
  const score = (label, url, value) => !url ? "" :
    `<a class="score" href="${esc(url)}" target="_blank" rel="noopener"><span>${label}</span><b>${value ? nl(value) : "↗"}</b></a>`;
  const scores =
    score("IMDb", f.imdb.url || (f.imdb.id && `https://www.imdb.com/title/${encodeURIComponent(f.imdb.id)}/`), f.imdb.score) +
    score("Letterboxd", lbUrl, f.letterboxd.score);
  return { f, meta, scores };
}

// Waar en wanneer dezelfde film die dag nog meer draait in de regio: per bioscoop een rij tijden.
// Een tijd aanklikken maakt dat de gekozen voorstelling; de ticketknop volgt.
function othersHtml(s) {
  if (!others || others.length < 2) return others ? "" : `<div class="others" aria-busy="true"></div>`;
  const rows = new Map();
  for (const o of others) {
    if (!rows.has(o.cinema.id)) rows.set(o.cinema.id, { cinema: o.cinema, items: [] });
    rows.get(o.cinema.id).items.push(o);
  }
  const sorted = [...rows.values()].sort((a, b) => (a.cinema.dist ?? 1e9) - (b.cinema.dist ?? 1e9));
  return `
    <div class="others">
      <p class="label">Die dag in de buurt</p>
      ${sorted.map((r) => `
        <div class="o-row">
          <span class="o-cin">${esc(r.cinema.name)}${r.cinema.dist != null ? `<small>${distLabel(r.cinema.dist)}</small>` : ""}</span>
          <span class="o-times">${r.items.map((o) =>
            `<button type="button" class="chip${o.id === s.id ? " on" : ""}" data-pick="${esc(o.id)}" aria-pressed="${o.id === s.id}">${hhmm(o.start)}</button>`).join("")}</span>
        </div>`).join("")}
    </div>`;
}

// De pop-up: alles over één voorstelling, midden op het scherm.
function detailHtml(s) {
  const { f, meta, scores } = filmBits(s);
  const buy = ticketUrl(s);
  const rel = relLabel(s.start);
  const day = dayDiff(s.start, new Date());
  const dayText = day === 0 ? "Vandaag" : day === 1 ? "Morgen" : s.start.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
  return `
    <button type="button" class="close" data-close aria-label="Sluiten">×</button>
    ${trailerHtml(s)}
    <div class="detail-body">
      <p class="when"><b>${hhmm(s.start)}</b><small>${dayText}${rel ? ` · ${rel}` : ""} · ${esc(s.cinema.name)}${s.cinema.dist != null ? ` · ${distLabel(s.cinema.dist)}` : ""}</small></p>
      <h2 class="title" id="detail-title">${esc(f.title)}</h2>
      ${f.genres?.length ? `<p class="genre">${f.genres.map(esc).join(" · ")}</p>` : ""}
      ${meta ? `<p class="meta">${meta}</p>` : ""}
      ${f.cast.length ? `<p class="cast">${f.cast.map(esc).join(", ")}</p>` : ""}
      ${releaseLabel(s) ? `<p class="release">${releaseLabel(s)}</p>` : ""}
      ${othersHtml(s)}
      ${f.likes?.length ? `<p class="likes"><span>Voor liefhebbers van</span> ${f.likes.map((l) => `<b>${esc(l.title)}</b>`).join(", ")}</p>` : ""}
      <p class="plot">${esc(f.sfeer || shorten(f.plot, 320) || "Geen beschrijving beschikbaar.")}</p>
      ${scores ? `<div class="row">${scores}</div>` : ""}
    </div>
    ${buy ? `<div class="detail-foot"><a class="buy" href="${esc(buy)}" target="_blank" rel="noopener sponsored">KOOP TICKETS</a>
      <p class="buy-sub">Je rekent af bij de bioscoop.</p></div>` : ""}`;
}

function cardHtml(s) {
  const { f, meta, scores } = filmBits(s);
  const rel = relLabel(s.start);
  return `
  <li class="card">
    <div class="card-head" role="button" tabindex="0" aria-haspopup="dialog" data-card="${esc(s.id)}">
      <div class="poster-wrap">
        ${httpUrl(f.poster)
          ? `<img class="poster" src="${esc(f.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'poster poster--none'}))">`
          : `<div class="poster poster--none"></div>`}
      </div>
      <div class="info">
        <p class="when"><b>${hhmm(s.start)}</b>${rel ? `<small>${rel}</small>` : ""}</p>
        <h2 class="title">${esc(f.title)}</h2>
        ${f.genres?.length ? `<p class="genre">${f.genres.map(esc).join(" · ")}</p>` : ""}
        ${meta ? `<p class="meta">${meta}</p>` : ""}
        ${f.cast.length ? `<p class="cast">${f.cast.map(esc).join(", ")}</p>` : ""}
        ${releaseLabel(s) ? `<p class="release">${releaseLabel(s)}</p>` : ""}
        ${f.sfeer ? `<p class="sfeer">${esc(f.sfeer)}</p>` : ""}
        <p class="venue">${esc(s.cinema.name)}${s.cinema.dist != null ? ` · ${distLabel(s.cinema.dist)}` : ""}</p>
        <div class="row">${scores}</div>
      </div>
    </div>
  </li>`;
}

// Tijden om uit te kiezen, per half uur. Vandaag alleen wat nog komt; terug in de tijd kan niet.
function timeOptions(day) {
  const out = [];
  const now = new Date();
  let from = FIRST_SLOT;
  if (day === 0) {
    out.push({ value: "now", label: `Nu (${hhmm(now)})` });
    from = Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30;
  } else {
    out.push({ value: "00:00", label: "Hele dag" });
  }
  for (let m = from; m <= LAST_SLOT; m += 30) {
    const t = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    out.push({ value: t, label: t });
  }
  return out;
}

function dayLabel(offset) {
  if (offset === 0) return "Vandaag";
  if (offset === 1) return "Morgen";
  const d = startOfDay(new Date());
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric" });
}

function renderControls() {
  const now = new Date();
  const day = Math.min(DAYS_AHEAD, Math.max(0, dayDiff(state.when, now)));
  const time = hhmm(state.when);

  el.days.innerHTML = Array.from({ length: DAYS_AHEAD + 1 }, (_, i) =>
    `<button type="button" data-day="${i}" class="${i === day ? "on" : ""}" aria-pressed="${i === day}">${dayLabel(i)}</button>`).join("");

  // de gekozen tijd staat altijd in de lijst, ook als die niet op een half uur valt (na "+ 30 min" vanaf nu)
  const current = state.live ? "now" : time;
  const options = timeOptions(day);
  if (!options.some((o) => o.value === current)) {
    options.push({ value: current, label: current });
    options.sort((a, b) => (a.value === "now" ? -1 : b.value === "now" ? 1 : a.value.localeCompare(b.value)));
  }
  el.time.innerHTML = options.map((o) => `<option value="${o.value}"${o.value === current ? " selected" : ""}>${o.label}</option>`).join("");

  el.now.classList.toggle("on", state.live);
  el.back.disabled = state.live; // eerder dan nu bestaat niet
  el.place.textContent = state.place;
  el.locate.classList.toggle("on", state.fromGps);

  el.cats.forEach((b) => {
    const on = b.dataset.cat === state.cat;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on);
  });

  // voor een latere dag: vaste tijden als snelkeuze
  el.presets.hidden = day === 0;
  el.presets.innerHTML = PRESET_TIMES
    .map((t) => `<button type="button" class="chip${t === time ? " on" : ""}" data-preset="${t}">${t}</button>`).join("");
}

function renderCinemas(cinemas) {
  el.cinemas.hidden = cinemas.length < 2;
  if (cinemas.length < 2) return;
  const all = state.cinemas.size === 0;
  el.cinemas.innerHTML =
    `<button type="button" class="chip${all ? " on" : ""}" data-cinema="" aria-pressed="${all}">Alle ${cinemas.length}</button>` +
    cinemas.map((c) => {
      const on = state.cinemas.has(c.id);
      return `<button type="button" class="chip${on ? " on" : ""}" data-cinema="${esc(c.id)}" aria-pressed="${on}">${esc(c.name)}<small>${distLabel(c.dist)}</small></button>`;
    }).join("");
}

function render() {
  if (!state.pos || !state.data) return;
  const { showings, cinemas, far, more, source, error } = state.data;
  const now = new Date();

  renderControls();
  renderCinemas(cinemas);

  el.demo.hidden = source !== "demo";
  $("#tmdb").hidden = !showings.some((s) => s.film.tmdb);
  const notes = [];
  if (error) notes.push(`Live tijden zijn nu niet beschikbaar (${error}).`);
  const what = { kids: "kinderfilm", filmhuis: "filmhuis", pathe: "Pathé" }[state.cat] || "bioscoop";
  if (far && cinemas.length) notes.push(`Geen ${what} binnen ${RADIUS_KM} km. Dit is het dichtstbijzijnde aanbod.`);
  el.note.hidden = !notes.length;
  el.note.textContent = notes.join(" ");
  el.more.hidden = !more;

  if (!showings.length) {
    el.list.innerHTML = `<li class="empty">Vanaf dit tijdstip draait er niets meer.</li>`;
    return;
  }

  let html = "", lastDay = dayDiff(state.when, now);
  for (const s of showings) {
    const sd = dayDiff(s.start, now);
    if (sd !== lastDay) {
      html += `<li class="day">${sd === 1 ? "Morgen" : s.start.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}</li>`;
      lastDay = sd;
    }
    html += cardHtml(s);
  }
  el.list.innerHTML = html;
}

// ---------- locatie ----------

function nearestCity(pos) {
  return Object.entries(CITIES)
    .map(([name, c]) => ({ name, d: km(pos, c) }))
    .sort((a, b) => a.d - b.d)[0];
}

// andere plek: andere bioscopen, dus de keuze en de lengte van de lijst beginnen opnieuw
function moveTo(pos) {
  state.pos = pos;
  state.cinemas.clear();
  state.limit = PAGE;
}

function setCity(name) {
  moveTo(CITIES[name]);
  state.place = name;
  state.fromGps = false;
  el.city.value = name;
  try { localStorage.setItem("draaiter.city", name); } catch {}
  refresh();
}

function locate() {
  if (!navigator.geolocation) return fallback("Je browser deelt geen locatie.");
  el.place.textContent = "Locatie zoeken";
  navigator.geolocation.getCurrentPosition(
    (p) => {
      moveTo({ lat: p.coords.latitude, lon: p.coords.longitude });
      const c = nearestCity(state.pos);
      state.place = c.d <= RADIUS_KM ? `Bij jou in de buurt · ${c.name}` : "Jouw locatie";
      state.fromGps = true;
      el.city.value = c.name;
      refresh();
    },
    () => fallback("Geen locatie gekregen."),
    { timeout: 8000, maximumAge: 300000 }
  );
}

function fallback(reason) {
  let saved = null;
  try { saved = localStorage.getItem("draaiter.city"); } catch {}
  setCity(CITIES[saved] ? saved : "Amsterdam");
  state.place = `${reason} Dan maar ${el.city.value}.`;
  render();
}

// ---------- bediening ----------

function setWhen(date) {
  const now = new Date();
  state.when = date < now ? now : date;
  state.live = date <= now;
  state.limit = PAGE;
  refresh();
}

function dayAt(offset, h, m) {
  const d = startOfDay(new Date());
  d.setDate(d.getDate() + offset);
  d.setHours(h, m, 0, 0);
  return d;
}
const currentDay = () => Math.min(DAYS_AHEAD, Math.max(0, dayDiff(state.when, new Date())));

el.city.innerHTML = Object.keys(CITIES).map((c) => `<option>${c}</option>`).join("");
el.city.addEventListener("change", () => setCity(el.city.value));
el.locate.addEventListener("click", locate);

el.time.addEventListener("change", () => {
  if (el.time.value === "now") return setWhen(new Date());
  const [h, m] = el.time.value.split(":").map(Number);
  setWhen(dayAt(currentDay(), h, m));
});

el.adders.forEach((b) =>
  b.addEventListener("click", () => setWhen(new Date(state.when.getTime() + b.dataset.add * 6e4)))
);

el.presets.addEventListener("click", (e) => {
  const b = e.target.closest("[data-preset]");
  if (!b) return;
  const [h, m] = b.dataset.preset.split(":").map(Number);
  setWhen(dayAt(currentDay(), h, m));
});

el.now.addEventListener("click", () => { state.live = true; state.limit = PAGE; refresh(); });

// Een andere dag kiezen houdt de gekozen tijd vast. Stond de tijd op "nu", dan begint
// een latere dag bij de eerste voorstelling. Een tijd die vandaag al voorbij is, wordt "nu".
el.days.addEventListener("click", (e) => {
  const b = e.target.closest("[data-day]");
  if (!b) return;
  const offset = +b.dataset.day;
  if (state.live) return setWhen(offset === 0 ? new Date() : dayAt(offset, 0, 0));
  setWhen(dayAt(offset, state.when.getHours(), state.when.getMinutes()));
});

// Bioscopen aan- en uitvinken; "Alle" wist de keuze.
el.cinemas.addEventListener("click", (e) => {
  const b = e.target.closest("[data-cinema]");
  if (!b) return;
  const id = b.dataset.cinema;
  if (!id) state.cinemas.clear();
  else state.cinemas.has(id) ? state.cinemas.delete(id) : state.cinemas.add(id);
  state.limit = PAGE;
  refresh();
});

// Categorie: andere soort betekent een andere rij bioscopen, dus die keuze vervalt.
el.cats.forEach((b) =>
  b.addEventListener("click", () => {
    state.cat = b.dataset.cat;
    state.cinemas.clear();
    state.limit = PAGE;
    refresh();
  })
);

el.more.addEventListener("click", () => { state.limit += PAGE; refresh(); });

// ---------- pop-up ----------

let shown = null;  // de voorstelling in de pop-up; los van de lijst, zodat verversen hem niet raakt
let others = null; // dezelfde film, die dag, in de regio; null zolang dat wordt opgehaald

function drawDetail() {
  const body = el.detail.querySelector(".detail-body");
  const top = body ? body.scrollTop : 0;
  el.detail.innerHTML = detailHtml(shown);
  const again = el.detail.querySelector(".detail-body");
  if (again) again.scrollTop = top;
}

async function loadOthers(s) {
  const pos = state.pos;
  if (!s.filmKey || !pos) { others = []; return; }
  // de hele dag van deze voorstelling, maar niet wat al voorbij is
  const dayStart = startOfDay(s.start), dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  dayEnd.setHours(5); // nachtfilms na middernacht horen bij de avond ervoor
  const from = new Date(Math.max(Date.now(), +dayStart));
  let list = [];
  try {
    const q = new URLSearchParams({ lat: pos.lat.toFixed(3), lon: pos.lon.toFixed(3), key: s.filmKey, from: from.toISOString(), to: dayEnd.toISOString() });
    const j = await (await fetch(`/api/film?${q}`)).json();
    list = (j.showings || []).map((o) => ({
      ...o, start: new Date(o.start), film: s.film,
      cinema: { ...o.cinema, dist: o.cinema.lat != null && o.cinema.lon != null ? km(pos, o.cinema) : null },
    }));
  } catch {}
  if (shown !== s) return; // pop-up is intussen dicht of toont iets anders
  others = list.sort((a, b) => a.start - b.start);
  drawDetail();
}

function openDetail(id) {
  const s = state.data?.showings.find((x) => x.id === id);
  if (!s) return;
  shown = s;
  others = null;
  state.trailers.clear();
  el.detail.innerHTML = detailHtml(s);
  if (!el.detail.open) el.detail.showModal();
  loadOthers(s);
}

// Een klik op KOOP TICKETS telt als gebeurtenis in GoatCounter, per bioscoop.
// Alleen de bioscoop en de film, nooit iets over de bezoeker. Zonder GoatCounter (adblocker, localhost) gebeurt er niets.
function countTicketClick(s) {
  try {
    window.goatcounter?.count?.({
      path: `tickets/${s.cinema.id}`,
      title: `${s.cinema.name}: ${s.film.title}`,
      event: true,
    });
  } catch {}
}

el.detail.addEventListener("click", (e) => {
  if (e.target.closest(".buy") && shown) return countTicketClick(shown); // de link zelf opent gewoon
  // klik naast de pop-up (op de donkere achtergrond) of op het kruisje sluit hem
  if (e.target === el.detail || e.target.closest("[data-close]")) return closeDetail();
  const pick = e.target.closest("[data-pick]");
  if (pick && others) {
    const next = others.find((o) => o.id === pick.dataset.pick);
    if (next) { shown = next; drawDetail(); }
    return;
  }
  const play = e.target.closest("[data-trailer]");
  if (play && shown) {
    state.trailers.add(shown.id);
    play.outerHTML = trailerHtml(shown);
  }
});

// sluiten haalt de inhoud weg; anders speelt een trailer onzichtbaar door
function emptyDetail() {
  el.detail.innerHTML = "";
  state.trailers.clear();
  shown = null;
  others = null;
}
function closeDetail() {
  if (el.detail.open) el.detail.close();
  emptyDetail();
}
el.detail.addEventListener("close", emptyDetail);
el.detail.addEventListener("cancel", (e) => { e.preventDefault(); closeDetail(); }); // Escape

el.list.addEventListener("click", (e) => {
  if (e.target.closest("a")) return; // scores zijn gewone links
  const head = e.target.closest("[data-card]");
  if (head) openDetail(head.dataset.card);
});

el.list.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-card]")) {
    e.preventDefault();
    openDetail(e.target.dataset.card);
  }
});

// meelopen met de klok
setInterval(() => { if (state.live) refresh(); }, 30000);
locate();
