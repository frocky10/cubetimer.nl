<?php
declare(strict_types=1);

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Events.php';
require_once __DIR__ . '/Follows.php';
require_once __DIR__ . '/Ranking.php';

/**
 * Duels: jij en een vriend op dezelfde scrambles, ieder wanneer het uitkomt.
 *
 * Wie uitdaagt kiest een event; zijn browser maakt de scrambles (officiële
 * WCA-scrambles via cubing.js) en die gelden voor allebei. Daarna doet ieder
 * zijn pogingen. Het format hangt af van het event, net als op een comp: Ao5,
 * Mo3 voor 6x6 en 7x7, best of 3 bij blind.
 *
 * Je ziet de tijden van de ander pas als jullie allebei klaar zijn. Anders
 * weet je bij poging drie al dat het een makkelijke scramble was.
 *
 * Alleen tussen vrienden: je volgt elkaar allebei. Zo kan niemand een
 * onbekende bestoken met uitdagingen. Na zeven dagen vervalt een duel; wie
 * dan wel klaar was, wint.
 *
 * Een solve in een duel komt niet in je sessies en telt niet voor records,
 * ranglijsten of XP. Het is een potje tegen een vriend.
 */
final class Duels
{
    public const EXPIRY_DAYS = 7;
    private const MAX_OPEN = 10;
    private const MAX_SOLVE_MS = 3_600_000;

    /** Het format per event, zoals op een comp. */
    public static function formatFor(string $event): string
    {
        return match ($event) {
            '666', '777' => 'm',
            '333bf', '444bf', '555bf' => '3',
            default => 'a',
        };
    }

    /* =====================================================================
     * Uitdagen
     * ================================================================== */

    /**
     * @param list<mixed> $scrambles
     * @return array{ok:bool,message?:string,duel?:array<string,mixed>}
     */
    public static function create(int $userId, string $opponentName, string $event, array $scrambles): array
    {
        if (!Events::isRanked($event)) {
            return ['ok' => false, 'message' => 'Op dit event kun je geen duel spelen.'];
        }

        $tegenstander = Database::first(
            'SELECT id, username FROM users WHERE username = ? AND is_active = 1',
            [$opponentName]
        );
        if ($tegenstander === null) {
            return ['ok' => false, 'message' => 'Die cuber kennen we niet.'];
        }
        $tegenstanderId = (int) $tegenstander['id'];
        if ($tegenstanderId === $userId) {
            return ['ok' => false, 'message' => 'Tegen jezelf spelen kan in de gewone timer.'];
        }
        if (!Follows::relation($userId, $tegenstanderId)['friends']) {
            return ['ok' => false, 'message' => 'Je kunt alleen een vriend uitdagen: jullie volgen elkaar allebei.'];
        }

        self::expire();
        $open = Database::first(
            "SELECT COUNT(*) AS aantal FROM duels WHERE challenger_id = ? AND status = 'open'",
            [$userId]
        );
        if ((int) ($open['aantal'] ?? 0) >= self::MAX_OPEN) {
            return ['ok' => false, 'message' => 'Je hebt al ' . self::MAX_OPEN . ' duels openstaan. Speel die eerst uit.'];
        }

        $format = self::formatFor($event);
        $schoon = self::cleanScrambles($event, $scrambles, Ranking::attempts($format));
        if ($schoon === null) {
            return ['ok' => false, 'message' => 'De scrambles voor dit duel kloppen niet. Probeer het opnieuw.'];
        }

        Database::run(
            'INSERT INTO duels (challenger_id, opponent_id, event, format, scrambles, expires_at)
             VALUES (?, ?, ?, ?, ?, ?)',
            [
                $userId, $tegenstanderId, $event, $format, json_encode($schoon),
                gmdate('Y-m-d H:i:s', time() + self::EXPIRY_DAYS * 86400),
            ]
        );
        $duelId = (int) Database::connection()->lastInsertId();

        return ['ok' => true, 'duel' => self::view(self::load($duelId), $userId)];
    }

