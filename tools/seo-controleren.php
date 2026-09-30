<?php
/**
 * Controleert de SEO van de site, zonder netwerk:
 *
 *   php tools/seo-controleren.php
 *
 * Per pagina uit sitemap.xml (Nederlands en Engels): lang past bij het adres
 * (/en/ is Engels), hreflang naar beide talen en x-default, over en weer
 * gelijk aan de sitemap, og:locale per taal, een titel van hooguit 60 tekens, een
 * omschrijving tussen 70 en 160 tekens, een canonical die precies gelijk is
 * aan het adres in de sitemap, één <h1>, lang="nl", een og:image met een
 * volledig adres dat ook echt bestaat, geldige JSON-LD, en bij elk plaatje een
 * alt-tekst en afmetingen (tegen verspringen tijdens het laden).
 *
 * Verder: robots.txt verwijst naar de sitemap en blokkeert geen pagina uit de
 * sitemap, profielen en de 404-pagina hebben noindex en staan niet in de
 * sitemap, en ads.txt heeft de goede vorm.
 */
declare(strict_types=1);

const SITE = 'https://cubetimer.nl';
$root = __DIR__ . '/../public_html/';

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

function laad(string $html): DOMXPath
{
    $dom = new DOMDocument();
    libxml_use_internal_errors(true);
    $dom->loadHTML('<?xml encoding="UTF-8">' . $html);
    libxml_clear_errors();
    return new DOMXPath($dom);
}

function attr(DOMXPath $x, string $query, string $naam): ?string
{
    $knoop = $x->query($query)->item(0);
    return $knoop instanceof DOMElement ? $knoop->getAttribute($naam) : null;
}

/** Een adres op de site naar het bestand in public_html. */
function bestandVoor(string $root, string $url): string
{
    $pad = substr($url, strlen(SITE)) ?: '/';
    if (str_ends_with($pad, '/')) {
        $pad .= 'index.html';
    }
    return $root . ltrim($pad, '/');
}

// --- sitemap ----------------------------------------------------------------
$sitemap = simplexml_load_file($root . 'sitemap.xml');
klopt($sitemap !== false, 'sitemap.xml is geldige XML');
$adressen = [];
$alternatievenSitemap = [];
foreach ($sitemap->url as $url) {
    $loc = (string) $url->loc;
    $adressen[] = $loc;
    foreach ($url->children('http://www.w3.org/1999/xhtml')->link as $link) {
        $a = $link->attributes();
        $alternatievenSitemap[$loc][(string) $a['hreflang']] = (string) $a['href'];
    }
}
klopt(count($adressen) >= 2, 'sitemap.xml heeft pagina\'s');

// --- robots.txt ---------------------------------------------------------------
$robots = (string) file_get_contents($root . 'robots.txt');
klopt(str_contains($robots, 'Sitemap: ' . SITE . '/sitemap.xml'), 'robots.txt verwijst naar de sitemap');
preg_match_all('/^Disallow:\s*(\S+)/mi', $robots, $geblokkeerd);
foreach ($adressen as $adres) {
    $pad = substr($adres, strlen(SITE)) ?: '/';
    foreach ($geblokkeerd[1] as $regel) {
        klopt(!str_starts_with($pad, $regel), "robots.txt blokkeert $pad niet");
    }
}
klopt(in_array('/api/', $geblokkeerd[1], true), 'robots.txt houdt /api/ buiten de index');
foreach (['/profiel.php', '/u/'] as $pad) {
    foreach ($geblokkeerd[1] as $regel) {
        // Geblokkeerd lezen betekent: Google ziet de noindex niet.
        klopt(!str_starts_with($pad, $regel), "robots.txt blokkeert $pad niet (anders ziet Google de noindex niet)");
    }
}

