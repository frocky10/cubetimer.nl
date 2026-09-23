<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * GET /api/algorithms/list.php
 *
 * Welke algoritmes heeft de ingelogde cuber als geleerd afgevinkt op de
 * leerpagina? Zonder account is dat gewoon een lege lijst en geen fout: de
 * pagina werkt ook uitgelogd, hij onthoudt dan alleen niets.
 *
 * De catalogus zelf (welke gevallen er bestaan) staat in
 * Script/algorithms.js, niet hier. De server bewaart alleen de vinkjes.
 */
Http::requireMethod('GET');

$user = Auth::user();
if ($user === null) {
    Http::ok(['learned' => [], 'signedIn' => false]);
}

$rijen = Database::all(
    'SELECT algorithm_id FROM user_algorithms WHERE user_id = ? ORDER BY algorithm_id',
    [(int) $user['id']]
);

Http::ok([
    'learned'  => array_map(static fn (array $rij): string => (string) $rij['algorithm_id'], $rijen),
    'signedIn' => true,
]);
