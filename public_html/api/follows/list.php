<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * GET /api/follows/list.php?type=following|followers|friends
 *
 * Standaard van jezelf; met ?u=naam die van iemand anders, zolang die zijn
 * profiel deelt.
 */
Http::requireMethod('GET');

$soort = (string) ($_GET['type'] ?? 'following');
if (!in_array($soort, ['following', 'followers', 'friends'], true)) {
    $soort = 'following';
}

$gevraagd = (string) ($_GET['u'] ?? '');

if ($gevraagd === '') {
    $user = Auth::requireUser();
    $userId = (int) $user['id'];
} else {
    $row = Database::first(
        'SELECT u.id FROM users u
         JOIN user_profiles p ON p.user_id = u.id
         WHERE u.username_lower = ? AND u.is_active = 1 AND p.show_on_leaderboard = 1',
        [mb_strtolower($gevraagd)]
    );
    if ($row === null) {
        Http::fail('not_found', 'Deze cuber bestaat niet, of deelt dit profiel niet.', 404);
    }
    $userId = (int) $row['id'];
}

Http::ok([
    'type'    => $soort,
    'entries' => Follows::listFor($userId, $soort),
    'counts'  => [
        'following' => Follows::countFollowing($userId),
        'followers' => Follows::countFollowers($userId),
        'friends'   => Follows::countFriends($userId),
    ],
]);
