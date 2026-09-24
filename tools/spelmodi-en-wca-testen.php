<?php
/**
 * Test het rekenwerk van de spelmodi, de duels en de historische toernooien,
 * zonder database en zonder netwerk.
 *
 *   php tools/spelmodi-en-wca-testen.php
 *
 * Wat hier getest wordt:
 *   - Ranking: Ao5, Mo3 en best of, met DNF's en een gemiste cutoff
 *   - GameModes::evaluate: de server telt zelf na wat de browser instuurt
 *   - Wca::process: de voorbeeldantwoorden uit tools/wca-voorbeeld worden
 *     omgezet naar rondes met het juiste format, de cutoff, de limiet, de
 *     scrambles en de uitslagen
 *
 * De voorbeeldbestanden zijn geschreven naar de vorm van de echte WCA-API.
 * Een groene test bewijst dat de omzetting klopt voor die vorm; of de echte
 * API precies zo antwoordt, zie je pas op een server die de WCA kan bereiken.
 */
declare(strict_types=1);

$api = __DIR__ . '/../public_html/api/lib/';
require_once $api . 'Ranking.php';
require_once $api . 'GameModes.php';
require_once $api . 'Duels.php';
require_once $api . 'Wca.php';

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

/* --- Ranking ----------------------------------------------------------- */
echo "Ranking\n";
$r = Ranking::result('a', [10000, 12000, 11000, null, 9000]);
klopt($r['average'] === 11000 && $r['best'] === 9000, 'Ao5 met een DNF: de DNF valt weg als slechtste');
$r = Ranking::result('a', [10000, null, 11000, null, 9000]);
klopt($r['average'] === null && $r['best'] === 9000, 'Ao5 met twee DNF\'s is een DNF');
$r = Ranking::result('a', [10000, 12000]);
klopt($r['average'] === null && $r['best'] === 10000, 'Gestrand op de cutoff: geen gemiddelde, wel een single');
$r = Ranking::result('m', [60000, 63000, 66000]);
klopt($r['average'] === 63000, 'Mo3 is gewoon het gemiddelde');
$r = Ranking::result('m', [60000, null, 66000]);
klopt($r['average'] === null, 'Mo3 met een DNF is een DNF');
$r = Ranking::result('3', [null, 50000, 48000]);
klopt($r['average'] === null && $r['best'] === 48000, 'Best of 3 heeft alleen een single');
klopt(Ranking::compare('a', ['average' => 9000, 'best' => 8000], ['average' => null, 'best' => 5000]) < 0,
    'Een gemiddelde gaat voor een betere single zonder gemiddelde');
klopt(Ranking::compare('3', ['average' => null, 'best' => 40000], ['average' => null, 'best' => 45000]) < 0,
    'Best of: de beste single wint');
klopt(Ranking::compare('a', ['average' => 9000, 'best' => 8000], ['average' => 9000, 'best' => 8500]) < 0,
    'Gelijk gemiddelde: de single beslist');
klopt(Ranking::effective(10000, 'plus2') === 12000 && Ranking::effective(10000, 'dns') === null,
    '+2 telt op, DNS telt als niets');

/* --- Spelmodi ---------------------------------------------------------- */
echo "Spelmodi\n";
$s = static fn (?int $ms, string $p = 'none'): array => ['ms' => $ms, 'penalty' => $p];

$u = GameModes::evaluate('streak', '333', 15000, ['solves' => [$s(12000), $s(14990), $s(13000, 'plus2'), $s(9000)]]);
klopt($u['ok'] && $u['score'] === 2, 'Streak sub 15: 12, 14.99, dan 15.00 met +2 breekt de reeks');
klopt(count($u['details']['solves']) === 3, 'Streak: wat na de breuk komt, telt niet en wordt niet bewaard');
klopt($u['tiebreak'] === 13495, 'Streak: tiebreak is het gemiddelde van de geslaagde solves');

$u = GameModes::evaluate('streak', '333', 15000, ['solves' => [$s(15000)]]);
klopt($u['ok'] && $u['score'] === 0, 'Streak: precies de doeltijd is niet "sub"');

