<?php
declare(strict_types=1);

/**
 * Laadt de configuratie uit een bestand buiten de webroot en geeft er
 * puntgescheiden toegang toe: Config::get('db.host').
 */
final class Config
{
    /** @var array<string,mixed>|null */
    private static ?array $values = null;
    private static ?string $loadedFrom = null;

    /** @return array<string,mixed> */
    public static function all(): array
    {
        if (self::$values === null) {
            self::load();
        }
        return self::$values ?? [];
    }

    public static function get(string $path, mixed $default = null): mixed
    {
        $value = self::all();
        foreach (explode('.', $path) as $segment) {
            if (!is_array($value) || !array_key_exists($segment, $value)) {
                return $default;
            }
            $value = $value[$segment];
        }
        return $value;
    }

    /** Pad van het geladen configbestand, of null als er geen gevonden is. */
    public static function loadedFrom(): ?string
    {
        self::all();
        return self::$loadedFrom;
    }

    public static function isConfigured(): bool
    {
        return self::loadedFrom() !== null;
    }

    private static function load(): void
    {
        self::$values = [];

        foreach (self::candidatePaths() as $path) {
            if ($path === '' || !is_file($path) || !is_readable($path)) {
                continue;
            }
            /** @psalm-suppress UnresolvableInclude */
            $loaded = require $path;
            if (is_array($loaded)) {
                self::$values = $loaded;
                self::$loadedFrom = $path;
                return;
            }
        }
    }

    /** @return list<string> */
    private static function candidatePaths(): array
    {
        $apiDir = dirname(__DIR__);              // .../public_html/api
        $webroot = dirname($apiDir);             // .../public_html
        $accountRoot = dirname($webroot);        // .../  (boven public_html)

        $paths = [];

        $fromEnv = getenv('CUBETIMER_CONFIG');
        if (is_string($fromEnv) && $fromEnv !== '') {
            $paths[] = $fromEnv;
        }

        $home = getenv('HOME');
        if (is_string($home) && $home !== '') {
            $paths[] = rtrim($home, '/') . '/cubetimer_config.php';
        }

        $paths[] = $accountRoot . '/cubetimer_config.php';
        $paths[] = $apiDir . '/config.php';

        return $paths;
    }
}
