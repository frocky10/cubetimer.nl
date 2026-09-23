<?php
declare(strict_types=1);

/**
 * De analyse van een smart-cubesolve: zetten, TPS, de oplossing, en per fase
 * de tijd en het aantal zetten.
 *
 * De browser maakt de analyse en stuurt hem mee met de solve. Hier wordt hij
 * gecontroleerd en opnieuw opgebouwd uit alleen de velden die we kennen, met
 * grenzen aan elk getal en aan de lengte van de oplossing. Wat de browser
 * stuurt komt dus nooit letterlijk in de database.
 *
 * De analyse telt nergens mee: geen record, ranglijst of XP kijkt ernaar. Een
 * verzonnen analyse levert dus niets op, behalve dat je hem zelf terugziet.
 */
final class SolveAnalysis
{
    private const PHASES = ['cross', 'f2l', 'oll', 'pll'];
    private const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
    private const MAX_MS = 3_600_000;
    private const MAX_MOVES = 1000;
    private const MAX_SOLUTION = 800;

    /** Controleert een analyse uit de browser; geeft JSON terug, of null. */
    public static function clean(mixed $input): ?string
    {
        if (!is_array($input)) {
            return null;
        }

        $uit = ['v' => 1];
        $uit['moves'] = self::int($input['moves'] ?? 0, self::MAX_MOVES);
        $tps = is_numeric($input['tps'] ?? null) ? (float) $input['tps'] : 0.0;
        $uit['tps'] = round(max(0.0, min(50.0, $tps)), 2);

        $oplossing = is_string($input['solution'] ?? null) ? $input['solution'] : '';
        // Alleen zetten van de zes vlakken, zoals een smart cube ze meldt.
        $oplossing = trim((string) preg_replace('/\s+/', ' ', $oplossing));
        if ($oplossing !== '' && preg_match("/^([URFDLB](2|')?)( [URFDLB](2|')?)*$/", $oplossing) === 1) {
            $uit['solution'] = mb_substr($oplossing, 0, self::MAX_SOLUTION);
        }

        if (in_array($input['crossFace'] ?? null, self::FACES, true)) {
            $uit['crossFace'] = $input['crossFace'];
        }
        $uit['hardwareTimes'] = ($input['hardwareTimes'] ?? false) === true;

        $fases = [];
        foreach (is_array($input['phases'] ?? null) ? $input['phases'] : [] as $fase) {
            if (!is_array($fase) || !in_array($fase['key'] ?? null, self::PHASES, true)) {
                continue;
            }
            if (isset($fases[$fase['key']])) {
                continue;
            }
            $fases[$fase['key']] = [
                'key'   => $fase['key'],
                'ms'    => self::int($fase['ms'] ?? 0, self::MAX_MS),
                'moves' => self::int($fase['moves'] ?? 0, self::MAX_MOVES),
            ];
        }
        // Altijd in de vaste volgorde.
        $uit['phases'] = array_values(array_filter(
            array_map(static fn (string $k) => $fases[$k] ?? null, self::PHASES)
        ));

        $json = json_encode($uit, JSON_UNESCAPED_UNICODE);
        return $json === false ? null : $json;
    }

    /** Terug naar de vorm die de browser kent, of null. */
    public static function decode(?string $json): ?array
    {
        if ($json === null || $json === '') {
            return null;
        }
        $data = json_decode($json, true);
        if (!is_array($data)) {
            return null;
        }
        unset($data['v']);
        return $data;
    }

    private static function int(mixed $value, int $max): int
    {
        return is_numeric($value) ? max(0, min($max, (int) round((float) $value))) : 0;
    }
}
