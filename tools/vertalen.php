<?php
/**
 * De Engelse versie van de site bouwen.
 *
 *   php tools/vertalen.php               bouwen
 *   php tools/vertalen.php --controleer  alleen kijken: klopt alles en is het bij?
 *   php tools/vertalen.php --ontbrekend  lijst van teksten zonder vertaling, als JSON
 *
 * Bron van alle vertalingen is taal/en/*.json: per bestand een object van
 * Nederlandse tekst naar Engelse tekst. De Nederlandse tekst ís de sleutel, dus
 * de code en de HTML blijven gewoon leesbaar Nederlands.
 *
 *   taal/en/html.json    de vaste teksten in index.html en leren.html
 *   taal/en/js.json      alles wat een script in beeld zet (UI.t('...'))
 *   taal/en/server.json  meldingen en teksten van de PHP-kant (Taal::t('...'))
 *
 * Wat dit script maakt (en wat dus nooit met de hand wordt aangepast):
 *
 *   public_html/en/index.html   uit index.html
 *   public_html/en/learn.html   uit leren.html
 *   public_html/Script/taal-en.js       js.json, voor de browser
 *   public_html/api/lib/taal/en.php     server.json, voor PHP
 *
 * De inhoudspagina's (privacy, voorwaarden, uitleg) zijn lopende tekst en
 * hebben elk een eigen, met de hand geschreven Engelse versie in public_html/en/.
 *
 * Hoe een pagina vertaald wordt: de HTML gaat door de HTML5-parser van PHP 8.4.
 * Per element: is de hele inhoud (met opmaak) een sleutel, dan wordt die in
 * één keer vervangen; zo kan een zin met een <strong> erin als geheel vertaald
 * worden, met een andere woordvolgorde. Anders gaat het per stukje tekst. Ook
 * title, aria-label, placeholder, alt, data-leeg en de meta-omschrijvingen gaan
 * mee, net als de tekst in de JSON-LD. Paden worden absoluut (/Style/...), en
 * links naar een pagina gaan naar de Engelse tegenhanger.
 */
declare(strict_types=1);

if (!class_exists(\Dom\HTMLDocument::class)) {
    fwrite(STDERR, "Dit script heeft PHP 8.4 of nieuwer nodig (Dom\\HTMLDocument).\n");
    exit(1);
}

$root = realpath(__DIR__ . '/..');
$web = $root . '/public_html';
$modus = $argv[1] ?? '';

const SITE = 'https://cubetimer.nl';

/** Nederlandse pagina => Engelse pagina. De enige plek waar dat staat. */
const PAGINAS = [
    '/'                               => '/en/',
    '/index.html'                     => '/en/',
    '/leren.html'                     => '/en/learn.html',
    '/privacy.html'                   => '/en/privacy.html',
    '/voorwaarden.html'               => '/en/terms.html',
    '/uitleg.html'                    => '/en/faq.html',
    '/gidsen/'                        => '/en/guides/',
    '/gidsen/index.html'              => '/en/guides/',
    '/gidsen/notatie.html'            => '/en/guides/notation.html',
    '/gidsen/cfop.html'               => '/en/guides/cfop.html',
    '/gidsen/sneller-worden.html'     => '/en/guides/get-faster.html',
    '/gidsen/gemiddelden.html'        => '/en/guides/averages.html',
    '/gidsen/hoe-snel.html'           => '/en/guides/how-fast.html',
    '/gidsen/eerste-wedstrijd.html'   => '/en/guides/first-competition.html',
    '/gidsen/speedcube-kiezen.html'   => '/en/guides/choosing-a-speedcube.html',
    '/gidsen/wca-events.html'         => '/en/guides/wca-events.html',
    '/over.html'                      => '/en/about.html',
];

/** Welke pagina's gegenereerd worden. */
const BOUWEN = [
    'index.html' => 'en/index.html',
    'leren.html' => 'en/learn.html',
];

/** Attributen met tekst voor mensen. */
const TEKST_ATTRIBUTEN = ['title', 'aria-label', 'placeholder', 'alt', 'data-leeg', 'label'];

/**
 * Tekst die in beide talen hetzelfde is: namen, notatie, sneltoetsen. Alles
 * zonder letters (getallen, tijden, symbolen) telt vanzelf mee.
 */
