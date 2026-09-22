<?php
declare(strict_types=1);

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Events.php';
require_once __DIR__ . '/SiteTime.php';
require_once __DIR__ . '/Xp.php';
require_once __DIR__ . '/Follows.php';

/**
 * Achievements.
 *
 * De catalogus staat hier in code en niet in de database: het zijn er bijna
 * honderd, de drempel en de controle horen bij elkaar, en zo komt er geen
 * migratie aan te pas als er eentje bij komt.
 *
 * Opbouw:
 *   - Families met vier niveaus (brons, zilver, goud, platina). Iedere familie
 *     hangt aan een cijfer uit `metrics` en heeft per niveau een drempel.
 *   - Geheime achievements, die pas in de lijst verschijnen als je ze haalt.
 *
 * `direction` bepaalt hoe je de drempel haalt:
 *   atLeast  meer is beter (aantal solves, dagen op rij)
 *   atMost   minder is beter (een tijd, een positie op de ranglijst)
 */
final class Achievements
{
    public const TIERS = ['brons', 'zilver', 'goud', 'platina'];

    /** @var array<string,int> XP per niveau */
    public const TIER_XP = [
        'brons'   => 50,
        'zilver'  => 150,
        'goud'    => 400,
        'platina' => 1000,
        'geheim'  => 250,
    ];

    /** @var array<string,string> */
    public const CATEGORIES = [
        'mijlpalen'  => 'Mijlpalen',
        'ontdekken'  => 'Ontdekken',
        'snelheid'   => 'Snelheid',
        'volhouden'  => 'Volhouden',
        'wedstrijd'  => 'Challenges en ranglijst',
        'pech'       => 'Pech',
        'toernooi'   => 'Toernooien',
        'sociaal'    => 'Sociaal',
        'geheim'     => 'Geheim',
    ];

