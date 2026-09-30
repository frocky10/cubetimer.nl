<?php
/**
 * Zoekt de teksten die de PHP-kant naar de bezoeker stuurt.
 *
 *   php tools/server-teksten.php            overzicht, met wat nog niet klopt
 *   php tools/server-teksten.php --sleutels alle sleutels als JSON
 *
 * Een sleutel is:
 *   - de melding (tweede argument) van Http::fail('code', 'melding', ...)
 *   - de waarde van 'message' => '...' in een array
 *   - het eerste argument van Taal::t('...')
 *
 * Een melding die geen vaste tekst is (met een . of een variabele erin) kan
 * niet vertaald worden; die wordt gemeld, zodat hij omgeschreven kan worden
 * naar Taal::t('... {n} ...', ['n' => ...]). Staat de melding al in een
 * Taal::t(), dan is dat in orde.
 *
 * tools/vertalen.php --controleer gebruikt --sleutels om te zien of elke
 * sleutel een vertaling in taal/en/server.json heeft.
 */
declare(strict_types=1);

$root = realpath(__DIR__ . '/..');
$bestanden = [];
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator("$root/public_html/api", FilesystemIterator::SKIP_DOTS));
foreach ($it as $f) {
    if ($f->getExtension() === 'php' && !str_contains($f->getPathname(), '/lib/taal/') && !str_ends_with($f->getPathname(), 'config.example.php')) {
        $bestanden[] = $f->getPathname();
    }
}
$bestanden[] = "$root/public_html/profiel.php";
sort($bestanden);

$sleutels = [];
$problemen = [];

/** De tokens van één argument, vanaf $i tot de komma of het haakje op hetzelfde niveau. */
function argument(array $tokens, int &$i): array
{
    $uit = [];
    $diepte = 0;
    for ($n = count($tokens); $i < $n; $i++) {
        $t = $tokens[$i];
        if (in_array($t, ['(', '['], true)) {
            $diepte++;
        } elseif (in_array($t, [')', ']'], true)) {
            if ($diepte === 0) {
                break;
            }
            $diepte--;
        } elseif ($t === ',' && $diepte === 0) {
            break;
        }
        if (!(is_array($t) && in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true))) {
            $uit[] = $t;
        }
    }
    return $uit;
}

/** Eén vaste string, of null. */
function vasteTekst(array $arg): ?string
{
    if (count($arg) === 1 && is_array($arg[0]) && $arg[0][0] === T_CONSTANT_ENCAPSED_STRING) {
        return stripcslashes(substr($arg[0][1], 1, -1));
    }
    // Meerdere vaste stukken met . ertussen: ook goed (lange zinnen).
    $delen = [];
    foreach ($arg as $k => $t) {
        if ($k % 2 === 1) {
            if ($t !== '.') {
                return null;
            }
            continue;
        }
        if (!is_array($t) || $t[0] !== T_CONSTANT_ENCAPSED_STRING) {
            return null;
        }
        $delen[] = substr($t[1], 1, -1);
    }
    return $delen ? stripcslashes(implode('', $delen)) : null;
}

function isTaalT(array $arg): bool
{
    return isset($arg[0], $arg[1], $arg[2]) && is_array($arg[0]) && $arg[0][1] === 'Taal'
        && is_array($arg[2]) && $arg[2][1] === 't';
}

