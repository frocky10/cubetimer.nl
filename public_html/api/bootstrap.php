<?php
declare(strict_types=1);

/**
 * Wordt door elk API-bestand als eerste ingeladen.
 * Zet de foutafhandeling goed en maakt de libraries beschikbaar.
 */

require_once __DIR__ . '/lib/Config.php';
require_once __DIR__ . '/lib/Http.php';
require_once __DIR__ . '/lib/Database.php';
require_once __DIR__ . '/lib/Auth.php';
require_once __DIR__ . '/lib/RateLimiter.php';
require_once __DIR__ . '/lib/GitHubIssues.php';

$debug = Config::get('debug', false) === true;

ini_set('display_errors', $debug ? '1' : '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);
date_default_timezone_set('UTC');

// Nooit een halve HTML-foutpagina terugsturen op een JSON-endpoint.
set_exception_handler(static function (Throwable $e) use ($debug): void {
    error_log('[cubetimer] onafgevangen fout: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    Http::fail(
        'server_error',
        'Er ging iets mis op de server.',
        500,
        $debug ? ['detail' => $e->getMessage(), 'where' => $e->getFile() . ':' . $e->getLine()] : []
    );
});

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
