<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/** GET /api/auth/me.php - wie ben ik? Geeft `user: null` als je niet ingelogd bent. */
Http::requireMethod('GET');

$user = Auth::user();

Http::ok(['user' => $user === null ? null : Auth::publicUser($user)]);
