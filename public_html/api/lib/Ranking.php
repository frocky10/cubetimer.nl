<?php
declare(strict_types=1);

require_once __DIR__ . '/Averages.php';

/**
 * Hoe een ronde gerangschikt wordt, per WCA-format.
 *
 *   a   Average of 5   vijf pogingen, beste en slechtste vallen weg
 *   m   Mean of 3      drie pogingen, gewoon het gemiddelde
 *   1/2/3  Best of N   alleen de beste poging telt
 *
 * Bij een gemiddelde gaat iedereen met een geldig gemiddelde voor, op
 * gemiddelde, en daarna de rest op beste single. Bij best of telt alleen de
 * single. Precies de volgorde van een echte uitslag.
 *
 * Gebruikt door de toernooien (echte comps kennen alle vijf) en de duels.
 */
final class Ranking
{
    /** @var array<string,int> pogingen per format */
    public const FORMATS = ['a' => 5, 'm' => 3, '1' => 1, '2' => 2, '3' => 3];

    public static function isFormat(string $format): bool
    {
        return isset(self::FORMATS[$format]);
    }

    public static function attempts(string $format): int
    {
        return self::FORMATS[$format] ?? 5;
    }

    public static function usesAverage(string $format): bool
    {
        return $format === 'a' || $format === 'm';
    }

    public static function label(string $format): string
    {
        return match ($format) {
            'a' => 'Ao5',
            'm' => 'Mo3',
            '1' => 'Bo1',
            '2' => 'Bo2',
            '3' => 'Bo3',
            default => $format,
        };
    }

    /** De effectieve tijd van een poging: met +2, of null bij een DNF/DNS. */
    public static function effective(?int $ms, string $penalty): ?int
    {
        if ($ms === null || $penalty === 'dnf' || $penalty === 'dns') {
            return null;
        }
        return $penalty === 'plus2' ? $ms + 2000 : $ms;
    }

    /**
     * Gemiddelde en beste single uit een rij effectieve tijden. Zijn er minder
     * pogingen dan het format vraagt (gestrand op de cutoff), dan is er geen
     * gemiddelde.
     *
     * @param list<int|null> $values
     * @return array{average:?int,best:?int}
     */
    public static function result(string $format, array $values): array
    {
        $geldig = array_values(array_filter($values, static fn (?int $v): bool => $v !== null));
        $best = $geldig ? min($geldig) : null;

        $average = null;
        if (self::usesAverage($format) && count($values) === self::attempts($format)) {
            $uitkomst = Averages::best($values, count($values), $format === 'a');
            $average = $uitkomst === null ? null : (int) round($uitkomst['value']);
        }

        return ['average' => $average, 'best' => $best];
    }

    /**
     * Vergelijkt twee uitslagen met de velden `average` en `best`.
     * Negatief als $a beter is.
     */
    public static function compare(string $format, array $a, array $b): int
    {
        if (self::usesAverage($format)) {
            $gemA = $a['average'] ?? null;
            $gemB = $b['average'] ?? null;
            if ($gemA !== null && $gemB === null) return -1;
            if ($gemA === null && $gemB !== null) return 1;
            if ($gemA !== null && $gemB !== null && $gemA !== $gemB) {
                return $gemA <=> $gemB;
            }
        }

        $besteA = $a['best'] ?? null;
        $besteB = $b['best'] ?? null;
        if ($besteA === null && $besteB === null) return 0;
        if ($besteA === null) return 1;
        if ($besteB === null) return -1;
        return $besteA <=> $besteB;
    }
}
