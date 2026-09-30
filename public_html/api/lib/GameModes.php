<?php
declare(strict_types=1);

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Taal.php';
require_once __DIR__ . '/Events.php';
require_once __DIR__ . '/Ranking.php';

/**
 * Spelmodi: een andere manier van timen, met een eigen record per modus.
 *
 *   streak    Zet een doel (sub X). Hoe vaak haal je dat achter elkaar?
 *             De reeks stopt bij de eerste solve die er niet onder zit.
 *   survival  Je begint met een ruime limiet, en na elke geslaagde solve gaat
 *             er een vast stuk af. Hoe lang houd je het vol?
 *   ladder    Elke solve moet sneller zijn dan de vorige. Hoe hoog kom je?
 *   speedrun  Zoveel mogelijk cubes oplossen in vijf minuten. Je scrambelt ze
 *             allemaal van tevoren, want tussendoor scramblen kan niet.
 *
 * De browser speelt het spel (zo werkt het ook zonder internet), maar het
 * resultaat rekent de server zelf uit uit de ingestuurde solves. Een browser
 * kan dus niet zeggen "ik had er 40 op rij": hij stuurt 40 solves, en de
 * server telt na. Records staan op je account en op je profiel; er is bewust
 * geen ranglijst.
 *
 * Solves uit een spelmodus komen niet in je sessies: ze staan hier, bij de
 * ronde waar ze bij horen.
 *
 * Bij een gelijke score wint de laagste `tiebreak_ms`:
 *   streak, survival  het gemiddelde van de geslaagde solves
 *   ladder            de laatste (en dus snelste) trede
 *   speedrun          het moment waarop de laatste cube klaar was
 */
final class GameModes
{
    public const MODES = ['streak', 'survival', 'ladder', 'speedrun'];

    public const SPEEDRUN_MS = 300_000;
    public const SPEEDRUN_MIN_CUBES = 2;
    public const SPEEDRUN_MAX_CUBES = 12;

    private const MAX_SOLVES = 1000;
    private const MAX_SOLVE_MS = 3_600_000;
    /** Speling op de vijf minuten, voor een browser die net wat later tekent. */
    private const SPEEDRUN_GRACE_MS = 1_000;

    /** Hoeveel er per geslaagde solve van de survival-limiet af gaat: 0,5 s op 3x3. */
    public static function survivalStep(string $event): int
    {
        return max(100, (int) (round(500 * Events::speedFactor($event) / 100) * 100));
    }

    /** De limiet voor solve $index (vanaf 0) in survival. */
    public static function survivalLimit(int $start, int $index, string $event): int
    {
        $stap = self::survivalStep($event);
        return max($stap, $start - $index * $stap);
    }

    /* =====================================================================
     * Controleren en uitrekenen
     * ================================================================== */

    /**
     * Controleert een ingestuurde ronde en rekent de score uit.
     *
     * @param array<string,mixed> $input  `solves` (lijst van {ms, penalty}) of
     *                                    bij speedrun `laps` (ms vanaf de start)
     * @return array{ok:bool,message?:string,score?:int,tiebreak?:?int,details?:array<string,mixed>,variant?:int}
     */
    public static function evaluate(string $mode, string $event, int $variant, array $input): array
    {
        if (!in_array($mode, self::MODES, true)) {
            return ['ok' => false, 'message' => 'Die spelmodus bestaat niet.'];
        }
        if (!Events::isRanked($event)) {
            return ['ok' => false, 'message' => 'Op dit event kun je geen spelmodus spelen.'];
        }

        $variant = self::normaliseVariant($mode, $variant);
        if ($variant === null) {
            return ['ok' => false, 'message' => 'Die instelling past niet bij deze spelmodus.'];
        }

        if ($mode === 'speedrun') {
            return self::evaluateSpeedrun($event, $variant, $input['laps'] ?? null);
        }

        $solves = self::cleanSolves($event, $input['solves'] ?? null);
        if ($solves === null) {
            return ['ok' => false, 'message' => 'De solves van deze ronde kloppen niet.'];
        }

        $score = 0;
        $geslaagd = [];
        $vorige = null;

        foreach ($solves as $index => $solve) {
            $tijd = Ranking::effective($solve['ms'], $solve['penalty']);

            $gelukt = match ($mode) {
                'streak'   => $tijd !== null && $tijd < $variant,
                'survival' => $tijd !== null && $tijd <= self::survivalLimit($variant, $index, $event),
                'ladder'   => $tijd !== null && ($vorige === null || $tijd < $vorige),
            };

            if (!$gelukt) {
                // De ronde is hier voorbij; alles wat er nog achteraan komt telt niet.
                $solves = array_slice($solves, 0, $index + 1);
                break;
            }

            $score++;
            $geslaagd[] = $tijd;
            $vorige = $tijd;
        }

        $tiebreak = null;
        if ($geslaagd) {
            $tiebreak = $mode === 'ladder'
                ? (int) end($geslaagd)
                : (int) round(array_sum($geslaagd) / count($geslaagd));
        }

        return [
            'ok'       => true,
            'variant'  => $variant,
            'score'    => $score,
            'tiebreak' => $tiebreak,
            'details'  => ['solves' => $solves],
        ];
    }

