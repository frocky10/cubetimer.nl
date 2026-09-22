<?php
declare(strict_types=1);

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Events.php';
require_once __DIR__ . '/SiteTime.php';
require_once __DIR__ . '/Xp.php';
require_once __DIR__ . '/Records.php';

/**
 * De ranglijsten, gelezen uit `user_records`.
 *
 * Alles wat hier uitkomt is door de server zelf uitgerekend (zie Records) en
 * bevat geen solves die in de beoordeelwachtrij staan.
 *
 * Je positie wordt als hard nummer getoond zolang je in de top 999 staat;
 * daaronder als percentiel, want "#4173" zegt niemand iets en "top 12%" wel.
 */
final class Leaderboard
{
    public const PERIODS = ['all', 'week', 'day'];
    public const MAX_LIMIT = 100;

    /** Tot en met deze positie krijg je een echt plaatsnummer te zien. */
    public const NUMBERED_UNTIL = 999;

    public static function isValidCategory(string $category): bool
    {
        return in_array($category, Records::RANKED_CATEGORIES, true);
    }

    public static function isValidPeriod(string $period): bool
    {
        return in_array($period, self::PERIODS, true);
    }

    /** De datum waarop een periode begint, of null voor 'all'. */
    public static function periodStart(string $period): ?string
    {
        return match ($period) {
            'day'  => SiteTime::today(),
            'week' => SiteTime::dayOf(SiteTime::startOfWeek()),
            default => null,
        };
    }

    /**
     * De ranglijst zelf.
     *
     * @return array{entries:list<array<string,mixed>>, total:int, periodStart:?string}
     */
    public static function top(string $event, string $category, string $period, int $limit = 50, int $offset = 0, ?array $onlyUserIds = null): array
    {
        $limit = max(1, min($limit, self::MAX_LIMIT));
        $offset = max(0, min($offset, 10000));
        $periodStart = self::periodStart($period);

        // Beperking tot een groep (de mensen die je volgt), of geen beperking.
        [$beperking, $extraParams] = self::restriction($onlyUserIds);

        // Bewust in de query geplakt: MySQL accepteert geen parameter op LIMIT
        // als prepared statement. Het zijn hierboven al begrensde getallen.
        $rows = Database::all(
            'SELECT r.value_ms, r.achieved_at, u.public_id, u.username,
                    p.country_code, p.level, p.xp
             FROM user_records r
             JOIN users u ON u.id = r.user_id
             JOIN user_profiles p ON p.user_id = r.user_id
             WHERE r.event = ? AND r.category = ? AND r.period = ? AND r.period_start <=> ?
               AND u.is_active = 1 AND p.show_on_leaderboard = 1' . $beperking . '
             ORDER BY r.value_ms ASC, r.achieved_at ASC
             LIMIT ' . $limit . ' OFFSET ' . $offset,
            array_merge([$event, $category, $period, $periodStart], $extraParams)
        );

        $entries = [];
        foreach ($rows as $index => $row) {
            $level = (int) $row['level'];
            $entries[] = [
                'position' => $offset + $index + 1,
                'user'     => $row['username'],
                'userId'   => $row['public_id'],
                'country'  => $row['country_code'],
                'level'    => $level,
                'tier'     => Xp::tier($level)['slug'],
                'valueMs'  => (int) $row['value_ms'],
                'achievedAt' => str_replace(' ', 'T', (string) $row['achieved_at']) . 'Z',
            ];
        }

        return [
            'entries'     => $entries,
            'total'       => self::total($event, $category, $period, $onlyUserIds),
            'periodStart' => $periodStart,
        ];
    }

    public static function total(string $event, string $category, string $period, ?array $onlyUserIds = null): int
    {
        [$beperking, $extraParams] = self::restriction($onlyUserIds);

        $row = Database::first(
            'SELECT COUNT(*) AS aantal
             FROM user_records r
             JOIN users u ON u.id = r.user_id
             JOIN user_profiles p ON p.user_id = r.user_id
             WHERE r.event = ? AND r.category = ? AND r.period = ? AND r.period_start <=> ?
               AND u.is_active = 1 AND p.show_on_leaderboard = 1' . $beperking,
            array_merge([$event, $category, $period, self::periodStart($period)], $extraParams)
        );
        return (int) ($row['aantal'] ?? 0);
    }

    /**
     * Bouwt een extra WHERE-stuk om de ranglijst tot een groep te beperken.
     *
     * @param list<int>|null $userIds
     * @return array{0:string,1:list<int>}
     */
    private static function restriction(?array $userIds): array
    {
        if ($userIds === null) {
            return ['', []];
        }
        if ($userIds === []) {
            return [' AND 1 = 0', []]; // lege groep: geen resultaten
        }
        $ids = array_values(array_map('intval', $userIds));
        $plaatshouders = implode(',', array_fill(0, count($ids), '?'));
        return [' AND r.user_id IN (' . $plaatshouders . ')', $ids];
    }

    /**
     * Waar staat deze gebruiker op deze ranglijst?
     *
     * @return array{position:int,total:int,percentile:int,label:string,valueMs:int}|null
     */
    public static function positionFor(int $userId, string $event, string $category, string $period = 'all'): ?array
    {
        $periodStart = self::periodStart($period);

        $mine = Database::first(
            'SELECT value_ms FROM user_records
             WHERE user_id = ? AND event = ? AND category = ? AND period = ? AND period_start <=> ?',
            [$userId, $event, $category, $period, $periodStart]
        );
        if ($mine === null) {
            return null;
        }
        $value = (int) $mine['value_ms'];

        $sneller = Database::first(
            'SELECT COUNT(*) AS aantal
             FROM user_records r
             JOIN users u ON u.id = r.user_id
             JOIN user_profiles p ON p.user_id = r.user_id
             WHERE r.event = ? AND r.category = ? AND r.period = ? AND r.period_start <=> ?
               AND u.is_active = 1 AND p.show_on_leaderboard = 1
               AND r.value_ms < ?',
            [$event, $category, $period, $periodStart, $value]
        );

        $position = (int) ($sneller['aantal'] ?? 0) + 1;
        $total = max(1, self::total($event, $category, $period));
        $percentile = max(1, (int) ceil($position / $total * 100));

        return [
            'position'   => $position,
            'total'      => $total,
            'percentile' => $percentile,
            'label'      => self::label($position, $percentile),
            'valueMs'    => $value,
        ];
    }

    /**
     * Hoe de positie getoond wordt: een hard nummer in de top 999, daaronder
     * een percentiel.
     */
    public static function label(int $position, int $percentile): string
    {
        return $position <= self::NUMBERED_UNTIL
            ? '#' . $position
            : 'top ' . $percentile . '%';
    }

    /** Events waar iemand tijden op heeft staan; voor de keuzelijst boven de ranglijst. */
    public static function activeEvents(): array
    {
        $rows = Database::all(
            "SELECT event, COUNT(*) AS aantal
             FROM user_records WHERE period = 'all' AND category = 'single'
             GROUP BY event ORDER BY aantal DESC"
        );
        $out = [];
        foreach ($rows as $row) {
            $event = (string) $row['event'];
            if (!Events::isRanked($event)) {
                continue;
            }
            $out[] = ['id' => $event, 'label' => Events::label($event), 'entries' => (int) $row['aantal']];
        }
        return $out;
    }
}