$stap = GameModes::survivalStep('333');
klopt($stap === 500, 'Survival op 3x3 gaat per solve 0,5 s omlaag');
klopt(GameModes::survivalStep('777') === 6500, 'Survival op 7x7 rekent de stap om met de snelheidsfactor');
$u = GameModes::evaluate('survival', '333', 20000, ['solves' => [$s(20000), $s(19500), $s(19100), $s(18999)]]);
klopt($u['ok'] && $u['score'] === 2, 'Survival: 20.00 onder 20.00 mag, 19.50 onder 19.50 mag, 19.10 boven 19.00 niet');

$u = GameModes::evaluate('ladder', '333', 999, ['solves' => [$s(15000), $s(14000), $s(13000), $s(13500)]]);
klopt($u['ok'] && $u['score'] === 3 && $u['variant'] === 0 && $u['tiebreak'] === 13000,
    'Ladder: drie treden, de vierde is langzamer; variant wordt 0');
$u = GameModes::evaluate('ladder', '333', 0, ['solves' => [$s(null, 'dnf')]]);
klopt($u['ok'] && $u['score'] === 0, 'Ladder: een DNF als eerste solve levert niets op');

$u = GameModes::evaluate('speedrun', '333', 5, ['laps' => [40000, 85000, 130000]]);
klopt($u['ok'] && $u['score'] === 3 && $u['tiebreak'] === 130000, 'Speedrun: drie van de vijf cubes');
$u = GameModes::evaluate('speedrun', '333', 5, ['laps' => [40000, 41000]]);
klopt(!$u['ok'], 'Speedrun: twee cubes binnen een seconde kan niet');
$u = GameModes::evaluate('speedrun', '333', 2, ['laps' => [40000, 80000, 120000]]);
klopt(!$u['ok'], 'Speedrun: meer cubes dan je had kan niet');
$u = GameModes::evaluate('speedrun', '333', 5, ['laps' => [40000, 400000]]);
klopt(!$u['ok'], 'Speedrun: na vijf minuten telt niets meer');
$u = GameModes::evaluate('speedrun', '333', 30, ['laps' => []]);
klopt(!$u['ok'], 'Speedrun: hooguit ' . GameModes::SPEEDRUN_MAX_CUBES . ' cubes');

$u = GameModes::evaluate('streak', '333', 15000, ['solves' => [$s(1000)]]);
klopt(!$u['ok'], 'Een solve onder het wereldrecord wordt geweigerd');
$u = GameModes::evaluate('streak', '333', 500, ['solves' => [$s(10000)]]);
klopt(!$u['ok'], 'Een doeltijd van een halve seconde kan niet');
$u = GameModes::evaluate('vliegen', '333', 0, ['solves' => [$s(10000)]]);
klopt(!$u['ok'], 'Onbekende modus');
$u = GameModes::evaluate('streak', '333fm', 15000, ['solves' => [$s(10000)]]);
klopt(!$u['ok'], 'FMC heeft geen tijd, dus geen spelmodus');

klopt(Duels::formatFor('333') === 'a' && Duels::formatFor('777') === 'm' && Duels::formatFor('333bf') === '3',
    'Duels volgen het format van een comp');

/* --- WCA --------------------------------------------------------------- */
echo "WCA\n";
$map = __DIR__ . '/wca-voorbeeld/';
$lees = static fn (string $f) => json_decode((string) file_get_contents($map . $f), true);
$comp = Wca::process('NepOpen2024', $lees('competition.json'), $lees('results.json'), $lees('wcif.json'), $lees('scrambles.json'));

klopt($comp['name'] === 'Nep Open 2024' && $comp['country'] === 'NL' && $comp['city'] === 'Utrecht', 'Naam, land en plaats');
klopt(array_map('strval', array_keys($comp['events'])) === ['333', '666', '333bf'],
    'Events in de vaste volgorde, zonder FMC: ' . implode(',', array_keys($comp['events'])));

