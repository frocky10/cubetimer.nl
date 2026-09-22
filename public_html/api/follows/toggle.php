<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/follows/toggle.php
 * Body: { username, follow: true|false }
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

$user = Auth::requireUser();
$viewerId = (int) $user['id'];

$username = Http::stringInput('username');
if ($username === '') {
    Http::fail('missing_username', 'Er is geen cuber meegestuurd.', 422);
}

$doel = Database::first(
    'SELECT id FROM users WHERE username_lower = ? AND is_active = 1',
    [mb_strtolower($username)]
);
if ($doel === null) {
    Http::fail('not_found', 'Deze cuber bestaat niet.', 404);
}

$wilVolgen = Http::input('follow', true) !== false;
$resultaat = $wilVolgen
    ? Follows::follow($viewerId, (int) $doel['id'])
    : Follows::unfollow($viewerId, (int) $doel['id']);

if (!$resultaat['ok']) {
    Http::fail('follow_failed', $resultaat['message'], 409);
}

Http::ok([
    'message'  => $resultaat['message'],
    'relation' => $resultaat['relation'],
    'counts'   => [
        'following' => Follows::countFollowing($viewerId),
        'friends'   => Follows::countFriends($viewerId),
    ],
]);
