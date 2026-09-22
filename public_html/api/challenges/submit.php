<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/challenges/submit.php
 * Body: { challengeId, timeMs, penalty, solveClientId }
 *
 * De poging voor de scramble van de dag. Er is er een per dag.
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

$user = Auth::requireUser();

$challengeId = (int) Http::input('challengeId', 0);
if ($challengeId <= 0) {
    Http::fail('invalid_challenge', 'Er is geen challenge meegestuurd.', 422);
}

$timeMs = Http::input('timeMs', null);
$timeMs = is_numeric($timeMs) ? (int) round((float) $timeMs) : null;
if ($timeMs !== null && $timeMs < 0) {
    $timeMs = null;
}

$penalty = Http::stringInput('penalty', 'none');
$solveClientId = mb_substr(Http::stringInput('solveClientId'), 0, 64);

$limiet = RateLimiter::hit('challenge:' . Auth::fingerprint((string) $user['id']), 10, 3600);
if (!$limiet['allowed']) {
    Http::fail('rate_limited', 'Je stuurt wel heel veel pogingen in. Probeer het straks nog eens.', 429);
}

$resultaat = Challenges::submitAttempt(
    (int) $user['id'],
    $challengeId,
    $timeMs,
    $penalty,
    $solveClientId === '' ? null : $solveClientId
);

if (!$resultaat['ok']) {
    Http::fail('attempt_rejected', $resultaat['message'], 409);
}

Http::ok([
    'message'     => $resultaat['message'],
    'entry'       => $resultaat['entry'] ?? null,
    'leaderboard' => Challenges::dayLeaderboard($challengeId, 25),
]);