$drie = $comp['events']['333']['rounds'];
klopt(count($drie) === 2 && $drie[0]['name'] === 'Eerste ronde' && $drie[1]['name'] === 'Finale', '3x3: eerste ronde en finale');
klopt(count($drie[0]['results']) === 12 && count($drie[1]['results']) === 6, '3x3: 12 deelnemers, 6 in de finale');
klopt($drie[0]['cutoff'] === ['attempts' => 2, 'ms' => 20000], '3x3: cutoff 20 s in twee pogingen');
klopt($drie[0]['limit'] === ['ms' => 60000, 'cumulative' => false], '3x3: limiet 1 minuut per poging');
klopt($drie[0]['results'][0]['p'] === 1 && $drie[0]['results'][11]['p'] === 12, '3x3: uitslagen op plek');

$gestrand = array_values(array_filter($drie[0]['results'], static fn ($r) => count($r['t']) === 2));
klopt(count($gestrand) === 2 && $gestrand[0]['a'] === null, '3x3: twee cubers gestrand op de cutoff, zonder gemiddelde');
$metDnf = array_values(array_filter($drie[0]['results'], static fn ($r) => in_array(null, $r['t'], true)));
klopt(count($metDnf) === 2, '3x3: DNF\'s komen door als null');
$metDns = array_values(array_filter($drie[1]['results'], static fn ($r) => in_array('dns', $r['t'], true)));
klopt(count($metDns) === 1, '3x3 finale: een DNS komt door als "dns"');
klopt(is_int($drie[0]['results'][0]['t'][0]) && $drie[0]['results'][0]['t'][0] % 10 === 0, 'Honderdsten worden milliseconden');
klopt(preg_match('/^\d{4}[A-Z]{4}\d{2}$/', (string) $drie[0]['results'][0]['w']) === 1, 'WCA-id komt mee');

$scr = $lees('scrambles.json');
$groepA = array_values(array_map(static fn ($s) => $s['scramble'], array_filter($scr,
    static fn ($s) => $s['event_id'] === '333' && $s['round_type_id'] === '1' && $s['group_id'] === 'A' && !$s['is_extra'])));
klopt($drie[0]['scrambles'] === $groepA, '3x3: de vijf scrambles van groep A, zonder de extra');
klopt(count($drie[1]['scrambles'] ?? []) === 5, '3x3 finale: vijf scrambles');

$zes = $comp['events']['666']['rounds'];
klopt(count($zes) === 1 && $zes[0]['name'] === 'Finale' && $zes[0]['format'] === 'm' && $zes[0]['attempts'] === 3,
    '6x6: een gecombineerde finale, Mo3');
klopt($zes[0]['cutoff'] === ['attempts' => 1, 'ms' => 120000], '6x6: cutoff 2 minuten in een poging');
klopt($zes[0]['limit'] === ['ms' => 600000, 'cumulative' => true], '6x6: cumulatieve limiet van 10 minuten');
klopt($zes[0]['scrambles'] === null, '6x6: geen scrambles bekend, dus null');

$blind = $comp['events']['333bf']['rounds'];
klopt($blind[0]['format'] === '3' && $blind[0]['attempts'] === 3, '3BLD: best of 3');
$allesDnf = array_values(array_filter($blind[0]['results'], static fn ($r) => $r['b'] === null));
klopt(count($allesDnf) === 1 && $allesDnf[0]['p'] === 5, '3BLD: wie alleen DNF\'s had, staat onderaan zonder single');

$zonder = Wca::process('X', [], $lees('results.json'), null, null);
klopt($zonder['events']['333']['rounds'][0]['cutoff'] === null && $zonder['events']['333']['rounds'][0]['limit'] === null
    && $zonder['name'] === 'X', 'Zonder WCIF en info: geen cutoff of limiet, en de id als naam');

$samenvatting = Wca::summarize($comp);
klopt($samenvatting['events'][0]['competitors'] === 12 && $samenvatting['events'][0]['rounds'] === 2
    && $samenvatting['events'][0]['officialScrambles'] === true, 'Samenvatting per event');
klopt($samenvatting['events'][0]['winner']['name'] === $drie[1]['results'][0]['n'], 'Samenvatting: de winnaar van de finale');

klopt(Wca::isValidId('WC2023') && !Wca::isValidId('../etc') && !Wca::isValidId('a b'), 'Alleen nette comp-id\'s');

echo "\n" . ($aantal - $fouten) . " van de $aantal controles in orde\n";
exit($fouten === 0 ? 0 : 1);
