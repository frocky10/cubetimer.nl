<?php
declare(strict_types=1);

require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Events.php';
require_once __DIR__ . '/Averages.php';
require_once __DIR__ . '/SiteTime.php';
require_once __DIR__ . '/SolveFacts.php';

/**
 * Rekent de records van een gebruiker opnieuw uit en markeert solves die er te
 * mooi uitzien om waar te zijn.
 *
 * Dit gebeurt na elke synchronisatie. De browser levert dus geen gemiddelden
 * aan; die zouden met de console te vervalsen zijn. De server leest de solves
 * en rekent zelf.
 *
 * Periodes worden bepaald in de tijdzone van de site (config: site_timezone),
 * niet in die van de bezoeker. Anders zou "vandaag" voor iedereen op een ander
 * moment beginnen en is een dagranglijst niet eerlijk te vergelijken.
 */
final class Records
{
    /** Categorie => [venstergrootte, wegstrepen ja/nee]. */
    public const CATEGORIES = [
        'mo3'   => [3, false],
        'ao5'   => [5, true],
        'ao12'  => [12, true],
        'ao50'  => [50, true],
        'ao100' => [100, true],
    ];

    /** Categorieen die in een ranglijst mogen. */
    public const RANKED_CATEGORIES = ['single', 'ao5', 'ao12', 'ao50', 'ao100', 'mo3'];

    /**
     * Een solve die minder dan de helft van je eigen record duurt, is geen
     * verbetering maar een sprong die niet kan. Bewust afgezet tegen je beste
     * tijd en niet tegen je gemiddelde: iemand met wisselende tijden heeft nu
     * eenmaal uitschieters naar beneden, en die horen gewoon te tellen.
     */
    private const SUSPICIOUS_RATIO = 0.5;
    private const SUSPICIOUS_AFTER_SOLVES = 25;

    /** Meer dan dit aantal solves binnen een minuut kan niet met de hand. */
    private const BURST_LIMIT = 20;
    private const BURST_WINDOW_SECONDS = 60;

    /** Hoeveel persoonlijke records we per categorie hooguit met terugwerkende kracht belonen. */
    private const MAX_IMPROVEMENTS = 500;

    /**
     * Rekent alles opnieuw uit voor een gebruiker.
     *
     * @return array{records:int, flagged:int, improvements:list<array{event:string,category:string,value:int,at:string}>,
     *               activeDays:list<string>, solvesPerDay:array<string,int>}
     */
    public static function rebuild(int $userId): array
    {
        $solves = Database::all(
            'SELECT client_id, event, raw_ms, penalty, solved_at
             FROM solves WHERE user_id = ?
             ORDER BY solved_at, id',
            [$userId]
        );

        $flagged = self::detectFlags($userId, $solves);

        // Solves die in de wachtrij staan of afgekeurd zijn tellen niet mee.
        $blocked = self::blockedSolveIds($userId);

        $perEvent = [];
        $activeDays = [];
        $solvesPerDay = [];

        foreach ($solves as $row) {
            $event = (string) $row['event'];
            if (!Events::isRanked($event)) {
                continue;
            }

            $effective = self::effectiveMs($row);
            $timestamp = strtotime((string) $row['solved_at'] . ' UTC');
            $day = SiteTime::dayOf($timestamp);

            if ($effective !== null) {
                $activeDays[$day] = true;
                $solvesPerDay[$day] = ($solvesPerDay[$day] ?? 0) + 1;
            }

            if (isset($blocked[(string) $row['client_id']])) {
                continue;
            }

            $perEvent[$event][] = [
                'client_id' => (string) $row['client_id'],
                'value'     => $effective,
                'at'        => $timestamp,
                'day'       => $day,
            ];
        }

        $rows = [];
        $improvements = [];

        $todayStart = SiteTime::startOfToday();
        $weekStart = SiteTime::startOfWeek();
        $todayDate = SiteTime::dayOf($todayStart);
        $weekDate = SiteTime::dayOf($weekStart);

        foreach ($perEvent as $event => $entries) {
            // PHP maakt van een numerieke array-sleutel als '333' stilletjes
            // een integer, dus hier weer expliciet terug naar string.
            $event = (string) $event;

            $windows = [
                ['all', null, $entries],
                ['day', $todayDate, array_values(array_filter($entries, fn ($e) => $e['at'] >= $todayStart))],
                ['week', $weekDate, array_values(array_filter($entries, fn ($e) => $e['at'] >= $weekStart))],
            ];

            foreach ($windows as [$period, $periodStart, $subset]) {
                if (!$subset) {
                    continue;
                }
                foreach (self::computeFor($event, $subset) as $record) {
                    $rows[] = $record + ['period' => $period, 'period_start' => $periodStart];
                }
            }

            // XP voor persoonlijke records kijkt naar de hele geschiedenis,
            // niet naar een periode.
            foreach (self::computeImprovements($event, $entries) as $improvement) {
                $improvements[] = $improvement;
            }
        }

        self::store($userId, $rows);

        return [
            'records'      => count($rows),
            'flagged'      => $flagged,
            'improvements' => $improvements,
            'activeDays'   => array_keys($activeDays),
            'solvesPerDay' => $solvesPerDay,
            // Alles wat de achievements nodig hebben, uit dezelfde doorloop.
            'facts'        => SolveFacts::from($solves, $blocked),
        ];
    }