    /** @return array<string,mixed> */
    private static function evaluateSpeedrun(string $event, int $cubes, mixed $laps): array
    {
        if (!is_array($laps) || count($laps) > $cubes) {
            return ['ok' => false, 'message' => 'De rondetijden van deze speedrun kloppen niet.'];
        }

        $ondergrens = Events::floorMs($event);
        $schoon = [];
        $vorige = 0;
        foreach (array_values($laps) as $lap) {
            if (!is_numeric($lap)) {
                return ['ok' => false, 'message' => 'De rondetijden van deze speedrun kloppen niet.'];
            }
            $lap = (int) round((float) $lap);
            // Elke cube kost minstens het wereldrecord, en de klok loopt maar één kant op.
            if ($lap - $vorige < $ondergrens || $lap > self::SPEEDRUN_MS + self::SPEEDRUN_GRACE_MS) {
                return ['ok' => false, 'message' => 'Deze speedrun is sneller dan kan.'];
            }
            $schoon[] = min($lap, self::SPEEDRUN_MS);
            $vorige = $lap;
        }

        return [
            'ok'       => true,
            'variant'  => $cubes,
            'score'    => count($schoon),
            'tiebreak' => $schoon ? (int) end($schoon) : null,
            'details'  => ['laps' => $schoon],
        ];
    }

    /** @return list<array{ms:?int,penalty:string}>|null */
    private static function cleanSolves(string $event, mixed $solves): ?array
    {
        if (!is_array($solves) || !$solves || count($solves) > self::MAX_SOLVES) {
            return null;
        }

        $ondergrens = Events::floorMs($event);
        $schoon = [];
        foreach (array_values($solves) as $solve) {
            if (!is_array($solve)) {
                return null;
            }
            $penalty = in_array($solve['penalty'] ?? 'none', ['none', 'plus2', 'dnf'], true)
                ? (string) ($solve['penalty'] ?? 'none') : 'none';
            $ms = $solve['ms'] ?? null;
            $ms = is_numeric($ms) ? (int) round((float) $ms) : null;

            if ($ms === null) {
                $penalty = 'dnf';
            } elseif ($ms <= 0 || $ms > self::MAX_SOLVE_MS) {
                return null;
            } elseif ($penalty !== 'dnf' && $ms < $ondergrens) {
                return null; // sneller dan het wereldrecord: geen record waard
            }
            $schoon[] = ['ms' => $ms, 'penalty' => $penalty];
        }
        return $schoon;
    }

    private static function normaliseVariant(string $mode, int $variant): ?int
    {
        return match ($mode) {
            'streak'   => $variant >= 1_000 && $variant <= self::MAX_SOLVE_MS
                ? (int) (round($variant / 10) * 10) : null,
            'survival' => $variant >= 3_000 && $variant <= self::MAX_SOLVE_MS
                ? (int) (round($variant / 100) * 100) : null,
            'speedrun' => $variant >= self::SPEEDRUN_MIN_CUBES && $variant <= self::SPEEDRUN_MAX_CUBES
                ? $variant : null,
            'ladder'   => 0,
            default    => null,
        };
    }

    /* =====================================================================
     * Opslaan
     * ================================================================== */

    /**
     * Slaat een gecontroleerde ronde op en zegt of het een nieuw record is.
     *
     * @param array<string,mixed> $uitslag het antwoord van evaluate()
     * @return array<string,mixed>
     */
    public static function store(int $userId, string $mode, string $event, array $uitslag): array
    {
        $variant = (int) $uitslag['variant'];
        $vorigRecord = self::bestFor($userId, $mode, $event, $variant);

        Database::run(
            'INSERT INTO game_runs (user_id, mode, event, variant, score, tiebreak_ms, details)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                $userId, $mode, $event, $variant, (int) $uitslag['score'], $uitslag['tiebreak'],
                json_encode($uitslag['details']),
            ]
        );

        $nieuw = ['score' => (int) $uitslag['score'], 'tiebreak' => $uitslag['tiebreak']];
        $isRecord = $nieuw['score'] > 0 && ($vorigRecord === null || self::better($nieuw, $vorigRecord));

