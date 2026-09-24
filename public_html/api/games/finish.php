<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/games/finish.php
 * Body: { mode, event, variant, solves: [{ms, penalty}] }   streak, survival, ladder
 *       { mode, event, variant, laps: [ms, ...] }           speedrun
 *
 * Een afgelopen ronde van een spelmodus. De server rekent de score zelf uit
 * uit de solves; wat de browser als score zou willen, wordt niet gevraagd.
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

$user = Auth::requireUser();
$userId = (int) $user['id'];

$limiet = RateLimiter::hit('games:' . Auth::fingerprint((string) $userId), 120, 3600);
if (!$limiet['allowed']) {
    Http::fail('rate_limited', 'Je hebt wel heel veel rondes ingestuurd. Probeer het straks nog eens.', 429);
}

$mode = Http::stringInput('mode');
$event = Http::stringInput('event', '333');
$variant = Http::input('variant', 0);
$variant = is_numeric($variant) ? (int) round((float) $variant) : -1;

$uitslag = GameModes::evaluate($mode, $event, $variant, [
    'solves' => Http::input('solves'),
    'laps'   => Http::input('laps'),
]);
if (!$uitslag['ok']) {
    Http::fail('invalid_run', $uitslag['message'], 422);
}

Http::ok([
    'run'     => GameModes::store($userId, $mode, $event, $uitslag),
    'records' => GameModes::records($userId),
    'recent'  => GameModes::recent($userId, 10),
]);
