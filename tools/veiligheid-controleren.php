<?php
/**
 * Controleert de veiligheid van de code, zonder netwerk of database:
 *
 *   php tools/veiligheid-controleren.php
 *
 * Wat hij nakijkt:
 *   - geen geheimen in git: niet in de huidige bestanden en niet in de hele
 *     geschiedenis (GitHub-tokens, privésleutels, ingevulde wachtwoorden)
 *   - .gitignore houdt de config buiten git; config.example.php is leeg
 *   - elk endpoint dwingt zijn methode af, en alles wat schrijft eist de
 *     X-Requested-With-header (CSRF)
 *   - SQL: geen variabelen in een query, behalve de bekende veilige gevallen
 *     hieronder (getypte getallen, placeholders, tabelnamen uit een constante)
 *   - wachtwoorden met password_hash, nergens md5/sha1 op een wachtwoord
 *   - de sessiecookie is httponly, SameSite en standaard secure
 *   - de formulieren hebben botbescherming (BotGuard)
 *   - .htaccess schermt api/lib en de config af en zet de beveiligingsheaders
 *   - geen eval(), geen display_errors aan, debug uit in het voorbeeld
 *   - geen scripts of lettertypes van een CDN (zelf gehost)
 *
 * Een nieuwe SQL-query met een variabele erin geeft een FOUT tot hij in
 * SQL_VEILIG staat, met de reden erbij. Zo kijkt er altijd iemand naar.
 */
declare(strict_types=1);

$root = realpath(__DIR__ . '/..');
$web = $root . '/public_html';

$fouten = 0;
$aantal = 0;
function klopt(bool $voorwaarde, string $wat): void
{
    global $fouten, $aantal;
    $aantal++;
    if (!$voorwaarde) {
        $fouten++;
        echo "  FOUT  $wat\n";
    }
}

function lees(string $pad): string
{
    return (string) file_get_contents($pad);
}

/** @return list<string> alle PHP-bestanden onder een map */
function phpBestanden(string $map): array
{
    $lijst = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($map, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $bestand) {
        if ($bestand->getExtension() === 'php') {
            $lijst[] = $bestand->getPathname();
        }
    }
    sort($lijst);
    return $lijst;
}

function kort(string $pad): string
{
    global $root;
    return ltrim(substr($pad, strlen($root)), '/');
}

/**
 * De variabelen in het eerste argument (de query) van elke aanroep van
 * Database::run/first/all/column, met de tokenizer van PHP zelf: tot de
 * eerste komma of het sluithaakje op hetzelfde niveau.
 *
 * @return list<string>
 */
function sqlVariabelen(string $code): array
{
    $tokens = token_get_all($code);
    $gevonden = [];
    $n = count($tokens);
    for ($i = 0; $i < $n - 3; $i++) {
        if (!is_array($tokens[$i]) || $tokens[$i][1] !== 'Database') {
            continue;
        }
        $j = $i + 1;
        if (!is_array($tokens[$j]) || $tokens[$j][0] !== T_DOUBLE_COLON) {
            continue;
        }
        $methode = $tokens[$j + 1];
        if (!is_array($methode) || !in_array($methode[1], ['run', 'first', 'all', 'column'], true)) {
            continue;
        }
        $k = $j + 2;
        while ($k < $n && $tokens[$k] !== '(') {
            $k++;
        }
        $diepte = 0;
        for ($k++; $k < $n; $k++) {
            $t = $tokens[$k];
            if ($t === '(' || $t === '[' || (is_array($t) && in_array($t[0], [T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES], true)) || $t === '{') {
                $diepte++;
            } elseif ($t === ')' || $t === ']' || $t === '}') {
                if ($diepte === 0) {
                    break;
                }
                $diepte--;
            } elseif ($t === ',' && $diepte === 0) {
                break;
            } elseif (is_array($t) && $t[0] === T_VARIABLE) {
                $gevonden[$t[1]] = true;
            }
        }
    }
    return array_keys($gevonden);
}

/* -------------------------------------------------------------------------
 * 1. Geheimen
 * ---------------------------------------------------------------------- */
echo "geheimen\n";

