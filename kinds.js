// Indeling voor de categorieknoppen: wat is een filmhuis, wat is Pathé, wat is een kinderfilm.
// De filmhuislijst is met de hand samengesteld; Filmladder zegt het er niet bij. Pas gerust aan.

const FILMHUIZEN = new Set([
  // eigen scrapers
  "kriterion", "themovies", "hartlooper", "springhaver", "kino", "lantarenvenster", "filmhuisdenhaag",
  // Amsterdam
  "cinecenter-amsterdam", "cinema-de-vlugt-amsterdam", "de-balie-amsterdam", "de-uitkijk-amsterdam", "eye-amsterdam",
  "fc-hyena-amsterdam", "filmhallen-amsterdam", "het-documentaire-paviljoen-amsterdam", "het-ketelhuis-amsterdam",
  "lab111-amsterdam", "melkweg-cinema-amsterdam", "rialto-de-pijp-amsterdam", "rialto-silo", "silo-rialto-amsterdam",
  "rialto-vu-amsterdam", "studio-k-amsterdam", "podium-mozaiek-amsterdam",
  // rest van het land
  "de-lieve-vrouw-amersfoort", "gigant-apeldoorn", "cinema-kiek-in-de-pot-bergen-op-zoom", "chasse-cinema-breda",
  "verkadefabriek-den-bosch", "theater-dakota-den-haag", "mimik-deventer", "de-witt-dordrecht", "lab-1", "natlab",
  "concordia-enschede", "podium-t-beest-goes", "forum-groningen-groningen", "filmkoepel-haarlem", "schuur-haarlem",
  "de-cacaofabriek-helmond", "cinema-oostereiland-hoorn", "slieker-film-leeuwarden", "kijkhuis-leiden",
  "lumiere-maastricht", "cinema-middelburg-middelburg", "lux-nijmegen", "cinerama-rotterdam", "worm-rotterdam",
  "wenneker-cinema-schiedam", "artishock", "cinecitta-tilburg", "slachtstraat-utrecht", "de-nieuwe-scene-venlo",
  "heerenstraat-theater-wageningen", "de-fabriek-zaandam", "fraterhuis-zwolle",
]);

// "pathe" | "filmhuis" | "overig"
function cinemaKind(cinema) {
  if (cinema.id.startsWith("pathe-")) return "pathe";
  // wie zichzelf filmhuis of filmtheater noemt, is het
  if (FILMHUIZEN.has(cinema.id) || /filmhuis|filmtheater/i.test(`${cinema.id} ${cinema.name || ""}`)) return "filmhuis";
  return "overig";
}

// Kinderfilm: familiegenre, of een titel die het zegt ("(NL)" = Nederlands gesproken, "(4+)", Cinemini).
// Animatie alleen telt niet; daar valt ook Akira onder.
const KIDS_GENRE = /^(familie|familiefilm|kinderfilm|jeugdfilm)$/i;
const KIDS_TITLE = /\((?:NL|\d{1,2}\+)\)|nederlands gesproken|cinemini|peuter|kleuter|\bkids\b|kinderprogramma|kinderfilm|sinterklaas/i;

function isKidsFilm(film) {
  const genres = film.genres || [];
  if (genres.some((g) => /^documentaire$/i.test(g)) && !KIDS_TITLE.test(film.title)) return false;
  return genres.some((g) => KIDS_GENRE.test(g)) || KIDS_TITLE.test(film.title);
}

module.exports = { cinemaKind, isKidsFilm };
