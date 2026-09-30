<?php
declare(strict_types=1);

require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Http.php';
require_once __DIR__ . '/Auth.php';

/**
 * Bots van de formulieren weren, zonder captcha en zonder derde partij.
 *
 * Drie lagen, die samen het gros van de spambots tegenhouden:
 *
 *  1. Honeypot. Elk formulier heeft een verborgen veld `website`. Een mens ziet
 *     het niet en laat het leeg; een bot die alle velden invult, vult het wel.
 *  2. Formuliertoken met minimumtijd. status.php (dat de pagina bij het laden
 *     altijd al ophaalt) geeft een token mee: een tijdstempel met een HMAC
 *     erover, ondertekend met de app_key. Een formulier stuurt het terug. Zo
 *     weet de server zeker hoe lang geleden de pagina geladen werd, zonder
 *     iets op te slaan. Wie rechtstreeks naar het endpoint post, heeft geen
 *     geldig token; wie het token haalt en meteen post, is te snel.
 *  3. De limieten per IP en per account in RateLimiter, die al in elk
 *     endpoint staan. Die blijven het echte vangnet.
 *
 * Een vastberaden aanvaller kan een token ophalen, een paar seconden wachten
 * en dan posten. Dat is precies waar de rate limits voor zijn. Het doel hier
 * is de massa domme bots, zonder echte bezoekers lastig te vallen.
 */
final class BotGuard
{
    /** Hoe lang een token geldig blijft: een tabblad kan lang openstaan. */
    private const MAX_AGE = 86400;

    /** Minimaal aantal seconden tussen het laden van de pagina en versturen. */
    public const MIN_SECONDS = [
        'login'    => 1,
        'forgot'   => 2,
        'register' => 3,
        'feedback' => 3,
    ];

    public static function issueToken(?int $now = null): string
    {
        $tijd = (string) ($now ?? time());
        $nonce = bin2hex(random_bytes(8));
        return $tijd . '.' . $nonce . '.' . self::sign($tijd, $nonce);
    }

    /**
     * Controleert honeypot en token. Stopt met een foutantwoord als het niet
     * klopt; keert gewoon terug als het goed is.
     */
    public static function check(string $form): void
    {
        if (self::honeypotFilled()) {
            // Geen uitleg: een mens komt hier nooit.
            Http::fail('bad_request', 'Dit formulier kon niet worden verwerkt.', 400);
        }

        $leeftijd = self::tokenAge(Http::stringInput('formToken'));
        if ($leeftijd === null) {
            Http::fail(
                'form_expired',
                'Dit formulier is verlopen. Ververs de pagina en probeer het nog eens.',
                400
            );
        }
        if ($leeftijd < (self::MIN_SECONDS[$form] ?? 2)) {
            Http::fail('too_fast', 'Dat ging wel erg snel. Wacht een paar tellen en probeer het opnieuw.', 429);
        }
    }

    public static function honeypotFilled(): bool
    {
        return Http::stringInput('website') !== '';
    }

    /** Leeftijd van een token in seconden, of null als het niet klopt of verlopen is. */
    public static function tokenAge(string $token, ?int $now = null): ?int
    {
        if (preg_match('/^(\d{10})\.([a-f0-9]{16})\.([a-f0-9]{64})$/', $token, $m) !== 1) {
            return null;
        }
        if (!hash_equals(self::sign($m[1], $m[2]), $m[3])) {
            return null;
        }
        $leeftijd = ($now ?? time()) - (int) $m[1];
        if ($leeftijd < 0 || $leeftijd > self::MAX_AGE) {
            return null;
        }
        return $leeftijd;
    }

    private static function sign(string $tijd, string $nonce): string
    {
        return hash_hmac('sha256', 'formulier|' . $tijd . '|' . $nonce, Auth::appKey());
    }
}
