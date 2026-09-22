<?php
declare(strict_types=1);

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Events.php';
require_once __DIR__ . '/SiteTime.php';
require_once __DIR__ . '/Records.php';
require_once __DIR__ . '/Xp.php';

/**
 * De daily challenges.
 *
 * Elke dag staan er drie opdrachten klaar:
 *
 *   scramble_of_the_day  Iedereen krijgt dezelfde scramble en heeft een
 *                        poging. Met een eigen dagranglijst.
 *   solve_count          Doe vandaag X solves.
 *   beat_average         Doe een solve die X% sneller is dan je gewoonlijk
 *                        bent op je hoofd-event.
 *
 * De opdrachten worden gemaakt zodra de eerste bezoeker die dag om de
 * challenges vraagt. Welke aantallen en percentages het worden, hangt af van
 * de datum: hetzelfde voor iedereen, elke dag anders.
 *
 * Over de scramble van de dag: officiele WCA-scrambles worden gemaakt door
 * cubing.js, dat alleen in de browser draait. Ingelogde bezoekers leveren
 * daarom scrambles aan die in `scramble_pool` belanden. De server kiest er per
 * dag willekeurig een uit, en alleen uit scrambles die er minstens een dag in
 * staan. Zo kan niemand een makkelijke scramble inleveren en die meteen zelf
 * krijgen.
 */
final class Challenges
{
    public const SCRAMBLE_EVENT = '333';

    /** Hoe lang een aangeleverde scramble in de voorraad moet rijpen. */
    private const POOL_MATURITY_HOURS = 24;

    private const XP_SCRAMBLE = 80;
    private const XP_SOLVE_COUNT = 40;
    private const XP_BEAT_AVERAGE = 60;

    /** Keuzes die per dag rouleren. */
    private const SOLVE_COUNT_TARGETS = [15, 20, 25, 30, 40];
    private const BEAT_AVERAGE_PERCENTS = [3, 5, 7, 10];

    /** Hoeveel eerdere solves het gemiddelde bepalen waar je overheen moet. */
    private const REFERENCE_SOLVES = 50;
    private const REFERENCE_MINIMUM = 12;

    /**
     * De opdrachten van vandaag, met de stand van deze gebruiker erbij.
     *
     * @return array{date:string, timezone:string, challenges:list<array<string,mixed>>, poolSize:int}
     */
    public static function today(?int $userId): array
    {
        $date = SiteTime::today();
        self::ensureForDate($date);

        $rows = Database::all(
            'SELECT * FROM daily_challenges WHERE challenge_date = ? ORDER BY sort_order, id',
            [$date]
        );

        $entries = [];
        if ($userId !== null && $rows) {
            $ids = array_column($rows, 'id');
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $found = Database::all(
                "SELECT * FROM challenge_entries WHERE user_id = ? AND challenge_id IN ($placeholders)",
                array_merge([$userId], $ids)
            );
            foreach ($found as $entry) {
                $entries[(int) $entry['challenge_id']] = $entry;
            }
        }

        $challenges = [];
        foreach ($rows as $row) {
            $id = (int) $row['id'];
            $payload = json_decode((string) ($row['payload'] ?? '{}'), true);
            $payload = is_array($payload) ? $payload : [];
            $entry = $entries[$id] ?? null;

            $challenge = [
                'id'          => $id,
                'type'        => $row['type'],
                'event'       => $row['event'],
                'eventLabel'  => Events::label((string) $row['event']),
                'title'       => $row['title'],
                'description' => $row['description'],
                'xpReward'    => (int) $row['xp_reward'],
                'progress'    => $entry !== null ? (int) $entry['progress'] : 0,
                'target'      => $entry !== null ? (int) $entry['target'] : self::targetFor($row, $payload),
                'completed'   => $entry !== null && $entry['completed_at'] !== null,
                'valueMs'     => $entry !== null && $entry['value_ms'] !== null ? (int) $entry['value_ms'] : null,
            ];

            if ($row['type'] === 'scramble_of_the_day') {
                $challenge['scramble'] = (string) ($payload['scramble'] ?? '');
                $challenge['attempted'] = $entry !== null;
                $challenge['participants'] = self::participantCount($id);
            }

            $challenges[] = $challenge;
        }

        return [
            'date'       => $date,
            'timezone'   => SiteTime::zoneName(),
            'challenges' => $challenges,
            'poolSize'   => self::poolSize(),
        ];
    }

