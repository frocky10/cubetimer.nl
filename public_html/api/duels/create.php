<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/duels/create.php
 * Body: { opponent, event, scrambles: [...] }
 *
 * Daagt een vriend uit. De scrambles komen uit de browser van de uitdager
 * (cubing.js) en gelden voor allebei.
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

$user = Auth::requireUser();
$userId = (int) $user['id'];

$limiet = RateLimiter::hit('duel:' . Auth::fingerprint((string) $userId), 30, 3600);
if (!$limiet['allowed']) {
    Http::fail('rate_limited', 'Je hebt de afgelopen tijd wel heel veel duels aangemaakt.', 429);
}

$scrambles = Http::input('scrambles', []);
$resultaat = Duels::create(
    $userId,
    mb_substr(Http::stringInput('opponent'), 0, 32),
    Http::stringInput('event', '333'),
    is_array($scrambles) ? $scrambles : []
);

if (!$resultaat['ok']) {
    Http::fail('duel_failed', $resultaat['message'], 409);
}

Http::ok(['duel' => $resultaat['duel']]);
