<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * GET /api/challenges/today.php
 *
 * De opdrachten van vandaag. Openbaar te bekijken; ben je ingelogd, dan staat
 * je eigen voortgang erbij. De dagranglijst van de scramble van de dag komt
 * meteen mee, zodat het scherm met een verzoek gevuld is.
 */
Http::requireMethod('GET');

$user = Auth::user();
$userId = $user === null ? null : (int) $user['id'];

$vandaag = Challenges::today($userId);

foreach ($vandaag['challenges'] as $index => $challenge) {
    if ($challenge['type'] === 'scramble_of_the_day') {
        $vandaag['challenges'][$index]['leaderboard'] = Challenges::dayLeaderboard((int) $challenge['id'], 25);
    }
}

Http::ok($vandaag + ['authenticated' => $userId !== null]);
