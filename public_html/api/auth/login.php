<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/auth/login.php
 * Body: { login, password, website, formToken }
 * `login` is een gebruikersnaam of e-mailadres; website en formToken: zie BotGuard.
 * BotGuard staat vóór de limieten, zodat een domme bot niet de limiet van een
 * echt account opmaakt en de eigenaar buitensluit.
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();
BotGuard::check('login');

$login    = Http::stringInput('login');
$password = (string) Http::input('password', '');

if ($login === '' || $password === '') {
    Http::fail('missing_credentials', 'Vul je gebruikersnaam en wachtwoord in.', 422);
}

$ipKey = Auth::fingerprint(Http::clientIp());
$byIp = RateLimiter::hit("login-ip:{$ipKey}", 15, 900);
$byAccount = RateLimiter::hit('login-account:' . Auth::fingerprint(strtolower($login)), 8, 900);
if (!$byIp['allowed'] || !$byAccount['allowed']) {
    Http::fail('rate_limited', 'Te veel inlogpogingen. Wacht even en probeer het opnieuw.', 429, [
        'retryAfter' => max($byIp['retryAfter'], $byAccount['retryAfter']),
    ]);
}

$normalized = strtolower($login);
$row = Database::first(
    'SELECT u.id, u.public_id, u.username, u.email, u.email_verified_at, u.role, u.created_at, u.password_hash, u.is_active,
            p.display_name, p.country_code, p.main_event, p.xp, p.level
     FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE u.username_lower = ? OR u.email_lower = ?
     LIMIT 1',
    [$normalized, $normalized]
);

// Altijd een hash verifiëren, ook als de gebruiker niet bestaat: anders is aan
// de responstijd te zien welke gebruikersnamen wel en niet bestaan.
$hash = is_array($row) ? (string) $row['password_hash'] : '$2y$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
$passwordOk = password_verify($password, $hash);

if ($row === null || !$passwordOk || (int) $row['is_active'] !== 1) {
    Http::fail('invalid_credentials', 'Gebruikersnaam of wachtwoord klopt niet.', 401);
}

$userId = (int) $row['id'];

if (password_needs_rehash($hash, PASSWORD_DEFAULT)) {
    Database::run('UPDATE users SET password_hash = ? WHERE id = ?', [
        password_hash($password, PASSWORD_DEFAULT),
        $userId,
    ]);
}

Database::run('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [$userId]);
Auth::startSession($userId);

Http::ok(['user' => Auth::publicUser($row)]);
