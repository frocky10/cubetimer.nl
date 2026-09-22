<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * GET /api/leaderboard/list.php?event=333&category=single&period=all&limit=50
 *
 * Openbaar: je hoeft niet ingelogd te zijn om de ranglijst te bekijken.
 * Ben je dat wel, dan krijg je je eigen positie erbij, ook als die buiten de
 * getoonde lijst valt.
 */
Http::requireMethod('GET');

$event = (string) ($_GET['event'] ?? '333');
$category = (string) ($_GET['category'] ?? 'single');
$period = (string) ($_GET['period'] ?? 'all');
$limit = (int) ($_GET['limit'] ?? 50);
$offset = (int) ($_GET['offset'] ?? 0);

if (!Events::isRanked($event)) {
    Http::fail('unknown_event', 'Dat event kennen we niet.', 422);
}
if (!Leaderboard::isValidCategory($category)) {
    Http::fail('unknown_category', 'Die categorie bestaat niet.', 422);
}
if (!Leaderboard::isValidPeriod($period)) {
    Http::fail('unknown_period', 'Die periode bestaat niet.', 422);
}

$user = Auth::user();

// Met scope=friends zie je alleen de mensen die je volgt, plus jezelf.
$scope = (string) ($_GET['scope'] ?? 'all');
$kring = null;
if ($scope === 'friends') {
    if ($user === null) {
        Http::fail('unauthenticated', 'Log in om de ranglijst van je vrienden te zien.', 401);
    }
    $kring = Follows::circleIds((int) $user['id']);
} else {
    $scope = 'all';
}

$board = Leaderboard::top($event, $category, $period, $limit, $offset, $kring);

$me = null;
if ($user !== null) {
    $me = Leaderboard::positionFor((int) $user['id'], $event, $category, $period);
}

Http::ok([
    'event'       => $event,
    'eventLabel'  => Events::label($event),
    'category'    => $category,
    'period'      => $period,
    'scope'       => $scope,
    'periodStart' => $board['periodStart'],
    'timezone'    => SiteTime::zoneName(),
    'entries'     => $board['entries'],
    'total'       => $board['total'],
    'me'          => $me,
    'events'      => Leaderboard::activeEvents(),
]);
