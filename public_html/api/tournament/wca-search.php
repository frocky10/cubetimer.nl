<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * GET /api/tournament/wca-search.php?q=dutch
 *
 * Afgelopen WCA-competities die op de zoekterm lijken. Zonder zoekterm: een
 * paar bekende kampioenschappen om mee te beginnen. De server zoekt bij de
 * WCA en bewaart het antwoord een dag.
 */
Http::requireMethod('GET');

$user = Auth::requireUser();
if (!Wca::isReady()) {
    Http::fail('unavailable', 'Historische toernooien zijn op deze server niet beschikbaar.', 503);
}

$zoekterm = trim((string) ($_GET['q'] ?? ''));
if ($zoekterm === '') {
    Http::ok(['featured' => true, 'competitions' => array_map(static fn (array $c): array => $c + [
        'city' => '', 'startDate' => (string) $c['year'], 'endDate' => '', 'events' => [],
    ], Wca::FEATURED)]);
}

$limiet = RateLimiter::hit('wca-search:' . Auth::fingerprint((string) $user['id']), 40, 600);
if (!$limiet['allowed']) {
    Http::fail('rate_limited', 'Rustig aan met zoeken. Probeer het over een paar minuten weer.', 429);
}

$resultaat = Wca::search($zoekterm);
if (!$resultaat['ok']) {
    Http::fail('search_failed', $resultaat['message'], 502);
}

Http::ok(['featured' => false, 'competitions' => $resultaat['competitions']]);