        return [
            'mode'           => $mode,
            'event'          => $event,
            'variant'        => $variant,
            'score'          => $nieuw['score'],
            'tiebreakMs'     => $nieuw['tiebreak'],
            'isRecord'       => $isRecord,
            'previousRecord' => $vorigRecord === null ? null : [
                'score' => $vorigRecord['score'], 'tiebreakMs' => $vorigRecord['tiebreak'],
            ],
        ];
    }

    /** @param array{score:int,tiebreak:?int} $a */
    private static function better(array $a, array $b): bool
    {
        if ($a['score'] !== $b['score']) {
            return $a['score'] > $b['score'];
        }
        if ($a['tiebreak'] === null) return false;
        if ($b['tiebreak'] === null) return true;
        return $a['tiebreak'] < $b['tiebreak'];
    }

    /** @return array{score:int,tiebreak:?int}|null */
    private static function bestFor(int $userId, string $mode, string $event, int $variant): ?array
    {
        $rij = Database::first(
            'SELECT score, tiebreak_ms FROM game_runs
             WHERE user_id = ? AND mode = ? AND event = ? AND variant = ? AND score > 0
             ORDER BY score DESC, tiebreak_ms IS NULL, tiebreak_ms ASC
             LIMIT 1',
            [$userId, $mode, $event, $variant]
        );
        return $rij === null ? null : [
            'score' => (int) $rij['score'],
            'tiebreak' => $rij['tiebreak_ms'] === null ? null : (int) $rij['tiebreak_ms'],
        ];
    }

    /* =====================================================================
     * Opvragen
     * ================================================================== */

    /**
     * Het record per modus, event en variant.
     *
     * @return list<array<string,mixed>>
     */
    public static function records(int $userId): array
    {
        $rijen = Database::all(
            'SELECT mode, event, variant, score, tiebreak_ms, created_at
             FROM game_runs
             WHERE user_id = ? AND score > 0
             ORDER BY score DESC, tiebreak_ms IS NULL, tiebreak_ms ASC, id ASC',
            [$userId]
        );

        $gezien = [];
        $uit = [];
        foreach ($rijen as $rij) {
            $sleutel = $rij['mode'] . '|' . $rij['event'] . '|' . $rij['variant'];
            if (isset($gezien[$sleutel])) {
                continue;
            }
            $gezien[$sleutel] = true;
            $uit[] = self::present($rij);
        }

        // Op modus, dan event, dan variant: zo staat het in het scherm.
        usort($uit, static function (array $a, array $b): int {
            $modus = array_search($a['mode'], self::MODES, true) <=> array_search($b['mode'], self::MODES, true);
            if ($modus !== 0) return $modus;
            if ($a['event'] !== $b['event']) return strcmp($a['event'], $b['event']);
            return $a['variant'] <=> $b['variant'];
        });
        return $uit;
    }

    /** @return list<array<string,mixed>> */
    public static function recent(int $userId, int $limit = 10): array
    {
        $limit = max(1, min($limit, 50));
        $rijen = Database::all(
            'SELECT mode, event, variant, score, tiebreak_ms, created_at
             FROM game_runs WHERE user_id = ? ORDER BY id DESC LIMIT ' . $limit,
            [$userId]
        );
        return array_map([self::class, 'present'], $rijen);
    }

    /** @param array<string,mixed> $rij */
    private static function present(array $rij): array
    {
        $mode = (string) $rij['mode'];
        $event = (string) $rij['event'];
        $variant = (int) $rij['variant'];
        $score = (int) $rij['score'];
        $tiebreak = $rij['tiebreak_ms'] === null ? null : (int) $rij['tiebreak_ms'];

        return [
            'mode'         => $mode,
            'modeLabel'    => self::modeLabel($mode),
            'event'        => $event,
            'eventLabel'   => Events::label($event),
            'variant'      => $variant,
            'variantLabel' => self::variantLabel($mode, $variant),
            'score'        => $score,
            'scoreLabel'   => self::scoreLabel($mode, $variant, $score),
            'tiebreakMs'   => $tiebreak,
            'at'           => str_replace(' ', 'T', (string) $rij['created_at']) . 'Z',
        ];
    }

    public static function modeLabel(string $mode): string
    {
        return match ($mode) {
            'streak'   => 'Streak',
            'survival' => 'Survival',
            'ladder'   => 'Ladder',
            'speedrun' => 'Speedrun',
            default    => $mode,
        };
    }

    public static function variantLabel(string $mode, int $variant): string
    {
        return match ($mode) {
            'streak'   => 'sub ' . self::seconds($variant),
            'survival' => 'start ' . self::seconds($variant),
            'speedrun' => $variant . ' cubes',
            default    => '',
        };
    }

    public static function scoreLabel(string $mode, int $variant, int $score): string
    {
        return match ($mode) {
            'streak'   => Taal::t('{n} op rij', ['n' => $score]),
            'survival' => Taal::t('{n} overleefd', ['n' => $score]),
            'ladder'   => $score === 1 ? Taal::t('1 trede') : Taal::t('{n} treden', ['n' => $score]),
            'speedrun' => Taal::t('{n} van {totaal} cubes', ['n' => $score, 'totaal' => $variant]),
            default    => (string) $score,
        };
    }

    /** 15000 wordt "15 s", 12500 wordt "12,5 s". */
    private static function seconds(int $ms): string
    {
        $punt = Taal::isEngels() ? '.' : ',';
        $tekst = rtrim(rtrim(number_format($ms / 1000, 2, $punt, ''), '0'), $punt);
        return $tekst . ' s';
    }
}
