<?php
declare(strict_types=1);

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Events.php';
require_once __DIR__ . '/Averages.php';
require_once __DIR__ . '/TournamentField.php';
require_once __DIR__ . '/Xp.php';

/**
 * Toernooimodus: een simulatie van een echte WCA-competitie.
 *
 * Opzet, net als op een echte comp:
 *   Ronde 1  Kwalificatie   iedereen doet mee, de besten gaan door
 *   Ronde 2  Halve finale   het overgebleven veld
 *   Ronde 3  Finale         de laatste acht
 *
 * Vijf solves per ronde, gerangschikt op Ao5 met je beste single als tiebreak.
 * De kwalificatie heeft een cutoff: haal je die in twee solves niet, dan stopt
 * je ronde daar en word je gerangschikt op je beste single, onder iedereen met
 * een gemiddelde. Elke solve boven de tijdslimiet is een DNF.
 *
 * Een toernooi staat helemaal los van je sessies: de solves komen in
 * `tournament_solves` en niet bij je gewone tijden. De records eruit komen in
 * `tournament_records`, met een eigen blok op je profiel. Een toernooitijd komt
 * onder heel andere omstandigheden tot stand en hoort niet door je
 * oefengemiddelden heen te lopen.
 */
final class Tournaments
{
    public const ATTEMPTS_PER_ROUND = 5;
    public const CUTOFF_ATTEMPTS = 2;

    /**
     * De moeilijkheidsgraden. `reference` is het gemiddelde waar het veld
     * omheen gebouwd wordt, in milliseconden op 3x3. `spread` bepaalt hoe ver
     * de deelnemers uit elkaar liggen.
     *
     * @var array<string,array{label:string,reference:?int,field:int,spread:float,description:string}>
     */
    public const DIFFICULTIES = [
        'beginner' => [
            'label' => 'Beginner', 'reference' => 45000, 'field' => 24, 'spread' => 0.45,
            'description' => 'Rustig veld rond de 45 seconden. Goed om de opzet te leren kennen.',
        ],
        'club' => [
            'label' => 'Clubniveau', 'reference' => 20000, 'field' => 32, 'spread' => 0.4,
            'description' => 'Zoals een doordeweekse clubavond: het veld zit rond de 20 seconden.',
        ],
        'nationaal' => [
            'label' => 'Nationaal', 'reference' => 11000, 'field' => 32, 'spread' => 0.35,
            'description' => 'Een nationaal kampioenschap. Rond de 11 seconden, en dat vijf keer op rij.',
        ],
        'wk' => [
            'label' => 'WK-niveau', 'reference' => 6500, 'field' => 32, 'spread' => 0.2,
            'description' => 'De wereldtop. Zes seconden gemiddeld, met uitschieters naar vijf.',
        ],
        'opmaat' => [
            'label' => 'Op jouw niveau', 'reference' => null, 'field' => 32, 'spread' => 0.35,
            'description' => 'Het veld beweegt zich rond jouw eigen gemiddelde. Blijft spannend, ook als je beter wordt.',
        ],
        'open' => [
            'label' => 'Open toernooi', 'reference' => 16000, 'field' => 64, 'spread' => 1.1,
            'description' => 'Alles door elkaar, van beginner tot wereldtop, in een veld van 64. Dertigste worden hoort erbij.',
        ],
    ];

    /** Rondeopzet: hoeveel er doorgaan naar de volgende ronde. */
    private const ROUND_NAMES = [1 => 'Kwalificatie', 2 => 'Halve finale', 3 => 'Finale'];
    private const ADVANCING = [1 => 16, 2 => 8, 3 => 0];

    /** XP: meedoen levert wat op, presteren meer. */
    private const XP_PARTICIPATION = 60;
    private const XP_BY_POSITION = [1 => 300, 2 => 200, 3 => 150];
    private const XP_TOP_EIGHT = 80;

    /* =====================================================================
     * Een toernooi beginnen
     * ================================================================== */

