<?php
declare(strict_types=1);

require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Events.php';

/**
 * Het deelnemersveld van een toernooi: de verzonnen cubers en de echte
 * gebruikers die als tegenstander meedoen.
 *
 * Over de echte gebruikers: hun tijden worden NIET overgenomen. Alleen hun
 * niveau (hun beste Ao12, of anders hun beste single) wordt gebruikt om tijden
 * mee te simuleren. Ze hebben dus niet echt meegedaan, en dat staat ook zo in
 * de interface. Wie zichzelf van de ranglijsten haalt, komt nergens in een
 * deelnemersveld terecht.
 */
final class TournamentField
{
    /**
     * De vaste tegenstanders. `percentile` zegt hoe sterk iemand is binnen het
     * veld: 0 is de snelste, 1 de langzaamste. Daardoor is dezelfde bot op elk
     * niveau even sterk ten opzichte van de rest, en herken je je rivalen terug.
     *
     * `consistency` is de spreiding in procenten: een lage waarde betekent
     * altijd rond hetzelfde, een hoge waarde uitschieters naar beide kanten.
     *
     * De namen zijn verzonnen. Er zitten bewust geen bestaande cubers bij.
     *
     * @var list<array{name:string,country:string,percentile:float,consistency:int}>
     */
    private const ROSTER = [
        ['name' => 'Mila Verhoeven',   'country' => 'NL', 'percentile' => 0.02, 'consistency' => 7],
        ['name' => 'Kenji Arakawa',    'country' => 'JP', 'percentile' => 0.04, 'consistency' => 6],
        ['name' => 'Tomas Brandt',     'country' => 'DE', 'percentile' => 0.07, 'consistency' => 9],
        ['name' => 'Ayla Coskun',      'country' => 'TR', 'percentile' => 0.09, 'consistency' => 11],
        ['name' => 'Ruben Okafor',     'country' => 'NG', 'percentile' => 0.12, 'consistency' => 8],
        ['name' => 'Sanne de Wit',     'country' => 'NL', 'percentile' => 0.14, 'consistency' => 10],
        ['name' => 'Luca Ferrari',     'country' => 'IT', 'percentile' => 0.17, 'consistency' => 13],
        ['name' => 'Ingrid Halvorsen', 'country' => 'NO', 'percentile' => 0.19, 'consistency' => 9],
        ['name' => 'Diego Salas',      'country' => 'CL', 'percentile' => 0.22, 'consistency' => 15],
        ['name' => 'Priya Nair',       'country' => 'IN', 'percentile' => 0.24, 'consistency' => 8],
        ['name' => 'Bram Coppens',     'country' => 'BE', 'percentile' => 0.27, 'consistency' => 12],
        ['name' => 'Yara Haddad',      'country' => 'LB', 'percentile' => 0.29, 'consistency' => 10],
        ['name' => 'Oskar Nowak',      'country' => 'PL', 'percentile' => 0.32, 'consistency' => 14],
        ['name' => 'Fenna Bakker',     'country' => 'NL', 'percentile' => 0.34, 'consistency' => 11],
        ['name' => 'Hugo Martins',     'country' => 'PT', 'percentile' => 0.37, 'consistency' => 16],
        ['name' => 'Nadia Petrova',    'country' => 'BG', 'percentile' => 0.39, 'consistency' => 9],
        ['name' => 'Ewan Blackwood',   'country' => 'GB', 'percentile' => 0.42, 'consistency' => 13],
        ['name' => 'Chiara Rossi',     'country' => 'IT', 'percentile' => 0.44, 'consistency' => 12],
        ['name' => 'Joris Kamphuis',   'country' => 'NL', 'percentile' => 0.47, 'consistency' => 17],
        ['name' => 'Amara Mensah',     'country' => 'GH', 'percentile' => 0.49, 'consistency' => 11],
        ['name' => 'Niko Virtanen',    'country' => 'FI', 'percentile' => 0.52, 'consistency' => 10],
        ['name' => 'Isabel Moreno',    'country' => 'ES', 'percentile' => 0.54, 'consistency' => 15],
        ['name' => 'Karel Dvorak',     'country' => 'CZ', 'percentile' => 0.57, 'consistency' => 13],
        ['name' => 'Lotte Jansen',     'country' => 'NL', 'percentile' => 0.59, 'consistency' => 18],
        ['name' => 'Malik Diallo',     'country' => 'SN', 'percentile' => 0.62, 'consistency' => 12],
        ['name' => 'Sofia Lindgren',   'country' => 'SE', 'percentile' => 0.64, 'consistency' => 14],
        ['name' => 'Arjun Mehta',      'country' => 'IN', 'percentile' => 0.67, 'consistency' => 16],
        ['name' => 'Elif Yildirim',    'country' => 'TR', 'percentile' => 0.69, 'consistency' => 11],
        ['name' => 'Pieter Vos',       'country' => 'NL', 'percentile' => 0.72, 'consistency' => 19],
        ['name' => 'Camila Duarte',    'country' => 'BR', 'percentile' => 0.74, 'consistency' => 15],
        ['name' => 'Jonas Weber',      'country' => 'DE', 'percentile' => 0.77, 'consistency' => 13],
        ['name' => 'Mei-Lin Chan',     'country' => 'SG', 'percentile' => 0.79, 'consistency' => 12],
        ['name' => 'Daan Overweg',     'country' => 'NL', 'percentile' => 0.82, 'consistency' => 20],
        ['name' => 'Rosa Alvarez',     'country' => 'MX', 'percentile' => 0.84, 'consistency' => 17],
        ['name' => 'Ivan Kuznetsov',   'country' => 'KZ', 'percentile' => 0.87, 'consistency' => 14],
        ['name' => 'Nora Egeland',     'country' => 'NO', 'percentile' => 0.89, 'consistency' => 16],
        ['name' => 'Samir Rahman',     'country' => 'BD', 'percentile' => 0.91, 'consistency' => 18],
        ['name' => 'Julia Kowalczyk',  'country' => 'PL', 'percentile' => 0.93, 'consistency' => 21],
        ['name' => 'Teun Rietveld',    'country' => 'NL', 'percentile' => 0.95, 'consistency' => 22],
        ['name' => 'Grace O\'Donnell', 'country' => 'IE', 'percentile' => 0.97, 'consistency' => 19],
    ];