const ZELFDE = [
    'CubeTimer', 'DNF', 'DNS', '+2', 'Ao5', 'Ao12', 'Ao50', 'Ao100', 'Mo3', 'PR', 'OLL', 'PLL', 'F2L', 'CFOP',
    'WCA', 'XP', 'Lv. 1', 'Spatie', 'D', '2', 'Email', 'GitHub', 'Bluetooth', 'Smart cube', 'OK', 'Ok',
    '3x3x3', '2x2x2', '4x4x4', '5x5x5', '6x6x6', '7x7x7', 'Megaminx', 'Pyraminx', 'Skewb', 'Square-1', 'Clock',
    'Single', 'Streak', 'Speedrun', 'Survival', 'Ladder', 'Duel', 'Scramble', 'sim', 'MAC',
    'Inter', 'MPL-2.0', 'Level', 'Lv.', 'TPS', '--', 'R', 'U', 'F', 'L', 'B', 'x', 'y', 'z',
    'GAN', 'MoYu', 'QiYi', 'X-Man', 'Giiker', 'GoCube', 'Timer', 'Status', 'Account', 'Menu', 'Privacy',
    'Feedback', 'Event', 'Solve', 'Solves', 'Cube', 'Protocol', 'Beginner', 'Cuber', 'Achievements',
    'Challenges', 'Daily challenges', 'FAQ', 'English', 'Nederlands', 'WebPage', 'LearningResource', 'AB:12:34:CD:56:EF', 'SportsApplication',
];

/* -------------------------------------------------------------------------
 * Woordenboeken
 * ---------------------------------------------------------------------- */

function laadWoordenboek(string $pad): array
{
    if (!is_file($pad)) {
        return [];
    }
    $data = json_decode((string) file_get_contents($pad), true);
    if (!is_array($data)) {
        fwrite(STDERR, "Geen geldige JSON: $pad (" . json_last_error_msg() . ")\n");
        exit(1);
    }
    return $data;
}

function normaal(string $tekst): string
{
    return trim((string) preg_replace('/\s+/u', ' ', $tekst));
}

$html = laadWoordenboek("$root/taal/en/html.json");
$js = laadWoordenboek("$root/taal/en/js.json");
$server = laadWoordenboek("$root/taal/en/server.json");

// De HTML-vertaler mag ook alles uit js.json gebruiken (dezelfde knoptekst
// staat soms in de HTML en in een script); html.json gaat voor.
$pagina = $html + $js;
$paginaNormaal = [];
foreach ($pagina as $nl => $en) {
    $paginaNormaal[normaal((string) $nl)] = (string) $en;
}

/* -------------------------------------------------------------------------
 * Een pagina vertalen
 * ---------------------------------------------------------------------- */

final class Vertaler
{
    /** @var array<string,true> */
    public array $ontbrekend = [];
    /** @var array<string,true> */
    public array $gebruikt = [];

    public function __construct(private array $woorden, private string $bron)
    {
    }

    public function vertaal(string $tekst): ?string
    {
        $sleutel = normaal($tekst);
        if ($sleutel === '' || self::hoeftNiet($sleutel)) {
            return null;
        }
        if (isset($this->woorden[$sleutel])) {
            $this->gebruikt[$sleutel] = true;
            return $this->woorden[$sleutel];
        }
        $this->ontbrekend[$sleutel] = true;
        return null;
    }

    public static function hoeftNiet(string $sleutel): bool
    {
        return preg_match('/\p{L}{2,}/u', $sleutel) !== 1 || in_array($sleutel, ZELFDE, true);
    }

    public function pagina(\Dom\HTMLDocument $doc): void
    {
        $this->element($doc->documentElement);
    }