    /** Maakt de opdrachten voor een dag aan als ze er nog niet zijn. */
    public static function ensureForDate(string $date): void
    {
        $bestaand = Database::all(
            'SELECT type FROM daily_challenges WHERE challenge_date = ?',
            [$date]
        );
        $aanwezig = array_column($bestaand, 'type');

        // De keuzes hangen af van de datum: iedereen dezelfde opdracht, elke
        // dag een andere, en vooraf niet interessant om te weten.
        $zaad = crc32($date);

        if (!in_array('solve_count', $aanwezig, true)) {
            $target = self::SOLVE_COUNT_TARGETS[$zaad % count(self::SOLVE_COUNT_TARGETS)];
            self::insert($date, 'solve_count', '', 'Blijf oefenen',
                sprintf('Doe vandaag %d solves. Elk event telt mee.', $target),
                ['target' => $target], self::XP_SOLVE_COUNT, 2);
        }

        if (!in_array('beat_average', $aanwezig, true)) {
            $percent = self::BEAT_AVERAGE_PERCENTS[intdiv($zaad, 7) % count(self::BEAT_AVERAGE_PERCENTS)];
            self::insert($date, 'beat_average', '', 'Sneller dan jezelf',
                sprintf('Doe een solve die minstens %d%% sneller is dan je gebruikelijke tijd.', $percent),
                ['percent' => $percent], self::XP_BEAT_AVERAGE, 3);
        }

        if (!in_array('scramble_of_the_day', $aanwezig, true)) {
            $scramble = self::pickScramble($date);
            if ($scramble !== null) {
                self::insert($date, 'scramble_of_the_day', self::SCRAMBLE_EVENT, 'Scramble van de dag',
                    'Iedereen krijgt dezelfde scramble en heeft een poging. Hoe snel ben jij?',
                    ['scramble' => $scramble['scramble'], 'pool_id' => $scramble['id']],
                    self::XP_SCRAMBLE, 1);
            }
        }
    }