    /**
     * De families. `format` bepaalt hoe een drempel getoond wordt:
     * number, time (ms), of days.
     *
     * @return array<string,array<string,mixed>>
     */
    public static function families(): array
    {
        return [
            /* ---------------------------------------------------- Mijlpalen */
            'solves' => [
                'category' => 'mijlpalen', 'metric' => 'validSolves',
                'title' => 'Vlieguren', 'unit' => 'solves', 'unitOne' => 'solve', 'format' => 'number',
                'description' => 'Aantal solves dat je hebt afgerond.',
                'tiers' => ['brons' => 100, 'zilver' => 1000, 'goud' => 5000, 'platina' => 25000],
            ],
            'dagen' => [
                'category' => 'mijlpalen', 'metric' => 'activeDays',
                'title' => 'Trouwe klant', 'unit' => 'dagen', 'unitOne' => 'dag', 'format' => 'number',
                'description' => 'Aantal dagen waarop je hebt getimed.',
                'tiers' => ['brons' => 7, 'zilver' => 30, 'goud' => 100, 'platina' => 365],
            ],
            'sessies' => [
                'category' => 'mijlpalen', 'metric' => 'sessionCount',
                'title' => 'Opgeruimd', 'unit' => 'sessies', 'unitOne' => 'sessie', 'format' => 'number',
                'description' => 'Aantal sessies dat je hebt aangemaakt.',
                'tiers' => ['brons' => 3, 'zilver' => 10, 'goud' => 25, 'platina' => 50],
            ],
            'records' => [
                'category' => 'mijlpalen', 'metric' => 'pbCount',
                'title' => 'Recordjager', 'unit' => 'records', 'unitOne' => 'record', 'format' => 'number',
                'description' => 'Hoe vaak je je eigen record hebt verbroken.',
                'tiers' => ['brons' => 10, 'zilver' => 50, 'goud' => 200, 'platina' => 500],
            ],
            'xp' => [
                'category' => 'mijlpalen', 'metric' => 'totalXp',
                'title' => 'Ervaren', 'unit' => 'XP', 'format' => 'number',
                'description' => 'Hoeveel XP je bij elkaar hebt verdiend.',
                'tiers' => ['brons' => 1000, 'zilver' => 10000, 'goud' => 50000, 'platina' => 200000],
            ],

            /* ---------------------------------------------------- Ontdekken */
            'events' => [
                'category' => 'ontdekken', 'metric' => 'eventsTried',
                'title' => 'Nieuwsgierig', 'unit' => 'events', 'unitOne' => 'event', 'format' => 'number',
                'description' => 'Aantal verschillende events waarop je hebt getimed.',
                'tiers' => ['brons' => 3, 'zilver' => 6, 'goud' => 10, 'platina' => 17],
            ],
            'alleskunner' => [
                'category' => 'ontdekken', 'metric' => 'eventsSolved',
                'title' => 'Alleskunner', 'unit' => 'events', 'unitOne' => 'event', 'format' => 'number',
                'description' => 'Aantal events waarop je een geldige tijd hebt neergezet. Platina betekent: alles opgelost.',
                'tiers' => ['brons' => 3, 'zilver' => 6, 'goud' => 10, 'platina' => 17],
            ],

            /* ----------------------------------------------------- Snelheid */
            'sub333' => [
                'category' => 'snelheid', 'metric' => 'best333', 'direction' => 'atMost',
                'title' => 'Sub-X op 3x3', 'format' => 'time',
                'description' => 'Je snelste 3x3-solve.',
                'tiers' => ['brons' => 60000, 'zilver' => 30000, 'goud' => 20000, 'platina' => 10000],
            ],
            'sub333ao12' => [
                'category' => 'snelheid', 'metric' => 'bestAo12_333', 'direction' => 'atMost',
                'title' => 'Constant op 3x3', 'format' => 'time',
                'description' => 'Je beste Ao12 op 3x3. Veel zwaarder dan een enkele gelukstijd.',
                'tiers' => ['brons' => 60000, 'zilver' => 30000, 'goud' => 20000, 'platina' => 12000],
            ],
            'sub222' => [
                'category' => 'snelheid', 'metric' => 'best222', 'direction' => 'atMost',
                'title' => 'Klein en snel', 'format' => 'time',
                'description' => 'Je snelste 2x2-solve.',
                'tiers' => ['brons' => 20000, 'zilver' => 10000, 'goud' => 5000, 'platina' => 3000],
            ],
            'sub444' => [
                'category' => 'snelheid', 'metric' => 'best444', 'direction' => 'atMost',
                'title' => 'Groot en snel', 'format' => 'time',
                'description' => 'Je snelste 4x4-solve.',
                'tiers' => ['brons' => 180000, 'zilver' => 120000, 'goud' => 80000, 'platina' => 60000],
            ],
            'sub555' => [
                'category' => 'snelheid', 'metric' => 'best555', 'direction' => 'atMost',
                'title' => 'Nog groter', 'format' => 'time',
                'description' => 'Je snelste 5x5-solve.',
                'tiers' => ['brons' => 300000, 'zilver' => 210000, 'goud' => 150000, 'platina' => 110000],
            ],
            'subpyram' => [
                'category' => 'snelheid', 'metric' => 'bestPyram', 'direction' => 'atMost',
                'title' => 'Driehoek', 'format' => 'time',
                'description' => 'Je snelste Pyraminx-solve.',
                'tiers' => ['brons' => 30000, 'zilver' => 15000, 'goud' => 8000, 'platina' => 5000],
            ],

            /* ---------------------------------------------------- Volhouden */
            'reeks' => [
                'category' => 'volhouden', 'metric' => 'longestStreak',
                'title' => 'Elke dag', 'unit' => 'dagen op rij', 'unitOne' => 'dag op rij', 'format' => 'number',
                'description' => 'Je langste reeks dagen achter elkaar met minstens een solve.',
                'tiers' => ['brons' => 3, 'zilver' => 7, 'goud' => 30, 'platina' => 100],
            ],
            'marathon' => [
                'category' => 'volhouden', 'metric' => 'maxSolvesOneDay',
                'title' => 'Marathon', 'unit' => 'solves op een dag', 'unitOne' => 'solve op een dag', 'format' => 'number',
                'description' => 'Je drukste dag ooit.',
                'tiers' => ['brons' => 50, 'zilver' => 100, 'goud' => 250, 'platina' => 500],
            ],
            'bluetooth' => [
                'category' => 'volhouden', 'metric' => 'bluetoothSolves',
                'title' => 'Verbonden', 'unit' => 'smart-cube solves', 'unitOne' => 'smart-cube solve', 'format' => 'number',
                'description' => 'Solves die via een Bluetooth-cube binnenkwamen.',
                'tiers' => ['brons' => 10, 'zilver' => 100, 'goud' => 1000, 'platina' => 5000],
            ],

            /* ---------------------------------------------------- Wedstrijd */
            'challenges' => [
                'category' => 'wedstrijd', 'metric' => 'challengesCompleted',
                'title' => 'Dagelijkse kost', 'unit' => 'challenges', 'unitOne' => 'challenge', 'format' => 'number',
                'description' => 'Aantal daily challenges dat je hebt gehaald.',
                'tiers' => ['brons' => 5, 'zilver' => 25, 'goud' => 100, 'platina' => 365],
            ],
            'ranglijst' => [
                'category' => 'wedstrijd', 'metric' => 'bestBoardRank', 'direction' => 'atMost',
                'title' => 'Op de kaart', 'format' => 'rank',
                'description' => 'Je beste positie op een van de ranglijsten.',
                'tiers' => ['brons' => 100, 'zilver' => 25, 'goud' => 10, 'platina' => 1],
            ],
            'scramblewins' => [
                'category' => 'wedstrijd', 'metric' => 'scrambleWins',
                'title' => 'Scramblekoning', 'unit' => 'keer gewonnen', 'format' => 'number',
                'description' => 'Hoe vaak je de scramble van de dag hebt gewonnen.',
                'tiers' => ['brons' => 1, 'zilver' => 5, 'goud' => 25, 'platina' => 100],
            ],

            /* ---------------------------------------------------- Toernooien */
            'toernooien' => [
                'category' => 'toernooi', 'metric' => 'tournamentsPlayed',
                'title' => 'Wedstrijdbeest', 'unit' => 'toernooien', 'unitOne' => 'toernooi', 'format' => 'number',
                'description' => 'Aantal toernooien dat je hebt uitgespeeld.',
                'tiers' => ['brons' => 1, 'zilver' => 10, 'goud' => 50, 'platina' => 200],
            ],
            'toernooiwinst' => [
                'category' => 'toernooi', 'metric' => 'tournamentsWon',
                'title' => 'Kampioen', 'unit' => 'overwinningen', 'unitOne' => 'overwinning', 'format' => 'number',
                'description' => 'Hoe vaak je een toernooi hebt gewonnen.',
                'tiers' => ['brons' => 1, 'zilver' => 5, 'goud' => 25, 'platina' => 100],
            ],
            'toernooipodium' => [
                'category' => 'toernooi', 'metric' => 'tournamentPodiums',
                'title' => 'Op het podium', 'unit' => 'podiumplekken', 'unitOne' => 'podiumplek', 'format' => 'number',
                'description' => 'Hoe vaak je bij de beste drie eindigde.',
                'tiers' => ['brons' => 1, 'zilver' => 10, 'goud' => 50, 'platina' => 200],
            ],

            /* -------------------------------------------------------- Sociaal */
            'vrienden' => [
                'category' => 'sociaal', 'metric' => 'friendCount',
                'title' => 'Onder de mensen', 'unit' => 'vrienden', 'unitOne' => 'vriend', 'format' => 'number',
                'description' => 'Cubers die jou volgen terwijl jij hen ook volgt.',
                'tiers' => ['brons' => 1, 'zilver' => 5, 'goud' => 25, 'platina' => 100],
            ],

            /* --------------------------------------------------------- Pech */
            'plus2' => [
                'category' => 'pech', 'metric' => 'plus2Count',
                'title' => 'Twee erbij', 'unit' => "+2's", 'format' => 'number',
                'description' => 'Je hoeft er niet trots op te zijn, maar ze tellen wel.',
                'tiers' => ['brons' => 10, 'zilver' => 50, 'goud' => 250, 'platina' => 1000],
            ],
            'dnf' => [
                'category' => 'pech', 'metric' => 'dnfCount',
                'title' => 'Niet gelukt', 'unit' => "DNF's", 'format' => 'number',
                'description' => 'Wie niet af en toe een DNF heeft, probeert niet hard genoeg.',
                'tiers' => ['brons' => 10, 'zilver' => 50, 'goud' => 250, 'platina' => 1000],
            ],
        ];
    }

