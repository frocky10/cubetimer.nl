<?php
/**
 * CubeTimer - configuratievoorbeeld
 * ---------------------------------------------------------------------------
 * Kopieer dit bestand naar `~/cubetimer_config.php` (dus EEN MAP BOVEN
 * public_html) via DirectAdmin > File Manager, en vul je eigen gegevens in.
 *
 * Zet het NIET in public_html en commit het NOOIT naar git.
 *
 * De API zoekt de config in deze volgorde:
 *   1. het pad in de environment-variabele CUBETIMER_CONFIG
 *   2. <home>/cubetimer_config.php
 *   3. <map boven public_html>/cubetimer_config.php
 *   4. public_html/api/config.php   (noodgreep, staat in .gitignore)
 */

return [
    /* ---------------------------------------------------------------------
     * Database
     * DirectAdmin zet je accountnaam voor de database- en gebruikersnaam,
     * dus vul de VOLLEDIGE namen in (bijv. 'mijnacc_cubetimer').
     * Laat 'name' leeg om de account-features uit te zetten; de timer en de
     * bug-knop blijven dan gewoon werken.
     * ------------------------------------------------------------------ */
    'db' => [
        'host'     => 'localhost',
        'port'     => 3306,
        'name'     => '',
        'user'     => '',
        'password' => '',
        'charset'  => 'utf8mb4',
    ],

    /* ---------------------------------------------------------------------
     * GitHub - voor de bug-/feature-knop
     *
     * Maak een fine-grained personal access token aan op
     * https://github.com/settings/personal-access-tokens
     *   - Repository access : alleen frocky10/cubetimer.nl
     *   - Permissions       : Issues -> Read and write  (verder niets!)
     * Een token met alleen deze rechten kan geen code lezen of pushen.
     *
     * Laat 'token' leeg om de bug-knop uit te schakelen; de knop verdwijnt
     * dan automatisch uit de interface.
     * ------------------------------------------------------------------ */
    'github' => [
        'token'          => '',
        'owner'          => 'frocky10',
        'repo'           => 'cubetimer.nl',
        // Labels die op ELK aangemaakt issue komen te staan.
        'labels'         => ['Van de website'],
        // Extra label per soort melding.
        'label_bug'      => 'Bug',
        'label_feature'  => 'Feature',
    ],

    /* ---------------------------------------------------------------------
     * Beveiliging
     * ------------------------------------------------------------------ */
    'security' => [
        // Willekeurige lange string. Wordt gebruikt om IP-adressen te hashen
        // en tokens af te leiden. Genereer er een met bijvoorbeeld:
        //   php -r "echo bin2hex(random_bytes(32));"
        // LET OP: als je deze wijzigt, worden alle bestaande logins ongeldig.
        'app_key'             => 'VERVANG_MIJ_DOOR_EEN_LANGE_WILLEKEURIGE_STRING',
        // Hoe lang een login geldig blijft (in dagen).
        'session_lifetime_days' => 90,
        // Naam van de cookie waarin het sessietoken staat.
        'cookie_name'         => 'cubetimer_session',
        // Zet op false als je (tijdelijk) zonder HTTPS draait.
        'cookie_secure'       => true,
    ],

    /* ---------------------------------------------------------------------
     * Opslagmap voor rate limiting en logbestanden.
     * Moet schrijfbaar zijn voor PHP en BUITEN public_html staan.
     * Laat leeg om de systeem-tempmap te gebruiken.
     * ------------------------------------------------------------------ */
    'storage_path' => '',

    /* ---------------------------------------------------------------------
     * Zet op true tijdens het debuggen: foutmeldingen komen dan in het
     * JSON-antwoord te staan. ALTIJD op false op de live site.
     * ------------------------------------------------------------------ */
    'debug' => false,
];
