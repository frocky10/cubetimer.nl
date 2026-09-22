<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * GET /api/achievements/list.php
 *
 * De hele catalogus. Ingelogd krijg je je eigen stand erbij: wat je hebt,
 * hoever je bent naar het volgende niveau, en hoe zeldzaam elk niveau is.
 * Uitgelogd zie je alleen wat er te halen valt.
 *
 * De cijfers worden hier opnieuw uitgerekend in plaats van opgeslagen. Dat is
 * een paar queries, en zo klopt de voortgang ook als er buiten een
 * synchronisatie om iets veranderd is (bijvoorbeeld een beoordeelde tijd).
 */
Http::requireMethod('GET');

$user = Auth::user();

if ($user === null) {
    Http::ok(Achievements::listFor(null) + ['authenticated' => false]);
}

$userId = (int) $user['id'];

$herberekening = Records::rebuild($userId);
$metrics = Achievements::buildMetrics($userId, $herberekening['facts'], $herberekening);

// Een bezoek aan dit scherm mag ook meteen opleveren wat er te halen viel.
$nieuw = Achievements::evaluate($userId, $metrics);
if ($nieuw !== []) {
    Xp::recalculate($userId);
}

Http::ok(Achievements::listFor($userId, $metrics) + [
    'authenticated' => true,
    'justUnlocked'  => $nieuw,
]);