foreach ($bestanden as $pad) {
    $tokens = token_get_all((string) file_get_contents($pad));
    $naam = substr($pad, strlen($root) + 1);
    $n = count($tokens);
    for ($i = 0; $i < $n; $i++) {
        $t = $tokens[$i];
        if (!is_array($t)) {
            continue;
        }
        // Http::fail(code, melding, ...)  en  Taal::t(tekst, ...)
        if ($t[0] === T_STRING && in_array($t[1], ['Http', 'Taal'], true)
            && ($tokens[$i + 1][0] ?? null) === T_DOUBLE_COLON && is_array($tokens[$i + 2] ?? null)) {
            $methode = $tokens[$i + 2][1];
            $j = $i + 3;
            while ($j < $n && $tokens[$j] !== '(') {
                $j++;
            }
            $j++;
            if ($t[1] === 'Http' && $methode === 'fail') {
                argument($tokens, $j); // code
                $j++;
                $arg = argument($tokens, $j);
            } elseif ($t[1] === 'Taal' && $methode === 't') {
                $arg = argument($tokens, $j);
            } else {
                continue;
            }
            $tekst = vasteTekst($arg);
            if ($tekst !== null) {
                $sleutels[$tekst] = true;
            } elseif ($t[1] === 'Taal') {
                // Taal::t($definitie['title']): een tekst uit een catalogus; die staan hieronder.
                continue;
            } elseif (!isTaalT($arg) && !($arg && is_array($arg[0]) && $arg[0][0] === T_VARIABLE)) {
                $problemen[] = "$naam:{$t[2]}  " . implode('', array_map(fn ($x) => is_array($x) ? $x[1] : $x, $arg));
            }
        }
        // t('...') in profiel.php (een korte naam voor Taal::t).
        if ($t[0] === T_STRING && $t[1] === 't' && ($tokens[$i + 1] ?? null) === '('
            && !in_array($tokens[$i - 1][0] ?? null, [T_DOUBLE_COLON, T_OBJECT_OPERATOR, T_FUNCTION], true)) {
            $j = $i + 2;
            $tekst = vasteTekst(argument($tokens, $j));
            if ($tekst !== null) {
                $sleutels[$tekst] = true;
            }
        }
        // 'message' => ...
        if ($t[0] === T_CONSTANT_ENCAPSED_STRING && in_array($t[1], ["'message'", '"message"'], true)) {
            $j = $i + 1;
            while ($j < $n && is_array($tokens[$j]) && $tokens[$j][0] === T_WHITESPACE) {
                $j++;
            }
            if (!is_array($tokens[$j] ?? null) || $tokens[$j][0] !== T_DOUBLE_ARROW) {
                continue;
            }
            $j++;
            $arg = argument($tokens, $j);
            $tekst = vasteTekst($arg);
            if ($tekst !== null) {
                $sleutels[$tekst] = true;
            } elseif (!isTaalT($arg) && !($arg && is_array($arg[0]) && in_array($arg[0][0], [T_VARIABLE, T_MATCH], true))) {
                $problemen[] = "$naam:{$t[2]}  message => " . implode('', array_map(fn ($x) => is_array($x) ? $x[1] : $x, $arg));
            }
        }
    }
}

/*
 * Catalogi: teksten die niet letterlijk in een Taal::t() staan, maar uit een
 * lijst komen en bij het tonen vertaald worden (Taal::t($definitie['title'])).
 */
require_once "$root/public_html/api/lib/Config.php";
foreach (['Taal', 'Http', 'Database', 'Events', 'SiteTime', 'Xp', 'Achievements', 'Ranking', 'Tournaments'] as $klasse) {
    require_once "$root/public_html/api/lib/$klasse.php";
}
$catalogus = [];
foreach (Achievements::families() as $f) {
    foreach (['title', 'description', 'unit', 'unitOne'] as $veld) {
        if (!empty($f[$veld])) {
            $catalogus[] = $f[$veld];
        }
    }
}
foreach (Achievements::secrets() as $g) {
    $catalogus[] = $g['title'];
    $catalogus[] = $g['description'];
}
$catalogus = array_merge($catalogus, array_values(Achievements::CATEGORIES), Achievements::TIERS, ['geheim']);
foreach ((new ReflectionClassConstant(Tournaments::class, 'DIFFICULTIES'))->getValue() as $niveau) {
    $catalogus[] = $niveau['label'];
    $catalogus[] = $niveau['description'];
}
$catalogus = array_merge($catalogus, array_values((new ReflectionClassConstant(Tournaments::class, 'ROUND_NAMES'))->getValue()));
// Rondenamen van historische comps (Wca::roundName) en de XP-niveaus (Xp::tier).
$catalogus = array_merge($catalogus, ['Eerste ronde', 'Tweede ronde', 'Diamant', 'Platina', 'Goud', 'Zilver', 'Brons']);
foreach ($catalogus as $tekst) {
    if (preg_match('/\p{L}{2,}/u', (string) $tekst) === 1 && !in_array($tekst, ['solves', 'solve', 'XP', 'events', 'event', 'records', 'record', 'challenges', 'challenge', 'Beginner'], true)) {
        $sleutels[(string) $tekst] = true;
    }
}

if (in_array('--sleutels', $argv, true)) {
    echo json_encode(array_keys($sleutels), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
    exit(0);
}

echo count($sleutels) . " sleutels gevonden\n";
foreach ($problemen as $p) {
    echo "  NIET VAST  $p\n";
}
echo count($problemen) . " meldingen zijn geen vaste tekst\n";
exit($problemen ? 1 : 0);
