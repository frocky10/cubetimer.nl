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