    /** @param array<string,mixed> $payload */
    private static function insert(string $date, string $type, string $event, string $title, string $description, array $payload, int $xp, int $order): void
    {
        try {
            Database::run(
                'INSERT INTO daily_challenges
                    (challenge_date, type, event, title, description, payload, xp_reward, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [$date, $type, $event, $title, $description, json_encode($payload), $xp, $order]
            );
        } catch (PDOException $e) {
            // Twee bezoekers tegelijk op de eerste aanvraag van de dag: de
            // unieke sleutel vangt dat op, de tweede insert mag mislukken.
            if (!str_contains($e->getMessage(), 'Duplicate entry')) {
                error_log('[cubetimer] challenge aanmaken mislukt: ' . $e->getMessage());
            }
        }
    }

    /** @return array{id:int,scramble:string}|null */
    private static function pickScramble(string $date): ?array
    {
        $row = Database::first(
            'SELECT id, scramble FROM scramble_pool
             WHERE event = ? AND used_on IS NULL
               AND created_at < (UTC_TIMESTAMP() - INTERVAL ? HOUR)
             ORDER BY RAND() LIMIT 1',
            [self::SCRAMBLE_EVENT, self::POOL_MATURITY_HOURS]
        );

        if ($row === null) {
            return null;
        }

        Database::run('UPDATE scramble_pool SET used_on = ? WHERE id = ?', [$date, $row['id']]);
        return ['id' => (int) $row['id'], 'scramble' => (string) $row['scramble']];
    }

    /**
     * Neemt een scramble op in de voorraad.
     *
     * @return array{ok:bool, message:string}
     */
    public static function contributeScramble(?int $userId, string $scramble): array
    {
        $scramble = trim(preg_replace('/\s+/', ' ', $scramble) ?? '');

        if (!self::looksLikeScramble($scramble)) {
            return ['ok' => false, 'message' => 'Dat ziet er niet uit als een geldige 3x3-scramble.'];
        }

        try {
            Database::run(
                'INSERT INTO scramble_pool (event, scramble, scramble_hash, submitted_by)
                 VALUES (?, ?, ?, ?)',
                [self::SCRAMBLE_EVENT, $scramble, hash('sha256', $scramble), $userId]
            );
        } catch (PDOException $e) {
            if (str_contains($e->getMessage(), 'Duplicate entry')) {
                return ['ok' => true, 'message' => 'Die scramble zat al in de voorraad.'];
            }
            error_log('[cubetimer] scramble opslaan mislukt: ' . $e->getMessage());
            return ['ok' => false, 'message' => 'Opslaan is niet gelukt.'];
        }

        return ['ok' => true, 'message' => 'Bedankt, je scramble zit in de voorraad.'];
    }

    /**
     * Een geldige 3x3-scramble: 16 tot 25 zetten uit de standaardnotatie.
     * Dit vangt onzin en handmatig geknutselde reeksen af, geen kwaadwillende
     * die een geldige maar makkelijke scramble instuurt; daarvoor is de
     * wachttijd van een dag en de willekeurige keuze uit de voorraad.
     */
    public static function looksLikeScramble(string $scramble): bool
    {
        if ($scramble === '' || mb_strlen($scramble) > 200) {
            return false;
        }
        $zetten = explode(' ', $scramble);
        $aantal = count($zetten);
        if ($aantal < 16 || $aantal > 25) {
            return false;
        }
        foreach ($zetten as $zet) {
            if (preg_match("/^[UDLRFB][2']?$/", $zet) !== 1) {
                return false;
            }
        }
        // Twee keer hetzelfde vlak achter elkaar hoort niet in een echte scramble.
        for ($i = 1; $i < $aantal; $i++) {
            if ($zetten[$i][0] === $zetten[$i - 1][0]) {
                return false;
            }
        }
        return true;
    }

    public static function poolSize(): int
    {
        $row = Database::first(
            'SELECT COUNT(*) AS aantal FROM scramble_pool WHERE event = ? AND used_on IS NULL',
            [self::SCRAMBLE_EVENT]
        );
        return (int) ($row['aantal'] ?? 0);
    }

    private static function participantCount(int $challengeId): int
    {
        $row = Database::first(
            'SELECT COUNT(*) AS aantal FROM challenge_entries WHERE challenge_id = ? AND completed_at IS NOT NULL',
            [$challengeId]
        );
        return (int) ($row['aantal'] ?? 0);
    }

    /** @param array<string,mixed> $payload */
    private static function targetFor(array $row, array $payload): int
    {
        return match ($row['type']) {
            'solve_count' => (int) ($payload['target'] ?? 25),
            default => 1,
        };
    }

    /* =====================================================================
     * Voortgang bijwerken
     * ================================================================== */

    /**
     * Kijkt na een synchronisatie hoever deze gebruiker is met de opdrachten
     * van vandaag. De scramble van de dag zit hier niet bij; die wordt apart
     * ingestuurd omdat er maar een poging voor is.
     */
    public static function evaluate(int $userId): void
    {
        $date = SiteTime::today();
        $rows = Database::all(
            "SELECT * FROM daily_challenges
             WHERE challenge_date = ? AND type IN ('solve_count', 'beat_average')",
            [$date]
        );
        if (!$rows) {
            return;
        }

        $dagStart = SiteTime::utcStartOfDay($date);

        foreach ($rows as $row) {
            $payload = json_decode((string) ($row['payload'] ?? '{}'), true);
            $payload = is_array($payload) ? $payload : [];

            if ($row['type'] === 'solve_count') {
                $target = max(1, (int) ($payload['target'] ?? 25));
                $progress = self::solvesToday($userId, null, $dagStart);
            } else {
                $target = 1;
                $progress = self::beatAverageProgress($userId, (int) ($payload['percent'] ?? 5), $dagStart) ? 1 : 0;
            }

            self::recordProgress($userId, (int) $row['id'], $progress, $target, (int) $row['xp_reward'], (string) $row['title']);
        }
    }

    /** Aantal geldige solves vandaag, eventueel voor een bepaald event. */
    private static function solvesToday(int $userId, ?string $event, string $dagStart): int
    {
        $sql = "SELECT COUNT(*) AS aantal FROM solves s
                WHERE s.user_id = ? AND s.solved_at >= ?
                  AND s.penalty <> 'dnf' AND s.raw_ms IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM solve_flags f
                      WHERE f.user_id = s.user_id AND f.solve_client_id = s.client_id
                        AND f.status IN ('pending', 'rejected')
                  )";
        $params = [$userId, $dagStart];

        if ($event !== null) {
            $sql .= ' AND s.event = ?';
            $params[] = $event;
        }

        $row = Database::first($sql, $params);
        return (int) ($row['aantal'] ?? 0);
    }

