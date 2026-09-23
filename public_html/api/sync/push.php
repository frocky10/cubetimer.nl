<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/sync/push.php
 * Body: {
 *   sessions: [ { id, name, event, times: [ { id, raw, penalty, timestamp, scramble, source } ] } ],
 *   removedSolveIds: [ '<solve-id>', ... ]
 * }
 *
 * De browser stuurt zijn volledige staat en de server legt die ernaast. Wat
 * meekomt wordt bijgewerkt of toegevoegd; sessies die niet meekomen worden
 * opgeruimd.
 *
 * Wat er *niet* gebeurt: een solve weggooien omdat de browser hem niet
 * meestuurt. Die wordt een losse tijd - hij blijft op het account staan en
 * telt gewoon mee voor records, ranglijsten, XP en achievements, maar hangt
 * niet meer onder een sessie. Sessies zijn er om te ordenen waar je mee bezig
 * bent; een sessie opruimen hoort geen tijden te kosten, en al helemaal niet
 * op een ander apparaat dan waar je aan het opruimen was.
 *
 * Echt weggooien gaat alleen via `removedSolveIds`. Dat is een aparte keuze in
 * de interface ("ook uit mijn account verwijderen") en de enige weg naar een
 * DELETE.
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

const MAX_SESSIONS = 300;
const MAX_SOLVES = 50000;
const MAX_REMOVED = 5000;
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

// Solves die de gebruiker uitdrukkelijk van zijn account af wil hebben.
$removed = Http::input('removedSolveIds', []);
if (!is_array($removed)) {
    $removed = [];
}
$removedIds = [];
foreach ($removed as $value) {
    if (!is_scalar($value)) {
        continue;
    }
    $id = mb_substr(trim((string) $value), 0, 64);
    if ($id !== '') {
        $removedIds[$id] = true;
    }
}
$removedIds = array_slice(array_keys($removedIds), 0, MAX_REMOVED);

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
                'details'   => SolveAnalysis::clean($rawSolve['analysis'] ?? null),
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

/* -------------------------------------------------------------------------
 * Opslaan
 *
 * De volgorde doet ertoe:
 *   1. wat weg mag, gaat weg
 *   2. de meegestuurde sessies bijwerken of aanmaken
 *   3. *alle* solves van deze gebruiker losmaken van hun sessie
 *   4. de meegestuurde solves bijwerken of aanmaken, en daarmee meteen weer
 *      aan de juiste sessie hangen
 *   5. de sessies opruimen die niet meekwamen
 *
 * Stap 3 lijkt omslachtig, maar is juist het simpelst: na stap 4 hangt precies
 * wat de browser stuurde weer onder een sessie, en houdt de rest zichzelf over
 * als losse tijd. Het alternatief was een NOT IN met alle solve-id's erin, en
 * dat is bij achttienduizend solves geen query meer.
 * ---------------------------------------------------------------------- */
