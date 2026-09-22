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
- Statistieken per sessie, per dag en per week
- Smart cubes via Web Bluetooth (GAN en QiYi/X-Man) met 3D-weergave
- Accounts met synchronisatie van je tijden naar de server
- Bug-/ideeënknop die een GitHub-issue aanmaakt
- Donker en licht thema, sessiegrafiek, confetti bij een PR

---

## Mappen

```
.github/workflows/deploy.yml   FTP-deploy naar DirectAdmin (branch: Release)
database/                      Genummerde SQL-migraties + uitleg
public_html/                   Precies wat er op de server komt te staan
  index.html
  Style/style.css              Eén design system, met tokens bovenaan
  Script/
    ui.js                      Toasts, modals, ask(), api(), opslag  ← laadt eerst
    script.js                  Timerkern, sessies, instellingen, tabel, grafiek
    stats.js                   Statistieken sessie / vandaag / deze week
    settings.js                Koppelt de instellingen-modal aan script.js
    feedback.js                Bug-/ideeënknop
    account.js                 Inloggen, registreren, synchroniseren
    scrambleScript.js          Scrambles via cubing.js (ES-module)
    bluetoothCube.js           Smart cubes via Web Bluetooth (ES-module)
  api/                         PHP-backend
    bootstrap.php              Laadt de libs, zet de foutafhandeling
    status.php                 Welke onderdelen zijn beschikbaar?
    config.example.php         Sjabloon — kopieer naar ~/cubetimer_config.php
    lib/                       Config, Http, Database, Auth, RateLimiter, GitHubIssues
    auth/                      register, login, logout, me
    sync/                      pull, push
    feedback/                  report
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
for f in ui script stats settings feedback account; do
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
niet naar een bestand; dan flitst de site bij het laden.

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
| `window.CubeTimerUI` | `ui.js` | `toast`, `ask`, `openModal`, `closeModal`, `registerModal`, `isAnyModalOpen`, `api`, `status`, `formatTime`, `uniqueId`, `storage` |
| `window.cubeTimerApi` | `script.js` | `getSessions`, `replaceSessions`, `getSetting`, `updateSetting`, `averageOf`, `getEffectiveTime`, `getState`, en de Bluetooth-haken |

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
| `sync/push.php` | POST | Volledige staat opslaan (vervangt) |
| `feedback/report.php` | POST | Melding als GitHub-issue |

### Rate limiting

`RateLimiter` werkt op bestanden in `storage_path`, niet op de database, zodat
de bug-knop ook werkt op een installatie zonder database. Huidige limieten
(per IP): registreren 5/uur, inloggen 15 per kwartier per IP en 8 per kwartier
per account, meldingen 5/uur. Zonder schrijfbare map wordt er niet gelimiteerd.

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
- De tijdweergave is `mm:ss:mmm`. Veel cubers verwachten `11.53`. Bewust niet
  aangepast — dat is een eigen beslissing waard.