    /**
     * Heeft de gebruiker vandaag een solve gedaan die het gevraagde percentage
     * sneller is dan zijn gebruikelijke tijd?
     *
     * "Gebruikelijk" is het gemiddelde van de laatste 50 solves op het
     * hoofd-event van voor vandaag. Niet zijn record, want dan zou de opdracht
     * alleen te halen zijn door meteen een nieuw record te draaien.
     */
    private static function beatAverageProgress(int $userId, int $percent, string $dagStart): bool
    {
        $profiel = Database::first('SELECT main_event FROM user_profiles WHERE user_id = ?', [$userId]);
        $event = (string) ($profiel['main_event'] ?? '333');

        $eerder = Database::all(
            "SELECT CASE WHEN penalty = 'plus2' THEN raw_ms + 2000 ELSE raw_ms END AS effectief
             FROM solves
             WHERE user_id = ? AND event = ? AND solved_at < ?
               AND penalty <> 'dnf' AND raw_ms IS NOT NULL
             ORDER BY solved_at DESC, id DESC
             LIMIT " . self::REFERENCE_SOLVES,
            [$userId, $event, $dagStart]
        );

        if (count($eerder) < self::REFERENCE_MINIMUM) {
            return false;
        }

        $waardes = array_map(static fn ($r) => (int) $r['effectief'], $eerder);
        $gebruikelijk = array_sum($waardes) / count($waardes);
        $doel = $gebruikelijk * (1 - $percent / 100);

        $beste = Database::first(
            "SELECT MIN(CASE WHEN penalty = 'plus2' THEN raw_ms + 2000 ELSE raw_ms END) AS snelste
             FROM solves s
             WHERE s.user_id = ? AND s.event = ? AND s.solved_at >= ?
               AND s.penalty <> 'dnf' AND s.raw_ms IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1 FROM solve_flags f
                   WHERE f.user_id = s.user_id AND f.solve_client_id = s.client_id
                     AND f.status IN ('pending', 'rejected')
               )",
            [$userId, $event, $dagStart]
        );