    /** @return array{ok:bool,message?:string,tournament?:array<string,mixed>} */
    public static function start(int $userId, string $event, string $difficulty): array
    {
        if (!Events::isRanked($event)) {
            return ['ok' => false, 'message' => 'Op dit event kun je geen toernooi spelen.'];
        }
        if (!isset(self::DIFFICULTIES[$difficulty])) {
            return ['ok' => false, 'message' => 'Die moeilijkheidsgraad bestaat niet.'];
        }
        if (self::activeId($userId) !== null) {
            return ['ok' => false, 'message' => 'Je hebt al een toernooi lopen. Maak dat eerst af of stop ermee.'];
        }

        $instelling = self::DIFFICULTIES[$difficulty];
        $referentie = self::referenceFor($userId, $event, $difficulty);

        $pdo = Database::connection();
        $pdo->beginTransaction();

        try {
            Database::run(
                'INSERT INTO tournaments (user_id, event, difficulty, field_size, total_rounds, reference_ms)
                 VALUES (?, ?, ?, ?, ?, ?)',
                [$userId, $event, $difficulty, $instelling['field'], count(self::ROUND_NAMES), $referentie]
            );
            $tournamentId = (int) $pdo->lastInsertId();

            // Het veld: de speler doet mee, dus er zijn er een minder nodig.
            $veld = TournamentField::build(
                $event, $referentie, $instelling['field'] - 1, $instelling['spread'], $userId
            );

            $insert = $pdo->prepare(
                'INSERT INTO tournament_competitors
                    (tournament_id, kind, name, country_code, ref_user_id, skill_ms, consistency, form)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            );
            foreach ($veld as $deelnemer) {
                $insert->execute([
                    $tournamentId, $deelnemer['kind'], $deelnemer['name'], $deelnemer['country'],
                    $deelnemer['ref_user_id'], $deelnemer['skill_ms'], $deelnemer['consistency'],
                    $deelnemer['form'],
                ]);
            }

            self::createRound($tournamentId, 1, count($veld) + 1, $referentie);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            error_log('[cubetimer] toernooi starten mislukt: ' . $e->getMessage());
            return ['ok' => false, 'message' => 'Het toernooi kon niet gestart worden.'];
        }

        return ['ok' => true, 'tournament' => self::state($tournamentId, $userId)];
    }

    /**
     * Het niveau waar het veld omheen gebouwd wordt, omgerekend naar het
     * gekozen event.
     */
    private static function referenceFor(int $userId, string $event, string $difficulty): int
    {
        $instelling = self::DIFFICULTIES[$difficulty];
        $basis = $instelling['reference'];

        if ($basis === null) {
            // Op jouw niveau: je eigen Ao12, anders je single, anders een
            // redelijke gok voor iemand die net begint.
            $eigen = Database::first(
                "SELECT
                    MIN(CASE WHEN category = 'ao12' THEN value_ms END) AS ao12,
                    MIN(CASE WHEN category = 'single' THEN value_ms END) AS single
                 FROM user_records
                 WHERE user_id = ? AND event = ? AND period = 'all'",
                [$userId, $event]
            );

            if ($eigen !== null && $eigen['ao12'] !== null) {
                return max(Events::ABSOLUTE_FLOOR_MS * 4, (int) $eigen['ao12']);
            }
            if ($eigen !== null && $eigen['single'] !== null) {
                return max(Events::ABSOLUTE_FLOOR_MS * 4, (int) round((int) $eigen['single'] * 1.18));
            }
            return (int) round(30000 * Events::speedFactor($event));
        }

        return max(Events::ABSOLUTE_FLOOR_MS * 4, (int) round($basis * Events::speedFactor($event)));
    }

    private static function createRound(int $tournamentId, int $roundNumber, int $entrants, int $referenceMs): void
    {
        // Cutoff alleen in de kwalificatie, net als bij een gecombineerde ronde
        // op een echte competitie. De limiet geldt altijd.
        $cutoff = $roundNumber === 1 ? (int) round($referenceMs * 1.6) : null;
        $limiet = (int) round($referenceMs * 3.2);

        Database::run(
            'INSERT INTO tournament_rounds
                (tournament_id, round_number, name, entrants, advancing, cutoff_ms, time_limit_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                $tournamentId, $roundNumber, self::ROUND_NAMES[$roundNumber] ?? ('Ronde ' . $roundNumber),
                $entrants, min(self::ADVANCING[$roundNumber] ?? 0, max(0, $entrants - 1)),
                $cutoff, $limiet,
            ]
        );
    }

