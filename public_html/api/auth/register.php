<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/auth/register.php
 * Body: { username, email, password, website, formToken }
 * (website en formToken: zie BotGuard)
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();
BotGuard::check('register');

$ipKey = Auth::fingerprint(Http::clientIp());
$limit = RateLimiter::hit("register:{$ipKey}", 5, 3600);
if (!$limit['allowed']) {
    Http::fail('rate_limited', 'Te veel registratiepogingen. Probeer het over een uurtje nog eens.', 429, [
        'retryAfter' => $limit['retryAfter'],
    ]);
}

$username = Http::stringInput('username');
$email    = strtolower(Http::stringInput('email'));
$password = (string) Http::input('password', '');

if (preg_match(Auth::USERNAME_PATTERN, $username) !== 1) {
    Http::fail(
        'invalid_username',
        'Kies een gebruikersnaam van 3 tot 32 tekens: letters, cijfers, punt, streepje of underscore, beginnend met een letter of cijfer.',
        422
    );
}
if (filter_var($email, FILTER_VALIDATE_EMAIL) === false || strlen($email) > 191) {
    Http::fail('invalid_email', 'Dat lijkt geen geldig e-mailadres.', 422);
}
if (($passwordError = Auth::validatePassword($password)) !== null) {
    Http::fail('invalid_password', $passwordError, 422);
}

$pdo = Database::connection();

$existing = Database::first(
    'SELECT username_lower, email_lower FROM users WHERE username_lower = ? OR email_lower = ? LIMIT 1',
    [strtolower($username), $email]
);
if ($existing !== null) {
    if ($existing['email_lower'] === $email) {
        Http::fail('email_taken', 'Er bestaat al een account met dit e-mailadres.', 409);
    }
    Http::fail('username_taken', 'Deze gebruikersnaam is al bezet.', 409);
}

$publicId = sprintf(
    '%s-%s-4%s-%x%s-%s',
    bin2hex(random_bytes(4)),
    bin2hex(random_bytes(2)),
    substr(bin2hex(random_bytes(2)), 1),
    random_int(8, 11),
    substr(bin2hex(random_bytes(2)), 1),
    bin2hex(random_bytes(6))
);

$pdo->beginTransaction();
try {
    Database::run(
        'INSERT INTO users (public_id, username, username_lower, email, email_lower, password_hash)
         VALUES (?, ?, ?, ?, ?, ?)',
        [
            $publicId,
            $username,
            strtolower($username),
            $email,
            $email,
            password_hash($password, PASSWORD_DEFAULT),
        ]
    );
    $userId = (int) $pdo->lastInsertId();

    Database::run(
        'INSERT INTO user_profiles (user_id, display_name) VALUES (?, ?)',
        [$userId, $username]
    );

    Database::run('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [$userId]);

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $e;
}

Auth::startSession($userId);

$row = Database::first(
    'SELECT u.id, u.public_id, u.username, u.email, u.email_verified_at, u.role, u.created_at,
            p.display_name, p.country_code, p.main_event, p.xp, p.level
     FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE u.id = ?',
    [$userId]
);

// Een bevestigingsmail, als mail aanstaat. Mislukt dat, dan is het account
// er gewoon; in het accountvenster kun je hem opnieuw laten sturen.
$verstuurd = false;
try {
    $verstuurd = AccountMail::sendVerification($userId);
} catch (Throwable $e) {
    error_log('[cubetimer] bevestigingsmail mislukt: ' . $e->getMessage());
}

Http::ok(['user' => Auth::publicUser($row ?? []), 'verificationSent' => $verstuurd], 201);
