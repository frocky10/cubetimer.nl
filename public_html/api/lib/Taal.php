<?php
declare(strict_types=1);

/**
 * De taal van een antwoord: Nederlands of Engels.
 *
 * Net als in de browser is de Nederlandse tekst de sleutel:
 * Taal::t('Dat wachtwoord klopt niet.') geeft in het Engels "That password is
 * incorrect.". De vertalingen staan in taal/en/server.json; tools/vertalen.php
 * maakt er lib/taal/en.php van.
 *
 * Welke taal: de header X-Taal die UI.api() meestuurt (de taal van de
 * pagina), of ?lang=en bij een gewone pagina zoals profiel.php. Standaard
 * Nederlands.
 *
 * Http::fail() en Http::ok() vertalen het veld `message` vanzelf. Een melding
 * met een getal of naam erin moet dan wel met plaatshouders geschreven zijn:
 * Taal::t('Probeer het over {n} minuten nog eens.', ['n' => 5]).
 */
final class Taal
{
    private static ?string $taal = null;
    /** @var array<string,string>|null */
    private static ?array $woorden = null;

    public static function huidig(): string
    {
        if (self::$taal === null) {
            $gevraagd = strtolower((string) ($_SERVER['HTTP_X_TAAL'] ?? ($_GET['lang'] ?? 'nl')));
            self::$taal = $gevraagd === 'en' ? 'en' : 'nl';
        }
        return self::$taal;
    }

    public static function zet(string $taal): void
    {
        self::$taal = $taal === 'en' ? 'en' : 'nl';
    }

    public static function isEngels(): bool
    {
        return self::huidig() === 'en';
    }

    /** @param array<string,string|int|float> $waarden */
    public static function t(string $tekst, array $waarden = []): string
    {
        if (self::isEngels()) {
            if (self::$woorden === null) {
                $bestand = __DIR__ . '/taal/en.php';
                self::$woorden = is_file($bestand) ? (array) require $bestand : [];
            }
            if (isset(self::$woorden[$tekst])) {
                $tekst = self::$woorden[$tekst];
            } elseif ($tekst !== '' && !empty($GLOBALS['cubetimer_taal_log'])) {
                error_log('[cubetimer] geen vertaling: ' . $tekst);
            }
        }
        if ($waarden) {
            $tekst = preg_replace_callback('/\{(\w+)\}/', static fn (array $m): string =>
                array_key_exists($m[1], $waarden) ? (string) $waarden[$m[1]] : $m[0], $tekst) ?? $tekst;
        }
        return $tekst;
    }

    /** '/en' voor Engels, '' voor Nederlands: voor links in mails en pagina's. */
    public static function prefix(): string
    {
        return self::isEngels() ? '/en' : '';
    }

    /** Getal met duizendtallen op z'n Nederlands of Engels. */
    public static function getal(int|float $n, int $decimalen = 0): string
    {
        return self::isEngels()
            ? number_format($n, $decimalen, '.', ',')
            : number_format($n, $decimalen, ',', '.');
    }
}