    public static function activeId(int $userId): ?int
    {
        $row = Database::first(
            "SELECT id FROM tournaments WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
            [$userId]
        );
        return $row === null ? null : (int) $row['id'];
    }

    /* =====================================================================
     * Solves insturen
     * ================================================================== */

    /**
     * Neemt een solve van de speler aan. Is de ronde daarmee klaar, dan wordt
     * hij meteen uitgerekend en zie je de stand.
     *
     * @return array{ok:bool,message?:string,tournament?:array<string,mixed>,roundScored?:bool}
     */
    public static function submitSolve(int $tournamentId, int $userId, ?int $timeMs, string $penalty, string $scramble): array
    {
        $toernooi = self::load($tournamentId, $userId);
        if ($toernooi === null) {
            return ['ok' => false, 'message' => 'Dit toernooi bestaat niet.'];
        }
        if ($toernooi['status'] !== 'active') {
            return ['ok' => false, 'message' => 'Dit toernooi is al afgelopen.'];
        }

        $ronde = self::currentRound($tournamentId);
        if ($ronde === null) {
            return ['ok' => false, 'message' => 'Er loopt geen ronde.'];
        }

        $gedaan = self::playerSolves($tournamentId, (int) $ronde['round_number']);
        if (count($gedaan) >= self::ATTEMPTS_PER_ROUND) {
            return ['ok' => false, 'message' => 'Deze ronde zit er al op.'];
        }

        if (!in_array($penalty, ['none', 'plus2', 'dnf'], true)) {
            $penalty = 'none';
        }
        if ($timeMs === null || $timeMs < 0) {
            $penalty = 'dnf';
            $timeMs = null;
        }

        // Boven de tijdslimiet is een solve een DNF, net als op een echte comp.
        $limiet = $ronde['time_limit_ms'] === null ? null : (int) $ronde['time_limit_ms'];
        $effectief = self::effective($timeMs, $penalty);
        if ($limiet !== null && $effectief !== null && $effectief > $limiet) {
            $penalty = 'dnf';
        }

        $poging = count($gedaan) + 1;
        Database::run(
            'INSERT INTO tournament_solves
                (tournament_id, user_id, round_number, attempt_number, raw_ms, penalty, scramble, solved_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $tournamentId, $userId, (int) $ronde['round_number'], $poging,
                $timeMs, $penalty, mb_substr($scramble, 0, 1024), gmdate('Y-m-d H:i:s'),
            ]
        );

        $gedaan = self::playerSolves($tournamentId, (int) $ronde['round_number']);
        $klaar = count($gedaan) >= self::ATTEMPTS_PER_ROUND || self::isCutOff($ronde, $gedaan);

        if ($klaar) {
            self::scoreRound($tournamentId, $userId, $ronde);
        }

        return [
            'ok' => true,
            'roundScored' => $klaar,
            'tournament' => self::state($tournamentId, $userId),
        ];
    }

    /** Is de speler op de cutoff gestrand? Alleen mogelijk na precies twee solves. */
    private static function isCutOff(array $ronde, array $solves): bool
    {
        $cutoff = $ronde['cutoff_ms'] === null ? null : (int) $ronde['cutoff_ms'];
        if ($cutoff === null || count($solves) !== self::CUTOFF_ATTEMPTS) {
            return false;
        }

        foreach ($solves as $solve) {
            $effectief = self::effective(
                $solve['raw_ms'] === null ? null : (int) $solve['raw_ms'],
                (string) $solve['penalty']
            );
            if ($effectief !== null && $effectief <= $cutoff) {
                return false; // cutoff gehaald, je mag door
            }
        }
        return true;
    }

    /* =====================================================================
     * Een ronde uitrekenen
     * ================================================================== */

