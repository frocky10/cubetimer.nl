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
- Smart cubes via Web Bluetooth (GAN en QiYi/X-Man) met 3D-weergave
- Accounts met synchronisatie van je tijden naar de server
- Leaderboards per event, categorie en periode
- XP, levels, streaks en een rangbadge
- Daily challenges: scramble van de dag plus twee opdrachten
- 96 achievements in vier niveaus, plus twaalf geheime
- Openbare, deelbare profielen op /profiel.php?u=naam
- Bug-/ideeënknop die een GitHub-issue aanmaakt
- Donker en licht thema, sessiegrafiek, confetti bij een PR

---

## Mappen

```
.github/workflows/deploy.yml   FTP-deploy naar DirectAdmin (branch: Release)
database/                      Genummerde SQL-migraties + uitleg
public_html/                   Precies wat er op de server komt te staan
  index.html                   De timer
  profiel.php                  Openbaar profiel, serverside gerenderd
  .htaccess                    Rewrite van /u/naam naar profiel.php
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
    admin.js                   Beoordeelwachtrij (alleen voor de rol admin)
    scrambleScript.js          Scrambles via cubing.js (ES-module)
    bluetoothCube.js           Smart cubes via Web Bluetooth (ES-module)
  api/                         PHP-backend
    bootstrap.php              Laadt de libs, zet de foutafhandeling
    status.php                 Welke onderdelen zijn beschikbaar?
    config.example.php         Sjabloon — kopieer naar ~/cubetimer_config.php
    lib/                       Config, Http, Database, Auth, RateLimiter, GitHubIssues,
                               SiteTime, Events, Averages, Records, Xp,
                               Leaderboard, Challenges, SolveFacts, Achievements,
                               PublicProfile
    auth/                      register, login, logout, me
    sync/                      pull, push
    feedback/                  report
    leaderboard/               list
    profile/                   overview, settings, public
    challenges/                today, submit, contribute
    achievements/              list
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
         achievements admin; do
  node --check public_html/Script/$f.js
done

# De site lokaal draaien, inclusief werkende API
php -S 127.0.0.1:8123 -t public_html
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

`script.js` en `bluetoothCube.js` zoeken elementen op id en klasse op. Deze
namen liggen vast tenzij je het JS meeverandert:

`#timer`, `#ready-lights`, `.ready-light` (+ `.active` / `.green`),
`#table-body`, `#times-table`, `#Scrambles`, `.ScrambleBox`, `#session-pr`,
`#session-graph-canvas`, `#confetti-canvas`, `#theme-toggle` (+ `.moon` /
`.sun` / `.toggle-knob`), `#session-select`, `#cube-select`, `#cube-display`,
`.time-modal` (+ `.visible`), alle `#modal-*`, alle `#bluetooth-*`,
`[data-settings-tab]` / `[data-settings-panel]`.

De klasse `.time-modal` is een historische naam en wordt door **alle** modals
gebruikt, niet alleen die van een solve.

### Laadvolgorde

`ui.js` moet als eerste geladen worden (alle andere scripts gebruiken
`window.CubeTimerUI`), daarna `script.js` (dat `window.cubeTimerApi` zet),
daarna de rest. Ze staan met `defer` in de `<head>`, wat de volgorde
garandeert. De twee ES-modules laden apart en mogen nergens vroeg op rekenen.

### De twee globale objecten

| Object | Van wie | Waarvoor |
|---|---|---|
| `window.CubeTimerUI` | `ui.js` | `toast`, `ask`, `openModal`, `closeModal`, `registerModal`, `isAnyModalOpen`, `api`, `status`, `refreshStatus`, `formatTime`, `uniqueId`, `storage` |
| `window.cubeTimerApi` | `script.js` | `getSessions`, `replaceSessions`, `getSetting`, `updateSetting`, `averageOf`, `getEffectiveTime`, `getEventOptions`, `setScrambleOverride`, `getState`, en de Bluetooth-haken |
| `window.CubeTimerAccount` | `account.js` | `currentUsername`, `getProfile`, `reloadProfile` |
| `window.CubeTimerLeaderboard` | `leaderboard.js` | `open`, `reload` |
| `window.CubeTimerChallenges` | `challenges.js` | `load`, `stopChallenge` |
| `window.CubeTimerAchievements` | `achievements.js` | `load`, `announce` |