    private function element(\Dom\Element $el): void
    {
        $naam = strtolower($el->localName);
        if (in_array($naam, ['script', 'style', 'svg', 'code', 'kbd'], true)) {
            if ($naam === 'script' && $el->getAttribute('type') === 'application/ld+json') {
                $this->jsonLd($el);
            }
            return;
        }
        if ($el->hasAttribute('data-niet-vertalen')) {
            return;
        }

        foreach (TEKST_ATTRIBUTEN as $attr) {
            if ($el->hasAttribute($attr)) {
                $en = $this->vertaal($el->getAttribute($attr));
                if ($en !== null) {
                    $el->setAttribute($attr, $en);
                }
            }
        }
        if ($naam === 'meta') {
            $soort = $el->getAttribute('name') ?: $el->getAttribute('property');
            if (in_array($soort, ['description', 'og:title', 'og:description', 'og:image:alt', 'twitter:title', 'twitter:description', 'apple-mobile-web-app-title'], true)) {
                $en = $this->vertaal($el->getAttribute('content'));
                if ($en !== null) {
                    $el->setAttribute('content', $en);
                }
            }
            if ($soort === 'og:locale') {
                $el->setAttribute('content', 'en_GB');
            }
            if ($soort === 'keywords') {
                $en = $this->vertaal($el->getAttribute('content'));
                if ($en !== null) {
                    $el->setAttribute('content', $en);
                }
            }
            return;
        }

        // Gemengde inhoud (tekst met opmaak erin) als geheel, als dat een sleutel is.
        $heeftElementen = false;
        $heeftTekst = false;
        foreach ($el->childNodes as $kind) {
            if ($kind instanceof \Dom\Element) {
                $heeftElementen = true;
            } elseif ($kind instanceof \Dom\Text && normaal($kind->textContent) !== '') {
                $heeftTekst = true;
            }
        }
        if ($heeftElementen && $heeftTekst) {
            $binnen = normaal($el->innerHTML);
            if (isset($this->woorden[$binnen])) {
                $this->gebruikt[$binnen] = true;
                $el->innerHTML = $this->woorden[$binnen];
                return;
            }
            // Nog geen vertaling: meld de hele zin, niet de losse stukjes.
            $this->ontbrekend[$binnen] = true;
            return;
        }

        foreach (iterator_to_array($el->childNodes) as $kind) {
            if ($kind instanceof \Dom\Element) {
                $this->element($kind);
            } elseif ($kind instanceof \Dom\Text) {
                $origineel = $kind->textContent;
                $sleutel = normaal($origineel);
                if ($sleutel === '' || self::hoeftNiet($sleutel)) {
                    continue;
                }
                if (isset($this->woorden[$sleutel])) {
                    $this->gebruikt[$sleutel] = true;
                    preg_match('/^\s*/u', $origineel, $voor);
                    preg_match('/\s*$/u', $origineel, $na);
                    $kind->textContent = $voor[0] . $this->woorden[$sleutel] . $na[0];
                } else {
                    $this->ontbrekend[$sleutel] = true;
                }
            }
        }
    }

    private function jsonLd(\Dom\Element $script): void
    {
        $data = json_decode($script->textContent, true);
        if (!is_array($data)) {
            return;
        }
        array_walk_recursive($data, function (&$waarde, $sleutel) {
            if (!is_string($waarde)) {
                return;
            }
            if (in_array($sleutel, ['url', 'item', '@id', 'image', 'logo'], true) || str_starts_with($waarde, SITE)) {
                $waarde = paginaUrl($waarde);
                return;
            }
            if (in_array($sleutel, ['@type', '@context', 'priceCurrency', 'price', 'applicationCategory'], true)) {
                return;
            }
            if ($sleutel === 'inLanguage') {
                $waarde = 'en';
                return;
            }
            $en = $this->vertaal($waarde);
            if ($en !== null) {
                $waarde = $en;
            }
        });
        $script->textContent = "\n    " . json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n    ";
    }
}

/** Een adres op de site naar zijn Engelse tegenhanger (of absoluut maken). */
function paginaUrl(string $url): string
{
    if ($url === '' || preg_match('#^(mailto:|tel:|javascript:|data:|\#)#', $url)) {
        return $url;
    }
    $absoluut = str_starts_with($url, SITE);
    $pad = $absoluut ? substr($url, strlen(SITE)) : $url;
    if (preg_match('#^[a-z]+://#i', $pad) || str_starts_with($pad, '//')) {
        return $url; // ander domein
    }
    if (str_starts_with($pad, '/en/') || $pad === '/en') {
        return $url;
    }
    if (!str_starts_with($pad, '/')) {
        $pad = '/' . $pad;
    }
    // Pad, querystring en hekje uit elkaar.
    preg_match('#^([^?\#]*)(.*)$#', $pad, $m);
    $basis = $m[1] === '' ? '/' : $m[1];
    if (isset(PAGINAS[$basis])) {
        $basis = PAGINAS[$basis];
    }
    return ($absoluut ? SITE : '') . $basis . $m[2];
}