    /** De tijd inclusief straf, of null bij een DNF. */
    public static function effectiveMs(array $row): ?int
    {
        $penalty = (string) ($row['penalty'] ?? 'none');
        if ($penalty === 'dnf' || $row['raw_ms'] === null) {
            return null;
        }
        $value = (int) $row['raw_ms'];
        return $penalty === 'plus2' ? $value + 2000 : $value;
    }

    /**
     * Beste single, slechtste single en de beste gemiddelden.
     *
     * @param list<array{client_id:string,value:?int,at:int,day:string}> $entries
     * @return list<array{event:string,category:string,value_ms:int,solve_client_id:?string,achieved_at:string}>
     */
    private static function computeFor(string $event, array $entries): array
    {
        $out = [];
        $values = array_column($entries, 'value');

        $best = null;
        $worst = null;
        foreach ($entries as $entry) {
            if ($entry['value'] === null) {
                continue;
            }
            if ($best === null || $entry['value'] < $best['value']) {
                $best = $entry;
            }
            if ($worst === null || $entry['value'] > $worst['value']) {
                $worst = $entry;
            }
        }

        if ($best !== null) {
            $out[] = [
                'event' => $event, 'category' => 'single',
                'value_ms' => (int) $best['value'],
                'solve_client_id' => $best['client_id'],
                'achieved_at' => gmdate('Y-m-d H:i:s', $best['at']),
            ];
        }
        if ($worst !== null) {
            $out[] = [
                'event' => $event, 'category' => 'worst_single',
                'value_ms' => (int) $worst['value'],
                'solve_client_id' => $worst['client_id'],
                'achieved_at' => gmdate('Y-m-d H:i:s', $worst['at']),
            ];
        }

        foreach (self::CATEGORIES as $category => [$window, $trim]) {
            $result = Averages::best($values, $window, $trim);
            if ($result === null) {
                continue;
            }
            $out[] = [
                'event' => $event, 'category' => $category,
                'value_ms' => (int) round($result['value']),
                'solve_client_id' => null,
                'achieved_at' => gmdate('Y-m-d H:i:s', $entries[$result['end']]['at']),
            ];
        }

        return $out;
    }

    /**
     * Elk moment waarop een persoonlijk record verbeterde. Daar hangt de
     * XP-beloning aan, dus we willen de hele geschiedenis, niet alleen de
     * huidige stand.
     *
     * @return list<array{event:string,category:string,value:int,at:string}>
     */
    private static function computeImprovements(string $event, array $entries): array
    {
        $out = [];
        $values = array_column($entries, 'value');

        $best = null;
        $singles = [];
        foreach ($entries as $entry) {
            if ($entry['value'] === null) {
                continue;
            }
            if ($best === null || $entry['value'] < $best) {
                $best = $entry['value'];
                $singles[] = [
                    'event' => $event, 'category' => 'single',
                    'value' => (int) $entry['value'],
                    'at' => gmdate('Y-m-d H:i:s', $entry['at']),
                ];
            }
        }
        $out = array_slice($singles, -self::MAX_IMPROVEMENTS);

        foreach (self::CATEGORIES as $category => [$window, $trim]) {
            $steps = Averages::improvements($values, $window, $trim);
            foreach (array_slice($steps, -self::MAX_IMPROVEMENTS) as $step) {
                $out[] = [
                    'event' => $event, 'category' => $category,
                    'value' => (int) round($step['value']),
                    'at' => gmdate('Y-m-d H:i:s', $entries[$step['end']]['at']),
                ];
            }
        }

        return $out;
    }

    /** @return array<string,true> client_ids die niet mee mogen tellen */
    private static function blockedSolveIds(int $userId): array
    {
        $rows = Database::all(
            "SELECT solve_client_id FROM solve_flags
             WHERE user_id = ? AND status IN ('pending', 'rejected')",
            [$userId]
        );
        $out = [];
        foreach ($rows as $row) {
            $out[(string) $row['solve_client_id']] = true;
        }
        return $out;
    }