    /** @return list<string>|null */
    private static function cleanScrambles(string $event, array $scrambles, int $aantal): ?array
    {
        if (count($scrambles) !== $aantal) {
            return null;
        }
        $uit = [];
        foreach (array_values($scrambles) as $scramble) {
            if (!is_string($scramble)) {
                return null;
            }
            // Megaminx staat over meerdere regels; verder alleen gewone spaties.
            $scramble = trim((string) preg_replace('/[ \t]+/', ' ', str_replace("\r", '', $scramble)));
            if ($scramble === '' || mb_strlen($scramble) > 800) {
                return null;
            }
            // Wat er in een scramble van welk event dan ook kan staan, en niets anders.
            if (preg_match("~^[A-Za-z0-9'+\-(),/ \n]+$~", $scramble) !== 1) {
                return null;
            }
            if (Events::hasScrambleFormat($event) && !Events::validateScramble($event, $scramble)) {
                return null;
            }
            $uit[] = $scramble;
        }
        return $uit;
    }

    /* =====================================================================
     * Spelen
     * ================================================================== */

    /** @return array{ok:bool,message?:string,duel?:array<string,mixed>} */
    public static function submit(int $duelId, int $userId, ?int $timeMs, string $penalty): array
    {
        self::expire();
        $duel = self::load($duelId);
        if ($duel === null || !self::participates($duel, $userId)) {
            return ['ok' => false, 'message' => 'Dit duel bestaat niet.'];
        }
        if ($duel['status'] !== 'open') {
            return ['ok' => false, 'message' => 'Dit duel is al voorbij.'];
        }

        $totaal = Ranking::attempts((string) $duel['format']);
        $gedaan = self::attempts($duelId, $userId);
        if (count($gedaan) >= $totaal) {
            return ['ok' => false, 'message' => 'Je hebt al je pogingen in dit duel gedaan.'];
        }

        if (!in_array($penalty, ['none', 'plus2', 'dnf'], true)) {
            $penalty = 'none';
        }
        if ($timeMs === null || $timeMs <= 0 || $timeMs > self::MAX_SOLVE_MS) {
            $timeMs = null;
            $penalty = 'dnf';
        } elseif ($penalty !== 'dnf' && $timeMs < Events::floorMs((string) $duel['event'])) {
            return ['ok' => false, 'message' => 'Die tijd is sneller dan het wereldrecord.'];
        }

        Database::run(
            'INSERT INTO duel_attempts (duel_id, user_id, attempt_number, raw_ms, penalty, solved_at)
             VALUES (?, ?, ?, ?, ?, ?)',
            [$duelId, $userId, count($gedaan) + 1, $timeMs, $penalty, gmdate('Y-m-d H:i:s')]
        );

        $gedaan = self::attempts($duelId, $userId);
        if (count($gedaan) >= $totaal) {
            self::closeSide($duel, $userId, $gedaan);
        }

        return ['ok' => true, 'duel' => self::view(self::load($duelId), $userId)];
    }

    /** Legt de uitslag van een kant vast, en rondt het duel af als de ander ook klaar is. */
    private static function closeSide(array $duel, int $userId, array $pogingen): void
    {
        $format = (string) $duel['format'];
        $uitslag = Ranking::result($format, array_map(
            static fn (array $p): ?int => Ranking::effective(
                $p['raw_ms'] === null ? null : (int) $p['raw_ms'], (string) $p['penalty']
            ),
            $pogingen
        ));

        $kant = (int) $duel['challenger_id'] === $userId ? 'challenger' : 'opponent';
        // De kolomnamen komen uit deze twee vaste woorden, niet uit invoer.
        Database::run(
            "UPDATE duels SET {$kant}_avg_ms = ?, {$kant}_best_ms = ?, {$kant}_done = 1 WHERE id = ?",
            [$uitslag['average'], $uitslag['best'], (int) $duel['id']]
        );

        $duel = self::load((int) $duel['id']);
        if ((int) $duel['challenger_done'] !== 1 || (int) $duel['opponent_done'] !== 1) {
            return;
        }

        $verschil = Ranking::compare(
            $format,
            ['average' => self::intOrNull($duel['challenger_avg_ms']), 'best' => self::intOrNull($duel['challenger_best_ms'])],
            ['average' => self::intOrNull($duel['opponent_avg_ms']), 'best' => self::intOrNull($duel['opponent_best_ms'])]
        );
        $winnaar = match (true) {
            $verschil < 0 => (int) $duel['challenger_id'],
            $verschil > 0 => (int) $duel['opponent_id'],
            default => null,
        };

        Database::run(
            "UPDATE duels SET status = 'finished', winner_id = ?, finished_at = UTC_TIMESTAMP()
             WHERE id = ? AND status = 'open'",
            [$winnaar, (int) $duel['id']]
        );
    }

