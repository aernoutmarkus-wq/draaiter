// De eigen website van elke bioscoop, voor de KOOP TICKETS-knop. Nooit Filmladder.
//
// Ketens: de pagina van die vestiging op de site van de keten (uit hun eigen overzichtspagina's).
// Onafhankelijk: de homepage, gecontroleerd op naam, stad en filmaanbod (websites-onafhankelijk.json).
// Staat een bioscoop hier niet in, dan toont de app geen ticketknop.

const independent = require("./websites-onafhankelijk.json");

const PATHE = {
  "pathe-amersfoort-amersfoort": "pathe-amersfoort",
  "pathe-amsterdam-noord-amsterdam": "pathe-amsterdam-noord",
  "pathe-arena-amsterdam": "pathe-arena",
  "pathe-city-amsterdam": "pathe-city",
  "pathe-de-munt-amsterdam": "pathe-de-munt",
  "pathe-tuschinski-amsterdam": "koninklijk-theater-tuschinski",
  "pathe-arnhem-arnhem": "pathe-arnhem",
  "pathe-breda-breda": "pathe-breda",
  "pathe-delft-delft": "pathe-delft",
  "pathe-buitenhof-den-haag": "pathe-buitenhof",
  "pathe-scheveningen-den-haag": "pathe-scheveningen",
  "pathe-spuimarkt-den-haag": "pathe-spuimarkt",
  "pathe-ypenburg-den-haag": "pathe-ypenburg",
  "pathe-ede-ede": "pathe-ede",
  "pathe-eindhoven-eindhoven": "pathe-eindhoven",
  "pathe-groningen-groningen": "pathe-groningen",
  "pathe-haarlem-haarlem": "pathe-haarlem",
  "pathe-helmond-helmond": "pathe-helmond",
  "pathe-leeuwarden-leeuwarden": "pathe-leeuwarden",
  "pathe-maastricht-maastricht": "pathe-maastricht",
  "pathe-nijmegen-nijmegen": "pathe-nijmegen",
  "pathe-de-kuip-rotterdam": "pathe-de-kuip",
  "pathe-schouwburgplein-rotterdam": "pathe-schouwburgplein",
  "pathe-euroscoop-schiedam-schiedam": "pathe-schiedam",
  "pathe-euroscoop-tilburg-tilburg": "pathe-tilburg-stappegoor", // de oude Euroscoop aan de Stappegoorweg
  "pathe-tilburg-tilburg": "pathe-tilburg-centrum",
  "pathe-rembrandt-utrecht-utrecht": "pathe-rembrandt-utrecht",
  "pathe-utrecht-leidsche-rijn-utrecht": "pathe-utrecht-leidsche-rijn",
  "pathe-zaandam-zaandam": "pathe-zaandam",
  "pathe-zwolle-zwolle": "pathe-zwolle",
};

const VUE = {
  "vue-alkmaar-alkmaar": "alkmaar", "vue-alphen-aan-den-rijn-alphen-aan-den-rijn": "alphen-aan-den-rijn",
  "vue-amersfoort-amersfoort": "amersfoort", "vue-amsterdam-amsterdam": "amsterdam", "vue-apeldoorn-apeldoorn": "apeldoorn",
  "vue-arnhem-arnhem": "arnhem", "vue-den-bosch": "den-bosch", "vue-deventer-deventer": "deventer",
  "vue-doetinchem-doetinchem": "doetinchem", "vue-eindhoven-eindhoven": "eindhoven", "vue-enschede-enschede": "enschede",
  "vue-gorinchem-gorinchem": "gorinchem", "vue-heerhugowaard-heerhugowaard": "heerhugowaard", "vue-hilversum-hilversum": "hilversum",
  "vue-hoogeveen-hoogeveen": "hoogeveen", "vue-hoogezand-hoogezand": "hoogezand", "vue-hoorn-enschede": "hoorn",
  "vue-kerkrade-kerkrade": "kerkrade", "vue-nijmegen-nijmegen": "nijmegen", "vue-purmerend-purmerend": "purmerend",
  "vue-vlaardingen-vlaardingen": "vlaardingen",
};

const KINEPOLIS = {
  "kinepolis-almere-almere": "kinepolis-almere", "kinepolis-breda-breda": "kinepolis-breda",
  "kinepolis-den-bosch-den-bosch": "kinepolis-den-bosch", "kinepolis-den-helder-den-helder": "kinepolis-den-helder",
  "kinepolis-dordrecht-dordrecht": "kinepolis-dordrecht", "kinepolis-emmen-emmen": "kinepolis-emmen",
  "kinepolis-enschede-enschede": "kinepolis-enschede", "kinepolis-groningen-groningen": "kinepolis-groningen",
  "kinepolis-haarlem-haarlem": "kinepolis-haarlem", "kinepolis-hoofddorp-hoofddorp": "kinepolis-cinemeerse-hoofddorp",
  "kinepolis-leidschendam-leidschendam": "kinepolis-leidschendam", "kinepolis-oss-oss": "kinepolis-oss",
  "kinepolis-schagen-schagen": "kinepolis-schagen", "kinepolis-spijkenisse-spijkenisse": "kinepolis-spijkenisse",
  "kinepolis-jaarbeurs-utrecht-utrecht": "kinepolis-jaarbeurs-utrecht", "kinepolis-zoetermeer-zoetermeer": "kinepolis-zoetermeer",
  // geen Kinepolis in de naam, wel van Kinepolis
  "cinerama-rotterdam": "cinerama", "utrecht-city-utrecht": "utrecht-city",
};

function ownWebsite(cinemaId) {
  if (PATHE[cinemaId]) return `https://www.pathe.nl/nl/bioscopen/${PATHE[cinemaId]}`;
  if (VUE[cinemaId]) return `https://www.vuecinemas.nl/cinema/${VUE[cinemaId]}/nu-in-de-bioscoop`;
  if (KINEPOLIS[cinemaId]) return `https://kinepolis.nl/bioscopen/${KINEPOLIS[cinemaId]}/`;
  return independent[cinemaId] || "";
}

// Laatste vangnet: een link naar Filmladder komt er nooit door.
const isFilmladder = (url) => /(^|\/\/|\.)filmladder\.nl/i.test(String(url || ""));
const safeUrl = (url) => (url && !isFilmladder(url) ? url : "");

module.exports = { ownWebsite, isFilmladder, safeUrl };
