# Database

Alle wijzigingen aan de MySQL-database staan hier als genummerde SQL-bestanden.
Je importeert ze **op volgorde**, en elk bestand hoef je maar één keer te draaien.

## Conventie

```
database/<nummer>_<wat_het_doet>.sql
```

* Het nummer is driecijferig en loopt op: `001`, `002`, `003`, …
* De bestandsnaam zegt wat de migratie aanpast.
* Bovenin elk bestand staat een blok commentaar met precies wat er verandert.
* Elke migratie eindigt met een `INSERT` in `schema_migrations`, zodat je in de
  database kunt zien welke versies al gedraaid hebben.
* Migraties zijn **additief**: een al geïmporteerd bestand wordt nooit aangepast.
  Moet er iets anders? Dan komt er een nieuw nummer bij.
* Alle migraties zijn zo geschreven dat ze veilig opnieuw te draaien zijn
  (`CREATE TABLE IF NOT EXISTS`, `ON DUPLICATE KEY UPDATE`).

## Overzicht

| Nummer | Bestand                     | Wat het doet |
|--------|-----------------------------|--------------|
| 001    | `001_initial_schema.sql`    | Migratietabel, `users`, `user_profiles`, `user_sessions`, `password_resets`, `timer_sessions`, `solves` |
| 002    | `002_feedback_reports.sql`  | `feedback_reports` — logboek van meldingen uit de bug-knop |
| 003    | `003_records_xp_en_leaderboards.sql` | `user_records`, `solve_flags`, `xp_events`, plus streakvelden op `user_profiles` |
| 004    | `004_daily_challenges.sql`  | `scramble_pool`, `daily_challenges`, `challenge_entries` |
| 005    | `005_achievements.sql`      | `user_achievements` — wat iemand behaald heeft en wanneer |
| 006    | `006_toernooien_en_volgen.sql` | `user_follows`, plus de zes toernooitabellen |
| 007    | `007_losse_tijden_en_algoritmes.sql` | `solves.timer_session_id` mag leeg zijn (losse tijden), sleutel naar `ON DELETE SET NULL`, en `user_algorithms` |
| 008    | `008_smartcube_analyse.sql` | `solves.details`: analyse van een smart-cubesolve (JSON, door de server gecontroleerd) |

## Eenmalige setup in DirectAdmin

1. **Database aanmaken** — DirectAdmin → *MySQL Management* → *Create new Database*.
   * Database naam: bijv. `cubetimer`
   * Maak meteen een database-gebruiker aan met een sterk wachtwoord.
   * DirectAdmin zet er automatisch je accountnaam voor: je krijgt iets als
     `gebruiker_cubetimer` en `gebruiker_cubeuser`. Noteer de **volledige** namen.
2. **Collation controleren** — de database moet `utf8mb4` / `utf8mb4_unicode_ci`
   zijn. Staat er nog `latin1`, pas dat dan aan in phpMyAdmin → *Operations*.
3. **Migraties importeren** — phpMyAdmin → kies de database → tabblad
   *Importeren* → `001_initial_schema.sql` kiezen → *Start*. Daarna hetzelfde
   voor `002` tot en met `006`, in die volgorde.
4. **Controleren** — draai in phpMyAdmin → *SQL*:
   ```sql
   SELECT * FROM schema_migrations ORDER BY version;
   ```
   Je hoort nu rijen `001` tot en met `006` te zien.
5. **Configuratie invullen** — kopieer `public_html/api/config.example.php` naar
   `~/cubetimer_config.php` (dus één map **boven** `public_html`) en vul je
   database- en GitHub-gegevens in. Zie de sectie *Configuratie* hieronder.

## Configuratie

De API leest zijn geheimen uit een PHP-bestand dat **buiten de webroot** staat,
zodat niemand het via de browser kan opvragen en het nooit in git belandt.

De API zoekt op deze plekken, in deze volgorde:

1. `CUBETIMER_CONFIG` (environment-variabele met een pad)
2. `<home>/cubetimer_config.php` — de aanbevolen plek
3. `<map boven public_html>/cubetimer_config.php`
4. `public_html/api/config.php` — alleen als noodgreep; staat in `.gitignore`
   en wordt door `api/.htaccess` afgeschermd

