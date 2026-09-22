<?php
declare(strict_types=1);

require_once __DIR__ . '/SiteTime.php';
require_once __DIR__ . '/Events.php';

/**
 * Loopt een keer door alle solves van een gebruiker en verzamelt onderweg
 * alles wat de achievements nodig hebben.
 *
 * Bewust in een doorloop: bij tienduizenden solves is een aparte query of een
 * tweede ronde per achievement niet te doen. Alles wat hier uitkomt is een
 * kaal getal of een ja/nee, zodat Achievements alleen nog hoeft te vergelijken.
 *
 * Tijdstippen worden omgerekend naar de tijdzone van de site, zodat
 * "middernacht" en "een dag" voor iedereen hetzelfde betekenen.
 */
final class SolveFacts
{
    /**
     * @param list<array<string,mixed>> $solves chronologisch, uit de database
     * @param array<string,true> $blocked client_ids die niet mee mogen tellen
     * @return array<string,mixed>
     */
    public static function from(array $solves, array $blocked = []): array
    {
        $totaal = 0;
        $geldig = 0;
        $dnf = 0;
        $plus2 = 0;
        $bluetooth = 0;

        $eventsGeprobeerd = [];
        $eventsOpgelost = [];

        $perDag = [];          // dag => aantal geldige solves
        $dnfPerDag = [];       // dag => aantal DNF's
        $urenPerDag = [];      // dag => set van uren

        $nachtbraker = 0;      // solves tussen 02:00 en 05:00
        $middernacht = false;  // solve tussen 00:00 en 00:05
        $vroegeVogel = false;  // solve tussen 05:00 en 06:00

        $palindroom = false;
        $repdigit = false;
        $rond = false;         // precies een hele seconde
        $pi = false;           // begint met 3,14
        $leet = false;         // 13,37 seconden

        $dnfReeks = 0;
        $langsteDnfReeks = 0;
        $wederopstanding = false;

        $besteTotNu = [];      // event => beste tijd tot nu toe
        $vorigeWasDnf = [];    // event => was de vorige solve een DNF?

        foreach ($solves as $row) {
            $event = (string) $row['event'];
            $clientId = (string) $row['client_id'];
            $effectief = self::effectiveMs($row);
            $tijdstip = strtotime((string) $row['solved_at'] . ' UTC');

            $lokaal = (new DateTimeImmutable('@' . $tijdstip))->setTimezone(SiteTime::zone());
            $dag = $lokaal->format('Y-m-d');
            $uur = (int) $lokaal->format('G');
            $minuut = (int) $lokaal->format('i');

            $totaal++;
            $eventsGeprobeerd[$event] = true;

            if ((string) ($row['source'] ?? 'manual') === 'bluetooth') {
                $bluetooth++;
            }

            // --- DNF ------------------------------------------------------
            if ($effectief === null) {
                $dnf++;
                $dnfPerDag[$dag] = ($dnfPerDag[$dag] ?? 0) + 1;
                $dnfReeks++;
                $langsteDnfReeks = max($langsteDnfReeks, $dnfReeks);
                $vorigeWasDnf[$event] = true;
                continue;
            }

            $dnfReeks = 0;

            if ((string) ($row['penalty'] ?? 'none') === 'plus2') {
                $plus2++;
            }

            $geldig++;
            $eventsOpgelost[$event] = true;
            $perDag[$dag] = ($perDag[$dag] ?? 0) + 1;
            $urenPerDag[$dag][$uur] = true;

            // --- Tijdstip van de dag --------------------------------------
            if ($uur === 0 && $minuut < 5) {
                $middernacht = true;
            }
            if ($uur === 5) {
                $vroegeVogel = true;
            }
            if ($uur >= 2 && $uur < 5) {
                $nachtbraker++;
            }

            // --- Bijzondere tijden ----------------------------------------
            // Gemarkeerde solves tellen hier niet mee: een verzonnen tijd
            // hoort geen achievement op te leveren.
            if (!isset($blocked[$clientId])) {
                $cijfers = (string) $effectief;

                if (strlen($cijfers) >= 5 && $cijfers === strrev($cijfers)) {
                    $palindroom = true;
                }
                if (strlen($cijfers) >= 4 && count(array_unique(str_split($cijfers))) === 1) {
                    $repdigit = true;
                }
                if ($effectief >= 1000 && $effectief % 1000 === 0) {
                    $rond = true;
                }
                if (str_starts_with($cijfers, '314') && strlen($cijfers) >= 5) {
                    $pi = true;
                }
                if ($effectief >= 13370 && $effectief <= 13379) {
                    $leet = true;
                }

                // --- Wederopstanding: een record meteen na een DNF --------
                $vorigeDnf = $vorigeWasDnf[$event] ?? false;
                $beste = $besteTotNu[$event] ?? null;
                if ($vorigeDnf && $beste !== null && $effectief < $beste) {
                    $wederopstanding = true;
                }
                if ($beste === null || $effectief < $beste) {
                    $besteTotNu[$event] = $effectief;
                }
            }

            $vorigeWasDnf[$event] = false;
        }

        // --- Afgeleide dagcijfers -----------------------------------------
        $meesteOpEenDag = $perDag ? max($perDag) : 0;
        $meesteUrenOpEenDag = 0;
        foreach ($urenPerDag as $uren) {
            $meesteUrenOpEenDag = max($meesteUrenOpEenDag, count($uren));
        }

        $vlekkeloos = false;
        foreach ($perDag as $dag => $aantal) {
            if ($aantal >= 25 && ($dnfPerDag[$dag] ?? 0) === 0) {
                $vlekkeloos = true;
                break;
            }
        }

        return [
            'totalSolves'        => $totaal,
            'validSolves'        => $geldig,
            'dnfCount'           => $dnf,
            'plus2Count'         => $plus2,
            'bluetoothSolves'    => $bluetooth,
            'eventsTried'        => count($eventsGeprobeerd),
            'eventsSolved'       => count($eventsOpgelost),
            'maxSolvesOneDay'    => $meesteOpEenDag,
            'maxHoursOneDay'     => $meesteUrenOpEenDag,
            'nightOwlSolves'     => $nachtbraker,
            'midnightSolve'      => $middernacht,
            'earlyBirdSolve'     => $vroegeVogel,
            'palindromeTime'     => $palindroom,
            'repdigitTime'       => $repdigit,
            'exactSecondTime'    => $rond,
            'piTime'             => $pi,
            'leetTime'           => $leet,
            'longestDnfRun'      => $langsteDnfReeks,
            'comebackPb'         => $wederopstanding,
            'flawlessDay'        => $vlekkeloos,
        ];
    }

    /** De tijd inclusief straf, of null bij een DNF. */
    private static function effectiveMs(array $row): ?int
    {
        $penalty = (string) ($row['penalty'] ?? 'none');
        if ($penalty === 'dnf' || $row['raw_ms'] === null) {
            return null;
        }
        $value = (int) $row['raw_ms'];
        return $penalty === 'plus2' ? $value + 2000 : $value;
    }
}
