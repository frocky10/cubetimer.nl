<?php
declare(strict_types=1);

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/SiteTime.php';
require_once __DIR__ . '/Events.php';

/**
 * XP en levels.
 *
 * Je verdient XP door te solven, door jezelf te verbeteren, door vol te houden
 * en door daily challenges af te ronden. Bewust niet door snel te zijn: een
 * beginner die elke dag oefent moet net zo goed kunnen opklimmen als iemand die
 * al sub-10 draait. Snelheid komt terug in de ranglijsten, niet in je level.
 *
 * Alles wordt vastgelegd in `xp_events`. De unieke sleutel op
 * (user_id, type, reference) is wat voorkomt dat dezelfde gebeurtenis bij de
 * volgende synchronisatie opnieuw XP oplevert.
 */
final class Xp
{
    public const PER_SOLVE = 2;

    /** Dagplafond op solve-XP, zodat eindeloos doorklikken niets extra's oplevert. */
    public const MAX_SOLVE_XP_PER_DAY = 300;

    /** @var array<string,int> XP per soort persoonlijk record */
    public const RECORD_XP = [
        'single' => 25,
        'mo3'    => 12,
        'ao5'    => 15,
        'ao12'   => 20,
        'ao50'   => 30,
        'ao100'  => 40,
    ];

    public const STREAK_XP_PER_DAY = 10;
    public const STREAK_MAX_DAYS = 10;

    /**
     * Levelcurve: om level L te halen heb je 50 * L * (L-1) XP nodig.
     * Level 2 = 100, level 10 = 4.500, level 25 = 30.000, level 50 = 122.500.
     */
    public static function xpForLevel(int $level): int
    {
        $level = max(1, $level);
        return 50 * $level * ($level - 1);
    }

    public static function levelForXp(int $xp): int
    {
        if ($xp <= 0) {
            return 1;
        }
        // Omgekeerde van de curve hierboven.
        return max(1, (int) floor((1 + sqrt(1 + 0.08 * $xp)) / 2));
    }

    /** @return array{name:string,slug:string,min:int} */
    public static function tier(int $level): array
    {
        $tiers = [
            ['name' => 'Diamant', 'slug' => 'diamant', 'min' => 50],
            ['name' => 'Platina', 'slug' => 'platina', 'min' => 35],
            ['name' => 'Goud',    'slug' => 'goud',    'min' => 20],
            ['name' => 'Zilver',  'slug' => 'zilver',  'min' => 10],
            ['name' => 'Brons',   'slug' => 'brons',   'min' => 1],
        ];
        foreach ($tiers as $tier) {
            if ($level >= $tier['min']) {
                return $tier;
            }
        }
        return $tiers[count($tiers) - 1];
    }

    /**
     * Kent XP toe op basis van een herberekening door Records::rebuild().
     * Schrijft alleen wat er nog niet staat of veranderd is.
     *
     * @param array{improvements:list<array{event:string,category:string,value:int,at:string}>,
     *              activeDays:list<string>, solvesPerDay:array<string,int>} $rebuild
     * @return array{xp:int, level:int, awarded:int}
     */
    public static function sync(int $userId, array $rebuild): array
    {
        $gewenst = [];

        // 1. Solven ----------------------------------------------------------
        foreach ($rebuild['solvesPerDay'] as $day => $count) {
            $amount = min($count * self::PER_SOLVE, self::MAX_SOLVE_XP_PER_DAY);
            $gewenst['solves|' . $day] = [
                'type' => 'solves',
                'reference' => $day,
                'amount' => $amount,
                'detail' => sprintf('%d solves op %s', $count, $day),
            ];
        }

        // 2. Persoonlijke records --------------------------------------------
        foreach ($rebuild['improvements'] as $improvement) {
            $reference = $improvement['event'] . ':' . $improvement['category'] . ':' . $improvement['value'];
            $gewenst['record|' . $reference] = [
                'type' => 'record',
                'reference' => $reference,
                'amount' => self::RECORD_XP[$improvement['category']] ?? 10,
                'detail' => sprintf(
                    'Nieuw record %s op %s: %s',
                    strtoupper($improvement['category']),
                    Events::label($improvement['event']),
                    self::formatMs($improvement['value'])
                ),
            ];
        }

        // 3. Volhouden -------------------------------------------------------
        $streaks = self::streaksPerDay($rebuild['activeDays']);
        foreach ($streaks as $day => $streak) {
            $amount = self::STREAK_XP_PER_DAY * min($streak, self::STREAK_MAX_DAYS);
            $gewenst['streak|' . $day] = [
                'type' => 'streak',
                'reference' => $day,
                'amount' => $amount,
                'detail' => sprintf('Dag %d op rij getimed', $streak),
            ];
        }

        $geschreven = self::persist($userId, $gewenst, ['solves', 'record', 'streak']);
        $totals = self::recalculate($userId, $streaks, $rebuild['activeDays']);

        return $totals + ['awarded' => $geschreven];
    }