        $snelste = $beste['snelste'] ?? null;
        return $snelste !== null && (int) $snelste <= $doel;
    }

    /** Slaat de voortgang op en kent XP toe zodra de opdracht af is. */
    private static function recordProgress(int $userId, int $challengeId, int $progress, int $target, int $xp, string $titel): void
    {
        $af = $progress >= $target;

        Database::run(
            'INSERT INTO challenge_entries (challenge_id, user_id, progress, target, completed_at, xp_awarded)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                progress = VALUES(progress),
                target = VALUES(target),
                completed_at = COALESCE(challenge_entries.completed_at, VALUES(completed_at))',
            [$challengeId, $userId, $progress, $target, $af ? gmdate('Y-m-d H:i:s') : null, $af ? $xp : 0]
        );

        if ($af) {
            Xp::award($userId, 'challenge', (string) $challengeId, $xp, 'Challenge gehaald: ' . $titel);
        }
    }

    /* =====================================================================
     * Scramble van de dag
     * ================================================================== */

    /**
     * Neemt de poging voor de scramble van de dag aan. Er is er maar een.
     *
     * @return array{ok:bool, message:string, entry?:array<string,mixed>}
     */
    public static function submitAttempt(int $userId, int $challengeId, ?int $timeMs, string $penalty, ?string $solveClientId): array
    {
        $challenge = Database::first(
            "SELECT * FROM daily_challenges WHERE id = ? AND type = 'scramble_of_the_day'",
            [$challengeId]
        );
        if ($challenge === null) {
            return ['ok' => false, 'message' => 'Deze challenge bestaat niet.'];
        }
        if ((string) $challenge['challenge_date'] !== SiteTime::today()) {
            return ['ok' => false, 'message' => 'De scramble van die dag is niet meer open.'];
        }

        $bestaand = Database::first(
            'SELECT id FROM challenge_entries WHERE challenge_id = ? AND user_id = ?',
            [$challengeId, $userId]
        );
        if ($bestaand !== null) {
            return ['ok' => false, 'message' => 'Je hebt de scramble van vandaag al gedaan.'];
        }

        if (!in_array($penalty, ['none', 'plus2', 'dnf'], true)) {
            $penalty = 'none';
        }

        $effectief = null;
        if ($penalty !== 'dnf' && $timeMs !== null) {
            $effectief = $penalty === 'plus2' ? $timeMs + 2000 : $timeMs;

            if ($effectief < Events::floorMs(self::SCRAMBLE_EVENT)) {
                return [
                    'ok' => false,
                    'message' => 'Die tijd is sneller dan het wereldrecord. Er is niets opgeslagen.',
                ];
            }
            if ($effectief > 3600000) {
                return ['ok' => false, 'message' => 'Die tijd lijkt niet te kloppen.'];
            }
        }

        Database::run(
            'INSERT INTO challenge_entries
                (challenge_id, user_id, progress, target, value_ms, penalty, solve_client_id, completed_at, xp_awarded)
             VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?)',
            [
                $challengeId, $userId, $effectief, $penalty, $solveClientId,
                gmdate('Y-m-d H:i:s'), (int) $challenge['xp_reward'],
            ]
        );

        Xp::award($userId, 'challenge', (string) $challengeId, (int) $challenge['xp_reward'],
            'Scramble van de dag gedaan');

        return [
            'ok' => true,
            'message' => $effectief === null
                ? 'DNF opgeslagen. Morgen weer een kans!'
                : 'Je tijd staat genoteerd.',
            'entry' => ['valueMs' => $effectief, 'penalty' => $penalty],
        ];
    }

    /**
     * De dagranglijst van de scramble van de dag.
     *
     * @return list<array<string,mixed>>
     */
    public static function dayLeaderboard(int $challengeId, int $limit = 25): array
    {
        $limit = max(1, min($limit, 100));

        $rows = Database::all(
            'SELECT e.value_ms, e.penalty, e.completed_at, u.username, u.public_id, p.level
             FROM challenge_entries e
             JOIN users u ON u.id = e.user_id
             JOIN user_profiles p ON p.user_id = e.user_id
             WHERE e.challenge_id = ? AND e.completed_at IS NOT NULL
               AND u.is_active = 1 AND p.show_on_leaderboard = 1
             ORDER BY e.value_ms IS NULL, e.value_ms ASC, e.completed_at ASC
             LIMIT ' . $limit,
            [$challengeId]
        );

        $out = [];
        foreach ($rows as $index => $row) {
            $level = (int) $row['level'];
            $out[] = [
                'position' => $index + 1,
                'user'     => $row['username'],
                'userId'   => $row['public_id'],
                'level'    => $level,
                'tier'     => Xp::tier($level)['slug'],
                'valueMs'  => $row['value_ms'] === null ? null : (int) $row['value_ms'],
                'penalty'  => $row['penalty'],
            ];
        }
        return $out;
    }
}
