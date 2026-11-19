# draaiter online zetten

Netlify serveert de website en de zoekfunctie. GitHub Actions haalt elke zes uur het programma op
en zet de site opnieuw op Netlify. Je laptop hoeft daarvoor niet aan te staan.

## 1. De code staat klaar

De projectmap is `C:\Users\info\Projecten\straks`, met een lokale git-repository en een eerste commit.

## 2. GitHub

1. Maak een account op github.com als je dat nog niet hebt.
2. Maak een nieuwe, lege repository, bijvoorbeeld `draaiter`. Kies **Private**; zie "Kosten" onderaan.
   Vink geen README, .gitignore of licentie aan.
3. Zet de code erin. In PowerShell, in de projectmap:

   ```
   git remote add origin https://github.com/JOUW-NAAM/draaiter.git
   git push -u origin main
   ```

   `.env`, `data/` en `node_modules/` gaan niet mee; dat regelt `.gitignore`.

## 3. Netlify

1. Log in op app.netlify.com.
2. **Add new site > Deploy manually.** Sleep de map `dist` erin (maak die eerst met `node build.js`).
   Koppel de site **niet** aan GitHub: dan zou Netlify zelf bouwen, zonder programma.
3. Kies onder **Site configuration > Change site name** een naam; je adres wordt `naam.netlify.app`.
4. Kopieer onder **Site configuration** het **Site ID**.
5. Maak een toegangstoken: klik rechtsboven op je avatar > **User settings > Applications >
   Personal access tokens > New access token**. Kopieer hem meteen; je ziet hem maar één keer.

## 4. Geheimen in GitHub

In je repository: **Settings > Secrets and variables > Actions > New repository secret.**
Maak er vier:

| Naam | Waarde |
|---|---|
| `NETLIFY_AUTH_TOKEN` | de token uit stap 3.5 |
| `NETLIFY_SITE_ID` | het Site ID uit stap 3.4 |
| `TMDB_API_KEY` | dezelfde waarde als in je `.env` |
| `OMDB_API_KEY` | dezelfde waarde als in je `.env` |

## 5. Eerste ronde

Ga naar het tabblad **Actions**, kies **Programma ophalen en uitrollen** en klik **Run workflow**.
De eerste keer duurt het een half uur tot drie kwartier: alle bioscopen en films worden dan opgehaald.
Daarna gaat het vanzelf, om 01:17, 07:17, 13:17 en 19:17 (winter; in de zomer een uur later).

## Kosten

- **Netlify**: het gratis plan volstaat voor een test.
- **GitHub Actions**: privérepository's krijgen 2.000 minuten per maand gratis. Schatting voor elke zes
  uur: ruim 1.000 minuten per maand. Een openbare repository is onbeperkt, maar dan kan iedereen de
  code en de lijst met bioscoopadressen inzien.

## Voor de lancering

- De site staat op `noindex`: zoekmachines nemen hem niet op. Haal die regel weg in `netlify.toml`
  zodra je live wilt.
- Het programma komt grotendeels van Filmladder, filmgegevens van TMDB (gratis sleutel is niet-commercieel).
  Regel dat voordat je er geld mee verdient.

## Lokaal blijft het werken

`node serve.js` start de app op http://localhost:4180, met eigen ophaalrondes, net als voorheen.