    /**
     * Losse toekenning, gebruikt door de daily challenges.
     *
     * @return bool true als er echt XP bij kwam (false als het al toegekend was)
     */
    public static function award(int $userId, string $type, string $reference, int $amount, ?string $detail = null): bool
    {
        try {
            $statement = Database::run(
                'INSERT INTO xp_events (user_id, type, reference, amount, detail)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE amount = VALUES(amount), detail = VALUES(detail)',
                [$userId, $type, mb_substr($reference, 0, 96), $amount, $detail]
            );
            $nieuw = $statement->rowCount() === 1;
        } catch (PDOException $e) {
            error_log('[cubetimer] XP toekennen mislukt: ' . $e->getMessage());
            return false;
        }

        self::recalculate($userId);
        return $nieuw;
    }

    /**
     * Schrijft de gewenste toekenningen weg, maar alleen wat nieuw of gewijzigd
     * is. Zonder deze vergelijking zou elke synchronisatie honderden rijen
     * opnieuw schrijven.
     *
     * @param array<string,array{type:string,reference:string,amount:int,detail:string}> $gewenst
     * @param list<string> $types welke soorten deze ronde beheert
     */
    private static function persist(int $userId, array $gewenst, array $types): int
    {
        $placeholders = implode(',', array_fill(0, count($types), '?'));
        $bestaand = Database::all(
            "SELECT type, reference, amount FROM xp_events
             WHERE user_id = ? AND type IN ($placeholders)",
            array_merge([$userId], $types)
        );

        $huidig = [];
        foreach ($bestaand as $row) {
            $huidig[$row['type'] . '|' . $row['reference']] = (int) $row['amount'];
        }

        $statement = Database::connection()->prepare(
            'INSERT INTO xp_events (user_id, type, reference, amount, detail)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE amount = VALUES(amount), detail = VALUES(detail)'
        );

        $geschreven = 0;
        foreach ($gewenst as $sleutel => $entry) {
            if (($huidig[$sleutel] ?? null) === $entry['amount']) {
                continue;
            }
            $statement->execute([
                $userId,
                $entry['type'],
                mb_substr($entry['reference'], 0, 96),
                $entry['amount'],
                mb_substr($entry['detail'], 0, 191),
            ]);
            $geschreven++;
        }

        return $geschreven;
    }

    /**
     * Telt de XP op en werkt level en streak bij op het profiel.
     *
     * @param array<string,int>|null $streaks
     * @param list<string>|null      $activeDays
     * @return array{xp:int, level:int}
     */
    public static function recalculate(int $userId, ?array $streaks = null, ?array $activeDays = null): array
    {
        $row = Database::first('SELECT COALESCE(SUM(amount), 0) AS totaal FROM xp_events WHERE user_id = ?', [$userId]);
        $xp = max(0, (int) ($row['totaal'] ?? 0));
        $level = self::levelForXp($xp);

        if ($activeDays === null) {
            Database::run(
                'UPDATE user_profiles SET xp = ?, level = ? WHERE user_id = ?',
                [$xp, $level, $userId]
            );
            return ['xp' => $xp, 'level' => $level];
        }

        $streaks ??= self::streaksPerDay($activeDays);
        $dagen = array_keys($streaks);
        sort($dagen);
        $laatste = $dagen ? (string) end($dagen) : null;

        $huidig = 0;
        if ($laatste !== null) {
            $vandaag = SiteTime::today();
            $gisteren = date('Y-m-d', strtotime($vandaag . ' -1 day'));
            // Een reeks blijft leven tot je een hele dag overslaat.
            if ($laatste === $vandaag || $laatste === $gisteren) {
                $huidig = $streaks[$laatste];
            }
        }
        $langste = $streaks ? max($streaks) : 0;

        Database::run(
            'UPDATE user_profiles
             SET xp = ?, level = ?, current_streak = ?, longest_streak = GREATEST(longest_streak, ?), last_active_date = ?
             WHERE user_id = ?',
            [$xp, $level, $huidig, $langste, $laatste, $userId]
        );

        return ['xp' => $xp, 'level' => $level];
    }

    /**
     * Per actieve dag: de lengte van de aaneengesloten reeks die op die dag
     * eindigt.
     *
     * @param list<string> $activeDays
     * @return array<string,int>
     */
    public static function streaksPerDay(array $activeDays): array
    {
        $dagen = array_values(array_unique($activeDays));
        sort($dagen);

        $out = [];
        $vorige = null;
        $reeks = 0;

        foreach ($dagen as $dag) {
            if ($vorige !== null && $dag === date('Y-m-d', strtotime($vorige . ' +1 day'))) {
                $reeks++;
            } else {
                $reeks = 1;
            }
            $out[$dag] = $reeks;
            $vorige = $dag;
        }

        return $out;
    }

    private static function formatMs(int $ms): string
    {
        $minuten = intdiv($ms, 60000);
        $seconden = ($ms % 60000) / 1000;
        return $minuten > 0
            ? sprintf('%d:%06.3f', $minuten, $seconden)
            : sprintf('%.3f s', $seconden);
    }
}