    /**
     * De geheime achievements. Ze staan pas in de lijst als je ze hebt.
     *
     * @return array<string,array<string,mixed>>
     */
    public static function secrets(): array
    {
        return [
            'eerste' => [
                'title' => 'Het begin', 'metric' => 'validSolves', 'threshold' => 1,
                'description' => 'Je allereerste afgeronde solve.',
            ],
            'middernacht' => [
                'title' => 'Klokslag twaalf', 'metric' => 'midnightSolve',
                'description' => 'Een solve in de eerste vijf minuten van een nieuwe dag.',
            ],
            'vroegevogel' => [
                'title' => 'Vroege vogel', 'metric' => 'earlyBirdSolve',
                'description' => 'Een solve tussen vijf en zes uur \'s ochtends.',
            ],
            'nachtbraker' => [
                'title' => 'Nachtbraker', 'metric' => 'nightOwlSolves', 'threshold' => 50,
                'description' => 'Vijftig solves tussen twee en vijf uur \'s nachts.',
            ],
            'palindroom' => [
                'title' => 'Heen en terug', 'metric' => 'palindromeTime',
                'description' => 'Een tijd die achterstevoren hetzelfde leest.',
            ],
            'repdigit' => [
                'title' => 'Allemaal hetzelfde', 'metric' => 'repdigitTime',
                'description' => 'Een tijd waarin elk cijfer gelijk is, zoals 11,111.',
            ],
            'rond' => [
                'title' => 'Precies rond', 'metric' => 'exactSecondTime',
                'description' => 'Een tijd op precies een hele seconde, tot op de milliseconde.',
            ],
            'pi' => [
                'title' => 'Taartpunt', 'metric' => 'piTime',
                'description' => 'Een tijd die begint met 3,14.',
            ],
            'leet' => [
                'title' => 'Dertien zevenendertig', 'metric' => 'leetTime',
                'description' => 'Een solve van 13,37 seconden.',
            ],
            'pechreeks' => [
                'title' => 'Even niet', 'metric' => 'longestDnfRun', 'threshold' => 5,
                'description' => "Vijf DNF's achter elkaar. Het gebeurt de beste.",
            ],
            'wederopstanding' => [
                'title' => 'Wederopstanding', 'metric' => 'comebackPb',
                'description' => 'Een persoonlijk record direct na een DNF.',
            ],
            'wkwinst' => [
                'title' => 'Wereldkampioen', 'metric' => 'wonAtWorldLevel',
                'description' => 'Een toernooi op WK-niveau gewonnen.',
            ],
            'openwinst' => [
                'title' => 'Groot veld', 'metric' => 'wonOpenTournament',
                'description' => 'Een open toernooi van vierenzestig deelnemers gewonnen.',
            ],
            'vlekkeloos' => [
                'title' => 'Vlekkeloos', 'metric' => 'flawlessDay',
                'description' => "Vijfentwintig solves op een dag zonder een enkele DNF.",
            ],
        ];
    }

