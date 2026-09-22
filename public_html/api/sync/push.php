<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/sync/push.php
 * Body: { sessions: [ { id, name, event, times: [ { id, raw, penalty, timestamp, scramble, source } ] } ] }
 *
 * De browser stuurt zijn volledige staat; de server vervangt die van de
 * gebruiker in één transactie. Dat is bewust simpel gehouden: er is per account
 * maar één bron van waarheid (de browser die als laatste synct), en daarmee
 * zijn er geen merge-conflicten mogelijk. De client voert de eigenlijke merge
 * uit bij het inloggen.
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

const MAX_SESSIONS = 300;
const MAX_SOLVES = 50000;
const MAX_SCRAMBLE_LENGTH = 2000;
const VALID_PENALTIES = ['none', 'plus2', 'dnf'];

$user = Auth::requireUser();
$userId = (int) $user['id'];

$payload = Http::input('sessions', null);
if (!is_array($payload)) {
    Http::fail('invalid_payload', 'Er zijn geen sessies meegestuurd.', 422);
}
if (count($payload) > MAX_SESSIONS) {
    Http::fail('too_many_sessions', 'Je hebt meer sessies dan we kunnen opslaan (maximaal ' . MAX_SESSIONS . ').', 422);
}

/** Maakt een tekst veilig en kort genoeg voor de kolom. */
$clean = static function (mixed $value, int $maxLength): string {
    $text = is_scalar($value) ? trim((string) $value) : '';
    return mb_substr($text, 0, $maxLength);
};

/** Zet een ISO-timestamp uit de browser om naar 'Y-m-d H:i:s' in UTC. */
$toUtc = static function (mixed $value): string {
    $fallback = gmdate('Y-m-d H:i:s');
    if (!is_string($value) || $value === '') {
        return $fallback;
    }
    try {
        return (new DateTimeImmutable($value))
            ->setTimezone(new DateTimeZone('UTC'))
            ->format('Y-m-d H:i:s');
    } catch (Exception) {
        return $fallback;
    }
};

// Eerst alles valideren en normaliseren, pas daarna de database aanraken.
$sessions = [];
$receivedSolves = 0;   // alles wat de browser stuurde, inclusief dubbelingen
$storedSolves = 0;     // wat er daadwerkelijk opgeslagen wordt
$seenSessionIds = [];
$seenSolveIds = [];

foreach (array_values($payload) as $order => $rawSession) {
    if (!is_array($rawSession)) {
        continue;
    }
    $clientId = $clean($rawSession['id'] ?? '', 64);
    if ($clientId === '' || isset($seenSessionIds[$clientId])) {
        continue;
    }
    $seenSessionIds[$clientId] = true;

    $times = [];
    $rawTimes = $rawSession['times'] ?? [];
    if (is_array($rawTimes)) {
        foreach ($rawTimes as $rawSolve) {
            if (!is_array($rawSolve)) {
                continue;
            }
            if (++$receivedSolves > MAX_SOLVES) {
                Http::fail('too_many_solves', 'Je hebt meer solves dan we kunnen opslaan (maximaal ' . MAX_SOLVES . ').', 422);
            }

            $solveId = $clean($rawSolve['id'] ?? '', 64);
            if ($solveId === '' || isset($seenSolveIds[$solveId])) {
                // Zonder uniek id kunnen we niet ontdubbelen; sla over.
                continue;
            }
            $seenSolveIds[$solveId] = true;
            $storedSolves += 1;

            $penalty = $clean($rawSolve['penalty'] ?? 'none', 8);
            if ($penalty === '' || $penalty === 'null') {
                $penalty = 'none';
            }
            if (!in_array($penalty, VALID_PENALTIES, true)) {
                $penalty = 'none';
            }

            $raw = $rawSolve['raw'] ?? null;
            $rawMs = is_numeric($raw) ? (int) round((float) $raw) : null;
            if ($rawMs !== null && ($rawMs < 0 || $rawMs > 86400000)) {
                $rawMs = null;
            }
            if ($rawMs === null) {
                $penalty = 'dnf';
            }

            $times[] = [
                'client_id' => $solveId,
                'raw_ms'    => $rawMs,
                'penalty'   => $penalty,
                'scramble'  => $clean($rawSolve['scramble'] ?? '', MAX_SCRAMBLE_LENGTH),
                'source'    => $clean($rawSolve['source'] ?? 'manual', 16) ?: 'manual',
                'solved_at' => $toUtc($rawSolve['timestamp'] ?? null),
            ];
        }
    }

    $sessions[] = [
        'client_id'  => $clientId,
        'name'       => $clean($rawSession['name'] ?? 'Session', 64) ?: 'Session',
        'event'      => $clean($rawSession['event'] ?? '333', 24) ?: '333',
        'sort_order' => (int) $order,
        'times'      => $times,
    ];
}

$pdo = Database::connection();
$pdo->beginTransaction();
try {
    // De solves hangen met ON DELETE CASCADE aan de sessies.
    Database::run('DELETE FROM timer_sessions WHERE user_id = ?', [$userId]);

    $insertSession = $pdo->prepare(
        'INSERT INTO timer_sessions (user_id, client_id, name, event, sort_order)
         VALUES (?, ?, ?, ?, ?)'
    );
    $insertSolve = $pdo->prepare(
        'INSERT INTO solves (user_id, timer_session_id, client_id, event, raw_ms, penalty, scramble, source, solved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    foreach ($sessions as $session) {
        $insertSession->execute([
            $userId,
            $session['client_id'],
            $session['name'],
            $session['event'],
            $session['sort_order'],
        ]);
        $sessionId = (int) $pdo->lastInsertId();

        foreach ($session['times'] as $solve) {
            $insertSolve->execute([
                $userId,
                $sessionId,
                $solve['client_id'],
                $session['event'],
                $solve['raw_ms'],
                $solve['penalty'],
                $solve['scramble'] === '' ? null : $solve['scramble'],
                $solve['source'],
                $solve['solved_at'],
            ]);
        }
    }

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $e;
}

/* -------------------------------------------------------------------------
 * Records, XP en challenges bijwerken
 *
 * De server rekent dit zelf uit op basis van de zojuist opgeslagen solves. De
 * browser stuurt dus nooit een gemiddelde of een XP-bedrag mee; dat zou met de
 * console te vervalsen zijn.
 *
 * Gaat hier iets mis, dan is de synchronisatie zelf wel geslaagd. De tijden
 * van de gebruiker zijn veilig; alleen de afgeleide cijfers lopen dan even
 * achter en worden bij de volgende synchronisatie alsnog bijgewerkt.
 * ---------------------------------------------------------------------- */
$afgeleid = null;
try {
    $herberekening = Records::rebuild($userId);
    $totalen = Xp::sync($userId, $herberekening);
    Challenges::evaluate($userId);

    $afgeleid = [
        'records' => $herberekening['records'],
        'flagged' => $herberekening['flagged'],
        'xp'      => $totalen['xp'],
        'level'   => $totalen['level'],
    ];
} catch (Throwable $e) {
    error_log('[cubetimer] herberekenen na synchronisatie mislukt: ' . $e->getMessage());
}

Http::ok([
    'sessions'  => count($sessions),
    'solves'    => $storedSolves,
    'syncedAt'  => gmdate('c'),
    'derived'   => $afgeleid,
]);
