<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/archive/clear.php
 * Body: { event?: '333', confirm: true }
 *
 * Wist de losse tijden definitief van het account. Dit is de enige plek waar
 * dat kan, en het is met opzet een aparte handeling: overal elders in de site
 * betekent "verwijderen" alleen dat iets uit een sessie verdwijnt.
 *
 * Na afloop worden de records opnieuw uitgerekend, want die stonden mede op
 * deze solves: een persoonlijk record kan er dus op achteruitgaan. XP die je
 * ooit verdiend hebt blijft staan - het XP-logboek is een geschiedenis, geen
 * momentopname, en dat is ook hoe de rest van de site ermee omgaat.
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

$user = Auth::requireUser();
$userId = (int) $user['id'];

if (Http::input('confirm') !== true) {
    Http::fail('not_confirmed', 'Deze actie moet bevestigd worden.', 422);
}

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

$verwijderd = Database::run(
    'DELETE FROM solves WHERE user_id = ? AND timer_session_id IS NULL' . $filter,
    $params
)->rowCount();

/* De records opnieuw uitrekenen. Net als bij een synchronisatie geldt: gaat
 * dit mis, dan is het verwijderen zelf wel gelukt en lopen alleen de afgeleide
 * cijfers even achter; die worden bij de volgende synchronisatie bijgewerkt. */
$afgeleid = null;
if ($verwijderd > 0) {
    try {
        $herberekening = Records::rebuild($userId);
        $totalen = Xp::recalculate($userId);
        $afgeleid = [
            'records' => $herberekening['records'],
            'xp'      => $totalen['xp'],
            'level'   => $totalen['level'],
        ];
    } catch (Throwable $e) {
        error_log('[cubetimer] herberekenen na wissen losse tijden mislukt: ' . $e->getMessage());
    }
}

Http::ok([
    'deleted' => $verwijderd,
    'derived' => $afgeleid,
]);
