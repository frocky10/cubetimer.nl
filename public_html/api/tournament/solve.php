<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/tournament/solve.php
 * Body: { tournamentId, timeMs, penalty, scramble }
 *
 * Een solve in het lopende toernooi. Deze komt NIET bij je gewone tijden
 * terecht; toernooisolves staan los van je sessies.
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

$user = Auth::requireUser();

$tournamentId = (int) Http::input('tournamentId', 0);
if ($tournamentId <= 0) {
    Http::fail('invalid_tournament', 'Er is geen toernooi meegestuurd.', 422);
}

$timeMs = Http::input('timeMs', null);
$timeMs = is_numeric($timeMs) ? (int) round((float) $timeMs) : null;
if ($timeMs !== null && ($timeMs < 0 || $timeMs > 86400000)) {
    $timeMs = null;
}

$resultaat = Tournaments::submitSolve(
    $tournamentId,
    (int) $user['id'],
    $timeMs,
    Http::stringInput('penalty', 'none'),
    Http::stringInput('scramble')
);

if (!$resultaat['ok']) {
    Http::fail('solve_rejected', $resultaat['message'], 409);
}

Http::ok([
    'roundScored' => $resultaat['roundScored'],
    'tournament'  => $resultaat['tournament'],
]);