    /**
     * Zoekt solves die niet kunnen kloppen en zet ze in de wachtrij.
     * Een solve die al beoordeeld is, blijft zoals hij is.
     *
     * @param list<array<string,mixed>> $solves chronologisch
     * @return int aantal nieuw gemarkeerde solves
     */
    private static function detectFlags(int $userId, array $solves): int
    {
        $known = Database::all('SELECT solve_client_id FROM solve_flags WHERE user_id = ?', [$userId]);
        $seen = [];
        foreach ($known as $row) {
            $seen[(string) $row['solve_client_id']] = true;
        }

        $nieuw = [];

        // Per event: het beste tot nu toe en hoeveel solves eraan voorafgingen.
        $besteTotNu = [];
        $aantalTotNu = [];
        // Voor de burst-controle: de tijdstippen van alle solves.
        $recent = [];

        foreach ($solves as $row) {
            $clientId = (string) $row['client_id'];
            $event = (string) $row['event'];
            $effective = self::effectiveMs($row);
            $at = strtotime((string) $row['solved_at'] . ' UTC');

            $recent[] = $at;
            while ($recent && $recent[0] < $at - self::BURST_WINDOW_SECONDS) {
                array_shift($recent);
            }

            if ($effective === null) {
                continue;
            }

            $reason = null;
            $detail = null;

            if ($effective < Events::ABSOLUTE_FLOOR_MS) {
                $reason = 'impossible';
                $detail = sprintf('%d ms is korter dan menselijk mogelijk.', $effective);
            } elseif (Events::isRanked($event) && $effective < Events::floorMs($event)) {
                $reason = 'below_world_record';
                $detail = sprintf(
                    'Sneller dan het wereldrecord op %s (%.2f s tegen %.2f s).',
                    Events::label($event),
                    $effective / 1000,
                    Events::floorMs($event) / 1000
                );
            } elseif (count($recent) > self::BURST_LIMIT) {
                $reason = 'burst';
                $detail = sprintf(
                    '%d solves binnen een minuut; dat is meer dan met de hand kan.',
                    count($recent)
                );
            } elseif (
                ($aantalTotNu[$event] ?? 0) >= self::SUSPICIOUS_AFTER_SOLVES
                && isset($besteTotNu[$event])
                && $effective < $besteTotNu[$event] * self::SUSPICIOUS_RATIO
            ) {
                $reason = 'too_fast_for_user';
                $detail = sprintf(
                    '%.2f s, terwijl het eigen record tot dan toe %.2f s was. Dat is meer dan een halvering.',
                    $effective / 1000,
                    $besteTotNu[$event] / 1000
                );
            }

            if ($reason !== null && !isset($seen[$clientId])) {
                $nieuw[] = [$userId, $clientId, $event, $effective, $reason, $detail];
                $seen[$clientId] = true;
            }

            $aantalTotNu[$event] = ($aantalTotNu[$event] ?? 0) + 1;
            if (!isset($besteTotNu[$event]) || $effective < $besteTotNu[$event]) {
                // Een gemarkeerde solve mag het record niet verleggen; anders
                // opent een valse tijd de deur voor de volgende.
                if ($reason === null) {
                    $besteTotNu[$event] = $effective;
                }
            }
        }

        foreach ($nieuw as $entry) {
            try {
                Database::run(
                    'INSERT INTO solve_flags (user_id, solve_client_id, event, value_ms, reason, detail)
                     VALUES (?, ?, ?, ?, ?, ?)',
                    $entry
                );
            } catch (PDOException $e) {
                error_log('[cubetimer] markering opslaan mislukt: ' . $e->getMessage());
            }
        }

        return count($nieuw);
    }

    /**
     * Vervangt alle records van de gebruiker. Records zijn afgeleide data, dus
     * opnieuw opbouwen is eenvoudiger en betrouwbaarder dan bijwerken.
     *
     * @param list<array<string,mixed>> $rows
     */
    private static function store(int $userId, array $rows): void
    {
        Database::run('DELETE FROM user_records WHERE user_id = ?', [$userId]);
        if (!$rows) {
            return;
        }

        $statement = Database::connection()->prepare(
            'INSERT INTO user_records
                (user_id, event, category, period, period_start, value_ms, solve_client_id, achieved_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );

        foreach ($rows as $row) {
            $statement->execute([
                $userId,
                $row['event'],
                $row['category'],
                $row['period'],
                $row['period_start'],
                $row['value_ms'],
                $row['solve_client_id'],
                $row['achieved_at'],
            ]);
        }
    }
}
