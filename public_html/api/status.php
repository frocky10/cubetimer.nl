<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

/**
 * GET /api/status.php
 *
 * Vertelt de frontend welke onderdelen op deze server beschikbaar zijn, zodat
 * de interface knoppen kan verbergen die toch niet zouden werken. Geeft bewust
 * geen versienummers of paden prijs.
 */
Http::requireMethod('GET');

$databaseReady = false;
if (Database::isConfigured()) {
    $databaseReady = Database::hasTable('users');
}

$leaderboardsReady = $databaseReady && Database::hasTable('user_records');
$challengesReady = $databaseReady && Database::hasTable('daily_challenges');
$achievementsReady = $databaseReady && Database::hasTable('user_achievements');
$tournamentsReady = $databaseReady && Database::hasTable('tournaments');
$followsReady = $databaseReady && Database::hasTable('user_follows');
$algorithmsReady = $databaseReady && Database::hasTable('user_algorithms');
$gamesReady = $databaseReady && Database::hasTable('game_runs');
$duelsReady = $gamesReady && $followsReady && Database::hasTable('duels');
$wcaReady = $tournamentsReady && Wca::isReady();

$user = Auth::user();

Http::ok([
    'features' => [
        'accounts'     => $databaseReady,
        'sync'         => $databaseReady,
        'feedback'     => GitHubIssues::isEnabled(),
        'leaderboards' => $leaderboardsReady,
        'challenges'   => $challengesReady,
        'achievements' => $achievementsReady,
        'tournaments'  => $tournamentsReady,
        'follows'      => $followsReady,
        'algorithms'   => $algorithmsReady,
        'games'        => $gamesReady,
        'duels'        => $duelsReady,
        'wcaTournaments' => $wcaReady,
    ],
    'timezone'      => SiteTime::zoneName(),
    'authenticated' => $user !== null,
    'admin'         => $user !== null && ($user['role'] ?? 'user') === 'admin',
]);
