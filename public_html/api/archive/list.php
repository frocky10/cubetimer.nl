<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * GET /api/archive/list.php
 *
 * De losse tijden van de ingelogde gebruiker: solves die wel op het account
 * staan maar niet meer onder een sessie hangen. Dat gebeurt als je een sessie
 * opruimt of er tijden uit haalt zonder ze van je account te willen wissen.
 *
 * Ze tellen gewoon mee voor je records, je ranglijstplek, je XP en je
 * achievements. Dit endpoint is er alleen zodat het accountscherm kan laten
 * zien dát ze er zijn, en wat je ermee kunt: terughalen of definitief wissen.
 *
 * Er komen geen losse solves in het antwoord, alleen aantallen per event. De
 * lijst zelf kan tienduizenden rijen lang zijn en de pagina heeft hem niet
 * nodig.
 */
Http::requireMethod('GET');

$user = Auth::requireUser();
$userId = (int) $user['id'];

$rijen = Database::all(
    'SELECT event, COUNT(*) AS aantal, MIN(solved_at) AS eerste, MAX(solved_at) AS laatste
     FROM solves
     WHERE user_id = ? AND timer_session_id IS NULL
     GROUP BY event
     ORDER BY aantal DESC, event',
    [$userId]
);

$perEvent = [];
$totaal = 0;
foreach ($rijen as $rij) {
    $event = (string) $rij['event'];
    $aantal = (int) $rij['aantal'];
    $totaal += $aantal;
    $perEvent[] = [
        'event'   => $event,
        'label'   => Events::label($event),
        'count'   => $aantal,
        'first'   => str_replace(' ', 'T', (string) $rij['eerste']) . 'Z',
        'last'    => str_replace(' ', 'T', (string) $rij['laatste']) . 'Z',
    ];
}

Http::ok([
    'total'    => $totaal,
    'perEvent' => $perEvent,
]);