// Patronen van echte sleutels. Bewust streng: liever een keer te veel kijken.
$geheimPatronen = [
    'GitHub-token'   => '/\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/',
    'privésleutel'   => '/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/',
    'AWS-sleutel'    => '/\bAKIA[0-9A-Z]{16}\b/',
    'Slack-token'    => '/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/',
    'Google-API-key' => '/\bAIza[0-9A-Za-z_-]{35}\b/',
];

$bestanden = array_filter(explode("\n", (string) shell_exec('cd ' . escapeshellarg($root) . ' && git ls-files')));
$gevonden = [];
foreach ($bestanden as $bestand) {
    $pad = $root . '/' . $bestand;
    if (!is_file($pad) || filesize($pad) > 2_000_000 || str_contains($bestand, 'vendor/cubing/')) {
        continue;
    }
    $inhoud = lees($pad);
    foreach ($geheimPatronen as $naam => $patroon) {
        if (preg_match($patroon, $inhoud) === 1) {
            $gevonden[] = "$naam in $bestand";
        }
    }
}
klopt($gevonden === [], 'geen sleutels in de bestanden in git' . ($gevonden ? ': ' . implode(', ', $gevonden) : ''));

// De hele geschiedenis: ook een verwijderd bestand staat nog in git.
$geschiedenis = (string) shell_exec('cd ' . escapeshellarg($root) . ' && git log --all -p --no-color -- . ":(exclude)public_html/Script/vendor/cubing" 2>/dev/null');
$inGeschiedenis = [];
foreach ($geheimPatronen as $naam => $patroon) {
    if (preg_match($patroon, $geschiedenis) === 1) {
        $inGeschiedenis[] = $naam;
    }
}
klopt($geschiedenis !== '', 'git-geschiedenis is te lezen');
klopt($inGeschiedenis === [], 'geen sleutels in de git-geschiedenis' . ($inGeschiedenis ? ': ' . implode(', ', $inGeschiedenis) : ''));

// Ooit een echte config in git gezet?
$configInGit = trim((string) shell_exec('cd ' . escapeshellarg($root)
    . ' && git log --all --name-only --format= 2>/dev/null | grep -E "(^|/)(cubetimer_config\.php|api/config\.php)$" | sort -u'));
klopt($configInGit === '', 'er is nooit een echte config in git gezet' . ($configInGit ? ": $configInGit" : ''));

$gitignore = lees($root . '/.gitignore');
klopt(str_contains($gitignore, 'cubetimer_config.php'), '.gitignore bevat cubetimer_config.php');
klopt(str_contains($gitignore, 'public_html/api/config.php'), '.gitignore bevat public_html/api/config.php');

$voorbeeld = require $web . '/api/config.example.php';
klopt(is_array($voorbeeld), 'config.example.php geeft een array terug');
klopt(($voorbeeld['db']['password'] ?? 'x') === '', 'config.example.php: db.password is leeg');
klopt(($voorbeeld['github']['token'] ?? 'x') === '', 'config.example.php: github.token is leeg');
klopt(($voorbeeld['mail']['password'] ?? 'x') === '', 'config.example.php: mail.password is leeg');
klopt(str_starts_with((string) ($voorbeeld['security']['app_key'] ?? ''), 'VERVANG_MIJ'), 'config.example.php: app_key is het voorbeeld (Auth::appKey weigert dat)');
klopt(($voorbeeld['debug'] ?? true) === false, 'config.example.php: debug staat uit');

/* -------------------------------------------------------------------------
 * 2. Endpoints
 * ---------------------------------------------------------------------- */
echo "endpoints\n";

$endpoints = array_filter(phpBestanden($web . '/api'), static fn (string $p): bool =>
    !str_contains($p, '/api/lib/') && !preg_match('#/(bootstrap|config\.example|config)\.php$#', $p));
klopt(count($endpoints) > 30, 'endpoints gevonden (' . count($endpoints) . ')');

