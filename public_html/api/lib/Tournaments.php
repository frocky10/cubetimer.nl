<?php
declare(strict_types=1);

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Taal.php';
require_once __DIR__ . '/Events.php';
require_once __DIR__ . '/Averages.php';
require_once __DIR__ . '/TournamentField.php';
require_once __DIR__ . '/Xp.php';
require_once __DIR__ . '/Ranking.php';
require_once __DIR__ . '/Wca.php';

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
 *
 * Twee soorten (kolom `source`):
 *   sim  Het veld bestaat uit bots en gesimuleerde gebruikers, op een
 *        moeilijkheidsgraad naar keuze. De opzet hierboven.
 *   wca  Een echte, afgelopen WCA-competitie. Het veld zijn de echte
 *        deelnemers met hun echte tijden, en de rondes hebben het echte format
 *        (Ao5, Mo3, best of), de echte cutoff en de echte tijdslimiet. Je gaat
 *        door als je hoog genoeg eindigt om bij het aantal cubers te horen dat
 *        in het echt doorging. Zo zie je waar je op die comp was geëindigd.
 *        De gegevens komen uit lib/Wca.php en worden bij de start in
 *        `wca_snapshot` vastgelegd, zodat een lopend toernooi niet afhangt van
 *        de WCA of de cache.
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

    /** Het type van een historisch toernooi in de kolom `difficulty`. */
    public const WCA_TYPE = 'wca';

    public static function typeLabel(string $type): string
    {
        if ($type === self::WCA_TYPE) {
            return Taal::t('Historische comp');
        }
        return Taal::t(self::DIFFICULTIES[$type]['label'] ?? $type);
    }

    /**
     * De naam van een ronde in de taal van het verzoek. In de database staat
     * hij in het Nederlands ("Halve finale", "Ronde 4").
     */
    public static function rondeNaam(string $naam): string
    {
        if (preg_match('/^Ronde (\d+)$/', $naam, $m) === 1) {
            return Taal::t('Ronde {n}', ['n' => $m[1]]);
        }
        return Taal::t($naam);
    }

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
     * Een toernooi op een echte, afgelopen WCA-competitie.
     *
     * @return array{ok:bool,message?:string,tournament?:array<string,mixed>}
     */
    public static function startWca(int $userId, string $competitionId, string $event): array
    {
        if (!Wca::isReady()) {
            return ['ok' => false, 'message' => 'Historische toernooien zijn op deze server niet beschikbaar.'];
        }
        if (self::activeId($userId) !== null) {
            return ['ok' => false, 'message' => 'Je hebt al een toernooi lopen. Maak dat eerst af of stop ermee.'];
        }

        $ophalen = Wca::competition($competitionId);
        if (!$ophalen['ok']) {
            return ['ok' => false, 'message' => $ophalen['message']];
        }
        $comp = $ophalen['competition'];
        $rondes = $comp['events'][$event]['rounds'] ?? null;
        if (!is_array($rondes) || !$rondes) {
            return ['ok' => false, 'message' => 'Dit event stond niet op deze comp.'];
        }
        $eersteRonde = $rondes[0]['results'];
        if (count($eersteRonde) < 2) {
            return ['ok' => false, 'message' => 'Er deden te weinig cubers mee aan dit event.'];
        }

        // Het niveau van het veld: de mediaan van de eerste ronde. Alleen voor
        // de volledigheid; een echt veld hoeft niet gesimuleerd te worden.
        $waardes = array_values(array_filter(array_map(
            static fn (array $r): ?int => $r['a'] ?? $r['b'] ?? null, $eersteRonde
        )));
        sort($waardes);
        $referentie = $waardes ? (int) $waardes[intdiv(count($waardes), 2)]
            : (int) round(30000 * Events::speedFactor($event));

        $momentopname = json_encode([
            'competition' => [
                'id' => $comp['id'], 'name' => $comp['name'], 'city' => $comp['city'],
                'country' => $comp['country'], 'startDate' => $comp['startDate'],
                'endDate' => $comp['endDate'], 'fetchedAt' => $comp['fetchedAt'],
            ],
            'rounds' => $rondes,
        ], JSON_UNESCAPED_UNICODE);

        $pdo = Database::connection();
        $pdo->beginTransaction();

        try {
            Database::run(
                'INSERT INTO tournaments
                    (user_id, event, difficulty, source, wca_competition_id, wca_name, wca_snapshot,
                     field_size, total_rounds, reference_ms)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $userId, $event, self::WCA_TYPE, 'wca', $comp['id'], mb_substr((string) $comp['name'], 0, 128),
                    $momentopname, count($eersteRonde) + 1, count($rondes), $referentie,
                ]
            );
            $tournamentId = (int) $pdo->lastInsertId();

            $insert = $pdo->prepare(
                "INSERT INTO tournament_competitors
                    (tournament_id, kind, name, country_code, wca_id, skill_ms, consistency, form)
                 VALUES (?, 'wca', ?, ?, ?, ?, 0, 0)"
            );
            foreach ($eersteRonde as $r) {
                $insert->execute([
                    $tournamentId, $r['n'], $r['c'], $r['w'], (int) ($r['a'] ?? $r['b'] ?? $referentie),
                ]);
            }

            self::createWcaRound($tournamentId, 1, $rondes);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            error_log('[cubetimer] historisch toernooi starten mislukt: ' . $e->getMessage());
            return ['ok' => false, 'message' => 'Het toernooi kon niet gestart worden.'];
        }

        return ['ok' => true, 'tournament' => self::state($tournamentId, $userId)];
    }

    /** Een ronde van een echte comp, met het echte format, de cutoff en de limiet. */
    private static function createWcaRound(int $tournamentId, int $roundNumber, array $rondes): void
    {
        $ronde = $rondes[$roundNumber - 1];
        $volgende = $rondes[$roundNumber] ?? null;

        Database::run(
            'INSERT INTO tournament_rounds
                (tournament_id, round_number, name, entrants, advancing, format, attempts,
                 cutoff_ms, cutoff_attempts, time_limit_ms, limit_cumulative)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $tournamentId, $roundNumber, $ronde['name'],
                count($ronde['results']) + 1,
                // In het echt gingen er zoveel door als er in de volgende ronde stonden.
                $volgende === null ? 0 : count($volgende['results']),
                $ronde['format'], (int) $ronde['attempts'],
                $ronde['cutoff']['ms'] ?? null, (int) ($ronde['cutoff']['attempts'] ?? self::CUTOFF_ATTEMPTS),
                $ronde['limit']['ms'] ?? null, !empty($ronde['limit']['cumulative']) ? 1 : 0,
            ]
        );
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

        $pogingen = self::attemptsOf($ronde);
        $gedaan = self::playerSolves($tournamentId, (int) $ronde['round_number']);
        if (count($gedaan) >= $pogingen) {
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
        // Bij een cumulatieve limiet (blind, 6x6 en 7x7 op veel comps) telt de
        // som van alle pogingen, en is de ronde voorbij zodra die op is.
        $limiet = $ronde['time_limit_ms'] === null ? null : (int) $ronde['time_limit_ms'];
        $limietOp = false;
        if ($limiet !== null && self::isCumulative($ronde)) {
            if (self::cumulativeUsed($gedaan) + self::cumulativePart($timeMs, $penalty) > $limiet) {
                $penalty = 'dnf';
                $limietOp = true;
            }
        } else {
            $effectief = self::effective($timeMs, $penalty);
            if ($limiet !== null && $effectief !== null && $effectief > $limiet) {
                $penalty = 'dnf';
            }
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
        $strikt = ($toernooi['source'] ?? 'sim') === 'wca';
        $klaar = count($gedaan) >= $pogingen || self::isCutOff($ronde, $gedaan, $strikt) || $limietOp;

        if ($klaar) {
            self::scoreRound($tournamentId, $userId, $ronde);
        }

        return [
            'ok' => true,
            'roundScored' => $klaar,
            'tournament' => self::state($tournamentId, $userId),
        ];
    }

    /**
     * Is de speler op de cutoff gestrand? Alleen mogelijk na precies het
     * aantal pogingen van de cutoff (meestal twee).
     *
     * Op een echte comp moet je er strikt onder zitten ($strikt); de
     * gesimuleerde toernooien rekenden altijd met "gelijk mag" en dat blijft zo.
     */
    private static function isCutOff(array $ronde, array $solves, bool $strikt = false): bool
    {
        $cutoff = $ronde['cutoff_ms'] === null ? null : (int) $ronde['cutoff_ms'];
        $binnen = (int) ($ronde['cutoff_attempts'] ?? self::CUTOFF_ATTEMPTS);
        if ($cutoff === null || count($solves) !== $binnen) {
            return false;
        }

        foreach ($solves as $solve) {
            $effectief = self::effective(
                $solve['raw_ms'] === null ? null : (int) $solve['raw_ms'],
                (string) $solve['penalty']
            );
            if ($effectief !== null && ($strikt ? $effectief < $cutoff : $effectief <= $cutoff)) {
                return false; // cutoff gehaald, je mag door
            }
        }
        return true;
    }

    /** Pogingen in deze ronde. Rondes van voor migratie 009 hebben er altijd vijf. */
    private static function attemptsOf(array $ronde): int
    {
        return (int) ($ronde['attempts'] ?? self::ATTEMPTS_PER_ROUND);
    }

    private static function isCumulative(array $ronde): bool
    {
        return (int) ($ronde['limit_cumulative'] ?? 0) === 1;
    }

    /**
     * Wat een poging van een cumulatieve limiet opmaakt: de gemeten tijd plus
     * een eventuele +2. Een DNF telt met de tijd die hij duurde.
     */
    private static function cumulativePart(?int $ms, string $penalty): int
    {
        return ($ms ?? 0) + ($penalty === 'plus2' ? 2000 : 0);
    }

    /** @param list<array<string,mixed>> $solves */
    private static function cumulativeUsed(array $solves): int
    {
        $som = 0;
        foreach ($solves as $solve) {
            $som += self::cumulativePart($solve['raw_ms'] === null ? null : (int) $solve['raw_ms'], (string) $solve['penalty']);
        }
        return $som;
    }

    /* =====================================================================
     * Een ronde uitrekenen
     * ================================================================== */

    private static function scoreRound(int $tournamentId, int $userId, array $ronde): void
    {
        $toernooi = self::load($tournamentId, $userId);
        if (($toernooi['source'] ?? 'sim') === 'wca') {
            self::scoreWcaRound($toernooi, $userId, $ronde);
            return;
        }

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
     * Een ronde van een echte comp uitrekenen. Hier wordt niets gesimuleerd:
     * het veld zijn de echte deelnemers van die ronde met hun echte pogingen,
     * en de speler wordt ertussen gezet.
     *
     * Door ga je als je plek binnen het aantal valt dat in het echt doorging.
     * De echte cubers die doorgingen doen in de volgende ronde allemaal weer
     * mee; wie er door jouw komst eigenlijk uit had gemoeten, laten we staan.
     * Zo blijft de volgende ronde precies de echte ronde, plus jij.
     */
    private static function scoreWcaRound(array $toernooi, int $userId, array $ronde): void
    {
        $tournamentId = (int) $toernooi['id'];
        $rondeNummer = (int) $ronde['round_number'];
        $format = (string) ($ronde['format'] ?? 'a');
        $pogingen = self::attemptsOf($ronde);

        $momentopname = json_decode((string) $toernooi['wca_snapshot'], true);
        $rondes = is_array($momentopname['rounds'] ?? null) ? $momentopname['rounds'] : [];
        $echt = $rondes[$rondeNummer - 1]['results'] ?? [];
        $volgende = $rondes[$rondeNummer]['results'] ?? null;

        // --- de speler ----------------------------------------------------
        $eigen = self::playerSolves($tournamentId, $rondeNummer);
        $gestrand = self::isCutOff($ronde, $eigen, true);
        $eigenTijden = array_map(static fn (array $r): array => [
            'ms'      => $r['raw_ms'] === null ? null : (int) $r['raw_ms'],
            'penalty' => (string) $r['penalty'],
        ], $eigen);
        // Op door een cumulatieve limiet: de rest van de pogingen is DNS.
        while (!$gestrand && count($eigenTijden) < $pogingen) {
            $eigenTijden[] = ['ms' => null, 'penalty' => 'dns'];
        }
        $eigenUitslag = Ranking::result($format, array_map(
            static fn (array $t): ?int => Ranking::effective($t['ms'], $t['penalty']), $eigenTijden
        ));

        $deelnemers = [[
            'competitor_id' => null,
            'times'   => $eigenTijden,
            'average' => $eigenUitslag['average'],
            'best'    => $eigenUitslag['best'],
            'cut'     => $gestrand,
            'key'     => null,
        ]];

        // --- het echte veld -------------------------------------------------
        $ids = [];
        foreach (Database::all(
            'SELECT id, name, wca_id FROM tournament_competitors WHERE tournament_id = ?',
            [$tournamentId]
        ) as $rij) {
            $ids[self::wcaKey($rij['wca_id'], (string) $rij['name'])] = (int) $rij['id'];
        }

        $heeftCutoff = $ronde['cutoff_ms'] !== null;
        foreach ($echt as $r) {
            $sleutel = self::wcaKey($r['w'] ?? null, (string) $r['n']);
            if (!isset($ids[$sleutel])) {
                // Stond niet in de eerste ronde (komt voor bij vreemde data): alsnog toevoegen.
                Database::run(
                    "INSERT INTO tournament_competitors
                        (tournament_id, kind, name, country_code, wca_id, skill_ms, consistency, form)
                     VALUES (?, 'wca', ?, ?, ?, ?, 0, 0)",
                    [$tournamentId, $r['n'], $r['c'], $r['w'], (int) ($r['a'] ?? $r['b'] ?? $toernooi['reference_ms'])]
                );
                $ids[$sleutel] = (int) Database::connection()->lastInsertId();
            }

            $tijden = array_map(static fn ($t): array => match (true) {
                is_int($t) => ['ms' => $t, 'penalty' => 'none'],
                $t === 'dns' => ['ms' => null, 'penalty' => 'dns'],
                default => ['ms' => null, 'penalty' => 'dnf'],
            }, is_array($r['t'] ?? null) ? $r['t'] : []);

            $deelnemers[] = [
                'competitor_id' => $ids[$sleutel],
                'times'   => $tijden,
                'average' => $r['a'] ?? null,
                'best'    => $r['b'] ?? null,
                'cut'     => $heeftCutoff && count($tijden) < $pogingen,
                'key'     => $sleutel,
            ];
        }

        // Stabiel sorteren: gelijke uitslagen houden de echte volgorde, en de
        // speler komt achter wie precies hetzelfde deed.
        $eigenRij = array_shift($deelnemers);
        $deelnemers[] = $eigenRij;
        usort($deelnemers, static fn (array $a, array $b): int => Ranking::compare($format, $a, $b));

        // --- wegschrijven ---------------------------------------------------
        $doorNaarVolgende = (int) $ronde['advancing'];
        $echtDoor = [];
        foreach ($volgende ?? [] as $r) {
            $echtDoor[self::wcaKey($r['w'] ?? null, (string) $r['n'])] = true;
        }

        $insert = Database::connection()->prepare(
            'INSERT INTO tournament_results
                (tournament_id, round_number, competitor_id, times_json, ao5_ms, best_ms, position, advanced, cut)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );

        $eigenPositie = 0;
        $eigenDoor = false;
        foreach ($deelnemers as $index => $deelnemer) {
            $positie = $index + 1;
            if ($deelnemer['competitor_id'] === null) {
                $gaatDoor = $doorNaarVolgende > 0 && $positie <= $doorNaarVolgende;
                $eigenPositie = $positie;
                $eigenDoor = $gaatDoor;
            } else {
                $gaatDoor = isset($echtDoor[$deelnemer['key']]);
            }

            $insert->execute([
                $tournamentId, $rondeNummer, $deelnemer['competitor_id'],
                json_encode($deelnemer['times']), $deelnemer['average'], $deelnemer['best'],
                $positie, $gaatDoor ? 1 : 0, $deelnemer['cut'] ? 1 : 0,
            ]);
        }

        Database::run(
            "UPDATE tournament_rounds SET status = 'done', finished_at = UTC_TIMESTAMP()
             WHERE tournament_id = ? AND round_number = ?",
            [$tournamentId, $rondeNummer]
        );

        if ($eigenDoor && $volgende !== null) {
            self::createWcaRound($tournamentId, $rondeNummer + 1, $rondes);
            Database::run('UPDATE tournaments SET current_round = ? WHERE id = ?', [$rondeNummer + 1, $tournamentId]);
            return;
        }

        self::finish($tournamentId, $userId, $eigenPositie, $rondeNummer);
    }

    /** Hoe we een echte cuber herkennen tussen de rondes: zijn WCA-id, anders zijn naam. */
    private static function wcaKey(?string $wcaId, string $naam): string
    {
        return $wcaId !== null && $wcaId !== '' ? 'id:' . $wcaId : 'naam:' . $naam;
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
        $isWca = ($toernooi['source'] ?? 'sim') === 'wca';
        $momentopname = $isWca ? json_decode((string) $toernooi['wca_snapshot'], true) : null;

        $uit = [
            'id'              => (int) $toernooi['id'],
            'event'           => $event,
            'eventLabel'      => Events::label($event),
            'difficulty'      => $moeilijkheid,
            'difficultyLabel' => self::typeLabel($moeilijkheid),
            'source'          => $isWca ? 'wca' : 'sim',
            'competition'     => $isWca && is_array($momentopname['competition'] ?? null) ? [
                'id'          => $momentopname['competition']['id'],
                'name'        => $momentopname['competition']['name'],
                'city'        => $momentopname['competition']['city'],
                'country'     => $momentopname['competition']['country'],
                'startDate'   => $momentopname['competition']['startDate'],
                'attribution' => Wca::attribution(substr((string) $momentopname['competition']['fetchedAt'], 0, 10)),
            ] : null,
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
            $format = (string) ($ronde['format'] ?? 'a');
            // De echte scramble van deze poging, als de WCA die kent.
            $scrambles = $momentopname['rounds'][(int) $ronde['round_number'] - 1]['scrambles'] ?? null;
            $uit['round'] = [
                'number'       => (int) $ronde['round_number'],
                'name'         => self::rondeNaam((string) $ronde['name']),
                'entrants'     => (int) $ronde['entrants'],
                'advancing'    => (int) $ronde['advancing'],
                'format'       => $format,
                'formatLabel'  => Ranking::label($format),
                'cutoffMs'     => $ronde['cutoff_ms'] === null ? null : (int) $ronde['cutoff_ms'],
                'cutoffAttempts' => (int) ($ronde['cutoff_attempts'] ?? self::CUTOFF_ATTEMPTS),
                'timeLimitMs'  => $ronde['time_limit_ms'] === null ? null : (int) $ronde['time_limit_ms'],
                'limitCumulative' => self::isCumulative($ronde),
                'limitUsedMs'  => self::isCumulative($ronde) ? self::cumulativeUsed($solves) : null,
                'scramble'     => is_array($scrambles) ? ($scrambles[count($solves)] ?? null) : null,
                'attemptsDone' => count($solves),
                'attemptsTotal' => self::attemptsOf($ronde),
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

        $wcaKolom = self::hasWcaColumns() ? ', c.wca_id' : '';
        $uitslagen = Database::all(
            'SELECT r.*, c.name, c.kind, c.country_code' . $wcaKolom . '
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
                'name'     => $rij['competitor_id'] === null ? Taal::t('Jij') : (string) $rij['name'],
                'kind'     => $rij['competitor_id'] === null ? 'player' : (string) $rij['kind'],
                'country'  => $rij['country_code'],
                'wcaId'    => $rij['wca_id'] ?? null,
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
                'name'        => self::rondeNaam((string) $ronde['name']),
                'entrants'    => (int) $ronde['entrants'],
                'advancing'   => (int) $ronde['advancing'],
                'format'      => (string) ($ronde['format'] ?? 'a'),
                'formatLabel' => Ranking::label((string) ($ronde['format'] ?? 'a')),
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
        $wcaKolom = self::hasWcaColumns() ? ', wca_name' : '';
        $rows = Database::all(
            "SELECT id, event, difficulty, status, field_size, final_position, final_ao5_ms, finished_at{$wcaKolom}
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
                'difficultyLabel' => self::typeLabel($moeilijkheid),
                'competitionName' => $row['wca_name'] ?? null,
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

        // Per soort toernooi: een derde plek op WK-niveau is iets anders dan
        // een derde plek bij de beginners.
        $perSoort = Database::all(
            "SELECT
                difficulty,
                COUNT(*) AS gespeeld,
                SUM(CASE WHEN final_position = 1 THEN 1 ELSE 0 END) AS gewonnen,
                SUM(CASE WHEN final_position <= 3 THEN 1 ELSE 0 END) AS podiums,
                MIN(final_position) AS beste
             FROM tournaments
             WHERE user_id = ? AND status = 'finished'
             GROUP BY difficulty",
            [$userId]
        );
        $volgorde = array_merge(array_keys(self::DIFFICULTIES), [self::WCA_TYPE]);
        $plaats = static fn (string $soort): int => ($i = array_search($soort, $volgorde, true)) === false ? 99 : $i;
        usort($perSoort, static fn (array $a, array $b): int =>
            $plaats((string) $a['difficulty']) <=> $plaats((string) $b['difficulty']));
        $soorten = array_map(static fn (array $rij): array => [
            'type'         => (string) $rij['difficulty'],
            'label'        => self::typeLabel((string) $rij['difficulty']),
            'played'       => (int) $rij['gespeeld'],
            'won'          => (int) $rij['gewonnen'],
            'podiums'      => (int) $rij['podiums'],
            'bestPosition' => $rij['beste'] === null ? null : (int) $rij['beste'],
        ], $perSoort);

        // Bij historische comps is elke comp (en elk event) een eigen toernooi.
        $comps = [];
        if (self::hasWcaColumns()) {
            $comps = array_map(static fn (array $rij): array => [
                'competitionId' => $rij['wca_competition_id'],
                'name'          => $rij['wca_name'],
                'event'         => $rij['event'],
                'eventLabel'    => Events::label((string) $rij['event']),
                'played'        => (int) $rij['gespeeld'],
                'bestPosition'  => $rij['beste'] === null ? null : (int) $rij['beste'],
                'fieldSize'     => (int) $rij['veld'],
            ], Database::all(
                "SELECT wca_competition_id, MAX(wca_name) AS wca_name, event, COUNT(*) AS gespeeld,
                        MIN(final_position) AS beste, MAX(field_size) AS veld
                 FROM tournaments
                 WHERE user_id = ? AND status = 'finished' AND source = 'wca'
                 GROUP BY wca_competition_id, event
                 ORDER BY MAX(finished_at) DESC
                 LIMIT 30",
                [$userId]
            ));
        }

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
            'perType'      => $soorten,
            'competitions' => $comps,
            'events'       => array_values($perEvent),
        ];
    }

    /** Staan de kolommen van migratie 009 er al? Eén keer per verzoek nagevraagd. */
    private static function hasWcaColumns(): bool
    {
        static $aanwezig = null;
        return $aanwezig ??= Database::hasColumn('tournaments', 'wca_name');
    }

    /** De moeilijkheidsgraden voor het keuzescherm. */
    public static function difficulties(): array
    {
        $uit = [];
        foreach (self::DIFFICULTIES as $sleutel => $instelling) {
            $uit[] = [
                'id'          => $sleutel,
                'label'       => Taal::t($instelling['label']),
                'description' => Taal::t($instelling['description']),
                'fieldSize'   => $instelling['field'],
                'referenceMs' => $instelling['reference'],
            ];
        }
        return $uit;
    }
}
