<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/** POST /api/tournament/abandon.php  Body: { tournamentId } */
Http::requireMethod('POST');
Http::requireAjaxHeader();

$user = Auth::requireUser();

$resultaat = Tournaments::abandon((int) Http::input('tournamentId', 0), (int) $user['id']);
if (!$resultaat['ok']) {
    Http::fail('abandon_failed', $resultaat['message'], 409);
}

Http::ok(['message' => $resultaat['message']]);
