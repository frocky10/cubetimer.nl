<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/auth/reset-password.php
 * Body: { token, password }
 *
 * Zet een nieuw wachtwoord met de link uit de mail. Alle andere inlogsessies
 * van dit account worden beëindigd, en je bent daarna meteen ingelogd.
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

$limiet = RateLimiter::hit('reset:' . Auth::fingerprint(Http::clientIp()), 10, 3600);
if (!$limiet['allowed']) {
    Http::fail('rate_limited', 'Te veel pogingen. Probeer het over een uurtje nog eens.', 429);
}

$resultaat = AccountMail::resetPassword(Http::stringInput('token'), (string) Http::input('password', ''));
if (!$resultaat['ok']) {
    Http::fail('reset_failed', $resultaat['message'], 422);
}

Auth::startSession($resultaat['userId']);

$row = Database::first(
    'SELECT u.id, u.public_id, u.username, u.email, u.email_verified_at, u.role, u.created_at,
            p.display_name, p.country_code, p.main_event, p.xp, p.level
     FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE u.id = ?',
    [$resultaat['userId']]
);

Http::ok(['message' => $resultaat['message'], 'user' => Auth::publicUser($row ?? [])]);
