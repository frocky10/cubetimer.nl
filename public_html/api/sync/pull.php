<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * GET /api/sync/pull.php
 * Geeft alle sessies en solves van de ingelogde gebruiker terug, in precies
 * de vorm die de browser in localStorage bewaart.
 *
 * Losse tijden (solves zonder sessie) komen hier *niet* in mee: die horen bij
 * het account, niet bij de timer. Wel het aantal, zodat het accountscherm kan
 * laten zien dat ze er zijn en wat je ermee kunt.
 */
Http::requireMethod('GET');

$user = Auth::requireUser();
$userId = (int) $user['id'];

$sessionRows = Database::all(
    'SELECT id, client_id, name, event, sort_order
     FROM timer_sessions WHERE user_id = ? ORDER BY sort_order, id',
    [$userId]
);

$sessions = [];
$byId = [];
foreach ($sessionRows as $row) {
    $sessions[] = [
        'id'    => $row['client_id'],
        'name'  => $row['name'],
        'event' => $row['event'],
        'times' => [],
    ];
    $byId[(int) $row['id']] = array_key_last($sessions);
}

if ($sessions !== []) {
    $metAnalyse = Database::hasColumn('solves', 'details');
    $solveRows = Database::all(
        'SELECT timer_session_id, client_id, raw_ms, penalty, scramble, source, solved_at'
        . ($metAnalyse ? ', details' : '') . '
         FROM solves WHERE user_id = ? AND timer_session_id IS NOT NULL ORDER BY solved_at, id',
        [$userId]
    );

    foreach ($solveRows as $row) {
        $index = $byId[(int) $row['timer_session_id']] ?? null;
        if ($index === null) {
            continue;
        }
        $solve = [
            'id'        => $row['client_id'],
            'raw'       => $row['raw_ms'] === null ? null : (int) $row['raw_ms'],
            'penalty'   => $row['penalty'] === 'none' ? null : $row['penalty'],
            'scramble'  => (string) ($row['scramble'] ?? ''),
            'source'    => (string) ($row['source'] ?? 'manual'),
            // De database staat in UTC; de browser rekent er lokale tijd van.
            'timestamp' => str_replace(' ', 'T', (string) $row['solved_at']) . 'Z',
        ];
        $analyse = SolveAnalysis::decode($row['details'] ?? null);
        if ($analyse !== null) {
            $solve['analysis'] = $analyse;
        }
        $sessions[$index]['times'][] = $solve;
    }
}

$losseTijden = (int) (Database::first(
    'SELECT COUNT(*) AS aantal FROM solves WHERE user_id = ? AND timer_session_id IS NULL',
    [$userId]
)['aantal'] ?? 0);

Http::ok([
    'sessions'    => $sessions,
    'looseSolves' => $losseTijden,
    'serverNow'   => gmdate('c'),
]);
