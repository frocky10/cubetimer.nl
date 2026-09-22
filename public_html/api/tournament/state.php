<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * GET /api/tournament/state.php
 *
 * Het lopende toernooi (of null), de keuzemogelijkheden om er een te starten,
 * en je eerdere toernooien.
 */
Http::requireMethod('GET');

$user = Auth::requireUser();
$userId = (int) $user['id'];

$actief = Tournaments::activeId($userId);

Http::ok([
    'tournament'   => $actief === null ? null : Tournaments::state($actief, $userId),
    'difficulties' => Tournaments::difficulties(),
    'events'       => Events::rankedList(),
    'history'      => Tournaments::history($userId, 15),
    'summary'      => Tournaments::summary($userId),
]);
