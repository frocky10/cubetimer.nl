<?php
declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';

/**
 * POST /api/feedback/report.php
 * Body: { type, title, description, steps, expected, email, website, context }
 *
 * Maakt een issue aan in de GitHub-repo. Het GitHub-token staat uitsluitend in
 * het configbestand buiten de webroot; de browser ziet het nooit.
 */
Http::requireMethod('POST');
Http::requireAjaxHeader();

if (!GitHubIssues::isEnabled()) {
    Http::fail('feedback_disabled', 'Meldingen zijn nog niet ingesteld op deze server.', 503);
}

/* -------------------------------------------------------------------------
 * Spam tegenhouden
 * ---------------------------------------------------------------------- */

// Honeypot: een verborgen veld dat een mens nooit invult, een bot meestal wel.
if (Http::stringInput('website') !== '') {
    // Doe alsof het gelukt is, zodat de bot niet gaat variëren.
    Http::ok(['issue' => null, 'message' => 'Bedankt voor je melding!']);
}

$ipKey = Auth::fingerprint(Http::clientIp());
$limit = RateLimiter::hit("feedback:{$ipKey}", 5, 3600);
if (!$limit['allowed']) {
    Http::fail(
        'rate_limited',
        'Je hebt net al een paar meldingen gestuurd. Probeer het over ' . ceil($limit['retryAfter'] / 60) . ' minuten nog eens.',
        429,
        ['retryAfter' => $limit['retryAfter']]
    );
}

/* -------------------------------------------------------------------------
 * Invoer valideren
 * ---------------------------------------------------------------------- */

$type = Http::stringInput('type', 'bug');
if (!in_array($type, ['bug', 'feature'], true)) {
    $type = 'bug';
}

$title       = mb_substr(Http::stringInput('title'), 0, 120);
$description = mb_substr(Http::stringInput('description'), 0, 4000);
$steps       = mb_substr(Http::stringInput('steps'), 0, 2000);
$expected    = mb_substr(Http::stringInput('expected'), 0, 1000);
$email       = mb_substr(Http::stringInput('email'), 0, 191);

if (mb_strlen($title) < 5) {
    Http::fail('invalid_title', 'Geef je melding een titel van minstens 5 tekens.', 422);
}
if (mb_strlen($description) < 10) {
    Http::fail('invalid_description', 'Beschrijf in een paar woorden meer wat er aan de hand is.', 422);
}
if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    Http::fail('invalid_email', 'Dat lijkt geen geldig e-mailadres. Laat het veld anders leeg.', 422);
}

/* -------------------------------------------------------------------------
 * Tekst onschadelijk maken voor GitHub
 *
 * Zonder dit kan iemand via het formulier willekeurige mensen taggen (@naam)
 * of andere issues aan elkaar koppelen (#12). Door ze in code-opmaak te zetten
 * blijft de tekst leesbaar, maar linkt GitHub er niets meer aan.
 * ---------------------------------------------------------------------- */
$neutralize = static function (string $text): string {
    $text = str_replace("\r\n", "\n", $text);
    $text = preg_replace('/@([A-Za-z0-9][A-Za-z0-9-]*)/', '`@$1`', $text) ?? $text;
    $text = preg_replace('/(?<![\w`])#(\d+)/', '`#$1`', $text) ?? $text;
    // Voorkom dat iemand uit een codeblok breekt in het contextgedeelte.
    return str_replace('```', "'''", $text);
};

/** Zet een meerregelige tekst als citaat neer, zodat opmaak van de gebruiker het issue niet kaapt. */
$quote = static function (string $text) use ($neutralize): string {
    $lines = explode("\n", $neutralize(trim($text)));
    return implode("\n", array_map(static fn (string $line): string => '> ' . $line, $lines));
};

/* -------------------------------------------------------------------------
 * Technische context - helpt enorm bij het reproduceren
 * ---------------------------------------------------------------------- */
$context = Http::input('context', []);
$context = is_array($context) ? $context : [];