foreach ($endpoints as $pad) {
    $code = lees($pad);
    $naam = kort($pad);
    klopt(str_contains($code, "require_once __DIR__ . '/") && str_contains($code, 'bootstrap.php'), "$naam laadt bootstrap.php");
    klopt(preg_match('/Http::requireMethod\(/', $code) === 1, "$naam dwingt zijn methode af");
    if (preg_match("/Http::requireMethod\([^)]*'POST'/", $code) === 1) {
        // admin/flags.php doet GET en POST; de header wordt dan alleen bij POST geëist.
        klopt(str_contains($code, 'Http::requireAjaxHeader()'), "$naam (POST) eist X-Requested-With");
    }
}

// Botbescherming op de formulieren die zonder login bereikbaar zijn.
foreach (['auth/register.php' => 'register', 'auth/login.php' => 'login', 'auth/forgot-password.php' => 'forgot', 'feedback/report.php' => 'feedback'] as $bestand => $form) {
    klopt(str_contains(lees("$web/api/$bestand"), "BotGuard::check('$form')"), "$bestand heeft BotGuard");
}

/* -------------------------------------------------------------------------
 * 3. SQL
 * ---------------------------------------------------------------------- */
echo "sql\n";

// Bekende gevallen waar een variabele in de query-tekst staat, met de reden
// waarom dat veilig is. Sleutel: bestand + variabele.
const SQL_VEILIG = [
    'api/lib/Follows.php $limit'          => 'int-parameter, begrensd met max/min',
    'api/lib/Follows.php $sql'            => 'een van twee vaste strings uit een match',
    'api/lib/Leaderboard.php $limit'      => 'int-parameter, begrensd met max/min',
    'api/lib/Leaderboard.php $offset'     => 'int-parameter, begrensd met max/min',
    'api/lib/GameModes.php $limit'        => 'int-parameter, begrensd met max/min',
    'api/lib/Challenges.php $limit'       => 'int-parameter, begrensd met max/min',
    'api/sync/push.php $plaatshouders'    => 'alleen vraagtekens',
    'api/lib/AccountData.php $tabel'      => 'tabelnaam uit een constante in dezelfde klasse',
    'api/lib/AccountData.php $kolom'      => 'kolomnaam uit een constante in dezelfde klasse',
    'api/archive/clear.php $filter'       => "leeg of de vaste tekst ' AND event = ?'",
    'api/archive/restore.php $filter'     => "leeg of de vaste tekst ' AND event = ?'",
    'api/lib/Challenges.php $placeholders' => 'alleen vraagtekens',
    'api/lib/Challenges.php $sql'         => "vaste query, eventueel met ' AND s.event = ?' erachter",
    'api/lib/Duels.php $kant'             => "'challenger' of 'opponent', uit een vergelijking",
    'api/lib/Leaderboard.php $beperking'  => 'uit restriction(): leeg of IN met alleen vraagtekens',
    'api/lib/Tournaments.php $plaatshouders' => 'alleen vraagtekens',
    'api/lib/Tournaments.php $wcaKolom'   => 'leeg of een vaste kolomnaam',
    'api/lib/Tournaments.php $limit'      => 'int-parameter, begrensd met max/min',
    'api/lib/Xp.php $placeholders'        => 'alleen vraagtekens',
    'api/profile/settings.php $velden'    => "vaste stukjes als 'main_event = ?', samengevoegd met implode",
    'api/sync/pull.php $metAnalyse'       => 'boolean; kiest een vaste kolomnaam',
];

$onbekend = [];
$bekend = [];
foreach (array_merge(phpBestanden($web . '/api'), [$web . '/profiel.php']) as $pad) {
    $naam = substr(kort($pad), strlen('public_html/'));
    foreach (sqlVariabelen(lees($pad)) as $var) {
        $sleutel = "$naam $var";
        if (isset(SQL_VEILIG[$sleutel])) {
            $bekend[$sleutel] = true;
        } else {
            $onbekend[$sleutel] = true;
        }
    }
}
klopt($onbekend === [], 'geen onbekende variabelen in SQL' . ($onbekend ? ': ' . implode(', ', array_keys($onbekend)) : ''));
foreach (array_keys(SQL_VEILIG) as $sleutel) {
    // Staat er iets in de lijst wat niet meer voorkomt, dan kan het eruit.
    klopt(isset($bekend[$sleutel]), "SQL_VEILIG '$sleutel' komt nog voor");
}