function bouwPagina(string $bron, string $doel, array $woorden, string $web): array
{
    $doc = \Dom\HTMLDocument::createFromString((string) file_get_contents("$web/$bron"), LIBXML_NOERROR);
    $vertaler = new Vertaler($woorden, $bron);
    $vertaler->pagina($doc);

    $doc->documentElement->setAttribute('lang', 'en');

    // Paden: alles absoluut, en pagina's naar hun Engelse versie. De
    // hreflang-links wijzen al naar beide talen en blijven zoals ze zijn.
    foreach ($doc->querySelectorAll('[href], [src]') as $el) {
        if ($el->localName === 'link' && $el->hasAttribute('hreflang')) {
            continue;
        }
        if ($el->hasAttribute('data-taalwissel')) {
            continue;
        }
        foreach (['href', 'src'] as $attr) {
            if ($el->hasAttribute($attr)) {
                $el->setAttribute($attr, paginaUrl($el->getAttribute($attr)));
            }
        }
    }
    foreach ($doc->querySelectorAll('meta[property="og:url"], meta[property="og:image"]') as $meta) {
        $meta->setAttribute('content', paginaUrl($meta->getAttribute('content')));
    }

    // De taallink wijst naar de Nederlandse versie. (Op de timer staat de taal
    // in Instellingen; dat keuzemenu heeft geen vertaling nodig.)
    foreach ($doc->querySelectorAll('[data-taalwissel]') as $knop) {
        $nl = array_search('/' . $doel, PAGINAS, true);
        $knop->setAttribute('href', (($doel === 'en/index.html') ? '/' : ($nl !== false ? $nl : '/')) . '#taal=nl');
        $knop->setAttribute('hreflang', 'nl');
        $knop->setAttribute('lang', 'nl');
        $knop->setAttribute('data-taalwissel', 'nl');
        foreach ($knop->querySelectorAll('[data-taalwissel-code]') as $code) {
            $code->textContent = 'Nederlands';
        }
    }

    // De vertalingen voor de scripts, vóór ui.js (defer houdt de volgorde vast).
    $ui = $doc->querySelector('script[src="/Script/ui.js"]');
    if ($ui !== null) {
        $taal = $doc->createElement('script');
        $taal->setAttribute('src', '/Script/taal-en.js');
        $taal->setAttribute('defer', '');
        $ui->parentNode->insertBefore($taal, $ui);
        $ui->parentNode->insertBefore($doc->createTextNode("\n    "), $ui);
    }

    $kop = "<!DOCTYPE html>\n<!-- Gegenereerd door tools/vertalen.php uit /$bron. Niet met de hand aanpassen:\n"
        . "     verander de Nederlandse pagina of taal/en/html.json en draai het script opnieuw. -->\n";
    $uit = $doc->saveHtml($doc->documentElement);

    return [$kop . $uit . "\n", $vertaler];
}

/* -------------------------------------------------------------------------
 * Aan de slag
 * ---------------------------------------------------------------------- */

$bestanden = [];
$ontbrekend = [];
$gebruikt = [];
foreach (BOUWEN as $bron => $doel) {
    [$inhoud, $vertaler] = bouwPagina($bron, $doel, $paginaNormaal, $web);
    $bestanden["$web/$doel"] = $inhoud;
    foreach ($vertaler->ontbrekend as $tekst => $_) {
        $ontbrekend[$tekst][] = $bron;
    }
    $gebruikt += $vertaler->gebruikt;
}