Gebruik **`CubeTimerUI.ask()` in plaats van `prompt()` of `confirm()`** en
**`CubeTimerUI.toast()` in plaats van `alert()`**. De browserdialogen passen
niet bij de rest van de site en blokkeren de timer.

### Events tussen de scripts

| Event | Wanneer | Wie luistert |
|---|---|---|
| `cubetimer:data-change` | na elke wijziging aan tijden of sessies | `stats.js`, `account.js` |
| `cubetimer:event-change` | ander cube/event gekozen | `stats.js`, `bluetoothCube.js` |
| `cubetimer:scramble-change` | nieuwe scramble klaar | `bluetoothCube.js` |
| `cubetimer:settings-change` | instelling gewijzigd | `settings.js` |
| `cubetimer:solve` | een solve is opgeslagen, met de solve erbij | `challenges.js` |
| `cubetimer:synced` | synchronisatie geslaagd, server heeft herberekend | `challenges.js` |
| `cubetimer:auth-change` | in- of uitgelogd, met de verse status erbij | `admin.js`, `challenges.js`, `leaderboard.js`, `achievements.js` |
| `cubetimer:achievements-unlocked` | er zijn achievements behaald | `achievements.js` |

### Waar de data staat

localStorage is altijd de werkkopie, ook als je ingelogd bent. Zonder internet
blijft de timer dus gewoon werken.

| Sleutel | Inhoud |
|---|---|
| `cubetimer_sessions_v1` | `{ sessions: { <id>: { id, name, event, times[] } }, activeSessionId }` |
| `cubetimer_settings_v1` | thema, focusmodus, confetti, inspectie, vasthoudtijd, bevestigen |
| `cubetimer_theme` | het opgeloste thema (`dark`/`light`) voor het inline script |
| `cubetimer_stats_scope` | laatst gekozen periode in het statistiekenpaneel |

Een solve ziet er zo uit:

```js
{
  id: 'solve-<base36>-<random>',  // uniek; nodig om te kunnen synchroniseren
  raw: 12345,                     // milliseconden, of null bij een DNF
  penalty: null | 'plus2' | 'dnf',// de +2 zit NIET in raw verwerkt
  timestamp: '2026-09-22T10:15:00.000Z',
  scramble: "R U R' U' F2 ...",
  source: 'manual' | 'bluetooth'
}
```

Oude solves uit localStorage hebben nog geen `id`; `ensureSolveIds()` vult die
bij het laden aan. Verwijder die functie niet.

### Gemiddelden

`averageOf(entries)` in `script.js` rekent volgens de WCA-regels: de beste en
de slechtste vallen weg, één DNF telt als slechtste en mag dus, vanaf twee
DNF's is het gemiddelde zelf een DNF. Gebruik altijd deze functie — niet zelf
een gemiddelde uitrekenen.

`stats.js` gebruikt hem voor het *beste* Ao5/Ao12 over een periode (alle
aaneengesloten blokken), `script.js` voor het *lopende* gemiddelde in de tabel.

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
| `auth/me.php` | GET | Huidige gebruiker, of `user: null` |
| `sync/pull.php` | GET | Alle sessies en solves ophalen |
| `sync/push.php` | POST | Volledige staat opslaan (vervangt) en alles herberekenen |
| `feedback/report.php` | POST | Melding als GitHub-issue |
| `leaderboard/list.php` | GET | Ranglijst per event, categorie en periode (openbaar) |
| `profile/overview.php` | GET | XP, level, rang, streak, records, XP-logboek |
| `profile/settings.php` | POST | Hoofd-event, land, wel of niet op de ranglijst |
| `profile/public.php` | GET | Het openbare profiel van een cuber (zonder login) |
| `challenges/today.php` | GET | De opdrachten van vandaag met je voortgang |
| `challenges/submit.php` | POST | Je poging voor de scramble van de dag |
| `challenges/contribute.php` | POST | Scrambles aanleveren voor de voorraad |
| `achievements/list.php` | GET | De catalogus, met je eigen stand als je ingelogd bent |
| `admin/flags.php` | GET/POST | Beoordeelwachtrij (alleen rol `admin`) |