// --- elke pagina uit de sitemap -----------------------------------------------
foreach ($adressen as $adres) {
    $bestand = bestandVoor($root, $adres);
    $naam = substr($bestand, strlen($root));
    echo "$naam\n";
    klopt(is_file($bestand), "$naam bestaat");
    if (!is_file($bestand)) {
        continue;
    }
    $html = (string) file_get_contents($bestand);
    $x = laad($html);

    $taal = str_starts_with(substr($adres, strlen(SITE)), '/en/') ? 'en' : 'nl';
    klopt(attr($x, '//html', 'lang') === $taal, "$naam: lang=\"$taal\"");

    // hreflang: beide talen en x-default, gelijk aan de sitemap, en de pagina
    // zelf staat erbij (Google negeert hreflang die niet over en weer klopt).
    $alternatieven = [];
    foreach ($x->query('//link[@rel="alternate"][@hreflang]') as $link) {
        $alternatieven[$link->getAttribute('hreflang')] = $link->getAttribute('href');
    }
    klopt(isset($alternatieven['nl'], $alternatieven['en'], $alternatieven['x-default']), "$naam: hreflang nl, en en x-default");
    klopt(($alternatieven[$taal] ?? '') === $adres, "$naam: hreflang $taal wijst naar zichzelf");
    klopt($alternatieven === ($alternatievenSitemap[$adres] ?? null), "$naam: hreflang gelijk aan de sitemap");
    foreach (['nl', 'en'] as $andere) {
        klopt(in_array($alternatieven[$andere] ?? '', $adressen, true), "$naam: hreflang $andere staat in de sitemap");
    }

    $titel = trim((string) ($x->query('//title')->item(0)?->textContent ?? ''));
    klopt($titel !== '' && mb_strlen($titel) <= 60, "$naam: titel van hooguit 60 tekens (" . mb_strlen($titel) . ')');

    $omschrijving = (string) attr($x, '//meta[@name="description"]', 'content');
    $lengte = mb_strlen($omschrijving);
    klopt($lengte >= 70 && $lengte <= 160, "$naam: omschrijving van 70 tot 160 tekens ($lengte)");

    klopt(attr($x, '//link[@rel="canonical"]', 'href') === $adres, "$naam: canonical is $adres");
    klopt(attr($x, '//meta[@property="og:url"]', 'content') === $adres, "$naam: og:url is $adres");
    klopt($x->query('//h1')->length === 1, "$naam: precies één h1");
    $locale = (string) attr($x, '//meta[@property="og:locale"]', 'content');
    klopt($locale === ($taal === 'en' ? 'en_GB' : 'nl_NL'), "$naam: og:locale past bij de taal ($locale)");
    klopt(!str_contains((string) attr($x, '//meta[@name="robots"]', 'content'), 'noindex'), "$naam: geen noindex");

    $afbeelding = (string) attr($x, '//meta[@property="og:image"]', 'content');
    klopt(str_starts_with($afbeelding, SITE . '/'), "$naam: og:image is een volledig adres");
    klopt(is_file(bestandVoor($root, $afbeelding)), "$naam: og:image bestaat");

    foreach ($x->query('//script[@type="application/ld+json"]') as $blok) {
        $data = json_decode($blok->textContent, true);
        klopt(is_array($data) && ($data['@context'] ?? '') === 'https://schema.org', "$naam: JSON-LD is geldig");
    }

    foreach ($x->query('//img') as $img) {
        $src = $img->getAttribute('src');
        klopt($img->hasAttribute('alt'), "$naam: <img $src> heeft een alt");
        klopt($img->hasAttribute('width') && $img->hasAttribute('height'), "$naam: <img $src> heeft afmetingen");
    }
}

// --- pagina's die er niet in horen --------------------------------------------
echo "noindex\n";
foreach (['404.html', 'profiel.php'] as $naam) {
    $html = (string) file_get_contents($root . $naam);
    klopt((bool) preg_match('/<meta name="robots" content="noindex/', $html), "$naam: noindex");
    foreach ($adressen as $adres) {
        klopt(!str_contains($adres, $naam), "$naam staat niet in de sitemap");
    }
    // Deze pagina's verschijnen op andere paden (/u/naam, /iets/anders).
    klopt(!preg_match('/(href|src)="(Style|Pictures|Script)\//', $html), "$naam: paden beginnen bij de root");
}

// --- ads.txt --------------------------------------------------------------------
echo "ads.txt\n";
$regels = array_filter(array_map('trim', file($root . 'ads.txt')), static fn ($r) => $r !== '' && $r[0] !== '#');
klopt(count($regels) >= 1, 'ads.txt heeft regels');
foreach ($regels as $regel) {
    klopt((bool) preg_match('/^google\.com, pub-\d{16}, DIRECT, f08c47fec0942fa0$/', $regel), "ads.txt: $regel");
}
$index = (string) file_get_contents($root . 'index.html');
preg_match_all('/ca-pub-(\d{16})/', $index, $idS);
foreach (array_unique($idS[1]) as $id) {
    klopt(str_contains(implode("\n", $regels), "pub-$id"), "ads.txt noemt pub-$id uit index.html");
}

echo "\n" . ($aantal - $fouten) . " van de $aantal controles in orde\n";
exit($fouten === 0 ? 0 : 1);
