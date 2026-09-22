<div align="center">

<img src="public_html/Pictures/CubeTimerLogo_V2.png" alt="CubeTimer" height="90" />

**Een rustige, snelle speedcubing-timer voor in je browser.**

Officiële WCA-scrambles · inspectietijd · sessies · statistieken · smart cubes
· ranglijsten · daily challenges · achievements

[**cubetimer.nl**](https://cubetimer.nl) · [Roadmap](https://github.com/frocky10/cubetimer.nl/issues) · [Werkafspraken](CLAUDE.md)

</div>

---

<img src="docs/screenshot-donker.png" alt="CubeTimer in het donkere thema" />

<details>
<summary>Het lichte thema</summary>

<img src="docs/screenshot-licht.png" alt="CubeTimer in het lichte thema" />

</details>

<details>
<summary>De ranglijsten</summary>

<img src="docs/screenshot-ranglijst.png" alt="De ranglijsten" />

</details>

<details>
<summary>De daily challenges</summary>

<img src="docs/screenshot-challenges.png" alt="De daily challenges" />

</details>

<details>
<summary>De achievements</summary>

<img src="docs/screenshot-achievements.png" alt="De achievements" />

</details>

---

## Wat is het

CubeTimer is een timer voor speedcubers. Geen account nodig, geen installatie,
geen cookiebanner die je eerst moet wegklikken: je opent de site en drukt op de
spatiebalk.

Wil je je tijden bewaren en meenemen naar een ander apparaat, dan kan dat met
een account. Je komt dan ook op de ranglijsten, verdient XP, verzamelt
achievements en kunt elke dag de scramble van de dag doen. Wil je dat niet, dan blijft alles gewoon in je browser
staan en werkt de timer ook zonder internet.

**Zo werkt het timen:**

| Toets | Wat het doet |
|---|---|
| `Spatie` | Start de inspectietijd. Nog een keer indrukken en vasthouden tot de lampjes groen worden, dan loslaten om te starten. Nogmaals indrukken stopt de timer. |
| `2` | Zet een +2 op je laatste solve, of haalt hem er weer af |
| `D` | Markeert je laatste solve als DNF |
| `⌫` | Verwijdert je laatste solve |
| Tik op het scherm | Hetzelfde als de spatiebalk, op telefoon en tablet |

Klik op een rij in de tabel om een oudere solve aan te passen of de scramble
terug te zien.

---

## Status

### Klaar

**Timen**

- [x] Timer met spatiebalk: indrukken, vasthouden tot groen, loslaten
- [x] Tikken om te timen op telefoon en tablet
- [x] WCA-inspectie van 15 seconden, met automatische +2 en DNF
- [x] Instelbare vasthoudtijd (uit, 0,3s, 0,5s of 0,8s)
- [x] Focusmodus: alles dimt weg zodra de timer loopt

**Scrambles**

- [x] Officiële WCA-scrambles via [cubing.js](https://cubing.net)
- [x] 19 events: 2x2 t/m 7x7, blind, one-handed, Megaminx, Pyraminx, Skewb, Square-1 en meer

**Je tijden**

- [x] Meerdere sessies, elk met een eigen event
- [x] Lopende Ao5 en Ao12 per solve, volgens de WCA-regels
- [x] +2, DNF, straf wissen en verwijderen per solve
- [x] Scramble en datum bewaard bij elke solve
- [x] Sessiegrafiek van je verloop
- [x] Confetti bij een nieuw sessierecord
- [x] Statistieken per sessie, per dag en per week — [#8](https://github.com/frocky10/cubetimer.nl/issues/8)
- [x] Beste, slechtste, gemiddelde en mediaan per periode
- [x] Beste Mo3, Ao5, Ao12, Ao50 en Ao100 — [#22](https://github.com/frocky10/cubetimer.nl/issues/22)
- [x] Je records per event bewaard op je account, inclusief je slechtste tijd

**Smart cubes** — [#11](https://github.com/frocky10/cubetimer.nl/issues/11)

- [x] GAN- en QiYi/X-Man-cubes via Web Bluetooth
- [x] 3D-weergave van je cube die meedraait
- [x] Timer start en stopt vanzelf op je eerste en laatste zet
- [x] Scramble-tracker die bijhoudt hoever je bent

**Account** — [#10](https://github.com/frocky10/cubetimer.nl/issues/10)

- [x] Registreren en inloggen
- [x] Tijden synchroniseren naar de server
- [x] Samenvoegen van lokale tijden en servertijden bij het inloggen
- [x] Blijft werken zonder internet; localStorage is altijd de werkkopie

**Ranglijsten en voortgang**

- [x] Leaderboards per event, voor single, Mo3, Ao5, Ao12, Ao50 en Ao100 — [#13](https://github.com/frocky10/cubetimer.nl/issues/13)
- [x] Te bekijken over alle tijd, deze week of vandaag
- [x] XP voor solven, persoonlijke records en dagen op rij — [#28](https://github.com/frocky10/cubetimer.nl/issues/28)
- [x] Levels met tiers: Brons, Zilver, Goud, Platina, Diamant
- [x] Rangbadge met je positie, in de kleur van je level — [#26](https://github.com/frocky10/cubetimer.nl/issues/26)
- [x] Streak: hoeveel dagen achter elkaar je getimed hebt
- [x] Zelf te kiezen of je meedoet aan de ranglijsten
- [x] Controle op onmogelijke tijden, met een beoordeelscherm voor de beheerder

**Daily challenges** — [#29](https://github.com/frocky10/cubetimer.nl/issues/29)

- [x] Scramble van de dag: iedereen dezelfde scramble, één poging, eigen dagranglijst
- [x] Dagopdracht "doe X solves vandaag"
- [x] Dagopdracht "doe een solve die X% sneller is dan je gebruikelijke tijd"

**Achievements** — [#27](https://github.com/frocky10/cubetimer.nl/issues/27)

- [x] 96 achievements: 21 families in vier niveaus, plus 12 geheime
- [x] Mijlpalen: solves, dagen, sessies, records, XP
- [x] Ontdekken: hoeveel events je geprobeerd en opgelost hebt
- [x] Snelheid: sub-drempels op 3x3, 2x2, 4x4, 5x5 en Pyraminx, single én Ao12
- [x] Volhouden: reeksen, drukste dag, smart-cube solves
- [x] Challenges en ranglijst: challenges gehaald, beste positie, scrambles gewonnen
- [x] Pech: je +2's en je DNF's tellen ook mee
- [x] Twaalf geheime, van een palindroomtijd tot een PB direct na een DNF
- [x] Voortgangsbalk naar het volgende niveau en hoe zeldzaam elk niveau is
- [x] Gelden met terugwerkende kracht: alles wat je ooit timede telt mee

**De site zelf**

- [x] Eigen design system, geen CSS-framework meer
- [x] Donker en licht thema, volgt standaard je systeeminstelling
- [x] Werkt op telefoon, tablet en desktop
- [x] Instellingenpaneel
- [x] Bug- en ideeënknop die een GitHub-issue aanmaakt — [#16](https://github.com/frocky10/cubetimer.nl/issues/16)

### Nog te doen

**Account uitbouwen**

- [ ] Openbaar profiel dat je kunt delen
- [ ] Landenvlag naast je naam op de ranglijst (het veld staat er al)

**Nieuwe manieren om te oefenen**

- [ ] Tournament mode: eigen schema met rondes en cutoffs — [#12](https://github.com/frocky10/cubetimer.nl/issues/12)
- [ ] Tournament mode v2: kiezen uit echte historische competities — [#14](https://github.com/frocky10/cubetimer.nl/issues/14)
- [ ] Training tools — [#30](https://github.com/frocky10/cubetimer.nl/issues/30)
- [ ] Special gamemodes — [#31](https://github.com/frocky10/cubetimer.nl/issues/31)
- [ ] Tutorialpagina's — [#21](https://github.com/frocky10/cubetimer.nl/issues/21)

**Techniek**

- [ ] Eigen scramble-script in plaats van de CDN — [#36](https://github.com/frocky10/cubetimer.nl/issues/36)
- [ ] Wachtwoord vergeten (de tabel staat er al, de e-mailflow nog niet)
- [ ] E-mailadres bevestigen bij registratie
- [ ] Paginering op de ranglijsten (de server kan het al, de interface nog niet)
- [ ] Scramble van de dag ook voor andere events dan 3x3
- [ ] `bluetoothCube.js` opschonen; is bij de restyling met rust gelaten
- [x] ~~Tijden tonen als `11.53`~~ — besloten: blijft `00:11:530`

**Beheer**

- [ ] Google Ads goed instellen — [#15](https://github.com/frocky10/cubetimer.nl/issues/15)

---

## Zelf draaien

Je hebt alleen PHP nodig. Zonder database werken de timer, de scrambles, de
sessies en de statistieken gewoon; de account- en meldknop verbergen zichzelf.

```bash
git clone https://github.com/frocky10/cubetimer.nl.git
cd cubetimer.nl
php -S 127.0.0.1:8123 -t public_html
```

Open <http://127.0.0.1:8123>.

Wil je ook accounts testen, zet dan een MySQL of MariaDB op, importeer
`database/001_initial_schema.sql` en `database/002_feedback_reports.sql`, en leg
een `cubetimer_config.php` neer één map boven `public_html`. Zie
[`database/README.md`](database/README.md).

---

## Installeren op je eigen hosting

Bedoeld voor shared hosting met DirectAdmin, maar het werkt op elke server met
PHP 8.1 en MySQL.

1. **Bestanden** — zet de inhoud van `public_html/` in je webroot. Of laat de
   GitHub Action het doen: push naar de branch `Release` en vul de secrets
   `FTP_HOST`, `FTP_USER`, `FTP_PASS` en `FTP_PORT` in.
2. **Database** — maak een database aan en importeer de twee bestanden uit
   `database/` op volgorde. Uitgebreide stappen staan in
   [`database/README.md`](database/README.md).
3. **Configuratie** — kopieer `public_html/api/config.example.php` naar
   `~/cubetimer_config.php`, dus één map **boven** je webroot, en vul je
   database-gegevens in. Daar komt de deploy nooit aan, dus je config blijft
   staan bij elke nieuwe release.
4. **Bug-knop** (optioneel) — maak een
   [fine-grained token](https://github.com/settings/personal-access-tokens) met
   alleen *Issues: read and write* op je eigen repo, en zet die in je config.
   Laat je hem leeg, dan verdwijnt de knop vanzelf.
5. **Controleren** — ga naar `/api/status.php`. Daar zie je welke onderdelen
   aanstaan. Controleer ook dat `/api/lib/Auth.php` een 403 of 404 geeft en niet
   je broncode laat zien.

---

## Hoe het in elkaar zit

Geen build, geen bundler, geen `node_modules`. Je kunt elk bestand openen en
meteen zien wat het doet.

| Map | Wat erin zit |
|---|---|
| `public_html/` | Precies wat er op de server komt te staan |
| `public_html/Script/` | De frontend, opgesplitst per onderwerp |
| `public_html/Style/style.css` | Eén design system met alle tokens bovenaan |
| `public_html/api/` | PHP-backend: accounts, synchronisatie en meldingen |
| `database/` | Genummerde SQL-migraties, met uitleg per stap |
| `.github/workflows/` | FTP-deploy naar DirectAdmin |

**Externe afhankelijkheden:** [cubing.js](https://cubing.net) voor de scrambles
en de 3D-cube, en Inter van Google Fonts. Verder niets.

[`CLAUDE.md`](CLAUDE.md) beschrijft de werkafspraken, de laadvolgorde van de
scripts, de vorm van de data en de regels voor de backend. Lees dat eerst als je
iets gaat aanpassen.

---

## Iets gevonden?

Gebruik de knop rechtsboven op de site — dan komt je melding meteen als issue
binnen, met je browser en schermformaat erbij. Een
[issue aanmaken](https://github.com/frocky10/cubetimer.nl/issues/new) mag
natuurlijk ook.
