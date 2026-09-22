<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/profile/settings.php
 * Body: { mainEvent?, showOnLeaderboard?, country? }
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

$user = Auth::requireUser();
$userId = (int) $user['id'];

$velden = [];
$waardes = [];

$mainEvent = Http::input('mainEvent', null);
if (is_string($mainEvent) && $mainEvent !== '') {
    if (!Events::isKnown($mainEvent)) {
        Http::fail('unknown_event', 'Dat event kennen we niet.', 422);
    }
    $velden[] = 'main_event = ?';
    $waardes[] = $mainEvent;
}

$showOnLeaderboard = Http::input('showOnLeaderboard', null);
if (is_bool($showOnLeaderboard)) {
    $velden[] = 'show_on_leaderboard = ?';
    $waardes[] = $showOnLeaderboard ? 1 : 0;
}

$country = Http::input('country', null);
if (is_string($country)) {
    $country = strtoupper(trim($country));
    if ($country !== '' && preg_match('/^[A-Z]{2}$/', $country) !== 1) {
        Http::fail('invalid_country', 'Gebruik een landcode van twee letters, bijvoorbeeld NL.', 422);
    }
    $velden[] = 'country_code = ?';
    $waardes[] = $country === '' ? null : $country;
}

if (!$velden) {
    Http::fail('nothing_to_update', 'Er is niets om aan te passen meegestuurd.', 422);
}

$waardes[] = $userId;
Database::run('UPDATE user_profiles SET ' . implode(', ', $velden) . ' WHERE user_id = ?', $waardes);

Http::ok();
