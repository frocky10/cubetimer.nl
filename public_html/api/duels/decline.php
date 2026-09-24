<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/duels/decline.php
 * Body: { duelId }
 *
 * Afwijzen als tegenstander, of intrekken als uitdager zolang de ander nog
 * niet begonnen is.
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

$user = Auth::requireUser();

$resultaat = Duels::decline((int) Http::input('duelId', 0), (int) $user['id']);
if (!$resultaat['ok']) {
    Http::fail('decline_failed', $resultaat['message'], 409);
}

Http::ok(['message' => $resultaat['message']]);