$pdo = Database::connection();
$pdo->beginTransaction();
try {
    // 1. Wat de gebruiker echt kwijt wil.
    if ($removedIds !== []) {
        $plaatshouders = implode(',', array_fill(0, count($removedIds), '?'));
        Database::run(
            'DELETE FROM solves WHERE user_id = ? AND client_id IN (' . $plaatshouders . ')',
            array_merge([$userId], $removedIds)
        );
    }

    // 2. Sessies bijwerken of aanmaken.
    $upsertSession = $pdo->prepare(
        'INSERT INTO timer_sessions (user_id, client_id, name, event, sort_order)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            name = VALUES(name), event = VALUES(event), sort_order = VALUES(sort_order)'
    );
    // De analyse van smart-cubesolves kan pas na migratie 008 mee. Zonder die
    // kolom slaan we hem over in plaats van de hele synchronisatie te laten
    // mislukken.
    $metAnalyse = Database::hasColumn('solves', 'details');
    $upsertSolve = $pdo->prepare($metAnalyse
        ? 'INSERT INTO solves (user_id, timer_session_id, client_id, event, raw_ms, penalty, scramble, source, solved_at, details)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
              timer_session_id = VALUES(timer_session_id),
              event            = VALUES(event),
              raw_ms           = VALUES(raw_ms),
              penalty          = VALUES(penalty),
              scramble         = VALUES(scramble),
              source           = VALUES(source),
              solved_at        = VALUES(solved_at),
              details          = VALUES(details)'
        : 'INSERT INTO solves (user_id, timer_session_id, client_id, event, raw_ms, penalty, scramble, source, solved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
              timer_session_id = VALUES(timer_session_id),
              event            = VALUES(event),
              raw_ms           = VALUES(raw_ms),
              penalty          = VALUES(penalty),
              scramble         = VALUES(scramble),
              source           = VALUES(source),
              solved_at        = VALUES(solved_at)'
    );

    $sessionIds = [];
    $opgeslagen = [];   // de sessies met hun id in de database erbij
    foreach ($sessions as $session) {
        $upsertSession->execute([
            $userId,
            $session['client_id'],
            $session['name'],
            $session['event'],
            $session['sort_order'],
        ]);
        // lastInsertId() geeft 0 terug als de rij alleen bijgewerkt is, dus
        // halen we hem er in dat geval bij op.
        $sessionId = (int) $pdo->lastInsertId();
        if ($sessionId === 0) {
            $rij = Database::first(
                'SELECT id FROM timer_sessions WHERE user_id = ? AND client_id = ?',
                [$userId, $session['client_id']]
            );
            $sessionId = (int) ($rij['id'] ?? 0);
        }
        if ($sessionId === 0) {
            continue;
        }
        $sessionIds[] = $sessionId;
        $session['db_id'] = $sessionId;
        $opgeslagen[] = $session;
    }

    // 3. Alles losmaken; stap 4 hangt terug wat de browser stuurde.
    Database::run(
        'UPDATE solves SET timer_session_id = NULL WHERE user_id = ? AND timer_session_id IS NOT NULL',
        [$userId]
    );

    // 4. Solves bijwerken of aanmaken.
    foreach ($opgeslagen as $session) {
        foreach ($session['times'] as $solve) {
            $waarden = [
                $userId,
                $session['db_id'],
                $solve['client_id'],
                $session['event'],
                $solve['raw_ms'],
                $solve['penalty'],
                $solve['scramble'] === '' ? null : $solve['scramble'],
                $solve['source'],
                $solve['solved_at'],
            ];
            if ($metAnalyse) {
                $waarden[] = $solve['details'];
            }
            $upsertSolve->execute($waarden);
        }
    }

    // 5. Sessies die niet meekwamen opruimen. Hun solves zijn na stap 3 al los,
    //    dus hier gaat geen tijd verloren.
    if ($sessionIds === []) {
        Database::run('DELETE FROM timer_sessions WHERE user_id = ?', [$userId]);
    } else {
        $plaatshouders = implode(',', array_fill(0, count($sessionIds), '?'));
        Database::run(
            'DELETE FROM timer_sessions WHERE user_id = ? AND id NOT IN (' . $plaatshouders . ')',
            array_merge([$userId], $sessionIds)
        );
    }

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $e;
}

// Hoeveel tijden staan er nu op het account zonder sessie?
$losseTijden = (int) (Database::first(
    'SELECT COUNT(*) AS aantal FROM solves WHERE user_id = ? AND timer_session_id IS NULL',
    [$userId]
)['aantal'] ?? 0);

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

    // Achievements als laatste: ze kijken naar XP en challenges, die hierboven
    // net zijn bijgewerkt.
    $metrics = Achievements::buildMetrics($userId, $herberekening['facts'], $herberekening);
    $nieuweAchievements = Achievements::evaluate($userId, $metrics);
    if ($nieuweAchievements !== []) {
        // Achievements leveren XP op, dus het totaal klopt nu niet meer.
        $totalen = Xp::recalculate($userId);
    }

    $afgeleid = [
        'records'      => $herberekening['records'],
        'flagged'      => $herberekening['flagged'],
        'xp'           => $totalen['xp'],
        'level'        => $totalen['level'],
        'achievements' => $nieuweAchievements,
    ];
} catch (Throwable $e) {
    error_log('[cubetimer] herberekenen na synchronisatie mislukt: ' . $e->getMessage());
}

Http::ok([
    'sessions'    => count($sessions),
    'solves'      => $storedSolves,
    'removed'     => count($removedIds),
    'looseSolves' => $losseTijden,
    'syncedAt'    => gmdate('c'),
    'derived'     => $afgeleid,
]);
