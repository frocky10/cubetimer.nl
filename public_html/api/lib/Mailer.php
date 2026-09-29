<?php
declare(strict_types=1);

require_once __DIR__ . '/Config.php';

/**
 * Mail versturen via SMTP, zonder bibliotheek.
 *
 * Er is geen composer op de hosting, en PHP's mail() belandt bij Gmail en
 * Outlook vaak in de spam. Daarom praat deze klasse zelf SMTP met een mailbox
 * die je in DirectAdmin aanmaakt (bijvoorbeeld noreply@cubetimer.nl). Dat is
 * een handvol regels protocol: begroeten, eventueel versleutelen, inloggen,
 * afzender, ontvanger, bericht, klaar.
 *
 * Instellingen in ~/cubetimer_config.php, onder 'mail' (zie config.example.php):
 *   host, port, encryption (ssl | tls | none), username, password, from,
 *   from_name, verify_peer
 *
 * Zonder host of afzender staat mail uit: dan verbergt de site "wachtwoord
 * vergeten" en vraagt hij niet om je adres te bevestigen. Een mislukte mail
 * gaat naar het errorlog, nooit naar de bezoeker.
 */
final class Mailer
{
    private const TIMEOUT = 15;

    public static function isEnabled(): bool
    {
        return trim((string) Config::get('mail.host', '')) !== ''
            && filter_var((string) Config::get('mail.from', ''), FILTER_VALIDATE_EMAIL) !== false;
    }

    /** Het adres van de site, voor links in een mail. Zonder slash aan het eind. */
    public static function siteUrl(): string
    {
        return rtrim((string) Config::get('site_url', 'https://cubetimer.nl'), '/');
    }