    /** Hoeveel van het veld hooguit uit echte gebruikers bestaat. */
    private const REAL_USER_SHARE = 0.25;

    /**
     * Stelt een veld samen.
     *
     * @param float $spread hoe ver het veld uit elkaar ligt. 0.5 is een
     *        gewoon toernooi (snelste helft zo snel als de referentie),
     *        hoger betekent grotere verschillen.
     * @return list<array{kind:string,name:string,country:?string,ref_user_id:?int,skill_ms:int,consistency:int,form:int}>
     */
    public static function build(string $event, int $referenceMs, int $size, float $spread, ?int $excludeUserId): array
    {
        $veld = [];

        $echte = self::realCubers($event, $referenceMs, (int) floor($size * self::REAL_USER_SHARE), $excludeUserId, $spread);
        foreach ($echte as $cuber) {
            $veld[] = $cuber;
        }

        $roster = self::ROSTER;
        shuffle($roster);

        foreach ($roster as $bot) {
            if (count($veld) >= $size) {
                break;
            }
            $veld[] = [
                'kind'        => 'bot',
                'name'        => $bot['name'],
                'country'     => $bot['country'],
                'ref_user_id' => null,
                'skill_ms'    => self::skillFor($event, $referenceMs, $bot['percentile'], $spread),
                'consistency' => $bot['consistency'],
                'form'        => random_int(-6, 6),
            ];
        }

        // Is het veld groter dan de vaste namen, dan komen er naamgenoten bij
        // met een cijfer erachter. Gebeurt alleen bij het open toernooi.
        $extra = 2;
        while (count($veld) < $size) {
            foreach ($roster as $bot) {
                if (count($veld) >= $size) {
                    break;
                }
                $veld[] = [
                    'kind'        => 'bot',
                    'name'        => $bot['name'] . ' ' . $extra,
                    'country'     => $bot['country'],
                    'ref_user_id' => null,
                    'skill_ms'    => self::skillFor($event, $referenceMs, $bot['percentile'], $spread),
                    'consistency' => $bot['consistency'],
                    'form'        => random_int(-6, 6),
                ];
            }
            $extra++;
            if ($extra > 6) {
                break;
            }
        }

        return array_slice($veld, 0, $size);
    }

