<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

/**
 * GET /api/status.php
 *
 * Vertelt de frontend welke onderdelen op deze server beschikbaar zijn, zodat
 * de interface knoppen kan verbergen die toch niet zouden werken. Geeft bewust
 * geen versienummers of paden prijs.
 */
Http::requireMethod('GET');

$databaseReady = false;
if (Database::isConfigured()) {
    $databaseReady = Database::hasTable('users');
}

Http::ok([
    'features' => [
        'accounts' => $databaseReady,
        'sync'     => $databaseReady,
        'feedback' => GitHubIssues::isEnabled(),
    ],
    'authenticated' => Auth::user() !== null,
]);