### Rate limiting

`RateLimiter` werkt op bestanden in `storage_path`, niet op de database, zodat
de bug-knop ook werkt op een installatie zonder database. Huidige limieten
(per IP): registreren 5/uur, inloggen 15 per kwartier per IP en 8 per kwartier
per account, meldingen 5/uur. Zonder schrijfbare map wordt er niet gelimiteerd.

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

Loopt de voorraad leeg, dan is er die dag simpelweg geen scramble van de dag;
de twee andere opdrachten staan er wel. Dat is bewust: liever geen opdracht dan
een scramble waarvan we de herkomst niet kennen.

---

## Openbare profielen

`/profiel.php?u=naam` is een **serverside gerenderde** pagina, geen JavaScript
dat een leeg scherm vult. Reden: een gedeelde link moet in WhatsApp, Discord en
Google meteen laten zien om wie het gaat, en dat werkt alleen als de titel en
de omschrijving al in de HTML staan. De og-tags worden per cuber ingevuld.

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

## Landen

De landcode staat als tekstbadge naast de naam, niet als vlag. Emoji-vlaggen
worden op Windows als losse letters getoond, en dat is voor het grootste deel
van de desktopbezoekers lelijker dan de code zelf. Wil je alsnog echte vlaggen,
dan moeten het meegeleverde SVG-bestanden worden.

De codes staan in `ui.js` (`COUNTRY_CODES`, 195 stuks). De **namen** komen uit
de browser via `Intl.DisplayNames`, dus er is geen vertaallijst om bij te
houden. `UI.countries()` geeft de gesorteerde lijst, `UI.countryName(code)` een
losse naam.

---

## Achievements

Zesennegentig stuks: eenentwintig families in vier niveaus (brons, zilver,
goud, platina) plus twaalf geheime. De catalogus staat in
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

Bewust simpel gehouden:

1. **Bij het inloggen** haalt `account.js` de server op en voegt die samen met
   wat er lokaal staat (`mergeSessions`). Koppelen gebeurt op `id` van de
   sessie en op `id` van de solve; staat een solve aan beide kanten, dan wint
   de lokale versie.
2. **Daarna is de browser de bron van waarheid.** Bij elke wijziging wordt na
   2,5 seconde de *volledige* staat naar `sync/push.php` geduwd, dat alle rijen
   van die gebruiker vervangt in één transactie.

Daardoor zijn er geen merge-conflicten mogelijk. Nadeel: twee tabbladen
tegelijk open die allebei timen, overschrijven elkaar. Zolang dat geen echt
probleem is, houden we het zo. Gaan we het wél oplossen, dan wordt het
incrementeel synchroniseren met een `updated_at` per solve — dat is de reden dat
elke solve al een eigen `id` heeft.

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

- Wachtwoord vergeten: de tabel `password_resets` staat er al, de e-mailflow
  nog niet.
- E-mailadres bevestigen: `users.email_verified_at` staat er al, ongebruikt.
- De statistieken rekenen in de browser over alle sessies. Bij duizenden solves
  kan dat beter naar een query op `solves` met de index
  `(user_id, event, solved_at)`, die daar al voor ligt.
- `bluetoothCube.js` is nog niet nagelopen op stijl of structuur; het werkt en
  is met rust gelaten bij de restyling.
- De tijdweergave blijft `mm:ss:mmm`. Dat is besloten; niet meer voorstellen om
  er `11.53` van te maken.
- De herberekening na een synchronisatie draait over álle solves. Bij 18.000
  solves duurt dat 2,5 seconde. Wordt dat een probleem, dan is de volgende stap
  alleen de staart herberekenen met een `records_computed_through`-markering.
- Leaderboards tonen nu de top 100. Paginering zit al in `Leaderboard::top()`
  (`offset`), maar de interface gebruikt hem nog niet.
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
- `achievements/list.php` doet een volledige `Records::rebuild()` om de
  voortgang vers te hebben. Dat is dezelfde 2,5 seconde als een synchronisatie
  bij een heel groot account; bij klachten kan het scherm de laatst bekende
  cijfers gebruiken in plaats van opnieuw te rekenen.
