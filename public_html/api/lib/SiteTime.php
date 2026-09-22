<?php
declare(strict_types=1);

require_once __DIR__ . '/Config.php';

/**
 * Dag- en weekgrenzen voor de hele site.
 *
 * Belangrijk: periodes lopen in de tijdzone van de site, niet in die van de
 * bezoeker. Anders begint "vandaag" voor iedereen op een ander moment en valt
 * een dagranglijst niet eerlijk te vergelijken. In de database staat alles in
 * UTC; hier wordt heen en weer gerekend.
 *
 * De statistieken in de sidebar rekenen wel met de lokale tijd van de
 * bezoeker. Dat kan dus rond middernacht een uurtje afwijken van de
 * ranglijsten. Dat is een bewuste keuze: je eigen cijfers horen bij jouw dag,
 * een wedstrijd hoort bij dezelfde dag voor iedereen.
 */
final class SiteTime
{
    private static ?DateTimeZone $zone = null;

    public static function zone(): DateTimeZone
    {
        if (self::$zone === null) {
            $name = (string) Config::get('site_timezone', 'Europe/Amsterdam');
            try {
                self::$zone = new DateTimeZone($name);
            } catch (Exception) {
                self::$zone = new DateTimeZone('Europe/Amsterdam');
            }
        }
        return self::$zone;
    }

    public static function zoneName(): string
    {
        return self::zone()->getName();
    }

    private static function now(): DateTimeImmutable
    {
        return new DateTimeImmutable('now', self::zone());
    }

    /** De dag waarop een unix-tijdstip valt, als Y-m-d in de sitetijdzone. */
    public static function dayOf(int $timestamp): string
    {
        return (new DateTimeImmutable('@' . $timestamp))
            ->setTimezone(self::zone())
            ->format('Y-m-d');
    }

    /** Vandaag als Y-m-d. */
    public static function today(): string
    {
        return self::now()->format('Y-m-d');
    }

    /** Unix-tijdstip van middernacht vannacht. */
    public static function startOfToday(): int
    {
        return self::now()->setTime(0, 0, 0)->getTimestamp();
    }

    /** Unix-tijdstip van maandag 00:00 van de lopende week. */
    public static function startOfWeek(): int
    {
        $now = self::now()->setTime(0, 0, 0);
        $dayIndex = ((int) $now->format('N')) - 1; // maandag = 0
        return $now->modify('-' . $dayIndex . ' days')->getTimestamp();
    }

    /** Maandag van de week waarin een dag (Y-m-d) valt. */
    public static function weekStartOf(string $day): string
    {
        $date = DateTimeImmutable::createFromFormat('Y-m-d', $day, self::zone());
        if ($date === false) {
            return $day;
        }
        $dayIndex = ((int) $date->format('N')) - 1;
        return $date->modify('-' . $dayIndex . ' days')->format('Y-m-d');
    }

    /** UTC-datumtijd (voor de database) van het begin van een dag. */
    public static function utcStartOfDay(string $day): string
    {
        $date = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $day . ' 00:00:00', self::zone());
        if ($date === false) {
            return gmdate('Y-m-d H:i:s');
        }
        return $date->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }
}
