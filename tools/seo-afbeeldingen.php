<?php
/**
 * Maakt de afbeeldingen die zoekmachines en sociale media gebruiken, uit het
 * logo en het favicon dat er al is. Draai opnieuw als het logo verandert:
 *
 *   php tools/seo-afbeeldingen.php
 *
 * Wat eruit komt (in public_html/):
 *   favicon.ico                  48x48, voor wie om /favicon.ico vraagt
 *   Pictures/favicon-48.png      Google toont een favicon van minstens 48px
 *   Pictures/favicon-192.png     Android en het webmanifest
 *   Pictures/apple-touch-icon.png  180x180 op een donkere ondergrond; iOS
 *                                  maakt transparantie zwart
 *   Pictures/og-image.png        1200x630, het voorbeeldplaatje bij een
 *                                gedeelde link (WhatsApp, Discord, X, Google)
 *
 * Vraagt PHP met GD en FreeType. De tekst gebruikt DejaVu Sans uit het
 * systeem; dat lettertype hoeft niet mee naar de server, alleen het plaatje.
 */
declare(strict_types=1);

$root = __DIR__ . '/../public_html/';
$favicon = imagecreatefrompng($root . 'Pictures/CubeTimerFavicon_V2.png');
$logo = imagecreatefrompng($root . 'Pictures/CubeTimerLogo_V2.png');
if (!$favicon || !$logo) {
    fwrite(STDERR, "Logo of favicon niet gevonden.\n");
    exit(1);
}

// Zelfde kleur als --bg in het donkere thema.
const ACHTERGROND = [6, 9, 17];

function canvas(int $w, int $h, bool $transparant): GdImage
{
    $im = imagecreatetruecolor($w, $h);
    imagesavealpha($im, true);
    imagealphablending($im, false);
    $kleur = $transparant
        ? imagecolorallocatealpha($im, 0, 0, 0, 127)
        : imagecolorallocate($im, ...ACHTERGROND);
    imagefilledrectangle($im, 0, 0, $w, $h, $kleur);
    imagealphablending($im, true);
    return $im;
}

/** Zet $bron gecentreerd en passend in een vak van $vakB x $vakH op ($x, $y). */
function plak(GdImage $doel, GdImage $bron, int $x, int $y, int $vakB, int $vakH): void
{
    $bw = imagesx($bron);
    $bh = imagesy($bron);
    $schaal = min($vakB / $bw, $vakH / $bh);
    $w = (int) round($bw * $schaal);
    $h = (int) round($bh * $schaal);
    imagecopyresampled($doel, $bron, $x + intdiv($vakB - $w, 2), $y + intdiv($vakH - $h, 2), 0, 0, $w, $h, $bw, $bh);
}

function bewaar(GdImage $im, string $pad): void
{
    imagepng($im, $pad, 9);
    echo str_pad(basename($pad), 24) . round(filesize($pad) / 1024, 1) . " kB\n";
}

// --- favicons ---------------------------------------------------------------
foreach ([48, 192] as $maat) {
    $im = canvas($maat, $maat, true);
    plak($im, $favicon, 0, 0, $maat, $maat);
    bewaar($im, $root . "Pictures/favicon-$maat.png");
}

$im = canvas(180, 180, false);
plak($im, $favicon, 22, 22, 136, 136);
bewaar($im, $root . 'Pictures/apple-touch-icon.png');

// favicon.ico: een ICO mag gewoon een PNG bevatten. Header (6 bytes), een
// regel in de map (16 bytes), dan de PNG zelf.
$im = canvas(48, 48, true);
plak($im, $favicon, 0, 0, 48, 48);
ob_start();
imagepng($im, null, 9);
$png = (string) ob_get_clean();
$ico = pack('vvv', 0, 1, 1) . pack('CCCCvvVV', 48, 48, 0, 0, 1, 32, strlen($png), 22) . $png;
file_put_contents($root . 'favicon.ico', $ico);
echo str_pad('favicon.ico', 24) . round(strlen($ico) / 1024, 1) . " kB\n";

// --- og-image ---------------------------------------------------------------
$w = 1200;
$h = 630;
$im = canvas($w, $h, false);

// Een zachte blauwe gloed achter het logo, zoals op de site zelf. Per pixel,
// want gestapelde halfdoorzichtige ellipsen tellen op tot een felle vlek.
for ($py = 0; $py < $h; $py++) {
    for ($px = 0; $px < $w; $px++) {
        $afstand = sqrt((($px - 600) / 560) ** 2 + (($py - 250) / 330) ** 2);
        $sterkte = 0.22 * max(0.0, 1 - $afstand) ** 2;
        if ($sterkte <= 0) {
            continue;
        }
        $kleur = imagecolorallocate(
            $im,
            (int) round(ACHTERGROND[0] + (27 - ACHTERGROND[0]) * $sterkte),
            (int) round(ACHTERGROND[1] + (166 - ACHTERGROND[1]) * $sterkte),
            (int) round(ACHTERGROND[2] + (255 - ACHTERGROND[2]) * $sterkte)
        );
        imagesetpixel($im, $px, $py, $kleur);
    }
}

plak($im, $logo, 250, 110, 700, 290);

$font = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
$fontLicht = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
if (is_file($font) && is_file($fontLicht)) {
    $wit = imagecolorallocate($im, 234, 242, 255);
    $grijs = imagecolorallocatealpha($im, 234, 242, 255, 45);
    $regels = [
        [$font, 40, $wit, 'Online speedcubing-timer'],
        [$fontLicht, 26, $grijs, 'WCA-scrambles · inspectie · statistieken · smart cubes'],
    ];
    $y = 470;
    foreach ($regels as [$f, $maat, $kleur, $tekst]) {
        $vak = imagettfbbox($maat, 0, $f, $tekst);
        $breedte = $vak[2] - $vak[0];
        imagettftext($im, $maat, 0, intdiv($w - $breedte, 2), $y, $kleur, $f, $tekst);
        $y += 60;
    }
} else {
    fwrite(STDERR, "DejaVu Sans niet gevonden; og-image zonder tekst.\n");
}

bewaar($im, $root . 'Pictures/og-image.png');