    private static function scoreRound(int $tournamentId, int $userId, array $ronde): void
    {
        $rondeNummer = (int) $ronde['round_number'];
        $limiet = $ronde['time_limit_ms'] === null ? null : (int) $ronde['time_limit_ms'];
        $cutoff = $ronde['cutoff_ms'] === null ? null : (int) $ronde['cutoff_ms'];

        // --- de speler ----------------------------------------------------
        $eigen = self::playerSolves($tournamentId, $rondeNummer);
        $eigenTijden = array_map(static fn (array $r): array => [
            'ms'      => $r['raw_ms'] === null ? null : (int) $r['raw_ms'],
            'penalty' => (string) $r['penalty'],
        ], $eigen);

        $deelnemers = [[
            'competitor_id' => null,
            'times'         => $eigenTijden,
            'cut'           => count($eigenTijden) < self::ATTEMPTS_PER_ROUND,
        ]];

        // --- de tegenstanders die nog meedoen ------------------------------
        $veld = Database::all(
            'SELECT * FROM tournament_competitors
             WHERE tournament_id = ? AND eliminated_in IS NULL',
            [$tournamentId]
        );

        foreach ($veld as $deelnemer) {
            $gesimuleerd = self::simulate(
                (int) $deelnemer['skill_ms'],
                (int) $deelnemer['consistency'],
                (int) $deelnemer['form'],
                $limiet,
                $cutoff
            );
            $deelnemers[] = [
                'competitor_id' => (int) $deelnemer['id'],
                'times'         => $gesimuleerd['times'],
                'cut'           => $gesimuleerd['cut'],
            ];
        }

        // --- rangschikken --------------------------------------------------
        foreach ($deelnemers as $index => $deelnemer) {
            $waardes = array_map(
                static fn (array $t): ?int => self::effective($t['ms'], $t['penalty']),
                $deelnemer['times']
            );
            $geldig = array_values(array_filter($waardes, static fn (?int $v): bool => $v !== null));

            $gemiddelde = null;
            if (count($waardes) === self::ATTEMPTS_PER_ROUND) {
                $resultaat = Averages::best($waardes, self::ATTEMPTS_PER_ROUND, true);
                $gemiddelde = $resultaat === null ? null : (int) round($resultaat['value']);
            }

            $deelnemers[$index]['ao5'] = $gemiddelde;
            $deelnemers[$index]['best'] = $geldig ? min($geldig) : null;
        }

        usort($deelnemers, static function (array $a, array $b): int {
            // Eerst iedereen met een gemiddelde, op gemiddelde. Daarna de rest,
            // op beste single. Precies de WCA-volgorde.
            if ($a['ao5'] !== null && $b['ao5'] === null) return -1;
            if ($a['ao5'] === null && $b['ao5'] !== null) return 1;
            if ($a['ao5'] !== null && $b['ao5'] !== null && $a['ao5'] !== $b['ao5']) {
                return $a['ao5'] <=> $b['ao5'];
            }
            if ($a['best'] === null && $b['best'] === null) return 0;
            if ($a['best'] === null) return 1;
            if ($b['best'] === null) return -1;
            return $a['best'] <=> $b['best'];
        });

        // --- wegschrijven ---------------------------------------------------
        $doorNaarVolgende = (int) $ronde['advancing'];
        $eigenPositie = 0;
        $eigenDoor = false;
        $doorgegaan = [];

        $insert = Database::connection()->prepare(
            'INSERT INTO tournament_results
                (tournament_id, round_number, competitor_id, times_json, ao5_ms, best_ms, position, advanced, cut)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );

        foreach ($deelnemers as $index => $deelnemer) {
            $positie = $index + 1;
            $gaatDoor = $doorNaarVolgende > 0 && $positie <= $doorNaarVolgende;

            $insert->execute([
                $tournamentId, $rondeNummer, $deelnemer['competitor_id'],
                json_encode($deelnemer['times']), $deelnemer['ao5'], $deelnemer['best'],
                $positie, $gaatDoor ? 1 : 0, $deelnemer['cut'] ? 1 : 0,
            ]);

            if ($deelnemer['competitor_id'] === null) {
                $eigenPositie = $positie;
                $eigenDoor = $gaatDoor;
            } elseif ($gaatDoor) {
                $doorgegaan[] = $deelnemer['competitor_id'];
            }
        }

        // Wie niet doorgaat, valt af.
        if ($doorNaarVolgende > 0) {
            $blijvers = $doorgegaan ?: [0];
            $plaatshouders = implode(',', array_fill(0, count($blijvers), '?'));
            Database::run(
                "UPDATE tournament_competitors SET eliminated_in = ?
                 WHERE tournament_id = ? AND eliminated_in IS NULL AND id NOT IN ($plaatshouders)",
                array_merge([$rondeNummer, $tournamentId], $blijvers)
            );
        }

        Database::run(
            "UPDATE tournament_rounds SET status = 'done', finished_at = UTC_TIMESTAMP()
             WHERE tournament_id = ? AND round_number = ?",
            [$tournamentId, $rondeNummer]
        );

        // --- volgende ronde of einde ---------------------------------------
        $toernooi = self::load($tournamentId, $userId);
        $isLaatsteRonde = $rondeNummer >= (int) $toernooi['total_rounds'];

        if ($eigenDoor && !$isLaatsteRonde) {
            self::createRound($tournamentId, $rondeNummer + 1, count($doorgegaan) + 1, (int) $toernooi['reference_ms']);
            Database::run('UPDATE tournaments SET current_round = ? WHERE id = ?', [$rondeNummer + 1, $tournamentId]);
            return;
        }

        self::finish($tournamentId, $userId, $eigenPositie, $rondeNummer);
    }

