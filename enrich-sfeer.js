// Sfeertekst en "voor liefhebbers van" per film, geschreven door Claude.
// Eén keer per film; daarna uit de cache. Zonder ANTHROPIC_API_KEY slaat de app dit over.

const sdk = require("@anthropic-ai/sdk");
const Anthropic = sdk.default || sdk;
const { zodOutputFormat } = require("@anthropic-ai/sdk/helpers/zod");
const { z } = require("zod");
const { filmKey } = require("./scrapers/util");

const MODEL = process.env.SFEER_MODEL || "claude-opus-5-5";
const TTL = 180 * 864e5;
const PARALLEL = 4;

const Schema = z.object({
  sfeer: z.string().describe("De sfeertekst, maximaal 22 woorden. Leeg als er te weinig bekend is om iets zinnigs te zeggen."),
  liefhebbers: z.array(z.object({
    titel: z.string().describe("Titel zoals die in Nederland bekend is"),
    jaar: z.number().int().describe("Jaar van uitkomen"),
  })).describe("Precies drie bekende, bestaande films die dezelfde kijker aanspreken. Leeg als sfeer leeg is."),
});

const SYSTEM = `Je schrijft voor draaiter, een Nederlandse app die laat zien welke film er zo meteen in de bioscoop draait. Iemand staat op het punt de deur uit te gaan en wil in één oogopslag weten wat voor avond een film oplevert. De plot staat er al; die hoef je niet na te vertellen.

Je krijgt de gegevens van één film en levert twee dingen.

1. Sfeer. Eén of twee korte zinnen, samen hooguit 22 woorden, die zeggen hoe de film voelt en voor welke bui hij is. Schrijf zoals een vriend met smaak het zou zeggen: concreet, droog, met een lichte ironische onderlaag. Voorbeelden van het register, niet om over te nemen: "Absurde vertelling waarin niemand krijgt wat hij wil, en dat is het leuke." "Bloederig en traag; niet voor na het eten." "Voor als je zin hebt in een avondje over de grond rollen." Spreek de lezer aan met je. Benoem de toon, het tempo en wat het met je doet; verklap niets van de afloop. Vermijd recensietaal en reclamewoorden (meesterwerk, must-see, ontroerend, meeslepend, hartverwarmend, indrukwekkend), uitroeptekens en gedachtestreepjes. Een puntkomma mag.

2. Voor liefhebbers van. Drie films die de meeste bioscoopgangers kennen en die dezelfde kijker aanspreken: zelfde toon of gevoel, niet per se hetzelfde onderwerp. Het moeten bestaande, eerder uitgebrachte speelfilms zijn, en niet de film zelf. Films van dezelfde regisseur mogen, maar hooguit één. Het veld "kandidaten" bevat suggesties uit een filmdatabase; gebruik ze als ze passen en bekend genoeg zijn, negeer ze anders.

Baseer je alleen op wat je over de film weet of in de gegevens leest. Veel films zijn nieuw; ken je de film niet, werk dan vanuit plot, genre en regisseur en verzin er niets bij. Is het geen film (een quiz, lezing, cursus) of staat er te weinig om iets zinnigs te zeggen, geef dan een lege sfeer en een lege lijst.`;

function describe(film) {
  return JSON.stringify({
    titel: film.title,
    jaar: film.year || undefined,
    regie: film.director || undefined,
    land: film.country || undefined,
    genre: film.genres?.length ? film.genres : undefined,
    cast: film.cast?.length ? film.cast : undefined,
    plot: film.plot || undefined,
    kandidaten: film.similar?.length ? film.similar.map((s) => `${s.title} (${s.year})`) : undefined,
  }, null, 1);
}

async function write(client, film) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: "user", content: describe(film) }],
    output_config: { effort: "low", format: zodOutputFormat(Schema) },
  });
  // geweigerd of afgekapt: liever niets dan een halve tekst
  if (response.stop_reason !== "end_turn" || !response.parsed_output) return null;
  const out = response.parsed_output;
  const sfeer = out.sfeer.trim().replace(/\s*[—–]\s*/g, "; ").replace(/!/g, ".");
  if (!sfeer) return { sfeer: "", likes: [] };
  const self = filmKey(film.title);
  const likes = out.liefhebbers
    .map((l) => ({ title: l.titel.trim(), year: l.jaar }))
    .filter((l) => l.title && filmKey(l.title) !== self)
    .slice(0, 3);
  return { sfeer, likes };
}

// Vult film.sfeer en film.likes voor alle films die genoeg gegevens hebben.
// verify(titel, jaar) -> bestaat deze film echt en is hij bekend genoeg? (TMDB; mag ontbreken)
async function enrichAll(films, cache, { log = console.log, verify, limit = 800 } = {}) {
  const client = new Anthropic();
  const todo = [];
  let done = 0;

  for (const film of films) {
    const ck = `${filmKey(film.title)}|${filmKey(film.director || "")}`;
    const hit = cache[ck];
    if (hit && Date.now() - hit.at < TTL) {
      if (hit.sfeer) { film.sfeer = hit.sfeer; film.likes = hit.likes; done++; }
    } else if ((film.plot || "").length >= 60 && todo.length < limit) {
      todo.push({ film, ck });
    }
  }

  let fatal = null, written = 0;
  const worker = async () => {
    while (todo.length && !fatal) {
      const { film, ck } = todo.shift();
      try {
        const res = await write(client, film);
        if (!res) continue;
        if (verify && res.likes.length) {
          const checked = [];
          for (const l of res.likes) if (await verify(l.title, l.year).catch(() => true)) checked.push(l);
          res.likes = checked;
        }
        // aanvullen tot drie uit de filmdatabase, als Claude er te weinig overhoudt
        for (const s of film.similar || []) {
          if (res.likes.length >= 3) break;
          if (!res.likes.some((l) => filmKey(l.title) === filmKey(s.title))) res.likes.push({ title: s.title, year: s.year });
        }
        cache[ck] = { at: Date.now(), ...res };
        if (res.sfeer) { film.sfeer = res.sfeer; film.likes = res.likes; written++; }
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) fatal = "Claude weigert de sleutel";
        else if (e instanceof Anthropic.PermissionDeniedError) fatal = "geen toegang tot dit model";
        else if (e instanceof Anthropic.RateLimitError) fatal = "limiet bereikt; volgende ronde verder";
        else if (e instanceof Anthropic.BadRequestError) fatal = `verzoek afgewezen: ${e.message}`;
        else if (e instanceof Anthropic.APIError) log(`  Sfeer: ${film.title} overgeslagen (${e.status || "netwerk"})`);
        else fatal = e.message;
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  log(`  Sfeer: ${written} nieuw geschreven, ${done} uit cache${fatal ? `; gestopt (${fatal})` : ""}`);
}

module.exports = { enrichAll, MODEL };
