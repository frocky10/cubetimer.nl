<?php
/**
 * Een nagebootste WCA-API voor het testen van de historische toernooien.
 *
 * De echte API (www.worldcubeassociation.org/api/v0) is niet vanuit elke
 * ontwikkelomgeving bereikbaar. Deze router geeft de voorbeeldbestanden uit
 * tools/wca-voorbeeld terug, in precies de vorm van de echte API.
 *
 *   php -S 127.0.0.1:8124 tools/nep-wca-server.php
 *
 * en zet in je lokale cubetimer_config.php:
 *
 *   'wca' => ['base_url' => 'http://127.0.0.1:8124/api/v0'],
 *
 * Bekend zijn: NepOpen2024 (3x3 met twee rondes en een cutoff, 6x6 Mo3 met
 * een cumulatieve limiet, 3BLD best of 3, en FMC dat genegeerd moet worden)
 * en NepLeeg2023 (een comp zonder uitslagen).
 */
$pad = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$map = __DIR__ . '/wca-voorbeeld/';

$bestand = match ($pad) {
    '/api/v0/competitions'                         => 'search.json',
    '/api/v0/competitions/NepOpen2024'             => 'competition.json',
    '/api/v0/competitions/NepOpen2024/results'     => 'results.json',
    '/api/v0/competitions/NepOpen2024/wcif/public' => 'wcif.json',
    '/api/v0/competitions/NepOpen2024/scrambles'   => 'scrambles.json',
    '/api/v0/competitions/NepLeeg2023/results'     => '[]',
    default                                        => null,
};

header('Content-Type: application/json');
if ($bestand === null) {
    http_response_code(404);
    echo '{"error":"Not found"}';
} elseif ($bestand === '[]') {
    echo '[]';
} else {
    readfile($map . $bestand);
}