    /**
     * Simuleert vijf solves voor een deelnemer.
     *
     * @return array{times:list<array{ms:?int,penalty:string}>,cut:bool}
     */
    private static function simulate(int $skillMs, int $consistency, int $form, ?int $limiet, ?int $cutoff): array
    {
        $gemiddelde = max(Events::ABSOLUTE_FLOOR_MS * 2, $skillMs * (1 + $form / 100));
        $spreiding = max(0.03, $consistency / 100);

        $tijden = [];
        for ($poging = 1; $poging <= self::ATTEMPTS_PER_ROUND; $poging++) {
            $tijden[] = self::oneSolve($gemiddelde, $spreiding, $limiet);

            // Na twee solves geldt dezelfde cutoff als voor de speler.
            if ($poging === self::CUTOFF_ATTEMPTS && $cutoff !== null) {
                $gehaald = false;
                foreach ($tijden as $tijd) {
                    $effectief = self::effective($tijd['ms'], $tijd['penalty']);
                    if ($effectief !== null && $effectief <= $cutoff) {
                        $gehaald = true;
                        break;
                    }
                }
                if (!$gehaald) {
                    return ['times' => $tijden, 'cut' => true];
                }
            }
        }

        return ['times' => $tijden, 'cut' => false];
    }

    /** @return array{ms:?int,penalty:string} */
    private static function oneSolve(float $gemiddelde, float $spreiding, ?int $limiet): array
    {
        // Benadering van een normale verdeling: de som van drie trekkingen.
        $ruis = (mt_rand(0, 1000) + mt_rand(0, 1000) + mt_rand(0, 1000) - 1500) / 1500;
        $tijd = (int) round($gemiddelde * (1 + $ruis * $spreiding));
        $tijd = max((int) round($gemiddelde * 0.55), $tijd);

        $worp = mt_rand(1, 1000);
        if ($worp <= 25) {
            return ['ms' => null, 'penalty' => 'dnf'];
        }
        if ($worp <= 70) {
            $straf = 'plus2';
        } else {
            $straf = 'none';
        }

        if ($limiet !== null && self::effective($tijd, $straf) > $limiet) {
            return ['ms' => null, 'penalty' => 'dnf'];
        }

        return ['ms' => $tijd, 'penalty' => $straf];
    }

    private static function effective(?int $ms, string $penalty): ?int
    {
        if ($penalty === 'dnf' || $ms === null) {
            return null;
        }
        return $penalty === 'plus2' ? $ms + 2000 : $ms;
    }

    /* =====================================================================
     * Afronden
     * ================================================================== */

