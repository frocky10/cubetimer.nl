# CubeTimer — werkafspraken

Dit bestand is het geheugen van het project. Lees het aan het begin van elke
sessie; dan hoeft er niets opnieuw uitgelegd te worden.

**Taal:** de code, commentaar, commits en de interface zijn in het Nederlands.
Uitzondering: bestaande Engelse identifiers in `script.js` (`saveTime`,
`renderTimes`, …) blijven zoals ze zijn — niet massaal hernoemen.

---

## Wat is dit

Een speedcubing-timer op <https://cubetimer.nl>. Statische frontend met een
kleine PHP-API, draaiend op shared hosting met DirectAdmin.

**Wat de site kan:**

- Timer met spatiebalk (indrukken, vasthouden tot groen, loslaten) en op
  aanraakschermen een tik in het timervlak
- WCA-inspectie van 15 seconden met automatische +2 en DNF
- Officiële WCA-scrambles via [cubing.js](https://cubing.net) voor 19 events
- Sessies met een eigen event, lopende Ao5 en Ao12 per solve
- +2, DNF en verwijderen per solve (klik op een rij, of `2` / `D` / `⌫`)
- Statistieken per sessie, per dag en per week (Mo3, Ao5, Ao12, Ao50, Ao100)
- Smart cubes via Web Bluetooth: GAN (gen1–4), QiYi/X-Man, MoYu, Giiker en GoCube,
  met scramblehulp, automatisch starten en stoppen, en een analyse per solve
- Accounts met synchronisatie van je tijden naar de server
- Leaderboards per event, categorie en periode
- XP, levels, streaks en een rangbadge
- Daily challenges: scramble van de dag plus twee opdrachten
- 120 achievements in vier niveaus, plus zestien geheime
- Leerpagina met de beginnersmethode, F2L, en alle OLL- en PLL-algoritmes
- Openbare, deelbare profielen op /profiel.php?u=naam
- Volgen en vrienden, met een eigen vriendenranglijst
- Toernooimodus: een simulatie van een WCA-competitie tegen bots, of een echte
  afgelopen WCA-comp naspelen tegen de echte tijden van toen
- Spelmodi: streak, speedrun, survival en ladder, met een record per modus, en
  duels tegen vrienden op dezelfde scrambles
- Bug-/ideeënknop die een GitHub-issue aanmaakt
- Donker en licht thema, sessiegrafiek, confetti bij een PR

---

## Mappen

```
.github/workflows/deploy.yml   FTP-deploy naar DirectAdmin (branch: Release)
database/                      Genummerde SQL-migraties + uitleg
tools/                         Hulpscripts voor het ontwikkelen (niet gedeployd)
public_html/                   Precies wat er op de server komt te staan
  index.html                   De timer
  leren.html                   Leerpagina: beginner, F2L, OLL, PLL
  profiel.php                  Openbaar profiel, serverside gerenderd
  404.html                     Eigen foutpagina (noindex, paden vanaf de root)
  .htaccess                    Eén adres (https, zonder www), /u/naam, 404, caching
  robots.txt, sitemap.xml      Voor zoekmachines, zie het hoofdstuk SEO
  ads.txt                      Welke AdSense-accounts advertenties mogen tonen
  site.webmanifest, favicon.ico  Icoon en naam voor browsers en telefoons
  Style/style.css              Eén design system, met tokens bovenaan
  Script/
    ui.js                      Toasts, modals, ask(), api(), opslag  ← laadt eerst
    script.js                  Timerkern, sessies, instellingen, tabel, grafiek
    stats.js                   Statistieken sessie / vandaag / deze week
    settings.js                Koppelt de instellingen-modal aan script.js
    feedback.js                Bug-/ideeënknop
    account.js                 Inloggen, registreren, synchroniseren, profiel
    leaderboard.js             Ranglijsten
    challenges.js              Daily challenges en de scramble van de dag
    achievements.js            Achievements
    tournament.js              Toernooimodus, ook historische WCA-comps
    games.js                   Spelmodi en duels
    admin.js                   Beoordeelwachtrij (alleen voor de rol admin)
    smartcube.js               Smart cube: knop, venster, timer, analyse
    smartcube-protocols.js     Drivers per merk (pas geladen bij gebruik)
    smartcube-engine.js        Stand, scramble volgen, analyse (idem)
    cube.js                    Kleine 3x3: zetten uitvoeren en omkeren
    algorithms.js              OLL, PLL en F2L; plaatjes eruit afgeleid
    tutorials.js               De leerpagina
    vendor/aes.js              aes-js (MIT), voor de versleuteling van cubes
    scrambleScript.js          Scrambles via cubing.js (ES-module)
  api/                         PHP-backend
    bootstrap.php              Laadt de libs, zet de foutafhandeling
    status.php                 Welke onderdelen zijn beschikbaar?
    config.example.php         Sjabloon — kopieer naar ~/cubetimer_config.php
    lib/                       Config, Http, Database, Auth, RateLimiter, GitHubIssues,
                               SiteTime, Events, Averages, Records, Xp,
                               Leaderboard, Challenges, SolveFacts, Achievements,
                               PublicProfile, Follows, Tournaments, TournamentField,
                               SolveAnalysis, Ranking, GameModes, Duels, Wca,
                               Mailer, AccountMail
    auth/                      register, login, logout, me, verify-email,
                               resend-verification, forgot-password, reset-password
    sync/                      pull, push
    feedback/                  report
    leaderboard/               list
    archive/                   list, restore, clear (losse tijden)
    algorithms/                list, toggle (geleerde algoritmes)
    profile/                   overview, settings, public
    challenges/                today, submit, contribute
    achievements/              list
    follows/                   toggle, list
    tournament/                state, start, solve, abandon, wca-search, wca-competition
    games/                     overview, finish (spelmodi)
    duels/                     create, solve, decline
    admin/                     flags
  Pictures/  Fonts/
```

---

## Werkwijze

1. **Altijd op een eigen branch werken**, nooit rechtstreeks op `main`.
2. **`Release` is de deploybranch.** Een push naar `Release` zet `public_html/`
   via FTP live. Alleen mergen naar `Release` als het echt de deur uit mag.
3. **Vragen stellen voordat er code komt** als er een keuze te maken valt die
   het werk wezenlijk verandert.
4. **De roadmap staat in GitHub issues.** Kijk daar voordat je iets nieuws
   bedenkt; veel staat er al (leaderboards #13, tournament mode #12/#14,
   XP en levels #28, achievements #27, rank #26, tutorials #21).
5. **Elke database-wijziging is een nieuw genummerd bestand** in `database/`.
   Zie `database/README.md`. Nooit een al geïmporteerd bestand aanpassen.
6. **Werk de checklist in `README.md` bij** zodra er iets af is of bij komt.
   Die lijst verwijst naar de issuenummers en is de snelste manier om te zien
   waar het project staat.
7. **Geen geheimen in git.** Wachtwoorden en tokens horen uitsluitend in
   `~/cubetimer_config.php` op de server.

### Testen voor je iets oplevert

Er is geen testframework. Wat er wel is, en wat werkt:

```bash
# PHP-syntax van alle endpoints
find public_html/api -name '*.php' -exec php -l {} \;

# JavaScript-syntax (de twee ES-modules kunnen hier niet doorheen)
for f in ui script stats settings feedback account leaderboard challenges \
         achievements tournament games admin cube algorithms tutorials \
         smartcube smartcube-protocols smartcube-engine; do
  node --check public_html/Script/$f.js
done

# De algoritmes op de leerpagina controleren. Draai dit na elke wijziging aan
# algorithms.js: een tikfout in een algoritme zie je niet met het blote oog.
node tools/algoritmes-controleren.js

# De smart-cubedrivers en het rekenwerk, met nagebootste cubes. Zie het
# hoofdstuk Smart cubes voor de vergelijking met gan-web-bluetooth.
node tools/smartcube-testen.js

# Het rekenwerk van de spelmodi, de rangschikking per format (Ao5, Mo3, best
# of) en de omzetting van WCA-antwoorden. Geen database of netwerk nodig.
php tools/spelmodi-en-wca-testen.php

# SEO: titels, omschrijvingen, canonicals, sitemap, robots.txt, noindex op
# profielen, og:image, JSON-LD, ads.txt. Draai na elke wijziging aan een <head>.
php tools/seo-controleren.php

# De site lokaal draaien, inclusief werkende API
php -S 127.0.0.1:8123 -t public_html

# Een nagebootste WCA-API, voor de historische toernooien (zie Toernooimodus)
php -S 127.0.0.1:8124 tools/nep-wca-server.php

# Een nagebootste mailserver: elke mail wordt een .eml-bestand (zie Mail)
php tools/nep-smtp-server.php 2525 /tmp
```

Voor een echte test van accounts en synchronisatie: zet een MySQL/MariaDB op,
importeer `database/001_*.sql` en `002_*.sql`, en leg een
`cubetimer_config.php` één map boven `public_html` neer (die staat in
`.gitignore`).

> **Let op bij testen van de bug-knop:** de uitgaande proxy van sommige
> ontwikkelomgevingen voegt geldige GitHub-inloggegevens toe aan verzoeken naar
> `api.github.com`. Een "test"-melding kan dan een écht issue aanmaken, ook met
> een nepnaam als token. Laat `github.token` bij het testen leeg en test alleen
> de validatie- en spamcontroles.

---

## Frontend

### Design system

Alle kleuren, ruimtes, radiussen, schaduwen en fonts staan als custom
properties bovenin `Style/style.css`, in twee blokken: `:root` (donker) en
`[data-theme="light"]`. **Nooit een losse hex-waarde in een component** — altijd
een token. Wil je een kleur veranderen, doe dat op één plek.

Er is geen CSS-framework meer. Bootstrap is eruit; de componenten
(`.panel`, `.btn`, `.input`, `.select`, `.segmented`, `.switch`, `.stat`,
`.toast`, `.time-modal`) staan in `style.css` en zijn in beide thema's
uitgewerkt.

Het thema wordt vóór de eerste paint gezet door een klein inline script in de
`<head>`, dat `cubetimer_theme` uit localStorage leest. Verplaats dat script
niet naar een bestand; dan flitst de site bij het laden. `profiel.php` heeft
een eigen kopie van datzelfde script.

**De topbar op een smal scherm**: de knoppen staan in `.topbar__group`. Boven
860px staat die groep gewoon naast elkaar in de balk; daaronder wordt hij een
uitklapmenu achter de menuknop. Zelfde knoppen, zelfde code, alleen andere
plaatsing — er is dus geen tweede set knoppen om bij te werken. Zet je er een
knop bij, geef hem dan een `<span class="btn-icon__label">` zodat hij in het
menu een naam heeft.

### Klassen die je niet zomaar mag hernoemen

`script.js` en `smartcube.js` zoeken elementen op id en klasse op. Deze
namen liggen vast tenzij je het JS meeverandert:

`#timer`, `#ready-lights`, `.ready-light` (+ `.active` / `.green`),
`#table-body`, `#times-table`, `#Scrambles`, `.ScrambleBox`, `#session-pr`,
`#session-graph-canvas`, `#confetti-canvas`, `#theme-toggle` (+ `.moon` /
`.sun` / `.toggle-knob`), `#session-select`, `#cube-select`, `#cube-display`,
`.time-modal` (+ `.visible`), alle `#modal-*`, alle `#smartcube-*`,
alle `#games-*` en `[data-close-games]`, alle `#tournament-*`,
`[data-sc-view]` / `[data-sc-step]`, `.sc-move`, `[data-more-times]`,
`[data-settings-tab]` / `[data-settings-panel]`.

De klasse `.time-modal` is een historische naam en wordt door **alle** modals
gebruikt, niet alleen die van een solve.

### Laadvolgorde

`ui.js` moet als eerste geladen worden (alle andere scripts gebruiken
`window.CubeTimerUI`), daarna `script.js` (dat `window.cubeTimerApi` zet),
daarna de rest. Ze staan met `defer` in de `<head>`, wat de volgorde
garandeert. `scrambleScript.js` is een ES-module (cubing.js), laadt apart en
mag nergens vroeg op rekenen.

Een paar bestanden worden pas geladen als ze nodig zijn: `cube.js` en
`algorithms.js` (door de oefenknop), en `vendor/aes.js`, `cube.js`,
`smartcube-protocols.js` en `smartcube-engine.js` (zodra je het
smart-cubevenster opent). Wie ze niet nodig heeft, downloadt ze ook niet.

### De twee globale objecten

| Object | Van wie | Waarvoor |
|---|---|---|
| `window.CubeTimerUI` | `ui.js` | `toast`, `ask`, `openModal`, `closeModal`, `registerModal`, `isAnyModalOpen`, `api`, `status`, `refreshStatus`, `formatTime`, `uniqueId`, `storage` |
| `window.cubeTimerApi` | `script.js` | `getSessions`, `replaceSessions`, `getSetting`, `updateSetting`, `averageOf`, `bestAverageOf`, `getEffectiveTime`, `getEventOptions`, `setScrambleOverride`, `setActiveSessionEvent`, `setSolveCapture(handler, owner)`, `getSolveCaptureOwner`, `triggerConfetti`, `getRemovedSolveIds`, `clearRemovedSolveIds`, `getState`, `startInspectionFromBluetooth`, `startTimerFromBluetooth`, `stopTimerFromBluetooth({ ms, analysis })` |
| `window.CubeTimerAccount` | `account.js` | `currentUsername`, `getProfile`, `reloadProfile` |
| `window.CubeTimerLeaderboard` | `leaderboard.js` | `open`, `reload` |
| `window.CubeTimerChallenges` | `challenges.js` | `load`, `stopChallenge` |
| `window.CubeTimerAchievements` | `achievements.js` | `load`, `announce` |
| `window.CubeTimerTournament` | `tournament.js` | `load`, `stopCapture`, `isActive` |
| `window.CubeTimerGames` | `games.js` | `load`, `isRunning` |
| `window.CubeTimerCube` | `cube.js` | `parse`, `invert`, `after`, `colorAt`, `slot`, `isSolved` — alleen op `leren.html` en bij het oefenen |
| `window.CubeTimerAlgorithms` | `algorithms.js` | `all`, `byId`, `colorAt`, `pieceAt`, `groupLabel` |
| `window.CubeTimerSmartCube` | `smartcube-protocols.js` | `connect`, `open`, `isSupported`, `requestOptions`, `brandFor`, `parseMac` |
| `window.CubeTimerSmartEngine` | `smartcube-engine.js` | `Tracker`, `analyse`, `mergeMoves`, `moveTimes` |

Gebruik **`CubeTimerUI.ask()` in plaats van `prompt()` of `confirm()`** en
**`CubeTimerUI.toast()` in plaats van `alert()`**. De browserdialogen passen
niet bij de rest van de site en blokkeren de timer.

### Events tussen de scripts

| Event | Wanneer | Wie luistert |
|---|---|---|
| `cubetimer:data-change` | na elke wijziging aan tijden of sessies | `stats.js`, `account.js` |
| `cubetimer:event-change` | ander cube/event gekozen | `stats.js`, `smartcube.js` |
| `cubetimer:scramble-change` | nieuwe scramble klaar; `override: true` bij een vastgezette (scramble van de dag, oefengeval) | `smartcube.js`, `challenges.js` (slaat `override` over) |
| `cubetimer:solve-open` | een solve wordt geopend in het solve-venster | `smartcube.js` (tekent de analyse) |
| `cubetimer:settings-change` | instelling gewijzigd | `settings.js` |
| `cubetimer:solve` | een solve is opgeslagen, met de solve erbij | `challenges.js` |
| `cubetimer:synced` | synchronisatie geslaagd, server heeft herberekend | `challenges.js` |
| `cubetimer:auth-change` | in- of uitgelogd, met de verse status erbij | `admin.js`, `challenges.js`, `leaderboard.js`, `achievements.js` |
| `cubetimer:achievements-unlocked` | er zijn achievements behaald | `achievements.js` |
| `cubetimer:scrambler-ready` | cubing.js is geladen en `window.generateScrambles(event, n)` bestaat | `games.js` |

### Waar de data staat

localStorage is altijd de werkkopie, ook als je ingelogd bent. Zonder internet
blijft de timer dus gewoon werken.

| Sleutel | Inhoud |
|---|---|
| `cubetimer_sessions_v1` | `{ sessions: { <id>: { id, name, event, times[] } }, activeSessionId }` |
| `cubetimer_settings_v1` | thema, focusmodus, confetti, inspectie, vasthoudtijd, bevestigen |
| `cubetimer_theme` | het opgeloste thema (`dark`/`light`) voor het inline script |
| `cubetimer_stats_scope` | laatst gekozen periode in het statistiekenpaneel |
| `cubetimer_removed_v1` | solve-id's die ook van het account af moeten, tot de volgende synchronisatie ze heeft doorgegeven |
| `cubetimer_cube_macs` | per naam van een smart cube het MAC-adres dat werkte, zodat je het maar één keer hoeft in te vullen |
| `cubetimer_game_v1` | `{ run, prefs }`: een lopende streak/survival/ladder (zodat herladen hem niet kost) en de laatst gekozen instellingen per modus |

Een solve ziet er zo uit:

```js
{
  id: 'solve-<base36>-<random>',  // uniek; nodig om te kunnen synchroniseren
  raw: 12345,                     // milliseconden, of null bij een DNF
  penalty: null | 'plus2' | 'dnf',// de +2 zit NIET in raw verwerkt
  timestamp: '2026-09-22T10:15:00.000Z',
  scramble: "R U R' U' F2 ...",
  source: 'manual' | 'bluetooth',
  analysis: { ... }               // alleen bij een smart cube, zie Smart cubes
}
```

Oude solves uit localStorage hebben nog geen `id`; `ensureSolveIds()` vult die
bij het laden aan. Verwijder die functie niet.

### Gemiddelden

`averageOf(entries)` in `script.js` rekent volgens de WCA-regels: de beste en
de slechtste vallen weg, één DNF telt als slechtste en mag dus, vanaf twee
DNF's is het gemiddelde zelf een DNF. Gebruik altijd deze functie — niet zelf
een gemiddelde uitrekenen.

`bestAverageOf(entries, count)` ernaast geeft het *beste* gemiddelde over alle
aaneengesloten blokken, met precies dezelfde regels, maar in één doorloop (twee
monotone wachtrijen, net als `Averages.php`). `stats.js` gebruikt die voor de
beste Ao5 t/m Ao100; `averageOf()` sorteerde elk blok opnieuw en kostte bij een
Ao100 over 10.000 solves 105 ms per keer, nu 0,2 ms. Op 12.000 willekeurige
reeksen met DNF's en +2's geven ze hetzelfde antwoord. Pas je de regels aan,
doe dat dan in allebei. `script.js` gebruikt `averageOf()` voor het *lopende*
gemiddelde in de tabel.

---

## Backend (PHP)

PHP 8.1+. Geen composer, geen framework, geen autoloader: elk endpoint doet
`require_once __DIR__ . '/../bootstrap.php'` en gebruikt de statische klassen
uit `lib/`.

### Regels

- Elk endpoint stuurt **altijd** JSON, ook bij een fout:
  `{"ok":true, ...}` of `{"ok":false,"error":"<code>","message":"<in het Nederlands>"}`.
  Gebruik `Http::ok()` en `Http::fail()`; die stoppen de uitvoering zelf.
- Alles wat schrijft, eist `POST` én de header `X-Requested-With: XMLHttpRequest`
  (`Http::requireAjaxHeader()`). Samen met `SameSite=Lax` op de cookie is dat de
  CSRF-bescherming.
- **Altijd prepared statements** via `Database::run()` / `first()` / `all()`.
  Nooit een variabele in een SQL-string plakken.
- Wachtwoorden met `password_hash()` / `password_verify()`. Sessietokens staan
  gehasht (SHA-256) in de database, IP-adressen als HMAC (`Auth::fingerprint`).
- Nooit een technische foutmelding naar de browser sturen. `error_log()` voor
  jezelf, een nette zin voor de bezoeker. `debug => true` in de config zet de
  details wél in het antwoord — alleen tijdens het uitzoeken.
- **Alles moet blijven werken zonder database.** `Database::tryConnection()`
  geeft `null` in plaats van te klappen; `status.php` vertelt de frontend wat er
  wel kan en de frontend verbergt knoppen die toch niet zouden werken.

### Endpoints

| Endpoint | Methode | Doet |
|---|---|---|
| `status.php` | GET | Welke onderdelen zijn beschikbaar, ben ik ingelogd |
| `auth/register.php` | POST | Account aanmaken en meteen inloggen |
| `auth/login.php` | POST | Inloggen met gebruikersnaam of e-mail |
| `auth/logout.php` | POST | Sessie beëindigen |
| `auth/me.php` | GET | Huidige gebruiker (met `emailVerified`), of `user: null` |
| `auth/verify-email.php` | POST | E-mailadres bevestigen met het token uit de mail (zonder login) |
| `auth/resend-verification.php` | POST | De bevestigingsmail opnieuw sturen |
| `auth/forgot-password.php` | POST | Herstellink mailen; antwoordt altijd hetzelfde |
| `auth/reset-password.php` | POST | Nieuw wachtwoord met het token uit de mail; logt overal uit en hier in |
| `sync/pull.php` | GET | Alle sessies en solves ophalen |
| `sync/push.php` | POST | Volledige staat opslaan (legt ernaast, zie Synchronisatie) en alles herberekenen |
| `feedback/report.php` | POST | Melding als GitHub-issue |
| `leaderboard/list.php` | GET | Ranglijst per event, categorie en periode (openbaar), per pagina (`limit`, `offset`), met `myIndex` voor "Naar mijn plek" |
| `profile/overview.php` | GET | XP, level, rang, streak, records, XP-logboek |
| `profile/settings.php` | POST | Hoofd-event, land, wel of niet op de ranglijst |
| `profile/public.php` | GET | Het openbare profiel van een cuber (zonder login) |
| `challenges/today.php` | GET | De opdrachten van vandaag met je voortgang |
| `challenges/submit.php` | POST | Je poging voor de scramble van de dag |
| `challenges/contribute.php` | POST | Scrambles aanleveren voor de voorraad |
| `achievements/list.php` | GET | De catalogus, met je eigen stand als je ingelogd bent |
| `archive/list.php` | GET | Hoeveel losse tijden er zijn, per event |
| `archive/restore.php` | POST | Losse tijden terug in een sessie zetten |
| `archive/clear.php` | POST | Losse tijden definitief wissen — de enige DELETE op solves |
| `algorithms/list.php` | GET | Welke algoritmes je als geleerd hebt afgevinkt |
| `algorithms/toggle.php` | POST | Een algoritme aan- of afvinken |
| `follows/toggle.php` | POST | Iemand volgen of ontvolgen |
| `follows/list.php` | GET | Wie je volgt, wie jou volgt, wie je vrienden zijn |
| `tournament/state.php` | GET | Lopend toernooi, keuzes, historie en samenvatting |
| `tournament/start.php` | POST | Een toernooi beginnen: `difficulty` voor gesimuleerd, `competitionId` voor een historische comp |
| `tournament/wca-search.php` | GET | Afgelopen WCA-comps zoeken (`?q=`), zonder zoekterm de bekende kampioenschappen |
| `tournament/wca-competition.php` | GET | Welke events er op een comp stonden, met rondes en deelnemers |
| `tournament/solve.php` | POST | Een solve in het lopende toernooi |
| `tournament/abandon.php` | POST | Stoppen met het lopende toernooi |
| `games/overview.php` | GET | Spelregels, en ingelogd ook je records, laatste rondes en duels |
| `games/finish.php` | POST | Een afgelopen ronde; de server telt de score zelf na |
| `duels/create.php` | POST | Een vriend uitdagen, met de scrambles uit je browser |
| `duels/solve.php` | POST | Een poging in een duel |
| `duels/decline.php` | POST | Afwijzen, of intrekken zolang de ander niet begonnen is |
| `admin/flags.php` | GET/POST | Beoordeelwachtrij (alleen rol `admin`) |

### Rate limiting

`RateLimiter` werkt op bestanden in `storage_path`, niet op de database, zodat
de bug-knop ook werkt op een installatie zonder database. Huidige limieten
(per IP): registreren 5/uur, inloggen 15 per kwartier per IP en 8 per kwartier
per account, meldingen 5/uur, wachtwoord vergeten 5/uur per IP en 3/uur per
account, een nieuw wachtwoord zetten 10/uur, bevestigen 20/uur. Per account:
bevestigingsmail opnieuw 3/uur, toernooien starten 20/uur,
spelmodusrondes 120/uur, duels aanmaken 30/uur, WCA-comps zoeken 40 en ophalen
30 per tien minuten. Zonder schrijfbare map wordt er niet gelimiteerd.

---

## Records, ranglijsten en XP

### De server rekent, de browser niet

Alles wat op een ranglijst kan komen wordt **serverside** uitgerekend uit de
opgeslagen solves. De browser stuurt nooit een gemiddelde of een XP-bedrag mee;
dat is met de console te verzinnen. Na elke synchronisatie draait
`sync/push.php` achter elkaar:

1. `Records::rebuild()` — markeert verdachte solves, rekent alle records
   opnieuw uit, schrijft `user_records` opnieuw en levert via `SolveFacts` in
   dezelfde doorloop alles wat de achievements nodig hebben
2. `Xp::sync()` — kent XP toe voor solven, records en streaks
3. `Challenges::evaluate()` — werkt de voortgang van de dagopdrachten bij
4. `Achievements::evaluate()` — ontgrendelt wat er gehaald is. Als laatste,
   want achievements kijken naar XP en challenges die hierboven net zijn
   bijgewerkt

Gaat een van die stappen mis, dan is de synchronisatie zelf wel geslaagd: de
tijden van de gebruiker zijn veilig, alleen de afgeleide cijfers lopen even
achter en worden bij de volgende synchronisatie bijgewerkt.

`Averages` doet het rekenwerk met twee monotone wachtrijen voor het schuivende
minimum en maximum. Daardoor kost een Ao100 evenveel als een Ao5. Achttienduizend
solves herberekenen duurt ongeveer 2,5 seconde, inclusief opslaan.

### Periodes

Dag- en weekgrenzen voor ranglijsten en challenges lopen in de **tijdzone van de
site** (`site_timezone` in de config, standaard Europe/Amsterdam), zodat iedereen
op dezelfde dag concurreert. De statistieken in de sidebar rekenen wel met de
lokale tijd van de bezoeker. Rond middernacht kan dat dus een uurtje verschillen;
dat is een bewuste keuze en staat zo in `lib/SiteTime.php`.

### Onmogelijke tijden

De timer draait in de browser, dus iedereen kan met de console een tijd van een
halve seconde insturen. Volledig dichtzetten kan niet zonder de timer naar de
server te verhuizen. Wat er wel gebeurt, in `Records::detectFlags()`:

| Reden | Wanneer |
|---|---|
| `impossible` | onder de 250 ms |
| `below_world_record` | sneller dan het wereldrecord voor dat event |
| `too_fast_for_user` | minder dan de helft van het eigen record tot dan toe, na minstens 25 solves |
| `burst` | meer dan 20 solves binnen een minuut |

Een gemarkeerde solve komt in `solve_flags` met status `pending` en telt
**niet** mee voor records en ranglijsten. De gebruiker ziet zijn tijd zelf
gewoon in zijn sessie staan. Jij beoordeelt ze in Instellingen → Beheer; dat
tabblad verschijnt alleen voor een account met de rol `admin`:

```sql
UPDATE users SET role = 'admin' WHERE username = 'jouwnaam';
```

Bij het afstellen van de drempels geldt: **liever een cheater door de vingers
zien dan een echte cuber onterecht markeren.** De vorige versie vergeleek met de
mediaan en markeerde 24 gewone tijden op 1222 solves; de vergelijking met het
eigen record markeert er nul.

### XP en levels

| Waarvoor | Hoeveel |
|---|---|
| Per geldige solve | 2 XP, maximaal 300 per dag |
| Persoonlijk record | 12 tot 40 XP, afhankelijk van de categorie |
| Dag op rij getimed | 10 XP per dag in de reeks, tot 10 dagen |
| Daily challenge | 40 tot 80 XP |

Level L vraagt `50 * L * (L - 1)` XP in totaal. Tiers: Brons (1-9), Zilver
(10-19), Goud (20-34), Platina (35-49), Diamant (50+). De tier bepaalt de kleur
van de rangbadge; het getal erin is je positie op de all-time ranglijst van je
hoofd-event — een hard nummer tot en met plek 999, daaronder een percentiel.

### Daily challenges

Drie per dag, aangemaakt zodra de eerste bezoeker die dag om de challenges
vraagt. Welke aantallen en percentages het worden hangt af van de datum
(`crc32`), dus voor iedereen hetzelfde en elke dag anders.

De **scramble van de dag** is een probleem apart: officiële WCA-scrambles komen
van cubing.js, dat alleen in de browser draait. Ingelogde bezoekers leveren
daarom scrambles aan in `scramble_pool` (`challenges/contribute.php`, op de
achtergrond, na elke vijfde 3x3-scramble). De server kiest er per dag
willekeurig een uit, en alleen uit scrambles die er minstens 24 uur in staan.
Zo kan niemand een makkelijke scramble insturen en die zelf krijgen.
`Challenges::looksLikeScramble()` weigert alles wat geen 16 tot 25 geldige
zetten is zonder herhaald vlak.

**"Sneller dan jezelf"** heeft een percentage in de database (voor iedereen
hetzelfde), maar in beeld staat een **tijd**: "Doe vandaag een solve onder
00:13:903 op 3x3x3". `Challenges::today()` rekent die per gebruiker uit met
`beatAverageTarget()`: het gemiddelde van zijn laatste 50 solves op zijn
hoofd-event van vóór vandaag, min het percentage. Daardoor ligt de doeltijd de
hele dag vast. "Onder" is strikt: precies de getoonde tijd telt niet. Met
minder dan 12 solves staat er hoeveel er nog nodig zijn; een gast krijgt de
uitnodiging om in te loggen.

Loopt de voorraad leeg, dan is er die dag simpelweg geen scramble van de dag;
de twee andere opdrachten staan er wel. Dat is bewust: liever geen opdracht dan
een scramble waarvan we de herkomst niet kennen.

---

## Toernooimodus

Een simulatie van een WCA-competitie: drie rondes (kwalificatie, halve finale,
finale) van vijf solves, gerangschikt op Ao5 met je beste single als tiebreak.
De kwalificatie heeft een cutoff (haal je die niet in twee solves, dan stopt je
ronde daar), en elke solve boven de tijdslimiet is een DNF. Na elke ronde valt
het veld terug tot de besten.

**Los van je sessies.** Zolang er een ronde loopt stuurt
`cubeTimerApi.setSolveCapture()` je afgeronde solves naar het toernooi in
plaats van naar je gewone tijden. De solves komen in `tournament_solves`, de
records in `tournament_records`, met een eigen blok op je profiel. Raak die
haak niet kwijt: zonder capture lopen toernooitijden dwars door je
oefengemiddelden heen.

**Moeilijkheidsgraden** staan in `Tournaments::DIFFICULTIES`. `reference` is het
gemiddelde waar het veld omheen gebouwd wordt, in milliseconden op 3x3;
`Events::speedFactor()` rekent dat om naar het gekozen event. `spread` bepaalt
hoe ver het veld uit elkaar ligt. Bij `opmaat` is de referentie je eigen Ao12.

| Niveau | Snelste | Midden | Langzaamste |
|---|---|---|---|
| Beginner | 29 s | 45 s | 69 s |
| Clubniveau | 14 s | 20 s | 29 s |
| Nationaal | 8 s | 11 s | 15 s |
| WK-niveau | 5,4 s | 6,5 s | 7,8 s |
| Open toernooi | 5,6 s | 16 s | 45 s |

De omrekening van percentiel naar tijd is **vermenigvuldigend**
(`exp((percentiel - 0.5) * 2 * spread)`), niet optellend. Met een lineaire
schaal sloeg het open toernooi door naar negatieve tijden; de eerste versie gaf
een bot van 0,73 seconden.

**De tegenstanders** zijn verzonnen cubers uit `TournamentField::ROSTER`, met
een vast percentiel zodat dezelfde naam op elk niveau even sterk is ten
opzichte van de rest. Daarnaast komt tot een kwart van het veld uit echte
gebruikers van de site. Hun tijden worden **niet** overgenomen: alleen hun
niveau (hun Ao12, of anders hun single) wordt gebruikt om tijden mee te
simuleren. Ze hebben dus niet echt meegedaan, en dat staat ook zo in de
interface met een `sim`-label. Wie zichzelf van de ranglijsten haalt, komt
nergens in een deelnemersveld terecht.

De tijden van je tegenstanders worden pas berekend als jij je ronde af hebt, in
`Tournaments::scoreRound()`. Vooruitkijken kan dus niet.

**Beste plek per soort.** `Tournaments::summary()` geeft naast de totalen ook
`perType` (per moeilijkheidsgraad, plus "Historische comp") en `competitions`
(per historische comp en event, met de veldgrootte). Een derde plek bij de
beginners is iets anders dan een derde plek op WK-niveau.

### Historische comps (v2)

Een toernooi met `source = 'wca'` is een echte, afgelopen WCA-competitie. Het
veld zijn de echte deelnemers (`kind = 'wca'`, met hun `wca_id`), met hun echte
pogingen. Er wordt niets gesimuleerd.

- **De rondes** komen uit de uitslagen: per event de rondetypes op volgorde
  (1/d, 2/e, 3/g, c/f; kwalificatie en B-finale doen niet mee). Het format per
  ronde (`a` Ao5, `m` Mo3, `1`/`2`/`3` best of) staat in `tournament_rounds`,
  net als het aantal pogingen, de cutoff (in hoeveel pogingen) en of de
  tijdslimiet cumulatief is. Cutoff en limiet komen uit de WCIF; oude comps
  hebben die vaak niet, en dan speel je zonder.
- **Rangschikken** gaat via `Ranking` (ook gebruikt door de duels): met
  gemiddelde eerst op gemiddelde en dan op single, bij best of alleen de single.
  Voor de echte deelnemers gebruiken we het gemiddelde en de single van de WCA
  zelf; bij gelijke uitslag komt de speler achter de echte cuber.
- **Doorgaan**: je gaat door als je plek binnen het aantal valt dat in het echt
  in de volgende ronde stond. De volgende ronde is dan de echte ronde plus jij;
  wie er door jouw komst eigenlijk uit had gemoeten, laten we staan.
- **Cutoff** is op een echte comp strikt ("onder"); de gesimuleerde toernooien
  rekenden altijd met "gelijk mag" en dat blijft zo.
- **Cumulatieve limiet**: de som van je pogingen (een DNF telt met zijn tijd).
  Is hij op, dan is die poging een DNF en de rest DNS.
- **Scrambles**: kent de WCA ze, dan krijg je de echte scrambles van groep A
  via `setScrambleOverride()`. Anders gewone scrambles.
- **Waar de gegevens vandaan komen**: `lib/Wca.php` haalt bij de WCA-API
  (`/competitions/{id}`, `/results`, `/wcif/public`, `/scrambles`) en bewaart het
  verwerkte resultaat 30 dagen in `wca_cache`, zoekresultaten een dag. Is de WCA
  onbereikbaar, dan gebruikt hij een verlopen kopie. Bij de start gaat alles
  wat het toernooi nodig heeft in `tournaments.wca_snapshot`, zodat een lopend
  toernooi nooit meer afhangt van de WCA of de cache.
- **Bronvermelding**: de WCA vraagt erom; `Wca::attribution()` staat bij elk
  historisch toernooi in beeld.
- **Testen** zonder WCA: `tools/wca-voorbeeld/` bevat antwoorden in de vorm van
  de echte API, `tools/nep-wca-server.php` serveert ze, en met
  `'wca' => ['base_url' => 'http://127.0.0.1:8124/api/v0']` in je lokale config
  praat de site ermee. `php tools/spelmodi-en-wca-testen.php` toetst de
  omzetting los.

## Spelmodi en duels

Vijf modi in één venster (`games.js`). Records staan op je account en je
profiel; er is **bewust geen ranglijst**.

| Modus | Regel | Record per | Tiebreak |
|---|---|---|---|
| Streak | elke solve onder de doeltijd; de eerste erboven of een DNF stopt | event + doeltijd | gemiddelde van de geslaagde solves |
| Survival | onder de limiet blijven; na elke geslaagde solve gaat er 0,5 s af (omgerekend per event met `speedFactor`) | event + startlimiet | idem |
| Ladder | elke solve sneller dan de vorige; de eerste is gratis | event | de laatste (snelste) trede |
| Speedrun | zoveel mogelijk cubes in vijf minuten, alles vooraf gescrambeld | event + aantal cubes | moment waarop de laatste cube klaar was |

**De browser speelt, de server telt na.** Streak, survival en ladder lopen via
de gewone timer met `setSolveCapture(handler, 'spelmodus')`; de solves komen
dus niet in je sessie. Aan het eind stuurt de browser de solves (of bij de
speedrun de rondetijden) naar `games/finish.php`, en `GameModes::evaluate()`
rekent de score zelf uit. Wat na de breuk komt, wordt niet bewaard. Een tijd
onder het wereldrecord maakt de hele ronde ongeldig. Zonder account kun je
gewoon spelen; je ziet je score, maar er wordt niets bewaard.

**De speedrun** heeft een eigen klok in het venster: de spatiebalk (of de grote
knop) markeert een cube als klaar. De server controleert alleen of het kan (elke
cube minstens het wereldrecord, niets na vijf minuten); een klok in de browser
is niet te bewijzen. Daarom ook geen ranglijst.

**Er kan maar één ding de solves opvangen.** `getSolveCaptureOwner()` zegt wie:
`'toernooi'` of `'spelmodus'`. Een spelmodus start niet als er een toernooi
loopt, en een toernooi niet als er een spelmodus loopt. `UI.closeModal()` haalt
de focus van een knop in het venster af; anders negeert de timer de spatiebalk
omdat die op een verborgen knop lijkt te vallen.

**Duels** (`lib/Duels.php`) zijn alleen tussen vrienden. De uitdager kiest een
event; zijn browser maakt de scrambles met `window.generateScrambles()` en de
server controleert ze (zelfde controle als de scramble van de dag, waar het
event die heeft). Het format volgt een comp: Ao5, Mo3 voor 6x6 en 7x7, best of
3 bij blind. Elke poging wordt meteen opgeslagen, dus opnieuw proberen kan niet.
Je ziet alleen de volgende scramble, en de tijden van de ander pas als jullie
allebei klaar zijn. Na zeven dagen vervalt een duel (`Duels::expire()`, bij elk
verzoek, zonder cronjob); wie dan wel klaar was, wint. Duelsolves tellen nergens
voor mee: geen records, ranglijsten of XP.

## Volgen en vrienden

Volgen is eenzijdig en vraagt geen toestemming. Volgen jullie elkaar allebei,
dan zijn jullie vrienden — dat is geen aparte status in de database maar een
wederzijds paar rijen in `user_follows`. Er zijn dus geen verzoeken om goed te
keuren.

Je kunt alleen iemand volgen die meedoet aan de ranglijsten. De ranglijst heeft
een `scope`: `all` of `friends`, waarbij `friends` beperkt tot
`Follows::circleIds()` (iedereen die je volgt, plus jezelf).

---

## Openbare profielen

`/profiel.php?u=naam` is een **serverside gerenderde** pagina, geen JavaScript
dat een leeg scherm vult. Reden: een gedeelde link moet in WhatsApp en Discord
meteen laten zien om wie het gaat, en dat werkt alleen als de titel en de
omschrijving al in de HTML staan. De og-tags worden per cuber ingevuld.

Profielen staan **niet in Google** (`noindex`, als meta-tag en als
`X-Robots-Tag`). Delen werkt gewoon; zie het hoofdstuk SEO. Omdat de pagina
ook onder `/u/naam` verschijnt, beginnen alle paden erin bij de root
(`/Style/style.css`); met relatieve paden kwamen CSS en logo onder `/u/` uit.

`.htaccess` in `public_html` maakt er `/u/naam` van. Staat mod_rewrite uit, dan
blijft `/profiel.php?u=naam` gewoon werken; de site verwijst overal naar die
lange vorm, de korte is alleen een extraatje.

`lib/PublicProfile.php` levert de gegevens, en wordt door twee dingen gebruikt:
de pagina zelf en `api/profile/public.php` (voor als de frontend hem ooit nodig
heeft). Daar staat dus de enige plek waar bepaald wordt wat openbaar is.

**Privacy**: een profiel is alleen zichtbaar als de cuber meedoet aan de
ranglijsten. Zet hij die schakelaar uit, dan geeft zowel de pagina als de API
een 404 en verdwijnt hij ook van de ranglijsten. Er staat nooit een
e-mailadres op een profiel.

## Snelheid in de browser

Gemeten in Chromium met een zware gebruiker (3000 solves in de sessie, 10.000
in totaal). Oud → nieuw: tijdens het timen 13 → 60 frames per seconde, van de
stop-toets tot je tijd in beeld 1023 → 105 ms, langste blokkade bij het laden
643 → 145 ms. Regels die daaruit volgen:

- **Geen `backdrop-filter` op iets wat onzichtbaar over het scherm ligt.** De
  vensters (`.time-modal`) staan allemaal in de pagina, met een blur. Met alleen
  `opacity: 0` rekent Chrome die twaalf blurs elke frame uit; daarom krijgen ze
  `visibility: hidden` als ze dicht zijn. Dat was de hapering tijdens het timen.
- **De tijdentabel toont de laatste 100 solves** (`TABLE_PAGE`), met bovenaan een
  knop voor 100 meer. De hele tabel opnieuw opbouwen bij elke solve kostte bij
  duizenden tijden meer dan een seconde. Een andere sessie begint weer bij 100.
- **Geen maten opvragen direct na een DOM-wijziging.** De grafiek vroeg
  `clientWidth` op vlak nadat de tabel vernieuwd was, en dwong Chrome zo om
  meteen alles op te meten. De breedte komt nu uit een `ResizeObserver`.
- **Rekenwerk dat niet meteen in beeld hoeft, wacht.** `stats.js` rekent na een
  solve pas in `requestIdleCallback`, zodat hij niet tussen de stop-toets en je
  tijd in zit.
- **AdSense en Analytics laden pas na `load` + idle**, niet in de `<head>`.
  `gtag()` werkt meteen; wat erin gaat wacht in `dataLayer`.
- **De gloed om de timercijfers** (`filter: drop-shadow`) kost tekenwerk bij elke
  frame. Hij blijft staan (keuze van de eigenaar); met de vensterfix haalt de
  timer toch 60 fps. `will-change` erop verlaagde het tekenwerk maar drukte in
  de meting de framerate, dus die staat er bewust niet.

Meten gaat met Playwright en de Chrome DevTools-protocol-metrics
(`Performance.getMetrics`, tracing, `Profiler`); zie de geschiedenis van
[#81](https://github.com/frocky10/cubetimer.nl/issues/81).

## SEO

Het doel: de timer en de leerpagina goed vindbaar, de rest niet. Alles staat
op één adres, **`https://cubetimer.nl`**, zonder www.

| Wat | Waar | Waarom |
|---|---|---|
| Eén adres | `.htaccess` | `www.` en `http://` gaan met een 301 naar `https://cubetimer.nl`, `/index.html` naar `/`. Anders ziet Google drie sites met dezelfde inhoud. Controleert `X-Forwarded-Proto`, zodat een proxy geen lus geeft |
| Canonical | `<link rel="canonical">` op elke indexeerbare pagina | Precies het adres uit de sitemap, ook als iemand `?oefen=...` of `/index.html` deelt |
| Sitemap | `sitemap.xml` | Alleen `/` en `/leren.html`. Een nieuwe openbare pagina hoort erin, met hetzelfde adres als in zijn canonical |
| robots.txt | `robots.txt` | Blokkeert alleen `/api/`. Profielen bewust **niet**: een geblokkeerde pagina leest Google niet, dus dan ziet hij de noindex niet en kan de kale URL alsnog in de resultaten komen |
| Niet in Google | `profiel.php`, `404.html` | `noindex, follow` als meta-tag en als `X-Robots-Tag`-header. De 404-pagina geeft ook echt een 404 |
| Titel en omschrijving | `<head>` | Nederlands, titel ≤ 60 tekens, omschrijving 70-160 tekens |
| Kop | `index.html` | Een `<h1>` met `.visually-hidden`: het logo staat er al, een zichtbare kop zou de timer in de weg zitten. Er is bewust geen verborgen lap tekst voor zoekmachines; dat ziet Google als misleiding |
| Delen | `og:*` en `twitter:card` | `Pictures/og-image.png` (1200x630), altijd als volledig adres; een relatief pad toont in WhatsApp niets |
| Structured data | JSON-LD in de `<head>` | Timer: `WebSite`, `Organization` (met logo) en `WebApplication` (gratis). Leren: `WebPage`/`LearningResource` met een kruimelpad |
| Iconen | `favicon.ico`, `Pictures/favicon-*.png`, `apple-touch-icon.png`, `site.webmanifest` | Google toont een favicon vanaf 48px. Gemaakt met `php tools/seo-afbeeldingen.php`; opnieuw draaien als het logo verandert |
| Snelheid | `.htaccess` | gzip, plaatjes en lettertypes een maand in de cache. CSS, JS en HTML niet: er zit geen versienummer in de bestandsnamen, dus na een release moet de browser het nieuwe bestand ophalen |
| Advertenties | `ads.txt` | Beide AdSense-accounts (`pub-7865…` en `pub-9889…`) staan erin. `tools/seo-controleren.php` controleert dat elk id uit `index.html` er ook in staat |

`php tools/seo-controleren.php` loopt dit allemaal na. De `.htaccess` is
getest op een echte Apache (redirects, 404, headers, gzip); `php -S` leest geen
`.htaccess`.

**Na de deploy**: meld de site aan in Google Search Console (eigendom bewijzen
via DNS of een HTML-bestand), stuur daar `https://cubetimer.nl/sitemap.xml` in,
en controleer met de Rich Results Test dat de structured data gelezen wordt.

## Mail: bevestigen en wachtwoord vergeten

`lib/Mailer.php` praat zelf SMTP met een mailbox op de hosting (geen composer,
en PHP's `mail()` belandt te vaak in de spam). Instellingen onder `mail` in
`~/cubetimer_config.php`; zie `config.example.php`. Zonder `host` staat mail
uit en verbergt de interface "wachtwoord vergeten" en de bevestigingsvraag
(`status.php`: `mail` en `emailVerification`).

`lib/AccountMail.php` doet de twee mails:

| | Bevestigen | Wachtwoord vergeten |
|---|---|---|
| Tabel | `email_verifications` (migratie 010) | `password_resets` (al sinds 001) |
| Geldig | 48 uur | 1 uur, eenmalig |
| Link | `/#bevestig=<token>` | `/#herstel=<token>` |
| Verplicht? | Nee: een onbevestigd account kan alles, het accountvenster vraagt er alleen om | — |
| Daarna | `users.email_verified_at` gezet | nieuw wachtwoord, **alle sessies weg**, hier ingelogd, adres telt als bevestigd |

- **Tokens**: 64 hextekens uit `random_bytes`; in de database alleen de
  SHA-256. Een nieuwe mail maakt de vorige link ongeldig.
- **Het token staat achter een hekje.** Wat na `#` staat stuurt de browser
  nooit naar een server, dus het komt niet in logbestanden, niet in de
  Referer en niet bij Google Analytics. `account.js` leest het uit (bij het
  laden én bij `hashchange`) en haalt het meteen uit de adresbalk.
- **Wachtwoord vergeten verraadt niet of een account bestaat**: het antwoord is
  altijd hetzelfde, en op PHP-FPM gaat de mail pas weg nadat het antwoord
  verstuurd is (`fastcgi_finish_request`), zodat ook de wachttijd niets zegt.
- **Testen**: `php tools/nep-smtp-server.php 2525 /tmp` schrijft elke mail als
  `.eml`. Met een PEM-bestand als derde argument kan hij ook STARTTLS. Zet
  lokaal `'mail' => ['host' => '127.0.0.1', 'port' => 2525, 'encryption' =>
  'none', ...]` en `'site_url' => 'http://127.0.0.1:8123'`.

## Landen

De landcode staat als tekstbadge naast de naam, niet als vlag. Emoji-vlaggen
worden op Windows als losse letters getoond, en dat is voor het grootste deel
van de desktopbezoekers lelijker dan de code zelf. **Besloten: er komen geen
echte vlaggen**, ook niet als meegeleverde SVG's. Niet meer voorstellen.

De codes staan in `ui.js` (`COUNTRY_CODES`, 195 stuks). De **namen** komen uit
de browser via `Intl.DisplayNames`, dus er is geen vertaallijst om bij te
houden. `UI.countries()` geeft de gesorteerde lijst, `UI.countryName(code)` een
losse naam.

---

## Achievements

Honderdtwintig stuks: zesentwintig families in vier niveaus (brons, zilver,
goud, platina) plus zestien geheime. De catalogus staat in
`lib/Achievements.php`, niet in de database. Een nieuwe achievement toevoegen
is dus een regel in `families()` of `secrets()` — geen migratie.

**Een familie** hangt aan een cijfer uit `metrics` en heeft per niveau een
drempel:

```php
'solves' => [
    'category' => 'mijlpalen', 'metric' => 'validSolves',
    'title' => 'Vlieguren', 'unit' => 'solves', 'format' => 'number',
    'description' => 'Aantal solves dat je hebt afgerond.',
    'tiers' => ['brons' => 100, 'zilver' => 1000, 'goud' => 5000, 'platina' => 25000],
],
```

`direction` is standaard `atLeast` (meer is beter). Zet hem op `atMost` voor
tijden en ranglijstposities, waar minder beter is. `format` bepaalt hoe een
drempel getoond wordt: `number`, `time` (ms) of `rank`.

Niveaus zijn **cumulatief**: wie meteen goud haalt krijgt brons en zilver er
gratis bij. XP per niveau: 50 / 150 / 400 / 1000, en 250 voor een geheime.

**De cijfers** komen uit twee bronnen. `SolveFacts::from()` loopt een keer door
alle solves en haalt daar alles uit wat een doorloop vraagt (aantallen, +2's,
DNF's, drukste dag, bijzondere tijden zoals palindromen, reeksen DNF's).
`Achievements::buildMetrics()` vult dat aan met een handvol queries (sessies,
XP, challenges, beste ranglijstpositie, persoonlijke records).

Wil je een achievement die iets nieuws meet, voeg het cijfer dan toe aan
`SolveFacts` (als het per solve is) of aan `buildMetrics` (als het een query
is), en verwijs ernaar met `metric`.

Achievements gelden **met terugwerkende kracht**: alles wat iemand ooit heeft
getimed telt mee zodra hij inlogt. Een verse gebruiker met 120 lokale solves
ontgrendelt er meteen zo'n twintig.

Gemarkeerde solves (zie hierboven) tellen niet mee voor de bijzondere tijden;
een verzonnen tijd hoort geen achievement op te leveren.

---

## Synchronisatie

1. **Bij het inloggen wint de server.** `account.js` haalt `sync/pull.php` op en
   zet dat in de browser, punt. Er wordt niet samengevoegd en er wordt daarna
   ook niet teruggeduwd. Alleen als het account nog helemaal leeg is — iemands
   eerste login — gaat de lokale staat omhoog.
2. **Daarna is de browser de bron van waarheid.** Bij elke wijziging wordt na
   2,5 seconde de volledige staat naar `sync/push.php` geduwd.

De vorige versie voegde bij elke login samen (`mergeSessions`). Dat duwde terug
wat er toevallig in díe browser stond: wie op zijn telefoon opruimde kreeg het
op zijn laptop weer terug, inclusief sessies van vóór hij een account had. Die
functie is weg. Een browser is een werkkopie, geen tweede administratie.

### Een sessie weggooien kost geen tijden

`sync/push.php` **vervangt** de staat van een gebruiker niet meer, hij legt hem
ernaast:

| Wat de browser doet | Wat de server doet |
|---|---|
| een sessie meesturen | bijwerken of aanmaken |
| een sessie weglaten | de sessierij weg, de solves erin worden **losse tijden** |
| een solve weglaten | wordt een **losse tijd** |
| een id in `removedSolveIds` | `DELETE` — de enige weg naar echt weg |

Een **losse tijd** is een solve met `timer_session_id IS NULL`. Hij staat nog op
het account en telt gewoon mee voor records, ranglijsten, XP en achievements;
alleen hangt hij niet meer onder een sessie en komt hij niet mee met
`sync/pull.php`. Via `api/archive/` kun je ze tellen, terughalen in een nieuwe
sessie per event, of alsnog wissen.

Daarmee is het ergste geval onschadelijk: een browser die zijn localStorage
kwijt is en een lege staat duwt, wist niets meer.

In de interface is verwijderen daarom altijd een keuze van twee: *uit de sessie
halen* of *ook van mijn account*. Uitgelogd valt er niets te kiezen en is het
één gewone vraag. Wat van het account af moet gaat naar `cubetimer_removed_v1`
en wordt pas gewist als de synchronisatie het heeft doorgegeven — zo werkt het
ook als je offline bent.

**In stappen, in één transactie:** tombstones wissen → sessies upserten → *alle*
solves van die gebruiker losmaken → de meegestuurde solves upserten (en daarmee
weer vastmaken) → sessies opruimen die niet meekwamen. Dat losmaken in stap 3
lijkt omslachtig maar is één `UPDATE`; het alternatief was een `NOT IN` met
achttienduizend id's erin. Gemeten op 18.000 solves: 2,2 seconde, net als de
oude aanpak.

**Nadeel dat blijft:** twee tabbladen tegelijk open die allebei timen,
overschrijven elkaar nog steeds — al kost dat nu geen solves meer, ze worden
hooguit los. Gaan we het echt oplossen, dan wordt het incrementeel
synchroniseren met een `updated_at` per solve; dat is de reden dat elke solve al
een eigen `id` heeft.

---

## De leerpagina

`/leren.html` is een losse statische pagina met vier tabbladen: de
beginnersmethode, F2L, OLL en PLL. Hij laadt alleen `ui.js`, `cube.js`,
`algorithms.js` en `tutorials.js` — niet de timer.

### De plaatjes worden berekend, niet bewaard

Er staat geen map met 119 afbeeldingen en geen lijst met vormbeschrijvingen.
`algorithms.js` bevat **alleen de zetten**; het plaatje, de groep waarin een
geval hoort en de opzetscramble om ermee te oefenen worden er met `cube.js` uit
afgeleid. Verander je een algoritme, dan verandert het plaatje mee. Een
diagram kan dus niet iets anders laten zien dan de zetten eronder doen.

`cube.js` is een kleine 3x3 met een ruimtelijk model: een plaatje is een blokje
op een plek `(x, y, z)` met een richting, en een draai is een echte rotatie om
een as. Daardoor volgen wide moves, slices en `x`/`y`/`z` er vanzelf uit in
plaats van uit zes extra permutatietabellen.

### Na elke wijziging aan `algorithms.js`

```bash
node tools/algoritmes-controleren.js
```

Dat controleert per algoritme dat het de kubus niet netto draait, niets sloopt
wat heel moest blijven en een echt geval oplost, en per soort dat alle gevallen
onderling verschillend zijn en het er precies zoveel zijn als er bestaan
(57 OLL, 21 PLL, 41 F2L). Die twee samen betekenen dat de lijst compleet is.
Een tikfout in een algoritme zie je niet met het blote oog, en iemand die een
fout algoritme uit zijn hoofd leert is er slechter aan toe dan iemand die niets
geleerd heeft.

De 41 F2L-algoritmes zijn niet overgeschreven maar gezocht: per geval het
kortste dat binnen `R`, `U` en `F` bestaat, en bij gelijke lengte dat met de
minste `F`-zetten (die vragen een hergreep).

### Oefenen

De oefenknop stuurt je naar `index.html?oefen=OLL-27`. `script.js` laadt
`cube.js` en `algorithms.js` dan alsnog in — wie gewoon komt timen krijgt ze
niet — en zet de opzetscramble vast met `setScrambleOverride()`. De
opzetscramble is het algoritme achterstevoren; ook die staat dus nergens apart.

### Wat je geleerd hebt

De vinkjes staan in `user_algorithms` op de server, niet in localStorage: het is
iets wat je leert, geen instelling van dit apparaat. Uitgelogd werkt de pagina
gewoon, hij onthoudt dan alleen niets. De catalogus staat bewust **niet** in de
database — de server controleert een id alleen op vorm (`OLL-27`, `PLL-T`,
`F2L-13`), want welke gevallen er bestaan staat in het JavaScript.

---

## Smart cubes

Eén knop in de balk, één venster, en daarna gaat het vanzelf: de scramble
licht zet voor zet op, na de laatste zet start de inspectie (als die aanstaat),
de eerste draai daarna start de timer, en de timer stopt als de cube opgelost
is. De knop verschijnt alleen als de browser Web Bluetooth heeft (Chrome en
Edge; niet Safari of Firefox).

### Drie bestanden, elk met één taak

| Bestand | Doet |
|---|---|
| `smartcube-protocols.js` | Praten met de cube: per merk versleutelen, ontcijferen en omzetten naar `move`, `facelets`, `battery`, `keyError` |
| `smartcube-engine.js` | Rekenen: stand bijhouden, scramble volgen, solve herkennen, analyse maken |
| `smartcube.js` | Interface en koppeling met de timer |

De eerste twee zijn los te testen en worden pas geladen als je het venster
opent. `smartcube.js` laadt altijd, want de analyse in het solve-venster moet
ook werken op een apparaat zonder Bluetooth.

### Merken

| Merk | Namen | Protocol | MAC-adres nodig |
|---|---|---|---|
| GAN | `GAN…`, `MG…`, `AiCube…` | gen1 (356i), gen2, gen3, gen4; AiCube = gen2 met eigen sleutel | ja, behalve gen1 |
| QiYi | `QY-QYSC…`, `XMD-TornadoV4-i…` | vaste AES-sleutel, begroeting met het MAC-adres | ja, wordt uit de naam afgeleid |
| MoYu | `WCU_MY3…` (WeiLong AI), `MHC…` (oud) | WeiLong: als GAN gen2 met eigen sleutel; MHC: draaihoeken | WeiLong ja, uit de naam |
| Giiker | `Gi…`, `Mi Smart Magic Cube`, `Hi-…` | hele stand per melding | nee |
| GoCube | `GoCube…`, `Rubiks…` | berichten tussen `*` en `\r\n` | nee |

De GAN-protocollen zijn een omzetting van gan-web-bluetooth (MIT, met
bronvermelding bovenin het bestand). De andere merken zijn zelf geschreven op
basis van wat er publiek over bekend is, onder meer uit csTimer. **Er staat geen
code uit csTimer in**: dat is GPL, en dan zou de hele site GPL moeten worden.

### Waarom het vroeger wisselend werkte

De vorige versie opende eerst een keuzevenster voor QiYi met álle
Bluetooth-apparaten, en na een mislukte poging een tweede venster voor GAN.
Chrome weigert dat tweede venster vaak, omdat het niet meer direct op een klik
volgt. Nu is er één venster dat alleen cubes toont, en wordt het merk herkend
aan de naam (of anders aan de services). **Roep `CubeTimerSmartCube.connect()`
altijd rechtstreeks aan vanuit de klik, zonder eerst iets te awaiten.**

Verder: QiYi kreeg een verkeerd voorvoegsel voor het MAC-adres, schrijfacties
botsten ("GATT operation already in progress") en gingen dan verloren, en
een gemist Bluetooth-pakketje bracht de stand ongemerkt uit de pas. Nu staan
schrijfacties in een rij, halen GAN gen3/4 gemiste zetten terug bij de cube,
en corrigeren cubes die hun stand meesturen de bijgehouden stand vanzelf.

### Het MAC-adres

GAN (gen2+), QiYi en MoYu WeiLong gebruiken hun MAC-adres in de versleuteling,
en dat geeft Web Bluetooth niet vrij. Volgorde: eerder gebruikt
(`cubetimer_cube_macs`) → uit de advertentie van de cube (alleen Chrome op
Windows, macOS en Android; op Linux en ChromeOS komt er nooit iets binnen) →
afgeleid uit de naam (QiYi `CC:A3:00:00:xx:xx`, MoYu `CF:30:16:00:xx:xx`) →
vragen. Een verkeerd adres herkennen we aan een onmogelijke stand, of aan een
cube die binnen vijf seconden niets zegt; dan vraagt de site het opnieuw
zonder de verbinding te verbreken.

### De scramble volgen op de stand

De engine telt geen zetten maar vergelijkt standen. Per scramblezet bewaart hij
de stand erna, en bij een halve slag ook de twee standen halverwege. Daardoor
telt R2 als R R én als R' R', en zit je na een verkeerde zet die je meteen
terugdraait gewoon weer op het goede spoor. Ligt de cube bij het begin niet
opgelost, dan zegt de hulpregel dat eerst.

### Tijd en analyse

De tijd van een smart-cubesolve komt uit de **klok in de cube** (GAN, QiYi,
MoYu hebben er een): van de eerste tot de laatste draai. De Bluetooth-vertraging
schommelt, die klok niet. Zonder klok (Giiker, GoCube) telt het moment van
ontvangst. `stopTimerFromBluetooth({ ms, analysis })` geeft beide door;
`saveTime` slaat de solve op met `source: 'bluetooth'`.

De analyse: aantal zetten (na samenvoegen: R R = R2, R R' valt weg), zetten per
seconde, de oplossing, en per fase — kruis, F2L, OLL, PLL — tijd en zetten.
Het kruis mag op elke kleur; het eerste kruis dat ligt telt. Op de server staat
hij in `solves.details` (migratie 008). `SolveAnalysis::clean()` bouwt hem
opnieuw op uit alleen bekende velden met grenzen; wat de browser stuurt komt
er nooit letterlijk in. De analyse telt nergens mee — records en ranglijsten
komen uit de tijd zelf.

### Testen zonder cube

`tools/nep-smartcube.js` bootst Web Bluetooth na plus per merk een cube die
zich gedraagt zoals het protocol voorschrijft, en die zetten kan laten
wegvallen. `tools/smartcube-testen.js` verbindt elk merk via de echte code en
controleert zetten, stand, batterij en het verkeerde-adrespad. Voor GAN
gen2/3/4 kan hij ook tegen het origineel toetsen:

```bash
npm pack gan-web-bluetooth && tar xzf gan-web-bluetooth-*.tgz
(cd package && npm install aes-js rxjs)
GAN_REF=$PWD/package node tools/smartcube-testen.js
```

Voor de andere merken bewijst een groene test dat heen en terug klopt, niet
dat een echte cube het zo doet: de nabootsing is geschreven vanuit hetzelfde
begrip van het protocol. **Een echte cube blijft de laatste test.** In de
console staat alles wat er gebeurt met het voorvoegsel `[smartcube]`.

Dezelfde nepcubes kun je in de browser gebruiken: laad `vendor/aes.js`,
`cube.js` en `tools/nep-smartcube.js` vóór de pagina (in Playwright met
`addInitScript`) en roep `NepSmartCube.install(new NepSmartCube.SIMS.gan())` aan.

---

## Server (DirectAdmin)

- **Deploy:** push naar `Release` → GitHub Action zet `public_html/` via FTP
  neer in `public_html/` op de server. Secrets: `FTP_HOST`, `FTP_USER`,
  `FTP_PASS`, `FTP_PORT`.
- **De config wordt niet meegedeployd.** `~/cubetimer_config.php` staat één map
  boven `public_html` en blijft dus staan bij elke release. Dat is precies de
  bedoeling.
- **Controleer na de eerste deploy** dat `https://cubetimer.nl/api/lib/Auth.php`
  een 403 of 404 geeft en niet de broncode toont. De `.htaccess`-bestanden
  regelen dat, maar die werken alleen op Apache en LiteSpeed.
- **Controleer ook** dat de FTP-deploy de `.htaccess`-bestanden meeneemt; sommige
  FTP-clients slaan bestanden die met een punt beginnen over.

---

## Bekende punten voor later

- **De historische toernooien zijn niet getest tegen de echte WCA-API.** Die was
  vanuit de ontwikkelomgeving niet bereikbaar. Alles is gebouwd op de
  gedocumenteerde vorm en getest met `tools/wca-voorbeeld/`. Controleer na de
  deploy: kies een comp in het toernooivenster, en kijk bij problemen in de
  PHP-errorlog naar regels die met `[cubetimer] WCA` beginnen. Het zou kunnen
  dat `/competitions/{id}/scrambles` niet bestaat; dan speel je met gewone
  scrambles en werkt de rest gewoon.
- De bekende kampioenschappen in het WCA-keuzescherm staan vast in
  `Wca::FEATURED`. Een nieuw WK erbij is een regel.
- Een WK heeft duizenden uitslagen. Het eerste ophalen kan daardoor een paar
  seconden duren en een paar tientallen MB geheugen kosten; daarna komt het uit
  de cache.
- Spelmodi en duels leveren nog geen XP of achievements op. Dat kan via
  `buildMetrics()` in `Achievements`, met `game_runs` als bron.
- Solves uit een spelmodus komen niet in je sessie (net als bij toernooien).
  Wil je ze wel in je statistieken, dan kan de capture-handler ze ook doorgeven.

- E-mailadres wijzigen kan nog niet vanuit de site. Komt dat, stuur dan een
  nieuwe bevestigingsmail en zet `email_verified_at` terug op NULL; een oude
  link werkt dan vanzelf niet meer (`email_verifications.email_lower`).
- De statistieken rekenen in de browser over alle sessies. Bij duizenden solves
  kan dat beter naar een query op `solves` met de index
  `(user_id, event, solved_at)`, die daar al voor ligt.
- De tijdweergave blijft `mm:ss:mmm`. Dat is besloten; niet meer voorstellen om
  er `11.53` van te maken.
- De herberekening na een synchronisatie draait over álle solves. Bij 18.000
  solves duurt dat 2,5 seconde. Wordt dat een probleem, dan is de volgende stap
  alleen de staart herberekenen met een `records_computed_through`-markering.
- De ranglijst bladert per 50 tot plek 10.000 (`MAX_OFFSET` in
  `leaderboard.js`, gelijk aan de grens in `Leaderboard::top()`). "Naar mijn
  plek" gebruikt `Leaderboard::indexFor()`, met dezelfde volgorde als `top()`:
  tijd, dan wie hem het eerst zette, dan het user-id.
- De scramble van de dag is er voor 3x3 plus een roulerend event
  (`Challenges::ROTATING_EVENTS`, acht stuks, dus een cyclus van acht dagen).
  Megaminx, Square-1 en Clock doen niet mee: hun notatie is te eigenzinnig om
  een aangeleverde scramble betrouwbaar te controleren. Zie
  `Events::SCRAMBLE_FORMATS`.
- Loopt de voorraad voor het roulerende event leeg, dan is er die dag geen
  tweede scramble van de dag. Dat is bewust; liever geen opdracht dan een
  scramble waarvan we de herkomst niet kennen.
- Het profiel toont hooguit twaalf uitgelichte achievements, het zeldzaamst
  eerst (`PublicProfile::HIGHLIGHT_COUNT`).
- Een toernooi kent drie vaste rondes. Wil je er meer, dan moeten
  `Tournaments::ROUND_NAMES` en `ADVANCING` mee.
- Je kunt maar een toernooi tegelijk hebben lopen.
- Je volgt hooguit 500 mensen (`Follows::MAX_FOLLOWING`), zodat de
  vriendenranglijst een enkele query blijft.
- `achievements/list.php` doet een volledige `Records::rebuild()` om de
  voortgang vers te hebben. Dat is dezelfde 2,5 seconde als een synchronisatie
  bij een heel groot account; bij klachten kan het scherm de laatst bekende
  cijfers gebruiken in plaats van opnieuw te rekenen.
- Losse tijden zijn alleen als aantal zichtbaar, niet als lijst. Terughalen doet
  ze allemaal tegelijk, in een nieuwe sessie per event. **Besloten: zo laten**;
  een lijst per stuk komt er niet.
- De leerpagina legt F2L uit voor de sleuf rechtsvoor. De andere drie sleuven
  doe je door de kubus te draaien; er staan dus geen gespiegelde varianten in.
- Smart cubes werken alleen in een 3x3-sessie. De GAN 251 (2x2) kent een eigen
  variant van gen4 die er niet in zit.
- Valt de verbinding met een smart cube weg, dan verbind je opnieuw met één
  klik; automatisch opnieuw verbinden zit er niet in (was een keuze).
- De smart-cubedrivers zijn getest met nagebootste cubes, GAN ook tegen
  gan-web-bluetooth. Met een echte cube: de eigenaar heeft een GAN en een QiYi;
  MoYu, Giiker en GoCube heeft niemand van ons. Bij de oude MoYu (MHC) is
  draaien tegen de klok in onzeker: csTimer leest de hoek zonder teken, en dat
  hebben we zo overgenomen.
- De gyroscoop van GAN-cubes (kantelen van de hele cube) wordt niet gebruikt.
- Bij OLL en PLL staat één algoritme per geval. Alternatieven (links- of
  rechtshandige varianten) zouden een tweede veld in `algorithms.js` vragen.
