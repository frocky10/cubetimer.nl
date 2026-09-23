<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/archive/restore.php
 * Body: { event?: '333' }
 *
 * Haalt losse tijden terug in de timer door er weer een sessie omheen te
 * zetten: één per event, want een sessie heeft één event en losse tijden
 * kunnen van alles door elkaar zijn. Zonder `event` worden ze allemaal
 * teruggehaald.
 *
 * De solves zelf blijven precies wat ze waren; alleen hun sessie verandert.
 * Er hoeft dus niets herberekend te worden: records, XP en achievements
 * stonden er al op.
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

const MAX_TERUG_PER_KEER = 20;

$user = Auth::requireUser();
$userId = (int) $user['id'];

$event = Http::stringInput('event', '');
if ($event !== '' && !Events::isKnown($event)) {
    Http::fail('unknown_event', 'Dat is geen event dat we kennen.', 422);
}

$params = [$userId];
$filter = '';
if ($event !== '') {
    $filter = ' AND event = ?';
    $params[] = $event;
}

$events = Database::all(
    'SELECT event, COUNT(*) AS aantal
     FROM solves
     WHERE user_id = ? AND timer_session_id IS NULL' . $filter . '
     GROUP BY event
     ORDER BY aantal DESC, event',
    $params
);

if ($events === []) {
    Http::ok(['restored' => 0, 'sessions' => 0]);
}

// Niet meer dan een handvol nieuwe sessies in één keer: anders krijgt iemand
// die ooit twintig events door elkaar heeft getimed er twintig sessies bij.
if (count($events) > MAX_TERUG_PER_KEER) {
    $events = array_slice($events, 0, MAX_TERUG_PER_KEER);
}

$volgende = (int) (Database::first(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS volgende FROM timer_sessions WHERE user_id = ?',
    [$userId]
)['volgende'] ?? 0);

$pdo = Database::connection();
$pdo->beginTransaction();
try {
    $teruggehaald = 0;
    $sessies = 0;

    foreach ($events as $rij) {
        $eventId = (string) $rij['event'];
        $naam = mb_substr('Teruggehaald · ' . Events::label($eventId), 0, 64);
        $clientId = 'session-terug-' . bin2hex(random_bytes(8));

        Database::run(
            'INSERT INTO timer_sessions (user_id, client_id, name, event, sort_order) VALUES (?, ?, ?, ?, ?)',
            [$userId, $clientId, $naam, $eventId, $volgende]
        );
        $sessieId = (int) $pdo->lastInsertId();
        $volgende += 1;
        $sessies += 1;

        $teruggehaald += Database::run(
            'UPDATE solves SET timer_session_id = ?
             WHERE user_id = ? AND timer_session_id IS NULL AND event = ?',
            [$sessieId, $userId, $eventId]
        )->rowCount();
    }

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $e;
}

Http::ok([
    'restored' => $teruggehaald,
    'sessions' => $sessies,
]);