    private static function finish(int $tournamentId, int $userId, int $positie, int $laatsteRonde): void
    {
        $eigen = Database::first(
            'SELECT ao5_ms, best_ms FROM tournament_results
             WHERE tournament_id = ? AND round_number = ? AND competitor_id IS NULL',
            [$tournamentId, $laatsteRonde]
        );

        Database::run(
            "UPDATE tournaments
             SET status = 'finished', final_position = ?, final_ao5_ms = ?, finished_at = UTC_TIMESTAMP()
             WHERE id = ?",
            [$positie, $eigen['ao5_ms'] ?? null, $tournamentId]
        );

        self::updateRecords($tournamentId, $userId);

        // XP: meedoen levert wat op, presteren meer.
        $xp = self::XP_PARTICIPATION + (self::XP_BY_POSITION[$positie] ?? ($positie <= 8 ? self::XP_TOP_EIGHT : 0));
        Xp::award($userId, 'tournament', (string) $tournamentId, $xp,
            'Toernooi afgerond: plek ' . $positie);
    }

    /**
     * Werkt de toernooirecords bij. Apart van de gewone records, want een
     * toernooitijd komt onder heel andere omstandigheden tot stand.
     */
    private static function updateRecords(int $tournamentId, int $userId): void
    {
        $toernooi = Database::first('SELECT event FROM tournaments WHERE id = ?', [$tournamentId]);
        if ($toernooi === null) {
            return;
        }
        $event = (string) $toernooi['event'];

        $besteSingle = Database::first(
            "SELECT MIN(CASE WHEN penalty = 'plus2' THEN raw_ms + 2000 ELSE raw_ms END) AS beste
             FROM tournament_solves
             WHERE tournament_id = ? AND penalty <> 'dnf' AND raw_ms IS NOT NULL",
            [$tournamentId]
        );
        $besteAo5 = Database::first(
            'SELECT MIN(ao5_ms) AS beste FROM tournament_results
             WHERE tournament_id = ? AND competitor_id IS NULL AND ao5_ms IS NOT NULL',
            [$tournamentId]
        );

        $nu = gmdate('Y-m-d H:i:s');
        foreach (['single' => $besteSingle['beste'] ?? null, 'ao5' => $besteAo5['beste'] ?? null] as $categorie => $waarde) {
            if ($waarde === null) {
                continue;
            }
            Database::run(
                'INSERT INTO tournament_records (user_id, event, category, value_ms, tournament_id, achieved_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    value_ms = LEAST(value_ms, VALUES(value_ms)),
                    tournament_id = IF(VALUES(value_ms) < value_ms, VALUES(tournament_id), tournament_id),
                    achieved_at = IF(VALUES(value_ms) < value_ms, VALUES(achieved_at), achieved_at)',
                [$userId, $event, $categorie, (int) $waarde, $tournamentId, $nu]
            );
        }
    }

    /** @return array{ok:bool,message:string} */
    public static function abandon(int $tournamentId, int $userId): array
    {
        $toernooi = self::load($tournamentId, $userId);
        if ($toernooi === null || $toernooi['status'] !== 'active') {
            return ['ok' => false, 'message' => 'Er is geen lopend toernooi om te stoppen.'];
        }

        Database::run(
            "UPDATE tournaments SET status = 'abandoned', finished_at = UTC_TIMESTAMP() WHERE id = ?",
            [$tournamentId]
        );
        return ['ok' => true, 'message' => 'Toernooi gestopt. Je resultaat telt niet mee.'];
    }

    /* =====================================================================
     * Opvragen
     * ================================================================== */

    /** @return array<string,mixed>|null */
    private static function load(int $tournamentId, int $userId): ?array
    {
        return Database::first(
            'SELECT * FROM tournaments WHERE id = ? AND user_id = ?',
            [$tournamentId, $userId]
        );
    }

    /** @return array<string,mixed>|null */
    private static function currentRound(int $tournamentId): ?array
    {
        return Database::first(
            "SELECT * FROM tournament_rounds
             WHERE tournament_id = ? AND status = 'active'
             ORDER BY round_number DESC LIMIT 1",
            [$tournamentId]
        );
    }

    /** @return list<array<string,mixed>> */
    private static function playerSolves(int $tournamentId, int $roundNumber): array
    {
        return Database::all(
            'SELECT * FROM tournament_solves
             WHERE tournament_id = ? AND round_number = ?
             ORDER BY attempt_number',
            [$tournamentId, $roundNumber]
        );
    }

