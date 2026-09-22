<?php
declare(strict_types=1);

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Events.php';
require_once __DIR__ . '/Xp.php';
require_once __DIR__ . '/Leaderboard.php';
require_once __DIR__ . '/Achievements.php';
require_once __DIR__ . '/Follows.php';
require_once __DIR__ . '/Tournaments.php';

/**
 * Het openbare profiel van een cuber.
 *
 * Dezelfde gegevens worden gebruikt door /api/profile/public.php (voor de
 * ranglijst) en door /profiel.php (de deelbare pagina). Daarom staat het hier
 * en niet in een endpoint.
 *
 * Privacy: een profiel is alleen zichtbaar als de gebruiker meedoet aan de
 * ranglijsten. Zet hij die schakelaar uit, dan is zijn profiel ook weg. Er
 * staat nooit een e-mailadres op.
 */
final class PublicProfile
{
    /** Hoeveel achievements we op het profiel uitlichten. */
    private const HIGHLIGHT_COUNT = 12;

    /** Volgorde waarin achievements uitgelicht worden: het zeldzaamst eerst. */
    private const TIER_WEIGHT = [
        'platina' => 0, 'geheim' => 1, 'goud' => 2, 'zilver' => 3, 'brons' => 4,
    ];

    /**
     * @return array<string,mixed>|null null als de cuber niet bestaat of zijn
     *         profiel niet deelt
     */
    public static function find(string $username, ?int $viewerId = null): ?array
    {
        $username = trim($username);
        if ($username === '' || mb_strlen($username) > 32) {
            return null;
        }

        $row = Database::first(
            'SELECT u.id, u.public_id, u.username, u.created_at,
                    p.display_name, p.country_code, p.main_event,
                    p.xp, p.level, p.current_streak, p.longest_streak, p.show_on_leaderboard
             FROM users u
             JOIN user_profiles p ON p.user_id = u.id
             WHERE u.username_lower = ? AND u.is_active = 1
             LIMIT 1',
            [mb_strtolower($username)]
        );

        if ($row === null || (int) $row['show_on_leaderboard'] !== 1) {
            return null;
        }

        $userId = (int) $row['id'];
        $level = (int) $row['level'];
        $xp = (int) $row['xp'];
        $mainEvent = (string) $row['main_event'];

        $huidigeDrempel = Xp::xpForLevel($level);
        $volgendeDrempel = Xp::xpForLevel($level + 1);

        return [
            'username'    => $row['username'],
            'displayName' => $row['display_name'] ?: $row['username'],
            'country'     => $row['country_code'],
            'memberSince' => substr((string) $row['created_at'], 0, 10),
            'mainEvent'   => ['id' => $mainEvent, 'label' => Events::label($mainEvent)],
            'xp' => [
                'total'         => $xp,
                'level'         => $level,
                'tier'          => Xp::tier($level),
                'inLevel'       => max(0, $xp - $huidigeDrempel),
                'neededForNext' => max(1, $volgendeDrempel - $huidigeDrempel),
            ],
            'streak' => [
                'current' => (int) $row['current_streak'],
                'longest' => (int) $row['longest_streak'],
            ],
            'rank'         => Leaderboard::positionFor($userId, $mainEvent, 'single', 'all'),
            'events'       => self::records($userId),
            'achievements' => self::achievements($userId),
            'solves'       => self::solveCount($userId),
            'follows'      => [
                'followers' => Follows::countFollowers($userId),
                'following' => Follows::countFollowing($userId),
                'friends'   => Follows::countFriends($userId),
            ],
            'relation'   => Follows::relation($viewerId, $userId),
            'isSelf'     => $viewerId !== null && $viewerId === $userId,
            'tournaments' => Database::hasTable('tournaments')
                ? Tournaments::summary($userId)
                : ['played' => 0, 'won' => 0, 'podiums' => 0, 'bestPosition' => null, 'events' => []],
        ];
    }

    /** @return list<array<string,mixed>> records per event, het hoofd-event eerst */
    private static function records(int $userId): array
    {
        $rows = Database::all(
            "SELECT event, category, value_ms, achieved_at
             FROM user_records
             WHERE user_id = ? AND period = 'all' AND category <> 'worst_single'
             ORDER BY event, category",
            [$userId]
        );

        $perEvent = [];
        foreach ($rows as $row) {
            $event = (string) $row['event'];
            $perEvent[$event]['event'] ??= $event;
            $perEvent[$event]['label'] ??= Events::label($event);
            $perEvent[$event]['records'][(string) $row['category']] = (int) $row['value_ms'];
        }

        return array_values($perEvent);
    }

    /** @return array{unlocked:int,total:int,highlights:list<array<string,mixed>>} */
    private static function achievements(int $userId): array
    {
        $behaald = Achievements::unlockedKeys($userId);

        $uitgelicht = [];
        foreach ($behaald as $sleutel => $moment) {
            $beschrijving = Achievements::describe($sleutel);
            if ($beschrijving === null) {
                continue;
            }
            $uitgelicht[] = $beschrijving + ['unlockedAt' => $moment];
        }

        usort($uitgelicht, static function (array $a, array $b): int {
            $verschil = (self::TIER_WEIGHT[$a['tier']] ?? 9) <=> (self::TIER_WEIGHT[$b['tier']] ?? 9);
            return $verschil !== 0 ? $verschil : strcmp($b['unlockedAt'], $a['unlockedAt']);
        });

        return [
            'unlocked'   => count($behaald),
            'total'      => count(Achievements::families()) * count(Achievements::TIERS)
                            + count(Achievements::secrets()),
            'highlights' => array_slice($uitgelicht, 0, self::HIGHLIGHT_COUNT),
        ];
    }

    private static function solveCount(int $userId): int
    {
        $row = Database::first('SELECT COUNT(*) AS aantal FROM solves WHERE user_id = ?', [$userId]);
        return (int) ($row['aantal'] ?? 0);
    }
}
