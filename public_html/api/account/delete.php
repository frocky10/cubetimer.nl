<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/account/delete.php
 * Body: { password }
 *
 * Verwijdert je account met alles erop (AVG: recht op vergetelheid). Direct en
 * onomkeerbaar. Vraagt je wachtwoord opnieuw: een open laptop of een
 * gestolen sessiecookie mag niet genoeg zijn om een account te wissen.
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

if (Database::tryConnection() === null) {
    Http::fail('database_unavailable', 'De database is even niet bereikbaar. Probeer het later nog eens.', 503);
}

$user = Auth::requireUser();
$userId = (int) $user['id'];

// Anders is dit een manier om het wachtwoord te raden van wie een sessie heeft.
$limit = RateLimiter::hit('delete-account:' . $userId, 5, 3600);
if (!$limit['allowed']) {
    Http::fail('rate_limited', 'Te veel pogingen. Probeer het over een uurtje nog eens.', 429);
}

$password = (string) Http::input('password', '');
$rij = Database::first('SELECT password_hash FROM users WHERE id = ?', [$userId]);
if ($rij === null || $password === '' || !password_verify($password, (string) $rij['password_hash'])) {
    Http::fail('invalid_password', 'Dat wachtwoord klopt niet.', 403);
}

AccountData::delete($userId);
Auth::endSession();

Http::ok(['message' => 'Je account en al je gegevens zijn verwijderd.']);
