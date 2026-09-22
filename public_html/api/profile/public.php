<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * GET /api/profile/public.php?u=gebruikersnaam
 *
 * Het openbare profiel van een cuber. Openbaar te bekijken, ook zonder
 * account. Bevat nooit een e-mailadres.
 */
Http::requireMethod('GET');

$username = (string) ($_GET['u'] ?? '');
$profiel = PublicProfile::find($username);

if ($profiel === null) {
    Http::fail('not_found', 'Deze cuber bestaat niet, of deelt zijn profiel niet.', 404);
}

Http::ok(['profile' => $profiel]);
