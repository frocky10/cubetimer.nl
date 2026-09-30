<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/auth/resend-verification.php
 *
 * Stuurt de bevestigingsmail opnieuw naar het adres van de ingelogde
 * gebruiker. Hooguit drie keer per uur.
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

$user = Auth::requireUser();
if (!AccountMail::isAvailable()) {
    Http::fail('unavailable', 'E-mail staat op deze server niet aan.', 503);
}

$bevestigd = Database::first('SELECT email_verified_at FROM users WHERE id = ?', [(int) $user['id']]);
if ($bevestigd !== null && $bevestigd['email_verified_at'] !== null) {
    Http::ok(['message' => 'Je e-mailadres is al bevestigd.', 'alreadyVerified' => true]);
}

$limiet = RateLimiter::hit('resend:' . Auth::fingerprint((string) $user['id']), 3, 3600);
if (!$limiet['allowed']) {
    Http::fail('rate_limited', 'Je hebt de mail net al een paar keer gekregen. Kijk ook even in je spam.', 429);
}

if (!AccountMail::sendVerification((int) $user['id'])) {
    Http::fail('send_failed', 'De mail kon niet verstuurd worden. Probeer het later nog eens.', 502);
}

Http::ok(['message' => 'Verstuurd naar ' . $user['email'] . '. Kijk ook even in je spam.']);