    /**
     * Verstuurt een mail met een tekst- en een HTML-versie.
     */
    public static function send(string $to, string $subject, string $text, string $html): bool
    {
        if (!self::isEnabled()) {
            return false;
        }
        if (filter_var($to, FILTER_VALIDATE_EMAIL) === false) {
            error_log('[cubetimer] mail: ongeldig adres');
            return false;
        }

        $from = (string) Config::get('mail.from');
        $bericht = self::build($from, (string) Config::get('mail.from_name', 'CubeTimer'), $to, $subject, $text, $html);

        try {
            self::deliver($from, $to, $bericht);
            return true;
        } catch (RuntimeException $e) {
            error_log('[cubetimer] mail versturen mislukt: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Stelt het bericht samen: kopregels plus een tekst- en HTML-deel.
     * Los van het versturen, zodat het te testen is.
     */
    public static function build(string $from, string $fromName, string $to, string $subject, string $text, string $html): string
    {
        $grens = 'ct-' . bin2hex(random_bytes(12));
        $domein = substr((string) strrchr($from, '@'), 1) ?: 'cubetimer.nl';

        $kop = [
            'From: ' . self::encodeHeader($fromName) . ' <' . $from . '>',
            'To: <' . $to . '>',
            'Subject: ' . self::encodeHeader($subject),
            'Date: ' . gmdate('D, d M Y H:i:s') . ' +0000',
            'Message-ID: <' . bin2hex(random_bytes(16)) . '@' . $domein . '>',
            'MIME-Version: 1.0',
            'Content-Type: multipart/alternative; boundary="' . $grens . '"',
            // Automatische mail: geen afwezigheidsberichten terug, graag.
            'Auto-Submitted: auto-generated',
            'X-Auto-Response-Suppress: All',
        ];

        $delen = [];
        foreach (['text/plain' => $text, 'text/html' => $html] as $soort => $inhoud) {
            $delen[] = '--' . $grens . "\r\n"
                . 'Content-Type: ' . $soort . "; charset=UTF-8\r\n"
                . "Content-Transfer-Encoding: base64\r\n\r\n"
                . rtrim(chunk_split(base64_encode($inhoud), 76, "\r\n"));
        }

        return implode("\r\n", $kop) . "\r\n\r\n"
            . implode("\r\n", $delen) . "\r\n"
            . '--' . $grens . "--\r\n";
    }

    /** Een kopregel met tekens buiten ASCII, als =?UTF-8?B?...?=. */
    private static function encodeHeader(string $waarde): string
    {
        $waarde = str_replace(["\r", "\n"], ' ', $waarde);
        return preg_match('/^[\x20-\x7E]*$/', $waarde) === 1
            ? $waarde
            : '=?UTF-8?B?' . base64_encode($waarde) . '?=';
    }

    /* =====================================================================
     * SMTP
     * ================================================================== */

    /** @throws RuntimeException */
    private static function deliver(string $from, string $to, string $bericht): void
    {
        $host = (string) Config::get('mail.host');
        $versleuteling = strtolower((string) Config::get('mail.encryption', 'ssl'));
        $poort = (int) Config::get('mail.port', $versleuteling === 'ssl' ? 465 : 587);
        $controleer = Config::get('mail.verify_peer', true) !== false;

        $context = stream_context_create(['ssl' => [
            'verify_peer'      => $controleer,
            'verify_peer_name' => $controleer,
            'SNI_enabled'      => true,
            'peer_name'        => $host,
        ]]);

        $adres = ($versleuteling === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $poort;
        $verbinding = @stream_socket_client($adres, $foutcode, $fout, self::TIMEOUT, STREAM_CLIENT_CONNECT, $context);
        if ($verbinding === false) {
            throw new RuntimeException("verbinden met $adres mislukt ($foutcode $fout)");
        }
        stream_set_timeout($verbinding, self::TIMEOUT);

        try {
            self::expect($verbinding, 220);
            $naam = self::heloName();
            self::command($verbinding, 'EHLO ' . $naam, 250);

            if ($versleuteling === 'tls') {
                self::command($verbinding, 'STARTTLS', 220);
                $methode = STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT
                    | (defined('STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT') ? STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT : 0);
                if (@stream_socket_enable_crypto($verbinding, true, $methode) !== true) {
                    $reden = error_get_last()['message'] ?? '';
                    throw new RuntimeException('STARTTLS mislukt' . ($reden !== '' ? " ($reden)" : ''));
                }
                self::command($verbinding, 'EHLO ' . $naam, 250);
            }

            $gebruiker = (string) Config::get('mail.username', '');
            if ($gebruiker !== '') {
                self::command($verbinding, 'AUTH LOGIN', 334);
                self::command($verbinding, base64_encode($gebruiker), 334);
                self::command($verbinding, base64_encode((string) Config::get('mail.password', '')), 235, true);
            }

            self::command($verbinding, 'MAIL FROM:<' . $from . '>', 250);
            self::command($verbinding, 'RCPT TO:<' . $to . '>', [250, 251]);
            self::command($verbinding, 'DATA', 354);

            // Een regel die met een punt begint krijgt er een extra (RFC 5321).
            $inhoud = preg_replace('/^\./m', '..', $bericht);
            self::write($verbinding, $inhoud . "\r\n.");
            self::expect($verbinding, 250);

            self::write($verbinding, 'QUIT');
        } finally {
            fclose($verbinding);
        }
    }

    /**
     * Stuurt een opdracht en controleert het antwoord.
     *
     * @param int|list<int> $verwacht
     * @param bool $geheim het wachtwoord komt niet in een foutmelding
     * @throws RuntimeException
     */
    private static function command($verbinding, string $regel, int|array $verwacht, bool $geheim = false): string
    {
        self::write($verbinding, $regel);
        try {
            return self::expect($verbinding, $verwacht);
        } catch (RuntimeException $e) {
            $wat = $geheim ? '(wachtwoord)' : strtok($regel, ' ');
            throw new RuntimeException($wat . ': ' . $e->getMessage());
        }
    }

    private static function write($verbinding, string $regel): void
    {
        if (fwrite($verbinding, $regel . "\r\n") === false) {
            throw new RuntimeException('schrijven naar de mailserver mislukt');
        }
    }

    /**
     * Leest een (eventueel meerregelig) antwoord: "250-..." gaat door, "250 ..."
     * is de laatste regel.
     *
     * @param int|list<int> $verwacht
     * @throws RuntimeException
     */
    private static function expect($verbinding, int|array $verwacht): string
    {
        $antwoord = '';
        while (($regel = fgets($verbinding, 1024)) !== false) {
            $antwoord .= $regel;
            if (strlen($regel) < 4 || $regel[3] === ' ') {
                break;
            }
        }
        if ($antwoord === '') {
            $meta = stream_get_meta_data($verbinding);
            throw new RuntimeException(!empty($meta['timed_out']) ? 'geen antwoord (time-out)' : 'verbinding verbroken');
        }
        $code = (int) substr($antwoord, 0, 3);
        if (!in_array($code, (array) $verwacht, true)) {
            throw new RuntimeException('onverwacht antwoord: ' . trim($antwoord));
        }
        return $antwoord;
    }

    private static function heloName(): string
    {
        $host = (string) parse_url(self::siteUrl(), PHP_URL_HOST);
        return preg_match('/^[A-Za-z0-9.-]+$/', $host) === 1 ? $host : 'localhost';
    }
}