    /* =====================================================================
     * Cijfers verzamelen
     * ================================================================== */

    /**
     * Alles waar de achievements tegenaan gehouden worden. `$facts` komt uit
     * SolveFacts (een doorloop over de solves), de rest uit een handvol
     * queries.
     *
     * @param array<string,mixed> $facts
     * @param array<string,mixed> $rebuild uitkomst van Records::rebuild()
     * @return array<string,mixed>
     */
    public static function buildMetrics(int $userId, array $facts, array $rebuild): array
    {
        $metrics = $facts;

        $metrics['activeDays'] = count($rebuild['activeDays'] ?? []);
        $metrics['pbCount'] = count($rebuild['improvements'] ?? []);

        $profiel = Database::first(
            'SELECT xp, longest_streak FROM user_profiles WHERE user_id = ?',
            [$userId]
        );
        $metrics['totalXp'] = (int) ($profiel['xp'] ?? 0);
        $metrics['longestStreak'] = (int) ($profiel['longest_streak'] ?? 0);

        $sessies = Database::first(
            'SELECT COUNT(*) AS aantal FROM timer_sessions WHERE user_id = ?',
            [$userId]
        );
        $metrics['sessionCount'] = (int) ($sessies['aantal'] ?? 0);

        $challenges = Database::first(
            'SELECT COUNT(*) AS aantal FROM challenge_entries
             WHERE user_id = ? AND completed_at IS NOT NULL',
            [$userId]
        );
        $metrics['challengesCompleted'] = (int) ($challenges['aantal'] ?? 0);

        $metrics['scrambleWins'] = self::scrambleWins($userId);
        foreach (self::tournamentMetrics($userId) as $sleutel => $waarde) {
            $metrics[$sleutel] = $waarde;
        }
        $metrics['friendCount'] = Follows::countFriends($userId);
        $metrics['bestBoardRank'] = self::bestBoardRank($userId);

        // De records die de snelheidsfamilies nodig hebben.
        foreach (self::personalBests($userId) as $sleutel => $waarde) {
            $metrics[$sleutel] = $waarde;
        }

        return $metrics;
    }

