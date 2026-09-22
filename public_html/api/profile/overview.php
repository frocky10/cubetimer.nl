<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * GET /api/profile/overview.php
 *
 * Alles wat het accountscherm laat zien: XP, level, rank-badge, streak,
 * records per event en de laatste XP-toekenningen.
 */
Http::requireMethod('GET');

$user = Auth::requireUser();
$userId = (int) $user['id'];

$profiel = Database::first(
    'SELECT main_event, country_code, xp, level, current_streak, longest_streak,
            last_active_date, show_on_leaderboard
     FROM user_profiles WHERE user_id = ?',
    [$userId]
);
$profiel ??= ['main_event' => '333', 'country_code' => null, 'xp' => 0, 'level' => 1,
              'current_streak' => 0, 'longest_streak' => 0, 'last_active_date' => null,
              'show_on_leaderboard' => 1];

$xp = (int) $profiel['xp'];
$level = (int) $profiel['level'];
$mainEvent = (string) $profiel['main_event'];

// Voortgang binnen het huidige level.
$huidigeDrempel = Xp::xpForLevel($level);
$volgendeDrempel = Xp::xpForLevel($level + 1);
$binnenLevel = max(0, $xp - $huidigeDrempel);
$nodigVoorVolgende = max(1, $volgendeDrempel - $huidigeDrempel);

// De rank-badge hangt aan je beste single op je hoofd-event.
$rank = Leaderboard::positionFor($userId, $mainEvent, 'single', 'all');

$records = Database::all(
    "SELECT event, category, value_ms, achieved_at
     FROM user_records
     WHERE user_id = ? AND period = 'all'
     ORDER BY event, category",
    [$userId]
);

$perEvent = [];
foreach ($records as $row) {
    $event = (string) $row['event'];
    $perEvent[$event]['event'] ??= $event;
    $perEvent[$event]['label'] ??= Events::label($event);
    $perEvent[$event]['records'][(string) $row['category']] = [
        'valueMs'    => (int) $row['value_ms'],
        'achievedAt' => str_replace(' ', 'T', (string) $row['achieved_at']) . 'Z',
    ];
}

$recenteXp = Database::all(
    'SELECT type, amount, detail, created_at FROM xp_events
     WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 15',
    [$userId]
);

$achievements = Database::first(
    'SELECT COUNT(*) AS aantal FROM user_achievements WHERE user_id = ?',
    [$userId]
);

$openMarkeringen = Database::first(
    "SELECT COUNT(*) AS aantal FROM solve_flags WHERE user_id = ? AND status = 'pending'",
    [$userId]
);

Http::ok([
    'xp' => [
        'total'          => $xp,
        'level'          => $level,
        'tier'           => Xp::tier($level),
        'inLevel'        => $binnenLevel,
        'neededForNext'  => $nodigVoorVolgende,
        'nextLevelAt'    => $volgendeDrempel,
    ],
    'streak' => [
        'current'    => (int) $profiel['current_streak'],
        'longest'    => (int) $profiel['longest_streak'],
        'lastActive' => $profiel['last_active_date'],
    ],
    'rank'      => $rank,
    'mainEvent' => ['id' => $mainEvent, 'label' => Events::label($mainEvent)],
    'country'   => $profiel['country_code'],
    'onLeaderboard' => (int) $profiel['show_on_leaderboard'] === 1,
    'events'    => array_values($perEvent),
    'recentXp'  => array_map(static fn ($row) => [
        'type'   => $row['type'],
        'amount' => (int) $row['amount'],
        'detail' => $row['detail'],
        'at'     => str_replace(' ', 'T', (string) $row['created_at']) . 'Z',
    ], $recenteXp),
    'pendingFlags' => (int) ($openMarkeringen['aantal'] ?? 0),
    'achievements' => [
        'unlocked' => (int) ($achievements['aantal'] ?? 0),
        'total'    => count(Achievements::families()) * count(Achievements::TIERS)
                      + count(Achievements::secrets()),
    ],
]);
