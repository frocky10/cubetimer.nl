<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/** POST /api/auth/logout.php */
Http::requireMethod('POST');
Http::requireAjaxHeader();

Auth::endSession();

Http::ok(['user' => null]);