/* -------------------------------------------------------------------------
 * 4. Wachtwoorden, sessies, fouten
 * ---------------------------------------------------------------------- */
echo "wachtwoorden en sessies\n";

$alleCode = '';
foreach (phpBestanden($web) as $pad) {
    $alleCode .= lees($pad) . "\n";
}
klopt(preg_match('/password_hash\([^)]*PASSWORD_(DEFAULT|BCRYPT|ARGON2ID)/', $alleCode) === 1, 'wachtwoorden met password_hash');
klopt(preg_match('/(md5|sha1)\(\s*\$(password|wachtwoord)/i', $alleCode) === 0, 'nergens md5/sha1 op een wachtwoord');
klopt(preg_match('/\beval\s*\(/', $alleCode) === 0, 'geen eval()');
klopt(preg_match("/ini_set\('display_errors',\s*'1'\)/", $alleCode) === 0, 'display_errors nergens vast aan');

$auth = lees($web . '/api/lib/Auth.php');
klopt(str_contains($auth, "'httponly' => true"), 'sessiecookie is httponly');
klopt(str_contains($auth, "'samesite' => 'Lax'"), 'sessiecookie is SameSite=Lax');
klopt(str_contains($auth, "Config::get('security.cookie_secure', true)"), 'sessiecookie is standaard secure');
klopt(str_contains($auth, "hash('sha256', \$token)"), 'sessietokens staan gehasht in de database');
klopt(str_contains($auth, 'random_bytes(32)'), 'sessietokens uit random_bytes');
klopt(str_contains(lees($web . '/api/auth/login.php'), 'password_needs_rehash'), 'login werkt oude hashes bij (password_needs_rehash)');

/* -------------------------------------------------------------------------
 * 5. Server en browser
 * ---------------------------------------------------------------------- */
echo "server en browser\n";

$apiHtaccess = lees($web . '/api/.htaccess');
klopt(str_contains($apiHtaccess, 'RedirectMatch 404 ^/api/lib/'), 'api/.htaccess verbergt api/lib');
klopt(preg_match('/FilesMatch "\^\(config\|config\\\\\.example\|bootstrap\)/', $apiHtaccess) === 1, 'api/.htaccess blokkeert config en bootstrap');
klopt(str_contains($apiHtaccess, 'Options -Indexes'), 'api/.htaccess: geen directorylisting');

$htaccess = lees($web . '/.htaccess');
foreach (['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options', "frame-ancestors 'self'", 'Permissions-Policy', 'Strict-Transport-Security'] as $header) {
    klopt(str_contains($htaccess, $header), ".htaccess zet $header");
}
klopt(str_contains($htaccess, 'Options -Indexes'), '.htaccess: geen directorylisting');

// Alles wat de browser laadt, komt van onze eigen server (behalve AdSense en
// Analytics, die achter de toestemming zitten).
foreach (glob($web . '/*.{html,php}', GLOB_BRACE) as $pad) {
    $html = lees($pad);
    klopt(!str_contains($html, 'fonts.googleapis.com'), kort($pad) . ' laadt geen Google Fonts');
    klopt(!str_contains($html, 'cdn.cubing.net'), kort($pad) . ' laadt niets van cdn.cubing.net');
}
klopt(!str_contains(lees($web . '/Script/scrambleScript.js'), 'cdn.cubing.net'), 'scrambleScript.js gebruikt de eigen cubing.js');
klopt(is_file($web . '/Script/vendor/cubing/scramble.js') && is_file($web . '/Script/vendor/cubing/search-worker-entry.js'), 'cubing.js staat in Script/vendor/cubing');

$index = lees($web . '/index.html');
$default = strpos($index, "gtag('consent', 'default'");
klopt($default !== false && $default < strpos($index, "gtag('config'"), 'Consent Mode staat standaard op geweigerd, vóór gtag config');
klopt(preg_match("/function start\(\) \{\s*laad\('https:\/\/pagead2/", $index) === 1, 'Analytics laadt niet bij de start, pas na toestemming');

echo "\n" . ($aantal - $fouten) . " van de $aantal controles in orde\n";
exit($fouten === 0 ? 0 : 1);
