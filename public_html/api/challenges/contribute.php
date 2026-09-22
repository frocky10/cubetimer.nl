<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/challenges/contribute.php
 * Body: { scrambles: ["R U R' ...", ...] }
 *
 * Vult de scramblevoorraad aan. PHP kan zelf geen officiele WCA-scrambles
 * maken; cubing.js in de browser wel. Ingelogde bezoekers leveren er daarom
 * af en toe een paar aan. Ze worden pas na een dag gebruikt en willekeurig
 * gekozen, zodat niemand zijn eigen scramble kan sturen en meteen krijgen.
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

$user = Auth::requireUser();
$userId = (int) $user['id'];

$limiet = RateLimiter::hit('scramble-pool:' . Auth::fingerprint((string) $userId), 20, 3600);
if (!$limiet['allowed']) {
    // Stilletjes accepteren: dit gebeurt op de achtergrond, de bezoeker heeft
    // er niets mee te maken.
    Http::ok(['accepted' => 0, 'poolSize' => Challenges::poolSize()]);
}

$scrambles = Http::input('scrambles', []);
if (!is_array($scrambles)) {
    Http::fail('invalid_payload', 'Er zijn geen scrambles meegestuurd.', 422);
}

$aangenomen = 0;
foreach (array_slice($scrambles, 0, 10) as $scramble) {
    if (!is_string($scramble)) {
        continue;
    }
    if (Challenges::contributeScramble($userId, $scramble)['ok']) {
        $aangenomen++;
    }
}

Http::ok(['accepted' => $aangenomen, 'poolSize' => Challenges::poolSize()]);