    /**
     * Alles wat het scherm nodig heeft: de stand van zaken, de lopende ronde
     * en de uitslagen van de rondes die klaar zijn.
     *
     * @return array<string,mixed>
     */
    public static function state(int $tournamentId, int $userId): array
    {
        $toernooi = self::load($tournamentId, $userId);
        if ($toernooi === null) {
            return [];
        }

        $event = (string) $toernooi['event'];
        $moeilijkheid = (string) $toernooi['difficulty'];

        $uit = [
            'id'              => (int) $toernooi['id'],
            'event'           => $event,
            'eventLabel'      => Events::label($event),
            'difficulty'      => $moeilijkheid,
            'difficultyLabel' => self::DIFFICULTIES[$moeilijkheid]['label'] ?? $moeilijkheid,
            'status'          => $toernooi['status'],
            'fieldSize'       => (int) $toernooi['field_size'],
            'totalRounds'     => (int) $toernooi['total_rounds'],
            'currentRound'    => (int) $toernooi['current_round'],
            'referenceMs'     => (int) $toernooi['reference_ms'],
            'finalPosition'   => $toernooi['final_position'] === null ? null : (int) $toernooi['final_position'],
            'finalAo5Ms'      => $toernooi['final_ao5_ms'] === null ? null : (int) $toernooi['final_ao5_ms'],
            'createdAt'       => str_replace(' ', 'T', (string) $toernooi['created_at']) . 'Z',
        ];

        // --- de lopende ronde ---------------------------------------------
        $ronde = self::currentRound($tournamentId);
        if ($ronde !== null) {
            $solves = self::playerSolves($tournamentId, (int) $ronde['round_number']);
            $uit['round'] = [
                'number'       => (int) $ronde['round_number'],
                'name'         => $ronde['name'],
                'entrants'     => (int) $ronde['entrants'],
                'advancing'    => (int) $ronde['advancing'],
                'cutoffMs'     => $ronde['cutoff_ms'] === null ? null : (int) $ronde['cutoff_ms'],
                'timeLimitMs'  => $ronde['time_limit_ms'] === null ? null : (int) $ronde['time_limit_ms'],
                'attemptsDone' => count($solves),
                'attemptsTotal' => self::ATTEMPTS_PER_ROUND,
                'solves'       => array_map(static fn (array $r): array => [
                    'attempt' => (int) $r['attempt_number'],
                    'ms'      => $r['raw_ms'] === null ? null : (int) $r['raw_ms'],
                    'penalty' => $r['penalty'],
                ], $solves),
            ];
        } else {
            $uit['round'] = null;
        }

        $uit['rounds'] = self::standings($tournamentId);
        return $uit;
    }

    /**
     * De uitslagen van alle afgeronde rondes, met de namen erbij.
     *
     * @return list<array<string,mixed>>
     */
    private static function standings(int $tournamentId): array
    {
        $rondes = Database::all(
            "SELECT * FROM tournament_rounds WHERE tournament_id = ? AND status = 'done'
             ORDER BY round_number",
            [$tournamentId]
        );
        if (!$rondes) {
            return [];
        }

        $uitslagen = Database::all(
            'SELECT r.*, c.name, c.kind, c.country_code
             FROM tournament_results r
             LEFT JOIN tournament_competitors c ON c.id = r.competitor_id
             WHERE r.tournament_id = ?
             ORDER BY r.round_number, r.position',
            [$tournamentId]
        );

        $perRonde = [];
        foreach ($uitslagen as $rij) {
            $nummer = (int) $rij['round_number'];
            $tijden = json_decode((string) ($rij['times_json'] ?? '[]'), true);
            $perRonde[$nummer][] = [
                'position' => (int) $rij['position'],
                'name'     => $rij['competitor_id'] === null ? 'Jij' : (string) $rij['name'],
                'kind'     => $rij['competitor_id'] === null ? 'player' : (string) $rij['kind'],
                'country'  => $rij['country_code'],
                'isYou'    => $rij['competitor_id'] === null,
                'times'    => is_array($tijden) ? $tijden : [],
                'ao5Ms'    => $rij['ao5_ms'] === null ? null : (int) $rij['ao5_ms'],
                'bestMs'   => $rij['best_ms'] === null ? null : (int) $rij['best_ms'],
                'advanced' => (int) $rij['advanced'] === 1,
                'cut'      => (int) $rij['cut'] === 1,
            ];
        }

        $uit = [];
        foreach ($rondes as $ronde) {
            $nummer = (int) $ronde['round_number'];
            $uit[] = [
                'number'      => $nummer,
                'name'        => $ronde['name'],
                'entrants'    => (int) $ronde['entrants'],
                'advancing'   => (int) $ronde['advancing'],
                'cutoffMs'    => $ronde['cutoff_ms'] === null ? null : (int) $ronde['cutoff_ms'],
                'timeLimitMs' => $ronde['time_limit_ms'] === null ? null : (int) $ronde['time_limit_ms'],
                'results'     => $perRonde[$nummer] ?? [],
            ];
        }
        return $uit;
    }