    /**
     * Zet een plek in het veld om naar een gemiddelde tijd.
     * Percentiel 0 is de snelste, 1 de langzaamste.
     *
     * Bewust vermenigvuldigend en niet optellend: bij een breed veld (het open
     * toernooi) zou een lineaire schaal doorslaan naar negatieve tijden. Met
     * exp() blijft de verhouding tussen de snelste en de langzaamste netjes,
     * hoe breed je het veld ook maakt.
     */
    private static function skillFor(string $event, int $referenceMs, float $percentile, float $spread): int
    {
        $factor = exp(($percentile - 0.5) * 2 * $spread);
        $tijd = (int) round($referenceMs * $factor);

        // Een gemiddelde kan nooit in de buurt van het wereldrecord komen.
        return max(self::floorFor($event), $tijd);
    }

    /** De snelste gemiddelde tijd die we geloofwaardig vinden voor dit event. */
    private static function floorFor(string $event): int
    {
        return (int) round(Events::floorMs($event) * 1.25);
    }

    /**
     * Echte gebruikers van de site die qua niveau in dit veld passen.
     *
     * @return list<array<string,mixed>>
     */
    private static function realCubers(string $event, int $referenceMs, int $max, ?int $excludeUserId, float $spread): array
    {
        if ($max < 1) {
            return [];
        }

        // Dezelfde schaal als voor de bots, zodat een echte cuber alleen in een
        // veld terechtkomt waar hij ook echt in past.
        $onder = (int) round($referenceMs * exp(-$spread));
        $boven = (int) round($referenceMs * exp($spread));

        try {
            $rows = Database::all(
                "SELECT u.id, u.username, p.country_code,
                        MIN(CASE WHEN r.category = 'ao12' THEN r.value_ms END) AS ao12,
                        MIN(CASE WHEN r.category = 'single' THEN r.value_ms END) AS single
                 FROM user_records r
                 JOIN users u ON u.id = r.user_id
                 JOIN user_profiles p ON p.user_id = r.user_id
                 WHERE r.event = ? AND r.period = 'all'
                   AND r.category IN ('ao12', 'single')
                   AND u.is_active = 1 AND p.show_on_leaderboard = 1
                   AND u.id <> ?
                 GROUP BY u.id, u.username, p.country_code
                 HAVING ao12 IS NOT NULL OR single IS NOT NULL",
                [$event, $excludeUserId ?? 0]
            );
        } catch (PDOException $e) {
            error_log('[cubetimer] echte cubers ophalen mislukt: ' . $e->getMessage());
            return [];
        }

        $kandidaten = [];
        foreach ($rows as $row) {
            // Geen Ao12? Dan is een single een redelijke benadering, iets
            // langzamer omdat een gemiddelde nooit zo snel is als je beste.
            $niveau = $row['ao12'] !== null
                ? (int) $row['ao12']
                : (int) round((int) $row['single'] * 1.18);

            if ($niveau < $onder || $niveau > $boven) {
                continue;
            }

            $kandidaten[] = [
                'kind'        => 'user',
                'name'        => (string) $row['username'],
                'country'     => $row['country_code'],
                'ref_user_id' => (int) $row['id'],
                'skill_ms'    => $niveau,
                'consistency' => 12,
                'form'        => random_int(-6, 6),
            ];
        }

        shuffle($kandidaten);
        return array_slice($kandidaten, 0, $max);
    }
}
