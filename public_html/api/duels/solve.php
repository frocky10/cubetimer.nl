<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/duels/solve.php
 * Body: { duelId, timeMs, penalty }
 *
 * Een poging in een duel. Per poging opgeslagen, zodat opnieuw proberen na
 * een slechte solve niet kan.
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

$user = Auth::requireUser();

$duelId = (int) Http::input('duelId', 0);
if ($duelId <= 0) {
    Http::fail('invalid_duel', 'Er is geen duel meegestuurd.', 422);
}

$timeMs = Http::input('timeMs', null);
$timeMs = is_numeric($timeMs) ? (int) round((float) $timeMs) : null;

$resultaat = Duels::submit($duelId, (int) $user['id'], $timeMs, Http::stringInput('penalty', 'none'));
if (!$resultaat['ok']) {
    Http::fail('solve_rejected', $resultaat['message'], 409);
}

Http::ok(['duel' => $resultaat['duel']]);
