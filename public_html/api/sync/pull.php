<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * GET /api/sync/pull.php
 * Geeft alle sessies en solves van de ingelogde gebruiker terug, in precies
 * de vorm die de browser in localStorage bewaart.
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
    $solveRows = Database::all(
        'SELECT timer_session_id, client_id, raw_ms, penalty, scramble, source, solved_at
         FROM solves WHERE user_id = ? ORDER BY solved_at, id',
        [$userId]
    );

    foreach ($solveRows as $row) {
        $index = $byId[(int) $row['timer_session_id']] ?? null;
        if ($index === null) {
            continue;
        }
        $sessions[$index]['times'][] = [
            'id'        => $row['client_id'],
            'raw'       => $row['raw_ms'] === null ? null : (int) $row['raw_ms'],
            'penalty'   => $row['penalty'] === 'none' ? null : $row['penalty'],
            'scramble'  => (string) ($row['scramble'] ?? ''),
            'source'    => (string) ($row['source'] ?? 'manual'),
            // De database staat in UTC; de browser rekent er lokale tijd van.
            'timestamp' => str_replace(' ', 'T', (string) $row['solved_at']) . 'Z',
        ];
    }
}

Http::ok([
    'sessions'  => $sessions,
    'serverNow' => gmdate('c'),
]);
