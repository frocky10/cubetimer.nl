<?php
declare(strict_types=1);

/**
 * Rekent gemiddelden uit over een reeks solves.
 *
 * Twee soorten:
 *   Ao (average)  de beste en de slechtste vallen weg. Een DNF telt als de
 *                 slechtste tijd en mag dus een keer voorkomen; vanaf twee
 *                 DNF's in een venster is het gemiddelde zelf een DNF.
 *   Mo (mean)     gewoon het gemiddelde, niets wegstrepen. Een enkele DNF
 *                 maakt het venster al ongeldig. Gebruikt bij 6x6 en 7x7.
 *
 * Dezelfde regels als averageOf() in Script/script.js, maar dan serverside,
 * omdat we de browser niet op zijn woord geloven als het om records gaat.
 *
 * Snelheid: de schuivende minimum- en maximumwaarde worden bijgehouden met
 * twee monotone wachtrijen. Daardoor kost een venster van 100 evenveel als een
 * venster van 5, en blijft een gebruiker met tienduizenden solves werkbaar.
 */
final class Averages
{
    /**
     * Het beste resultaat over alle aaneengesloten vensters.
     *
     * @param list<int|null> $values effectieve tijden in ms, null voor een DNF
     * @param int  $window aantal solves per venster
     * @param bool $trim   true voor Ao, false voor Mo
     * @return array{value:float,end:int}|null het beste venster, of null
     */
    public static function best(array $values, int $window, bool $trim = true): ?array
    {
        $best = null;
        foreach (self::rolling($values, $window, $trim) as $entry) {
            if ($best === null || $entry['value'] < $best['value']) {
                $best = $entry;
            }
        }
        return $best;
    }

    /**
     * Elk geldig venster, in volgorde.
     *
     * @param list<int|null> $values
     * @return list<array{value:float,end:int}> `end` is de index van de laatste
     *         solve in het venster
     */
    public static function rolling(array $values, int $window, bool $trim = true): array
    {
        $count = count($values);
        $out = [];
        if ($window < 1 || $count < $window) {
            return $out;
        }
        if ($trim && $window < 3) {
            return $out; // wegstrepen kan pas vanaf drie
        }

        $divisor = $trim ? $window - 2 : $window;

        $sum = 0.0;       // som van de niet-DNF waardes in het venster
        $dnf = 0;         // aantal DNF's in het venster
        $minQueue = [];   // indexen, oplopend in waarde
        $maxQueue = [];   // indexen, aflopend in waarde
        $minHead = 0;
        $maxHead = 0;

        for ($i = 0; $i < $count; $i++) {
            $value = $values[$i];

            if ($value === null) {
                $dnf++;
            } else {
                $sum += $value;
                while (count($minQueue) > $minHead && $values[$minQueue[count($minQueue) - 1]] >= $value) {
                    array_pop($minQueue);
                }
                $minQueue[] = $i;
                while (count($maxQueue) > $maxHead && $values[$maxQueue[count($maxQueue) - 1]] <= $value) {
                    array_pop($maxQueue);
                }
                $maxQueue[] = $i;
            }

            if ($i < $window - 1) {
                continue;
            }

            $start = $i - $window + 1;

            // De solve die net buiten het venster viel weer aftrekken.
            if ($start > 0) {
                $leaving = $values[$start - 1];
                if ($leaving === null) {
                    $dnf--;
                } else {
                    $sum -= $leaving;
                }
            }

            while (count($minQueue) > $minHead && $minQueue[$minHead] < $start) {
                $minHead++;
            }
            while (count($maxQueue) > $maxHead && $maxQueue[$maxHead] < $start) {
                $maxHead++;
            }

            if (!$trim) {
                if ($dnf === 0) {
                    $out[] = ['value' => $sum / $divisor, 'end' => $i];
                }
                continue;
            }

            if ($dnf >= 2) {
                continue;
            }

            $min = $values[$minQueue[$minHead]];

            if ($dnf === 1) {
                // De DNF is de slechtste en valt weg; alleen het minimum er nog af.
                $out[] = ['value' => ($sum - $min) / $divisor, 'end' => $i];
                continue;
            }

            $max = $values[$maxQueue[$maxHead]];
            $out[] = ['value' => ($sum - $min - $max) / $divisor, 'end' => $i];
        }

        return $out;
    }

    /**
     * Het lopende beste: per venster het beste resultaat tot dan toe, maar
     * alleen de momenten waarop het record verbeterde. Gebruikt om XP toe te
     * kennen voor elk persoonlijk record uit iemands geschiedenis.
     *
     * @param list<int|null> $values
     * @return list<array{value:float,end:int}>
     */
    public static function improvements(array $values, int $window, bool $trim = true): array
    {
        $out = [];
        $best = null;
        foreach (self::rolling($values, $window, $trim) as $entry) {
            if ($best === null || $entry['value'] < $best) {
                $best = $entry['value'];
                $out[] = $entry;
            }
        }
        return $out;
    }
}
