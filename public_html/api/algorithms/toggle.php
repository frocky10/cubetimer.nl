<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/algorithms/toggle.php
 * Body: { id: 'OLL-27', learned: true }
 *
 * Zet het vinkje "geleerd" bij een algoritme aan of uit.
 *
 * De id wordt op vorm gecontroleerd en niet op inhoud: de catalogus staat in
 * Script/algorithms.js en die kent de server niet. Het ergste wat iemand met
 * een verzonnen id kan bereiken is een rij die op de pagina nergens meer bij
 * hoort en dus niet getoond wordt. Het aantal ligt wel aan een maximum, zodat
 * de tabel niet als opslagruimte te misbruiken is.
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

const MAX_GELEERD = 500;

$user = Auth::requireUser();
$userId = (int) $user['id'];

$id = Http::stringInput('id', '');
if (!preg_match('/^(OLL|PLL|F2L)-[A-Za-z0-9]{1,8}$/', $id)) {
    Http::fail('invalid_id', 'Dat is geen algoritme dat we kennen.', 422);
}

$geleerd = Http::input('learned') === true;

if ($geleerd) {
    $aantal = (int) (Database::first(
        'SELECT COUNT(*) AS aantal FROM user_algorithms WHERE user_id = ?',
        [$userId]
    )['aantal'] ?? 0);

    if ($aantal >= MAX_GELEERD) {
        Http::fail('too_many', 'Je hebt het maximum aantal afgevinkte algoritmes bereikt.', 422);
    }

    Database::run(
        'INSERT INTO user_algorithms (user_id, algorithm_id) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE algorithm_id = VALUES(algorithm_id)',
        [$userId, $id]
    );
} else {
    Database::run(
        'DELETE FROM user_algorithms WHERE user_id = ? AND algorithm_id = ?',
        [$userId, $id]
    );
}

$totaal = (int) (Database::first(
    'SELECT COUNT(*) AS aantal FROM user_algorithms WHERE user_id = ?',
    [$userId]
)['aantal'] ?? 0);

Http::ok([
    'id'      => $id,
    'learned' => $geleerd,
    'total'   => $totaal,
]);
