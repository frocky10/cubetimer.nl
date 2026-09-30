<?php
declare(strict_types=1);

/**
 * Wordt door elk API-bestand als eerste ingeladen.
 * Zet de foutafhandeling goed en maakt de libraries beschikbaar.
 */

require_once __DIR__ . '/lib/Config.php';
require_once __DIR__ . '/lib/Taal.php';
require_once __DIR__ . '/lib/Http.php';
require_once __DIR__ . '/lib/Database.php';
require_once __DIR__ . '/lib/Auth.php';
require_once __DIR__ . '/lib/RateLimiter.php';
require_once __DIR__ . '/lib/BotGuard.php';
require_once __DIR__ . '/lib/GitHubIssues.php';
require_once __DIR__ . '/lib/SiteTime.php';
require_once __DIR__ . '/lib/Events.php';
require_once __DIR__ . '/lib/Averages.php';
require_once __DIR__ . '/lib/Records.php';
require_once __DIR__ . '/lib/Xp.php';
require_once __DIR__ . '/lib/Leaderboard.php';
require_once __DIR__ . '/lib/Challenges.php';
require_once __DIR__ . '/lib/SolveFacts.php';
require_once __DIR__ . '/lib/Achievements.php';
require_once __DIR__ . '/lib/Follows.php';
require_once __DIR__ . '/lib/TournamentField.php';
require_once __DIR__ . '/lib/Tournaments.php';
require_once __DIR__ . '/lib/PublicProfile.php';
require_once __DIR__ . '/lib/SolveAnalysis.php';
require_once __DIR__ . '/lib/Ranking.php';
require_once __DIR__ . '/lib/GameModes.php';
require_once __DIR__ . '/lib/Duels.php';
require_once __DIR__ . '/lib/Wca.php';
require_once __DIR__ . '/lib/Mailer.php';
require_once __DIR__ . '/lib/AccountMail.php';
require_once __DIR__ . '/lib/AccountData.php';

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
