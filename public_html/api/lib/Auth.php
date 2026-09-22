<?php
declare(strict_types=1);

require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Http.php';

/**
 * Registratie, login en sessieherkenning.
 *
 * De cookie bevat een willekeurig token; in de database staat alleen de
 * SHA-256 hash daarvan. Wie de database leest kan dus geen sessie overnemen.
 */
final class Auth
{
    /** @var array<string,mixed>|null */
    private static ?array $currentUser = null;
    private static bool $resolved = false;

    public const USERNAME_PATTERN = '/^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/';
    public const MIN_PASSWORD_LENGTH = 8;
    public const MAX_PASSWORD_LENGTH = 200;

    /** Hasht een waarde (IP-adres) met de app_key erbij, zodat hij niet te raden is. */
    public static function fingerprint(string $value): string
    {
        $key = (string) Config::get('security.app_key', 'cubetimer');
        return hash_hmac('sha256', $value, $key);
    }

    /** De ingelogde gebruiker, of null. */
    public static function user(): ?array
    {
        if (self::$resolved) {
            return self::$currentUser;
        }
        self::$resolved = true;
        self::$currentUser = self::resolveFromCookie();
        return self::$currentUser;
    }

    /** De ingelogde gebruiker, of een 401. */
    public static function requireUser(): array
    {
        $user = self::user();
        if ($user === null) {
            Http::fail('unauthenticated', 'Je moet ingelogd zijn voor deze actie.', 401);
        }
        return $user;
    }

    private static function resolveFromCookie(): ?array
    {
        $cookieName = (string) Config::get('security.cookie_name', 'cubetimer_session');
        $token = $_COOKIE[$cookieName] ?? '';
        if (!is_string($token) || $token === '') {
            return null;
        }
        if (Database::tryConnection() === null) {
            return null;
        }

        try {
            $row = Database::first(
                'SELECT u.id, u.public_id, u.username, u.email, u.role, u.created_at,
                        p.display_name, p.country_code, p.main_event, p.xp, p.level,
                        s.id AS session_id, s.expires_at
                 FROM user_sessions s
                 JOIN users u ON u.id = s.user_id
                 LEFT JOIN user_profiles p ON p.user_id = u.id
                 WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() AND u.is_active = 1
                 LIMIT 1',
                [hash('sha256', $token)]
            );
        } catch (PDOException $e) {
            error_log('[cubetimer] sessie opzoeken mislukt: ' . $e->getMessage());
            return null;
        }

        if ($row === null) {
            self::clearCookie();
            return null;
        }

        // Hooguit één keer per uur schrijven, anders is elk verzoek een UPDATE.
        try {
            Database::run(
                'UPDATE user_sessions SET last_seen_at = UTC_TIMESTAMP()
                 WHERE id = ? AND last_seen_at < (UTC_TIMESTAMP() - INTERVAL 1 HOUR)',
                [$row['session_id']]
            );
        } catch (PDOException) {
            // Niet erg genoeg om het verzoek op te laten vallen.
        }

        return $row;
    }

    /** Maakt een sessie aan en zet de cookie. */
    public static function startSession(int $userId): void
    {
        $token = bin2hex(random_bytes(32));
        $days = max(1, (int) Config::get('security.session_lifetime_days', 90));
        $expiresAt = (new DateTimeImmutable('now', new DateTimeZone('UTC')))
            ->add(new DateInterval('P' . $days . 'D'));

        Database::run(
            'INSERT INTO user_sessions (user_id, token_hash, user_agent, ip_hash, expires_at)
             VALUES (?, ?, ?, ?, ?)',
            [
                $userId,
                hash('sha256', $token),
                substr(Http::userAgent(), 0, 191),
                self::fingerprint(Http::clientIp()),
                $expiresAt->format('Y-m-d H:i:s'),
            ]
        );

        self::setCookie($token, $expiresAt->getTimestamp());
        self::pruneExpiredSessions();
    }

    /** Beëindigt de huidige sessie. */
    public static function endSession(): void
    {
        $cookieName = (string) Config::get('security.cookie_name', 'cubetimer_session');
        $token = $_COOKIE[$cookieName] ?? '';
        if (is_string($token) && $token !== '' && Database::tryConnection() !== null) {
            try {
                Database::run('DELETE FROM user_sessions WHERE token_hash = ?', [hash('sha256', $token)]);
            } catch (PDOException $e) {
                error_log('[cubetimer] uitloggen mislukt: ' . $e->getMessage());
            }
        }
        self::clearCookie();
    }

    private static function setCookie(string $token, int $expiresAt): void
    {
        setcookie((string) Config::get('security.cookie_name', 'cubetimer_session'), $token, [
            'expires'  => $expiresAt,
            'path'     => '/',
            'secure'   => (bool) Config::get('security.cookie_secure', true),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    private static function clearCookie(): void
    {
        if (headers_sent()) {
            return;
        }
        setcookie((string) Config::get('security.cookie_name', 'cubetimer_session'), '', [
            'expires'  => time() - 3600,
            'path'     => '/',
            'secure'   => (bool) Config::get('security.cookie_secure', true),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    /** Ruimt af en toe verlopen sessies op; een cronjob is hier niet voor nodig. */
    private static function pruneExpiredSessions(): void
    {
        if (random_int(1, 50) !== 1) {
            return;
        }
        try {
            Database::run('DELETE FROM user_sessions WHERE expires_at < UTC_TIMESTAMP()');
            Database::run('DELETE FROM password_resets WHERE expires_at < UTC_TIMESTAMP()');
        } catch (PDOException) {
            // Opruimen mag altijd mislukken.
        }
    }

    /** Publieke voorstelling van een gebruiker (nooit hashes of interne ids). */
    public static function publicUser(array $row): array
    {
        return [
            'id'          => $row['public_id'] ?? null,
            'username'    => $row['username'] ?? null,
            'email'       => $row['email'] ?? null,
            'displayName' => $row['display_name'] ?? ($row['username'] ?? null),
            'role'        => $row['role'] ?? 'user',
            'country'     => $row['country_code'] ?? null,
            'mainEvent'   => $row['main_event'] ?? '333',
            'xp'          => isset($row['xp']) ? (int) $row['xp'] : 0,
            'level'       => isset($row['level']) ? (int) $row['level'] : 1,
            'createdAt'   => $row['created_at'] ?? null,
        ];
    }

    /** @return string|null Foutmelding, of null als het wachtwoord voldoet. */
    public static function validatePassword(string $password): ?string
    {
        $length = strlen($password);
        if ($length < self::MIN_PASSWORD_LENGTH) {
            return 'Je wachtwoord moet minstens ' . self::MIN_PASSWORD_LENGTH . ' tekens lang zijn.';
        }
        if ($length > self::MAX_PASSWORD_LENGTH) {
            return 'Je wachtwoord mag hooguit ' . self::MAX_PASSWORD_LENGTH . ' tekens lang zijn.';
        }
        if (preg_match('/^\d+$/', $password) === 1) {
            return 'Kies een wachtwoord met meer dan alleen cijfers.';
        }
        return null;
    }
}
