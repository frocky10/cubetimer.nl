<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * GET /api/tournament/wca-competition.php?id=WC2023
 *
 * Welke events je op deze comp kunt spelen, met het aantal rondes en
 * deelnemers. De eerste keer haalt de server alle uitslagen op bij de WCA
 * (dat kan bij een WK een paar seconden duren); daarna komen ze uit de
 * database.
 */
Http::requireMethod('GET');

$user = Auth::requireUser();
if (!Wca::isReady()) {
    Http::fail('unavailable', 'Historische toernooien zijn op deze server niet beschikbaar.', 503);
}

$id = trim((string) ($_GET['id'] ?? ''));
if (!Wca::isValidId($id)) {
    Http::fail('invalid_competition', 'Dat is geen geldige WCA-competitie.', 422);
}

$limiet = RateLimiter::hit('wca-comp:' . Auth::fingerprint((string) $user['id']), 30, 600);
if (!$limiet['allowed']) {
    Http::fail('rate_limited', 'Rustig aan. Probeer het over een paar minuten weer.', 429);
}

$resultaat = Wca::competition($id);
if (!$resultaat['ok']) {
    Http::fail('competition_failed', $resultaat['message'], 502);
}

Http::ok(['competition' => Wca::summarize($resultaat['competition'])]);