    /**
     * Afwijzen (als tegenstander) of intrekken (als uitdager, zolang de ander
     * nog niet begonnen is).
     *
     * @return array{ok:bool,message:string}
     */
    public static function decline(int $duelId, int $userId): array
    {
        $duel = self::load($duelId);
        if ($duel === null || !self::participates($duel, $userId) || $duel['status'] !== 'open') {
            return ['ok' => false, 'message' => 'Dit duel staat niet meer open.'];
        }

        if ((int) $duel['opponent_id'] === $userId) {
            if ((int) $duel['opponent_done'] === 1) {
                return ['ok' => false, 'message' => 'Je hebt dit duel al gespeeld.'];
            }
            Database::run("UPDATE duels SET status = 'declined', finished_at = UTC_TIMESTAMP() WHERE id = ?", [$duelId]);
            return ['ok' => true, 'message' => 'Duel afgewezen.'];
        }

        if (self::attempts($duelId, (int) $duel['opponent_id'])) {
            return ['ok' => false, 'message' => 'Je tegenstander is al begonnen; intrekken kan niet meer.'];
        }
        Database::run("UPDATE duels SET status = 'cancelled', finished_at = UTC_TIMESTAMP() WHERE id = ?", [$duelId]);
        return ['ok' => true, 'message' => 'Duel ingetrokken.'];
    }

    /**
     * Laat verlopen duels vervallen. Wie op dat moment wel klaar was, wint.
     * Draait bij elk verzoek dat duels bekijkt; een cronjob is niet nodig.
     */
    public static function expire(): void
    {
        Database::run(
            "UPDATE duels
             SET status = 'expired', finished_at = UTC_TIMESTAMP(),
                 winner_id = CASE
                     WHEN challenger_done = 1 AND opponent_done = 0 THEN challenger_id
                     WHEN opponent_done = 1 AND challenger_done = 0 THEN opponent_id
                     ELSE NULL END
             WHERE status = 'open' AND expires_at < UTC_TIMESTAMP()"
        );
    }

    /* =====================================================================
     * Opvragen
     * ================================================================== */

    /** @return array<string,mixed> */
    public static function overview(int $userId): array
    {
        self::expire();

        $open = Database::all(
            "SELECT * FROM duels WHERE status = 'open' AND (challenger_id = ? OR opponent_id = ?)
             ORDER BY id DESC",
            [$userId, $userId]
        );
        $klaar = Database::all(
            "SELECT * FROM duels WHERE status IN ('finished', 'expired', 'declined', 'cancelled')
               AND (challenger_id = ? OR opponent_id = ?)
             ORDER BY id DESC LIMIT 10",
            [$userId, $userId]
        );

        $openViews = array_map(static fn (array $d): array => self::view($d, $userId), $open);
        $wachtend = count(array_filter($openViews, static fn (array $d): bool => !$d['you']['done']));

        return [
            'open'    => $openViews,
            'recent'  => array_map(static fn (array $d): array => self::view($d, $userId), $klaar),
            'waiting' => $wachtend,
            'totals'  => self::totals($userId),
            'friends' => Follows::listFor($userId, 'friends'),
        ];
    }