$contextFields = [
    'Pagina'        => 'url',
    'Browser'       => 'userAgent',
    'Schermformaat' => 'screen',
    'Taal'          => 'language',
    'Tijdzone'      => 'timezone',
    'Thema'         => 'theme',
    'Actief event'  => 'event',
    'Solves in sessie' => 'solveCount',
    'Smart cube'    => 'bluetooth',
];

$contextLines = [];
foreach ($contextFields as $label => $key) {
    $value = $context[$key] ?? null;
    if ($value === null || $value === '' || is_array($value)) {
        continue;
    }
    $contextLines[] = sprintf('| %s | %s |', $label, str_replace('|', '\\|', mb_substr((string) $value, 0, 300)));
}
$contextLines[] = sprintf('| Gemeld op | %s UTC |', gmdate('Y-m-d H:i'));

$currentUser = Auth::user();
$reporter = $currentUser !== null
    ? 'ingelogd als **' . $neutralize((string) $currentUser['username']) . '**'
    : 'niet ingelogd';
$contextLines[] = sprintf('| Melder | %s |', $reporter);

/* -------------------------------------------------------------------------
 * Issue samenstellen
 * ---------------------------------------------------------------------- */
$bodyParts = [];
$bodyParts[] = $type === 'bug'
    ? '### Wat gaat er mis?'
    : '### Wat zou je graag willen?';
$bodyParts[] = $quote($description);

if ($steps !== '') {
    $bodyParts[] = "### Stappen om het te zien\n" . $quote($steps);
}
if ($expected !== '') {
    $bodyParts[] = "### Wat had je verwacht?\n" . $quote($expected);
}

$bodyParts[] = "### Context\n\n| | |\n|---|---|\n" . implode("\n", $contextLines);
$bodyParts[] = $email !== ''
    ? '<sub>De melder heeft een e-mailadres achtergelaten voor terugkoppeling. Dat staat in de database (`feedback_reports`), niet in dit issue.</sub>'
    : '<sub>De melder heeft geen contactgegevens achtergelaten.</sub>';
$bodyParts[] = '<sub>Automatisch aangemaakt via de meldknop op cubetimer.nl.</sub>';

$labels = Config::get('github.labels', []);
$labels = is_array($labels) ? array_values(array_filter(array_map('strval', $labels))) : [];
$typeLabel = (string) Config::get($type === 'bug' ? 'github.label_bug' : 'github.label_feature', '');
if ($typeLabel !== '') {
    $labels[] = $typeLabel;
}

$prefix = $type === 'bug' ? '[Bug] ' : '[Feature] ';
$result = GitHubIssues::create($prefix . $neutralize($title), implode("\n\n", $bodyParts), $labels);

/* -------------------------------------------------------------------------
 * Loggen (als de tabel uit migratie 002 bestaat)
 * ---------------------------------------------------------------------- */
if (Database::hasTable('feedback_reports')) {
    try {
        Database::run(
            'INSERT INTO feedback_reports
                (user_id, type, title, body, contact_email, issue_number, issue_url, status, ip_hash, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $currentUser['id'] ?? null,
                $type,
                $title,
                $description,
                $email !== '' ? $email : null,
                $result['ok'] ? $result['number'] : null,
                $result['ok'] ? $result['url'] : null,
                $result['ok'] ? 'submitted' : 'failed',
                $ipKey,
                Http::userAgent(),
            ]
        );
    } catch (PDOException $e) {
        error_log('[cubetimer] melding loggen mislukt: ' . $e->getMessage());
    }
}

if (!$result['ok']) {
    Http::fail('github_error', 'We konden je melding niet doorsturen naar GitHub. Probeer het later nog eens.', 502);
}

Http::ok([
    'issue' => [
        'number' => $result['number'],
        'url'    => $result['url'],
    ],
    'message' => 'Bedankt! Je melding staat als issue #' . $result['number'] . ' in GitHub.',
]);
