<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * GET  /api/admin/flags.php              de wachtrij met verdachte solves
 * POST /api/admin/flags.php  { id, decision: 'approve'|'reject' }
 *
 * Alleen voor een account met de rol `admin`. Zet die met de hand:
 *   UPDATE users SET role = 'admin' WHERE username = 'jouwnaam';
 *
 * Een solve in de wachtrij telt niet mee voor records en ranglijsten. De
 * gebruiker zelf ziet zijn tijd gewoon staan; alleen de ranglijst wacht op
 * jouw oordeel.
 */
$user = Auth::requireUser();
if (($user['role'] ?? 'user') !== 'admin') {
    Http::fail('forbidden', 'Deze pagina is alleen voor beheerders.', 403);
}

if (Http::method() === 'GET') {
    $gevraagd = (string) ($_GET['status'] ?? 'pending');
    $status = in_array($gevraagd, ['pending', 'approved', 'rejected'], true) ? $gevraagd : 'pending';

    $rows = Database::all(
        'SELECT f.id, f.solve_client_id, f.event, f.value_ms, f.reason, f.detail, f.status, f.created_at,
                u.username, u.public_id
         FROM solve_flags f
         JOIN users u ON u.id = f.user_id
         WHERE f.status = ?
         ORDER BY f.created_at DESC
         LIMIT 200',
        [$status]
    );

    $open = Database::first("SELECT COUNT(*) AS aantal FROM solve_flags WHERE status = 'pending'");

    Http::ok([
        'status'  => $status,
        'pending' => (int) ($open['aantal'] ?? 0),
        'flags'   => array_map(static fn ($row) => [
            'id'        => (int) $row['id'],
            'user'      => $row['username'],
            'event'     => $row['event'],
            'eventLabel' => Events::label((string) $row['event']),
            'valueMs'   => $row['value_ms'] === null ? null : (int) $row['value_ms'],
            'reason'    => $row['reason'],
            'detail'    => $row['detail'],
            'status'    => $row['status'],
            'createdAt' => str_replace(' ', 'T', (string) $row['created_at']) . 'Z',
        ], $rows),
    ]);
}

Http::requireMethod('GET', 'POST');
Http::requireAjaxHeader();

$id = (int) Http::input('id', 0);
$decision = Http::stringInput('decision');

if ($id <= 0 || !in_array($decision, ['approve', 'reject'], true)) {
    Http::fail('invalid_decision', 'Geef een markering en een beslissing mee.', 422);
}

$flag = Database::first('SELECT user_id FROM solve_flags WHERE id = ?', [$id]);
if ($flag === null) {
    Http::fail('not_found', 'Die markering bestaat niet (meer).', 404);
}

Database::run(
    'UPDATE solve_flags SET status = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?',
    [$decision === 'approve' ? 'approved' : 'rejected', (int) $user['id'], $id]
);

// De records van die gebruiker kloppen nu niet meer: opnieuw uitrekenen.
$herberekening = Records::rebuild((int) $flag['user_id']);
Xp::sync((int) $flag['user_id'], $herberekening);

Http::ok(['message' => $decision === 'approve'
    ? 'Goedgekeurd. De tijd telt weer mee.'
    : 'Afgekeurd. De tijd blijft buiten de ranglijsten.']);