    /**
     * De toernooicijfers. Staan in een aparte tabel, dus een eigen query.
     *
     * @return array<string,int|bool>
     */
    private static function tournamentMetrics(int $userId): array
    {
        if (!Database::hasTable('tournaments')) {
            return ['tournamentsPlayed' => 0, 'tournamentsWon' => 0, 'tournamentPodiums' => 0,
                    'wonAtWorldLevel' => false, 'wonOpenTournament' => false];
        }

        $row = Database::first(
            "SELECT
                COUNT(*) AS gespeeld,
                SUM(CASE WHEN final_position = 1 THEN 1 ELSE 0 END) AS gewonnen,
                SUM(CASE WHEN final_position <= 3 THEN 1 ELSE 0 END) AS podiums,
                SUM(CASE WHEN final_position = 1 AND difficulty = 'wk' THEN 1 ELSE 0 END) AS wk,
                SUM(CASE WHEN final_position = 1 AND difficulty = 'open' THEN 1 ELSE 0 END) AS open_gewonnen
             FROM tournaments
             WHERE user_id = ? AND status = 'finished'",
            [$userId]
        );

        return [
            'tournamentsPlayed'  => (int) ($row['gespeeld'] ?? 0),
            'tournamentsWon'     => (int) ($row['gewonnen'] ?? 0),
            'tournamentPodiums'  => (int) ($row['podiums'] ?? 0),
            'wonAtWorldLevel'    => (int) ($row['wk'] ?? 0) > 0,
            'wonOpenTournament'  => (int) ($row['open_gewonnen'] ?? 0) > 0,
        ];
    }

    /** Hoe vaak deze gebruiker de snelste was op een scramble van de dag. */
    private static function scrambleWins(int $userId): int
    {
        $row = Database::first(
            'SELECT COUNT(*) AS aantal
             FROM challenge_entries e
             JOIN daily_challenges c ON c.id = e.challenge_id
             WHERE e.user_id = ? AND e.value_ms IS NOT NULL
               AND c.type = "scramble_of_the_day"
               AND e.value_ms = (
                   SELECT MIN(e2.value_ms) FROM challenge_entries e2
                   WHERE e2.challenge_id = e.challenge_id AND e2.value_ms IS NOT NULL
               )',
            [$userId]
        );
        return (int) ($row['aantal'] ?? 0);
    }