$jsBestand = "/* Gegenereerd door tools/vertalen.php uit taal/en/js.json. Niet met de hand aanpassen. */\n"
    . 'window.CubeTimerVertaling = ' . json_encode($js, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . ";\n";
$bestanden["$web/Script/taal-en.js"] = $jsBestand;

$phpBestand = "<?php\n// Gegenereerd door tools/vertalen.php uit taal/en/server.json. Niet met de hand aanpassen.\nreturn "
    . var_export($server, true) . ";\n";
$bestanden["$web/api/lib/taal/en.php"] = $phpBestand;

if ($modus === '--ontbrekend') {
    echo json_encode(array_keys($ontbrekend), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
    exit(0);
}

$fouten = 0;
foreach ($ontbrekend as $tekst => $bronnen) {
    echo '  ONTBREEKT  ' . implode(', ', array_unique($bronnen)) . ': ' . mb_strimwidth($tekst, 0, 140, '…') . "\n";
    $fouten++;
}
// Lege of gelijke vertalingen zijn meestal vergeten.
foreach (['html' => $html, 'js' => $js, 'server' => $server] as $naam => $lijst) {
    foreach ($lijst as $nl => $en) {
        if (!is_string($en) || trim($en) === '') {
            echo "  LEEG       taal/en/$naam.json: $nl\n";
            $fouten++;
        }
        // Plaatshouders moeten in beide talen hetzelfde zijn.
        preg_match_all('/\{\w+\}/', (string) $nl, $a);
        preg_match_all('/\{\w+\}/', (string) $en, $b);
        sort($a[0]);
        sort($b[0]);
        if ($a[0] !== $b[0]) {
            echo "  PLAATSHOUDER taal/en/$naam.json: $nl\n";
            $fouten++;
        }
    }
}
foreach (array_keys($html) as $nl) {
    if (!isset($gebruikt[normaal((string) $nl)])) {
        echo "  ONGEBRUIKT taal/en/html.json: " . mb_strimwidth((string) $nl, 0, 100, '…') . "\n";
    }
}

// Elke UI.t('...') in de scripts moet een vertaling hebben, en er mag geen
// Nederlandse tekst buiten UI.t() staan (zie tools/teksten-zoeken.js).
$node = trim((string) shell_exec('command -v node'));
if ($node !== '') {
    $sleutels = json_decode((string) shell_exec(escapeshellarg($node) . ' ' . escapeshellarg("$root/tools/teksten-zoeken.js") . ' --sleutels'), true) ?: [];
    foreach ($sleutels as $sleutel) {
        if (!array_key_exists($sleutel, $js)) {
            echo "  ONTBREEKT  taal/en/js.json: $sleutel\n";
            $fouten++;
        }
    }
    $los = (string) shell_exec(escapeshellarg($node) . ' ' . escapeshellarg("$root/tools/teksten-zoeken.js"));
    if (preg_match('/^(\d+) regels met Nederlandse tekst/m', $los, $m) && (int) $m[1] > 0) {
        echo "  NIET IN UI.t()  {$m[1]} regels (node tools/teksten-zoeken.js)\n";
        $fouten++;
    }
} else {
    echo "  (node niet gevonden: de scripts zijn niet gecontroleerd)\n";
}

// En hetzelfde voor de server (tools/server-teksten.php).
$serverSleutels = json_decode((string) shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg("$root/tools/server-teksten.php") . ' --sleutels'), true) ?: [];
foreach ($serverSleutels as $sleutel) {
    if (!array_key_exists($sleutel, $server)) {
        echo "  ONTBREEKT  taal/en/server.json: $sleutel\n";
        $fouten++;
    }
}
$losServer = (string) shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg("$root/tools/server-teksten.php"));
if (preg_match('/^(\d+) meldingen zijn geen vaste tekst/m', $losServer, $m) && (int) $m[1] > 0) {
    echo "  NIET VAST  {$m[1]} servermeldingen (php tools/server-teksten.php)\n";
    $fouten++;
}

if ($modus === '--controleer') {
    foreach ($bestanden as $pad => $inhoud) {
        if (!is_file($pad) || file_get_contents($pad) !== $inhoud) {
            echo '  NIET BIJ   ' . substr($pad, strlen($root) + 1) . " (draai php tools/vertalen.php)\n";
            $fouten++;
        }
    }
    echo $fouten === 0 ? "Engelse versie is compleet en bij.\n" : "\n$fouten problemen.\n";
    exit($fouten === 0 ? 0 : 1);
}

foreach ($bestanden as $pad => $inhoud) {
    if (!is_dir(dirname($pad))) {
        mkdir(dirname($pad), 0775, true);
    }
    file_put_contents($pad, $inhoud);
}
echo count($bestanden) . " bestanden geschreven" . ($fouten ? ", $fouten teksten nog zonder vertaling" : '') . ".\n";
exit($fouten === 0 ? 0 : 1);
