<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/auth/forgot-password.php
 * Body: { identifier }   e-mailadres of gebruikersnaam
 *
 * Stuurt een herstellink. Het antwoord is altijd hetzelfde, of het account nu
 * bestaat of niet: anders kun je hiermee uitzoeken wie er een account heeft.
 * Om dezelfde reden gaat de mail pas weg nadat het antwoord verstuurd is (op
 * PHP-FPM); anders zou een trager antwoord verraden dat het adres bestaat.
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

if (!Mailer::isEnabled()) {
    Http::fail('unavailable', 'Wachtwoord herstellen staat op deze server niet aan.', 503);
}

$identifier = mb_substr(Http::stringInput('identifier'), 0, 191);
if (trim($identifier) === '') {
    Http::fail('invalid_identifier', 'Vul je e-mailadres of gebruikersnaam in.', 422);
}

$perIp = RateLimiter::hit('forgot-ip:' . Auth::fingerprint(Http::clientIp()), 5, 3600);
$perAccount = RateLimiter::hit('forgot-id:' . Auth::fingerprint(strtolower(trim($identifier))), 3, 3600);
if (!$perIp['allowed'] || !$perAccount['allowed']) {
    Http::fail('rate_limited', 'Te veel aanvragen. Probeer het over een uurtje nog eens.', 429);
}

register_shutdown_function(static function () use ($identifier): void {
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    }
    try {
        AccountMail::requestReset($identifier);
    } catch (Throwable $e) {
        error_log('[cubetimer] herstelmail mislukt: ' . $e->getMessage());
    }
});

Http::ok(['message' => 'Als dit account bestaat, staat er binnen een paar minuten een mail klaar. Kijk ook even in je spam.']);