    /**
     * De beste positie die deze gebruiker op een van de all-time ranglijsten
     * heeft. Null als hij nog nergens op staat.
     */
    private static function bestBoardRank(int $userId): ?int
    {
        $row = Database::first(
            "SELECT MIN(rang) AS beste FROM (
                SELECT (
                    SELECT COUNT(*) FROM user_records r2
                    JOIN users u2 ON u2.id = r2.user_id
                    JOIN user_profiles p2 ON p2.user_id = r2.user_id
                    WHERE r2.event = r.event AND r2.category = r.category
                      AND r2.period = 'all' AND r2.period_start IS NULL
                      AND u2.is_active = 1 AND p2.show_on_leaderboard = 1
                      AND r2.value_ms < r.value_ms
                ) + 1 AS rang
                FROM user_records r
                WHERE r.user_id = ? AND r.period = 'all' AND r.category <> 'worst_single'
            ) AS posities",
            [$userId]
        );
        $beste = $row['beste'] ?? null;
        return $beste === null ? null : (int) $beste;
    }

    /** @return array<string,int|null> */
    private static function personalBests(int $userId): array
    {
        $rows = Database::all(
            "SELECT event, category, value_ms FROM user_records
             WHERE user_id = ? AND period = 'all'
               AND category IN ('single', 'ao12')",
            [$userId]
        );

        $out = [
            'best333' => null, 'best222' => null, 'best444' => null,
            'best555' => null, 'bestPyram' => null, 'bestAo12_333' => null,
        ];
        $singles = ['333' => 'best333', '222' => 'best222', '444' => 'best444',
                    '555' => 'best555', 'pyram' => 'bestPyram'];

        foreach ($rows as $row) {
            $event = (string) $row['event'];
            $category = (string) $row['category'];
            $waarde = (int) $row['value_ms'];

            if ($category === 'single' && isset($singles[$event])) {
                $out[$singles[$event]] = $waarde;
            }
            if ($category === 'ao12' && $event === '333') {
                $out['bestAo12_333'] = $waarde;
            }
        }
        return $out;
    }

    /* =====================================================================
     * Ontgrendelen
     * ================================================================== */

    /**
     * Kijkt welke achievements gehaald zijn en schrijft de nieuwe weg.
     * Niveaus zijn cumulatief: wie meteen goud haalt, krijgt brons en zilver
     * er ook bij.
     *
     * @param array<string,mixed> $metrics
     * @return list<array{key:string,title:string,tier:string,xp:int}> wat er nieuw bij kwam
     */
    public static function evaluate(int $userId, array $metrics): array
    {
        $behaald = self::unlockedKeys($userId);
        $nieuw = [];
        $nu = gmdate('Y-m-d H:i:s');

        foreach (self::families() as $familie => $definitie) {
            $waarde = $metrics[$definitie['metric']] ?? null;
            if ($waarde === null) {
                continue;
            }
            $omlaag = ($definitie['direction'] ?? 'atLeast') === 'atMost';

            foreach ($definitie['tiers'] as $tier => $drempel) {
                $gehaald = $omlaag ? $waarde <= $drempel : $waarde >= $drempel;
                if (!$gehaald) {
                    continue;
                }
                $sleutel = $familie . '.' . $tier;
                if (isset($behaald[$sleutel])) {
                    continue;
                }
                $nieuw[] = [
                    'key'   => $sleutel,
                    'title' => $definitie['title'] . ' · ' . ucfirst($tier),
                    'tier'  => $tier,
                    'xp'    => self::TIER_XP[$tier],
                ];
            }
        }

        foreach (self::secrets() as $naam => $definitie) {
            $sleutel = 'geheim.' . $naam;
            if (isset($behaald[$sleutel])) {
                continue;
            }
            $waarde = $metrics[$definitie['metric']] ?? null;
            $drempel = $definitie['threshold'] ?? null;

            $gehaald = $drempel === null
                ? $waarde === true
                : (is_numeric($waarde) && $waarde >= $drempel);

            if ($gehaald) {
                $nieuw[] = [
                    'key'   => $sleutel,
                    'title' => $definitie['title'],
                    'tier'  => 'geheim',
                    'xp'    => self::TIER_XP['geheim'],
                ];
            }
        }

        foreach ($nieuw as $achievement) {
            try {
                Database::run(
                    'INSERT INTO user_achievements (user_id, achievement_key, tier, xp_awarded, unlocked_at)
                     VALUES (?, ?, ?, ?, ?)',
                    [$userId, $achievement['key'], $achievement['tier'], $achievement['xp'], $nu]
                );
                Xp::award($userId, 'achievement', $achievement['key'], $achievement['xp'],
                    'Achievement: ' . $achievement['title']);
            } catch (PDOException $e) {
                if (!str_contains($e->getMessage(), 'Duplicate entry')) {
                    error_log('[cubetimer] achievement opslaan mislukt: ' . $e->getMessage());
                }
            }
        }

        return $nieuw;
    }

    /**
     * Wat een sleutel als 'solves.goud' voorstelt. Gebruikt op het openbare
     * profiel, waar we alleen de sleutels uit de database hebben.
     *
     * @return array{title:string,tier:string,category:string}|null
     */
    public static function describe(string $key): ?array
    {
        $punt = strrpos($key, '.');
        if ($punt === false) {
            return null;
        }
        $familie = substr($key, 0, $punt);
        $tier = substr($key, $punt + 1);

        if ($familie === 'geheim') {
            $geheim = self::secrets()[$tier] ?? null;
            return $geheim === null ? null : [
                'title' => $geheim['title'], 'tier' => 'geheim', 'category' => 'geheim',
            ];
        }

        $definitie = self::families()[$familie] ?? null;
        if ($definitie === null || !isset($definitie['tiers'][$tier])) {
            return null;
        }
        return [
            'title'    => $definitie['title'] . ' · ' . ucfirst($tier),
            'tier'     => $tier,
            'category' => $definitie['category'],
        ];
    }

    /** @return array<string,string> sleutel => moment van behalen */
    public static function unlockedKeys(int $userId): array
    {
        $rows = Database::all(
            'SELECT achievement_key, unlocked_at FROM user_achievements WHERE user_id = ?',
            [$userId]
        );
        $out = [];
        foreach ($rows as $row) {
            $out[(string) $row['achievement_key']] = (string) $row['unlocked_at'];
        }
        return $out;
    }

    /* =====================================================================
     * De lijst voor de interface
     * ================================================================== */

    /**
     * De hele catalogus met, als er een gebruiker is, de stand erbij.
     *
     * @param array<string,mixed>|null $metrics laat leeg om alleen de catalogus te krijgen
     * @return array<string,mixed>
     */
    public static function listFor(?int $userId, ?array $metrics = null): array
    {
        $behaald = $userId === null ? [] : self::unlockedKeys($userId);
        $zeldzaamheid = self::rarity();

        $categorieen = [];
        foreach (self::CATEGORIES as $slug => $naam) {
            $categorieen[$slug] = ['slug' => $slug, 'name' => $naam, 'items' => []];
        }

        foreach (self::families() as $familie => $definitie) {
            $waarde = $metrics[$definitie['metric']] ?? null;
            $omlaag = ($definitie['direction'] ?? 'atLeast') === 'atMost';

            $niveaus = [];
            $volgende = null;

            foreach ($definitie['tiers'] as $tier => $drempel) {
                $sleutel = $familie . '.' . $tier;
                $isBehaald = isset($behaald[$sleutel]);

                if (!$isBehaald && $volgende === null) {
                    $volgende = [
                        'tier'      => $tier,
                        'threshold' => $drempel,
                        'label'     => self::formatThreshold($definitie, $drempel),
                        'progress'  => self::progress($waarde, $drempel, $omlaag),
                    ];
                }

                $niveaus[] = [
                    'tier'       => $tier,
                    'key'        => $sleutel,
                    'threshold'  => $drempel,
                    'label'      => self::formatThreshold($definitie, $drempel),
                    'xp'         => self::TIER_XP[$tier],
                    'unlocked'   => $isBehaald,
                    'unlockedAt' => $isBehaald ? str_replace(' ', 'T', $behaald[$sleutel]) . 'Z' : null,
                    'rarity'     => $zeldzaamheid[$sleutel] ?? 0,
                ];
            }

            $categorieen[$definitie['category']]['items'][] = [
                'key'         => $familie,
                'title'       => $definitie['title'],
                'description' => $definitie['description'],
                'format'      => $definitie['format'],
                'value'       => $waarde,
                'valueLabel'  => $waarde === null ? null : self::formatValue($definitie, $waarde),
                'tiers'       => $niveaus,
                'next'        => $volgende,
                'unlockedCount' => count(array_filter($niveaus, static fn ($n) => $n['unlocked'])),
            ];
        }

        // Geheime achievements: alleen tonen wat je hebt, de rest als aantal.
        $geheimBehaald = [];
        foreach (self::secrets() as $naam => $definitie) {
            $sleutel = 'geheim.' . $naam;
            if (!isset($behaald[$sleutel])) {
                continue;
            }
            $geheimBehaald[] = [
                'key'         => $sleutel,
                'title'       => $definitie['title'],
                'description' => $definitie['description'],
                'xp'          => self::TIER_XP['geheim'],
                'unlockedAt'  => str_replace(' ', 'T', $behaald[$sleutel]) . 'Z',
                'rarity'      => $zeldzaamheid[$sleutel] ?? 0,
            ];
        }

        $categorieen['geheim']['items'] = $geheimBehaald;
        $categorieen['geheim']['hidden'] = count(self::secrets()) - count($geheimBehaald);

        $totaal = count(self::families()) * count(self::TIERS) + count(self::secrets());

        return [
            'categories' => array_values($categorieen),
            'total'      => $totaal,
            'unlocked'   => count($behaald),
            'xpFromAchievements' => array_sum(array_map(
                static fn (string $sleutel): int => str_starts_with($sleutel, 'geheim.')
                    ? self::TIER_XP['geheim']
                    : (self::TIER_XP[substr($sleutel, strrpos($sleutel, '.') + 1)] ?? 0),
                array_keys($behaald)
            )),
        ];
    }

    /**
     * Hoeveel procent van de cubers heeft deze achievement? Geeft een idee
     * van hoe bijzonder hij is.
     *
     * @return array<string,int>
     */
    private static function rarity(): array
    {
        $totaal = Database::first(
            'SELECT COUNT(DISTINCT user_id) AS aantal FROM user_achievements'
        );
        $aantalGebruikers = max(1, (int) ($totaal['aantal'] ?? 0));

        $rows = Database::all(
            'SELECT achievement_key, COUNT(*) AS aantal FROM user_achievements GROUP BY achievement_key'
        );

        $out = [];
        foreach ($rows as $row) {
            $out[(string) $row['achievement_key']] = (int) round((int) $row['aantal'] / $aantalGebruikers * 100);
        }
        return $out;
    }

    /** Voortgang naar een drempel toe, als getal tussen 0 en 1. */
    private static function progress(mixed $waarde, int $drempel, bool $omlaag): float
    {
        if ($waarde === null || !is_numeric($waarde)) {
            return 0.0;
        }
        $waarde = (float) $waarde;

        if (!$omlaag) {
            return $drempel <= 0 ? 1.0 : min(1.0, $waarde / $drempel);
        }
        // Minder is beter: hoe dichter je bij de drempel zit, hoe verder je bent.
        return $waarde <= 0 ? 0.0 : min(1.0, $drempel / $waarde);
    }

    /** @param array<string,mixed> $definitie */
    private static function formatThreshold(array $definitie, int $drempel): string
    {
        return match ($definitie['format']) {
            'time' => 'onder ' . self::formatMs($drempel),
            'rank' => $drempel === 1 ? 'nummer 1' : 'top ' . $drempel,
            default => number_format($drempel, 0, ',', '.') . ' ' . self::unit($definitie, (float) $drempel),
        };
    }

    /** @param array<string,mixed> $definitie */
    private static function formatValue(array $definitie, mixed $waarde): string
    {
        return match ($definitie['format']) {
            'time' => self::formatMs((int) $waarde),
            'rank' => '#' . (int) $waarde,
            default => number_format((float) $waarde, 0, ',', '.') . ' ' . self::unit($definitie, (float) $waarde),
        };
    }

    /** De eenheid, in enkelvoud als het er precies een is. */
    private static function unit(array $definitie, float $waarde): string
    {
        if ((int) $waarde === 1 && isset($definitie['unitOne'])) {
            return (string) $definitie['unitOne'];
        }
        return (string) ($definitie['unit'] ?? '');
    }

    private static function formatMs(int $ms): string
    {
        $minuten = intdiv($ms, 60000);
        $seconden = ($ms % 60000) / 1000;
        return $minuten > 0
            ? sprintf('%d:%05.2f', $minuten, $seconden)
            : rtrim(rtrim(number_format($seconden, 2, ',', ''), '0'), ',') . ' s';
    }
}
