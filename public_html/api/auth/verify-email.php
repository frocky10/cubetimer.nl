<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/auth/verify-email.php
 * Body: { token }
 *
 * Bevestigt een e-mailadres met de link uit de mail. Inloggen is niet nodig:
 * de link wordt vaak op een ander apparaat geopend (de telefoon met de mail).
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

if (!AccountMail::isAvailable()) {
    Http::fail('unavailable', 'E-mail staat op deze server niet aan.', 503);
}

$limiet = RateLimiter::hit('verify:' . Auth::fingerprint(Http::clientIp()), 20, 3600);
if (!$limiet['allowed']) {
    Http::fail('rate_limited', 'Te veel pogingen. Probeer het over een uurtje nog eens.', 429);
}

$resultaat = AccountMail::verify(Http::stringInput('token'));
if (!$resultaat['ok']) {
    Http::fail('invalid_token', $resultaat['message'], 410);
}

Http::ok(['message' => $resultaat['message']]);