    /**
     * Eerder gespeelde toernooien.
     *
     * @return list<array<string,mixed>>
     */
    public static function history(int $userId, int $limit = 20): array
    {
        $limit = max(1, min($limit, 100));
        $rows = Database::all(
            "SELECT id, event, difficulty, status, field_size, final_position, final_ao5_ms, finished_at
             FROM tournaments
             WHERE user_id = ? AND status <> 'active'
             ORDER BY id DESC LIMIT " . $limit,
            [$userId]
        );

        return array_map(static function (array $row): array {
            $moeilijkheid = (string) $row['difficulty'];
            return [
                'id'              => (int) $row['id'],
                'event'           => $row['event'],
                'eventLabel'      => Events::label((string) $row['event']),
                'difficulty'      => $moeilijkheid,
                'difficultyLabel' => self::DIFFICULTIES[$moeilijkheid]['label'] ?? $moeilijkheid,
                'status'          => $row['status'],
                'fieldSize'       => (int) $row['field_size'],
                'position'        => $row['final_position'] === null ? null : (int) $row['final_position'],
                'ao5Ms'           => $row['final_ao5_ms'] === null ? null : (int) $row['final_ao5_ms'],
                'finishedAt'      => $row['finished_at'] === null
                    ? null : str_replace(' ', 'T', (string) $row['finished_at']) . 'Z',
            ];
        }, $rows);
    }

    /**
     * De toernooicijfers voor op het profiel: hoeveel gespeeld, gewonnen,
     * podiums, en de records die er los van de oefentijden bijgehouden worden.
     *
     * @return array<string,mixed>
     */
    public static function summary(int $userId): array
    {
        $totalen = Database::first(
            "SELECT
                COUNT(*) AS gespeeld,
                SUM(CASE WHEN final_position = 1 THEN 1 ELSE 0 END) AS gewonnen,
                SUM(CASE WHEN final_position <= 3 THEN 1 ELSE 0 END) AS podiums,
                MIN(final_position) AS beste
             FROM tournaments
             WHERE user_id = ? AND status = 'finished'",
            [$userId]
        );

        $records = Database::all(
            'SELECT event, category, value_ms, achieved_at FROM tournament_records
             WHERE user_id = ? ORDER BY event, category',
            [$userId]
        );

        $perEvent = [];
        foreach ($records as $rij) {
            $event = (string) $rij['event'];
            $perEvent[$event]['event'] ??= $event;
            $perEvent[$event]['label'] ??= Events::label($event);
            $perEvent[$event]['records'][(string) $rij['category']] = (int) $rij['value_ms'];
        }

        return [
            'played'       => (int) ($totalen['gespeeld'] ?? 0),
            'won'          => (int) ($totalen['gewonnen'] ?? 0),
            'podiums'      => (int) ($totalen['podiums'] ?? 0),
            'bestPosition' => $totalen['beste'] === null ? null : (int) $totalen['beste'],
            'events'       => array_values($perEvent),
        ];
    }

    /** De moeilijkheidsgraden voor het keuzescherm. */
    public static function difficulties(): array
    {
        $uit = [];
        foreach (self::DIFFICULTIES as $sleutel => $instelling) {
            $uit[] = [
                'id'          => $sleutel,
                'label'       => $instelling['label'],
                'description' => $instelling['description'],
                'fieldSize'   => $instelling['field'],
                'referenceMs' => $instelling['reference'],
            ];
        }
        return $uit;
    }
}