Zet het bestand neer via DirectAdmin → *File Manager*, één niveau boven
`public_html`. De FTP-deploy raakt die map niet aan, dus je config blijft staan
bij elke nieuwe release.

## Een nieuwe migratie toevoegen

1. Nieuw bestand `database/00X_korte_omschrijving.sql`.
2. Bovenin een commentaarblok met wat het aanpast en waarom.
3. Onderin de `INSERT` in `schema_migrations` met hetzelfde nummer.
4. Regel toevoegen aan de tabel *Overzicht* hierboven.
5. Gebruik `ALTER TABLE` voor wijzigingen aan bestaande tabellen — nooit
   `DROP` + `CREATE`, want dan verlies je data die al live staat.

## Datamodel in het kort

```
users ──1:1── user_profiles          (xp, level, streak, land, hoofd-event)
  │
  ├──1:n── user_sessions             (actieve logins; cookie-token, gehasht)
  ├──1:n── password_resets
  ├──1:n── feedback_reports          (meldingen uit de bug-knop)
  ├──1:n── user_records              (beste per event/categorie/periode)
  ├──1:n── solve_flags               (tijden die nagekeken moeten worden)
  ├──1:n── xp_events                 (logboek van alle toegekende XP)
  ├──1:n── challenge_entries ──n:1── daily_challenges ──n:1── scramble_pool
  ├──1:n── user_achievements         (behaalde achievements)
  ├──n:n── user_follows              (wie volgt wie; wederzijds = vrienden)
  ├──1:n── tournament_records        (records uit toernooien, apart gehouden)
  ├──1:n── tournaments ──1:n── tournament_rounds
  │                    ├──1:n── tournament_competitors
  │                    ├──1:n── tournament_results
  │                    └──1:n── tournament_solves
  └──1:n── timer_sessions ──1:n── solves
```

`tournament_records` staat bewust los van `user_records`. Een toernooitijd komt
onder heel andere omstandigheden tot stand dan een oefensolve; ze horen niet
door dezelfde gemiddelden te lopen, maar wel ergens zichtbaar te zijn. Op het
profiel krijgen ze een eigen blok.

De achievements zelf staan **niet** in de database maar in
`public_html/api/lib/Achievements.php`. Het zijn er honderdtwintig, de drempel
en de controle horen bij elkaar, en zo is er geen migratie nodig als er eentje
bij komt. Hetzelfde geldt voor de algoritmes op de leerpagina: `user_algorithms`
bewaart alleen wélke id's iemand heeft afgevinkt, de catalogus staat in
`public_html/Script/algorithms.js`.

`user_records` wordt volledig door de server berekend uit `solves`, na elke
synchronisatie. De browser levert nooit een gemiddelde aan; dat zou met de
console te vervalsen zijn. De leaderboards lezen rechtstreeks uit deze tabel.

`solve_flags` staat bewust los van `solves`. Een markering is een
beoordelingsstatus en geen eigenschap van de solve zelf: hij komt van de server,
niet van de browser, en moet blijven staan als de gebruiker zijn tijd bewerkt.
(Tot migratie 007 was er nog een tweede reden: `solves` werd bij elke
synchronisatie volledig vervangen. Dat gebeurt niet meer — rijen worden nu
bijgewerkt in plaats van weggegooid.)

`xp_events` heeft een unieke sleutel op `(user_id, type, reference)`. Dat is wat
voorkomt dat dezelfde solve of hetzelfde record bij een volgende synchronisatie
opnieuw XP oplevert.

`solves` draagt zowel `timer_session_id` als een eigen `event` en `solved_at`.
Die duplicatie is bewust: de daily/weekly averages draaien op de index
`(user_id, event, solved_at)` en hoeven daardoor niet te joinen. Sinds migratie
007 mag `timer_session_id` leeg zijn: zo'n solve is een *losse tijd* die nog wel
op het account staat en meetelt, maar niet meer onder een sessie hangt. Juist
omdat het event in de rij zelf staat, telt zo'n tijd gewoon mee in alle
berekeningen.

`client_id` op `timer_sessions` en `solves` is het id dat de browser zelf
genereert. Daarmee is lokale localStorage-data en serverdata aan elkaar te
koppelen, ook als iemand eerst uitgelogd heeft getimed.