    /** @return array{won:int,lost:int,drawn:int} */
    public static function totals(int $userId): array
    {
        $rij = Database::first(
            "SELECT
                SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) AS gewonnen,
                SUM(CASE WHEN winner_id IS NOT NULL AND winner_id <> ? THEN 1 ELSE 0 END) AS verloren,
                SUM(CASE WHEN winner_id IS NULL AND status = 'finished' THEN 1 ELSE 0 END) AS gelijk
             FROM duels
             WHERE (challenger_id = ? OR opponent_id = ?) AND status IN ('finished', 'expired')",
            [$userId, $userId, $userId, $userId]
        );
        return [
            'won'   => (int) ($rij['gewonnen'] ?? 0),
            'lost'  => (int) ($rij['verloren'] ?? 0),
            'drawn' => (int) ($rij['gelijk'] ?? 0),
        ];
    }

    /**
     * Een duel zoals de speler het mag zien. De tijden van de ander staan er
     * pas in als het duel voorbij is.
     *
     * @return array<string,mixed>
     */
    private static function view(?array $duel, int $userId): array
    {
        if ($duel === null) {
            return [];
        }

        $duelId = (int) $duel['id'];
        $isUitdager = (int) $duel['challenger_id'] === $userId;
        $anderId = $isUitdager ? (int) $duel['opponent_id'] : (int) $duel['challenger_id'];
        $ik = $isUitdager ? 'challenger' : 'opponent';
        $zij = $isUitdager ? 'opponent' : 'challenger';

        $format = (string) $duel['format'];
        $totaal = Ranking::attempts($format);
        $voorbij = $duel['status'] !== 'open';

        $mijn = self::attempts($duelId, $userId);
        $hun = self::attempts($duelId, $anderId);
        $naam = Database::first('SELECT username FROM users WHERE id = ?', [$anderId]);

        $scrambles = json_decode((string) $duel['scrambles'], true);
        $scrambles = is_array($scrambles) ? $scrambles : [];

        $winnaar = $duel['winner_id'] === null ? null : (int) $duel['winner_id'];
        $uitkomst = null;
        if ($voorbij && in_array($duel['status'], ['finished', 'expired'], true)) {
            $uitkomst = $winnaar === null ? ($duel['status'] === 'finished' ? 'draw' : null)
                : ($winnaar === $userId ? 'win' : 'loss');
        }

        return [
            'id'            => $duelId,
            'event'         => $duel['event'],
            'eventLabel'    => Events::label((string) $duel['event']),
            'format'        => $format,
            'formatLabel'   => Ranking::label($format),
            'status'        => $duel['status'],
            'role'          => $isUitdager ? 'challenger' : 'opponent',
            'attemptsTotal' => $totaal,
            'result'        => $uitkomst,
            'createdAt'     => str_replace(' ', 'T', (string) $duel['created_at']) . 'Z',
            'expiresAt'     => str_replace(' ', 'T', (string) $duel['expires_at']) . 'Z',
            // De volgende scramble alleen voor wie nog moet; de rest blijft verborgen.
            'nextScramble'  => !$voorbij && count($mijn) < $totaal ? ($scrambles[count($mijn)] ?? null) : null,
            'scrambles'     => $voorbij ? $scrambles : null,
            'you' => [
                'done'     => (int) $duel[$ik . '_done'] === 1,
                'attempts' => self::presentAttempts($mijn),
                'average'  => self::intOrNull($duel[$ik . '_avg_ms']),
                'best'     => self::intOrNull($duel[$ik . '_best_ms']),
            ],
            'them' => [
                'username'     => $naam['username'] ?? '?',
                'done'         => (int) $duel[$zij . '_done'] === 1,
                'attemptsDone' => count($hun),
                'attempts'     => $voorbij ? self::presentAttempts($hun) : null,
                'average'      => $voorbij ? self::intOrNull($duel[$zij . '_avg_ms']) : null,
                'best'         => $voorbij ? self::intOrNull($duel[$zij . '_best_ms']) : null,
            ],
        ];
    }

    /** @return list<array{ms:?int,penalty:string}> */
    private static function presentAttempts(array $rijen): array
    {
        return array_map(static fn (array $r): array => [
            'ms' => $r['raw_ms'] === null ? null : (int) $r['raw_ms'],
            'penalty' => (string) $r['penalty'],
        ], $rijen);
    }

    /** @return array<string,mixed>|null */
    private static function load(int $duelId): ?array
    {
        return Database::first('SELECT * FROM duels WHERE id = ?', [$duelId]);
    }

    private static function participates(array $duel, int $userId): bool
    {
        return (int) $duel['challenger_id'] === $userId || (int) $duel['opponent_id'] === $userId;
    }

    /** @return list<array<string,mixed>> */
    private static function attempts(int $duelId, int $userId): array
    {
        return Database::all(
            'SELECT raw_ms, penalty FROM duel_attempts WHERE duel_id = ? AND user_id = ? ORDER BY attempt_number',
            [$duelId, $userId]
        );
    }

    private static function intOrNull(mixed $waarde): ?int
    {
        return $waarde === null ? null : (int) $waarde;
    }
}
