<?php
declare(strict_types=1);

require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Http.php';

/**
 * Dunne wrapper rond PDO. De verbinding wordt pas opgezet als er echt een
 * query nodig is, zodat de bug-knop blijft werken op een installatie zonder
 * database.
 */
final class Database
{
    private static ?PDO $pdo = null;
    private static ?string $lastError = null;

    /** Is er een database geconfigureerd? (zegt nog niets over bereikbaarheid) */
    public static function isConfigured(): bool
    {
        return (string) Config::get('db.name', '') !== '';
    }

    /** Verbinding of null als er geen database is of de verbinding faalt. */
    public static function tryConnection(): ?PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }
        if (!self::isConfigured()) {
            self::$lastError = 'Er is geen database geconfigureerd.';
            return null;
        }

        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=%s',
            (string) Config::get('db.host', 'localhost'),
            (int) Config::get('db.port', 3306),
            (string) Config::get('db.name', ''),
            (string) Config::get('db.charset', 'utf8mb4')
        );

        try {
            self::$pdo = new PDO(
                $dsn,
                (string) Config::get('db.user', ''),
                (string) Config::get('db.password', ''),
                [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES   => false,
                ]
            );
            // Alles in de database staat in UTC; zo rekenen datumfuncties goed.
            self::$pdo->exec("SET time_zone = '+00:00'");
        } catch (PDOException $e) {
            self::$lastError = $e->getMessage();
            error_log('[cubetimer] databaseverbinding mislukt: ' . $e->getMessage());
            return null;
        }

        return self::$pdo;
    }

    /** Verbinding, of een nette 503 als de database niet beschikbaar is. */
    public static function connection(): PDO
    {
        $pdo = self::tryConnection();
        if ($pdo === null) {
            Http::fail(
                'database_unavailable',
                'De accountfunctie is nog niet ingesteld op deze server.',
                503,
                Config::get('debug', false) === true ? ['detail' => self::$lastError] : []
            );
        }
        return $pdo;
    }

    /** @param array<string|int,mixed> $params */
    public static function run(string $sql, array $params = []): PDOStatement
    {
        $statement = self::connection()->prepare($sql);
        $statement->execute($params);
        return $statement;
    }

    /**
     * @param array<string|int,mixed> $params
     * @return array<string,mixed>|null
     */
    public static function first(string $sql, array $params = []): ?array
    {
        $row = self::run($sql, $params)->fetch();
        return is_array($row) ? $row : null;
    }

    /**
     * @param array<string|int,mixed> $params
     * @return list<array<string,mixed>>
     */
    public static function all(string $sql, array $params = []): array
    {
        /** @var list<array<string,mixed>> $rows */
        $rows = self::run($sql, $params)->fetchAll();
        return $rows;
    }

    /** Bestaat een tabel? Gebruikt om optionele tabellen over te slaan. */
    public static function hasTable(string $table): bool
    {
        $pdo = self::tryConnection();
        if ($pdo === null) {
            return false;
        }
        try {
            $statement = $pdo->prepare(
                'SELECT COUNT(*) FROM information_schema.tables
                 WHERE table_schema = DATABASE() AND table_name = ?'
            );
            $statement->execute([$table]);
            return (int) $statement->fetchColumn() > 0;
        } catch (PDOException) {
            return false;
        }
    }
}
