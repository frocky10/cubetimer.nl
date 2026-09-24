<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * GET /api/games/overview.php
 *
 * De spelregels die de browser nodig heeft (hoeveel er per survival-solve af
 * gaat, hoe lang een speedrun duurt), en voor wie ingelogd is ook zijn
 * records, zijn laatste rondes en zijn duels. Werkt ook zonder login: spelen
 * kan iedereen, alleen bewaren vraagt een account.
 */
Http::requireMethod('GET');

$stappen = [];
foreach (Events::rankedList() as $event) {
    $stappen[$event['id']] = GameModes::survivalStep($event['id']);
}

$uit = [
    'rules' => [
        'survivalSteps'  => $stappen,
        'speedrunMs'     => GameModes::SPEEDRUN_MS,
        'speedrunCubes'  => ['min' => GameModes::SPEEDRUN_MIN_CUBES, 'max' => GameModes::SPEEDRUN_MAX_CUBES],
        'duelDays'       => Duels::EXPIRY_DAYS,
    ],
    'events'  => Events::rankedList(),
    'records' => [],
    'recent'  => [],
    'duels'   => null,
];

$gereed = Database::isConfigured() && Database::hasTable('game_runs');
$user = $gereed ? Auth::user() : null;

if ($user !== null) {
    $userId = (int) $user['id'];
    $uit['records'] = GameModes::records($userId);
    $uit['recent'] = GameModes::recent($userId, 10);
    if (Database::hasTable('user_follows')) {
        $uit['duels'] = Duels::overview($userId);
    }
}

Http::ok($uit);
