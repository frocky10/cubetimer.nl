<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * GET /api/account/export.php
 *
 * Al je gegevens als JSON-bestand om te downloaden (AVG: recht op inzage en
 * op overdraagbaarheid). Zie AccountData::export() voor wat erin staat.
 *
 * Een GET, zodat de browser het gewoon als download kan openen. Dat is veilig:
 * een andere site kan de link wel laten openen, maar het antwoord niet lezen
 * (geen CORS), en het bestand komt dan op de computer van de gebruiker zelf.
 */
Http::requireMethod('GET');

if (Database::tryConnection() === null) {
    Http::fail('database_unavailable', 'De database is even niet bereikbaar. Probeer het later nog eens.', 503);
}

$user = Auth::requireUser();
$userId = (int) $user['id'];

$limit = RateLimiter::hit('export:' . $userId, 10, 3600);
if (!$limit['allowed']) {
    Http::fail('rate_limited', 'Je hebt je gegevens net al een paar keer gedownload. Probeer het over een uurtje nog eens.', 429);
}

$data = AccountData::export($userId);
$json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
if ($json === false) {
    error_log('[cubetimer] export mislukt: ' . json_last_error_msg());
    Http::fail('server_error', 'Het bestand kon niet worden gemaakt.', 500);
}

$bestand = 'cubetimer-' . preg_replace('/[^A-Za-z0-9_.-]/', '', (string) $user['username']) . '-' . gmdate('Y-m-d') . '.json';

header('Content-Type: application/json; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $bestand . '"');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
echo $json;
