<?php
declare(strict_types=1);

/**
 * Wat we over de WCA-events weten: hun naam, en de ondergrens waaronder een
 * tijd niet echt kan zijn.
 *
 * De ondergrenzen zijn de wereldrecords. Een tijd daaronder is op deze site
 * geen record maar een foutje of een grap, en gaat naar de beoordeelwachtrij.
 */
final class Events
{
    /** @var array<string,string> */
    public const LABELS = [
        '333' => '3x3x3',
        '222' => '2x2x2',
        '444' => '4x4x4',
        '555' => '5x5x5',
        '666' => '6x6x6',
        '777' => '7x7x7',
        '333bf' => '3x3x3 Blindfolded',
        '333fm' => '3x3x3 Fewest Moves',
        '333oh' => '3x3x3 One-Handed',
        'clock' => 'Clock',
        'minx' => 'Megaminx',
        'pyram' => 'Pyraminx',
        'skewb' => 'Skewb',
        'sq1' => 'Square-1',
        '444bf' => '4x4x4 Blindfolded',
        '555bf' => '5x5x5 Blindfolded',
        '333mbf' => '3x3x3 Multi-Blind',
        'fto' => 'Face-Turning Octahedron',
        'master_tetraminx' => 'Master Tetraminx',
    ];

    /**
     * Wereldrecords in milliseconden. Een solve hieronder wordt gemarkeerd.
     * Bijwerken mag altijd; het is een ondergrens, geen doel.
     *
     * @var array<string,int>
     */
    private const WORLD_RECORD_MS = [
        '222' => 430,
        '333' => 3130,
        '444' => 15710,
        '555' => 27930,
        '666' => 55680,
        '777' => 89680,
        '333bf' => 12000,
        '333oh' => 5660,
        'clock' => 2160,
        'minx' => 25750,
        'pyram' => 730,
        'skewb' => 930,
        'sq1' => 3600,
        '444bf' => 51960,
        '555bf' => 132000,
        'fto' => 8000,
        'master_tetraminx' => 10000,
    ];

    /** Onder deze grens is geen enkele solve geloofwaardig, welk event dan ook. */
    public const ABSOLUTE_FLOOR_MS = 250;

    /** Events waarvoor een tijd niets zegt (aantal zetten, aantal kubussen). */
    private const NON_TIMED = ['333fm', '333mbf'];

    /**
     * Hoe een scramble er per event uitziet: welke zetten erin mogen staan en
     * hoeveel het er ongeveer zijn.
     *
     * Alleen events die hier staan kunnen een scramble van de dag krijgen.
     * De voorraad wordt namelijk gevuld door de browsers van bezoekers, en dan
     * wil je kunnen controleren of er geen onzin binnenkomt. Voor Megaminx,
     * Square-1 en Clock is de notatie te eigenzinnig om betrouwbaar te
     * controleren; die laten we bewust buiten de scramble van de dag.
     *
     *   token        reguliere expressie voor een losse zet
     *   min, max     hoeveel zetten een scramble mag tellen
     *   noRepeat     mag hetzelfde vlak twee keer achter elkaar? Alleen zinnig
     *                bij puzzels zonder brede zetten.
     *
     * @var array<string,array{token:string,min:int,max:int,noRepeat:bool}>
     */
    private const SCRAMBLE_FORMATS = [
        '222'   => ['token' => "[UDLRFB][2']?",                      'min' => 8,  'max' => 13,  'noRepeat' => true],
        '333'   => ['token' => "[UDLRFB][2']?",                      'min' => 16, 'max' => 25,  'noRepeat' => true],
        '333oh' => ['token' => "[UDLRFB][2']?",                      'min' => 16, 'max' => 25,  'noRepeat' => true],
        '444'   => ['token' => "(?:[UDLRFB]w?|[23][UDLRFB]w)[2']?",  'min' => 36, 'max' => 52,  'noRepeat' => false],
        '555'   => ['token' => "(?:[UDLRFB]w?|[23][UDLRFB]w)[2']?",  'min' => 52, 'max' => 70,  'noRepeat' => false],
        '666'   => ['token' => "(?:[UDLRFB]w?|[23][UDLRFB]w)[2']?",  'min' => 70, 'max' => 90,  'noRepeat' => false],
        '777'   => ['token' => "(?:[UDLRFB]w?|[234][UDLRFB]w)[2']?", 'min' => 88, 'max' => 112, 'noRepeat' => false],
        'pyram' => ['token' => "[ULRBulrb]'?",                       'min' => 8,  'max' => 16,  'noRepeat' => false],
        'skewb' => ['token' => "[URLB]'?",                           'min' => 8,  'max' => 14,  'noRepeat' => true],
    ];

    public static function isKnown(string $event): bool
    {
        return isset(self::LABELS[$event]);
    }

    public static function label(string $event): string
    {
        return self::LABELS[$event] ?? $event;
    }

    /** Events die in een ranglijst thuishoren: alles waar een tijd telt. */
    public static function isRanked(string $event): bool
    {
        return self::isKnown($event) && !in_array($event, self::NON_TIMED, true);
    }

    /** De ondergrens voor dit event, of de absolute ondergrens als we hem niet kennen. */
    public static function floorMs(string $event): int
    {
        return self::WORLD_RECORD_MS[$event] ?? self::ABSOLUTE_FLOOR_MS;
    }

    /** Kan dit event een scramble van de dag krijgen? */
    public static function hasScrambleFormat(string $event): bool
    {
        return isset(self::SCRAMBLE_FORMATS[$event]);
    }

    /** @return list<string> events die een scramble van de dag kunnen krijgen */
    public static function scrambleEvents(): array
    {
        return array_keys(self::SCRAMBLE_FORMATS);
    }

    /**
     * Controleert of een aangeleverde scramble er voor dit event uitziet als
     * een echte. Dit vangt onzin en handmatig geknutselde reeksen af, geen
     * kwaadwillende die een geldige maar makkelijke scramble instuurt;
     * daarvoor zijn de wachttijd van een dag en de willekeurige keuze uit de
     * voorraad.
     */
    public static function validateScramble(string $event, string $scramble): bool
    {
        $formaat = self::SCRAMBLE_FORMATS[$event] ?? null;
        if ($formaat === null) {
            return false;
        }
        if ($scramble === '' || mb_strlen($scramble) > 800) {
            return false;
        }

        $zetten = explode(' ', $scramble);
        $aantal = count($zetten);
        if ($aantal < $formaat['min'] || $aantal > $formaat['max']) {
            return false;
        }

        $patroon = '/^' . $formaat['token'] . '$/';
        foreach ($zetten as $zet) {
            if (preg_match($patroon, $zet) !== 1) {
                return false;
            }
        }

        if ($formaat['noRepeat']) {
            for ($i = 1; $i < $aantal; $i++) {
                if ($zetten[$i][0] === $zetten[$i - 1][0]) {
                    return false;
                }
            }
        }

        return true;
    }

    /** @return list<array{id:string,label:string}> */
    public static function rankedList(): array
    {
        $out = [];
        foreach (self::LABELS as $id => $label) {
            if (self::isRanked($id)) {
                $out[] = ['id' => $id, 'label' => $label];
            }
        }
        return $out;
    }
}
