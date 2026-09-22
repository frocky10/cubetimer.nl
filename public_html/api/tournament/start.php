<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/tournament/start.php
 * Body: { event, difficulty }
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

$user = Auth::requireUser();
$userId = (int) $user['id'];

$limiet = RateLimiter::hit('tournament:' . Auth::fingerprint((string) $userId), 20, 3600);
if (!$limiet['allowed']) {
    Http::fail('rate_limited', 'Je hebt de afgelopen tijd wel heel veel toernooien gestart.', 429);
}

$resultaat = Tournaments::start(
    $userId,
    Http::stringInput('event', '333'),
    Http::stringInput('difficulty', 'club')
);

if (!$resultaat['ok']) {
    Http::fail('start_failed', $resultaat['message'], 409);
}

Http::ok(['tournament' => $resultaat['tournament']]);
