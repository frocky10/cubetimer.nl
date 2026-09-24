<?php
declare(strict_types=1);

require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Events.php';
require_once __DIR__ . '/Ranking.php';

/**
 * Historische WCA-competities: ophalen bij de WCA en bewaren.
 *
 * De server haalt de gegevens op bij de openbare API van de World Cube
 * Association (www.worldcubeassociation.org/api/v0) en bewaart ze in
 * `wca_cache`. De browser praat nooit zelf met de WCA. Zo:
 *   - komt een comp die iemand al eens gekozen heeft meteen uit de database;
 *   - blijft een toernooi speelbaar als de WCA even niet bereikbaar is;
 *   - zien we wat we opslaan, en slaan we alleen op wat we gebruiken.
 *
 * Per comp gebruiken we drie bronnen:
 *   /competitions/{id}              naam, plaats, land, datum
 *   /competitions/{id}/results      alle uitslagen: per event, per ronde, per
 *                                   cuber de pogingen, beste en gemiddelde
 *   /competitions/{id}/wcif/public  per ronde de cutoff en de tijdslimiet;
 *                                   die staan niet in de uitslagen
 *   /competitions/{id}/scrambles    de echte scrambles (groep A), zodat je
 *                                   dezelfde scrambles draait als het veld
 * De laatste twee zijn een extraatje: ontbreken ze (oude comps hebben vaak
 * geen WCIF met limieten), dan speel je zonder cutoff en limiet en met
 * gewone scrambles.
 *
 * Tijden komen bij de WCA in honderdsten van een seconde, met -1 voor DNF,
 * -2 voor DNS en 0 voor "geen poging" (bijvoorbeeld na een gemiste cutoff).
 * Hier worden het milliseconden.
 *
 * De WCA vraagt bij hergebruik van de uitslagen om bronvermelding; die staat
 * in de interface bij elk historisch toernooi (zie `attribution()`).
 */
final class Wca
{
    private const DEFAULT_BASE = 'https://www.worldcubeassociation.org/api/v0';
    private const SEARCH_TTL = 86_400;
    private const COMPETITION_TTL = 30 * 86_400;
    private const TIMEOUT = 25;
    private const CACHE_VERSION = 'v1';

    /**
     * Een paar bekende kampioenschappen om mee te beginnen. De rest vind je
     * met zoeken.
     *
     * @var list<array{id:string,name:string,country:string,year:int}>
     */
    public const FEATURED = [
        ['id' => 'WC2025',   'name' => 'WCA World Championship 2025',    'country' => 'US', 'year' => 2025],
        ['id' => 'WC2023',   'name' => 'WCA World Championship 2023',    'country' => 'KR', 'year' => 2023],
        ['id' => 'WC2019',   'name' => 'WCA World Championship 2019',    'country' => 'AU', 'year' => 2019],
        ['id' => 'WC2017',   'name' => 'WCA World Championship 2017',    'country' => 'FR', 'year' => 2017],
        ['id' => 'Euro2024', 'name' => 'WCA European Championship 2024', 'country' => 'PL', 'year' => 2024],
        ['id' => 'Euro2022', 'name' => 'WCA European Championship 2022', 'country' => 'FI', 'year' => 2022],
        ['id' => 'Euro2018', 'name' => 'WCA European Championship 2018', 'country' => 'ES', 'year' => 2018],
    ];

    /** Volgorde van de WCA-rondetypes. Kwalificatie (0, h) en B-finale (b) doen niet mee. */
    private const ROUND_RANK = ['1' => 1, 'd' => 1, '2' => 2, 'e' => 2, '3' => 3, 'g' => 3, 'c' => 4, 'f' => 4];

    /* =====================================================================
     * Beschikbaarheid
     * ================================================================== */

    /** Mag en kan deze server de WCA bereiken? Uit te zetten met `wca.enabled`. */
    public static function isEnabled(): bool
    {
        if (Config::get('wca.enabled', true) === false) {
            return false;
        }
        return function_exists('curl_init') || filter_var(ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOLEAN);
    }

    /** Is alles er om een historisch toernooi te spelen? */
    public static function isReady(): bool
    {
        return self::isEnabled()
            && Database::hasTable('wca_cache')
            && Database::hasColumn('tournaments', 'wca_snapshot');
    }

    public static function isValidId(string $id): bool
    {
        return preg_match('/^[A-Za-z0-9]{3,32}$/', $id) === 1;
    }

    public static function attribution(?string $datum = null): string
    {
        $tekst = 'Uitslagen: World Cube Association, worldcubeassociation.org/results';
        return $datum ? $tekst . ' (opgehaald ' . $datum . ')' : $tekst;
    }

    /* =====================================================================
     * Zoeken
     * ================================================================== */

    /**
     * Afgelopen competities die op de zoekterm lijken, de nieuwste eerst.
     *
     * @return array{ok:bool,message?:string,competitions?:list<array<string,mixed>>}
     */
    public static function search(string $zoekterm): array
    {
        $zoekterm = trim((string) preg_replace('/\s+/', ' ', $zoekterm));
        if (mb_strlen($zoekterm) < 2 || mb_strlen($zoekterm) > 60) {
            return ['ok' => false, 'message' => 'Zoek op minstens twee letters.'];
        }

        $gisteren = gmdate('Y-m-d', time() - 86_400);
        $sleutel = 'search:' . self::CACHE_VERSION . ':' . sha1(mb_strtolower($zoekterm) . '|' . $gisteren);

        $data = self::cached($sleutel, self::SEARCH_TTL, static fn () => self::fetchJson(
            '/competitions?' . http_build_query([
                'q' => $zoekterm, 'sort' => '-start_date', 'end' => $gisteren, 'per_page' => 25,
            ])
        ));
        if (!is_array($data)) {
            return ['ok' => false, 'message' => 'De WCA is nu niet bereikbaar. Probeer het straks nog eens.'];
        }

        $uit = [];
        foreach ($data as $comp) {
            if (!is_array($comp) || !self::isValidId((string) ($comp['id'] ?? ''))) {
                continue;
            }
            $eind = (string) ($comp['end_date'] ?? '');
            if ($eind === '' || $eind > $gisteren) {
                continue; // nog niet afgelopen: dan zijn er ook geen uitslagen
            }
            $events = array_values(array_filter(
                array_map('strval', is_array($comp['event_ids'] ?? null) ? $comp['event_ids'] : []),
                [Events::class, 'isRanked']
            ));
            $uit[] = [
                'id'        => (string) $comp['id'],
                'name'      => mb_substr((string) ($comp['name'] ?? $comp['id']), 0, 128),
                'city'      => mb_substr((string) ($comp['city'] ?? ''), 0, 96),
                'country'   => self::country($comp['country_iso2'] ?? null),
                'startDate' => (string) ($comp['start_date'] ?? ''),
                'endDate'   => $eind,
                'events'    => $events,
            ];
        }

        return ['ok' => true, 'competitions' => $uit];
    }

    /* =====================================================================
     * Een competitie
     * ================================================================== */

    /**
     * De verwerkte gegevens van een comp: per event de rondes met format,
     * cutoff, limiet, uitslagen en (als bekend) de scrambles.
     *
     * @return array{ok:bool,message?:string,competition?:array<string,mixed>}
     */
    public static function competition(string $id): array
    {
        if (!self::isValidId($id)) {
            return ['ok' => false, 'message' => 'Dat is geen geldige WCA-competitie.'];
        }

        $sleutel = 'comp:' . self::CACHE_VERSION . ':' . $id;
        $mislukt = null;
        $data = self::cached($sleutel, self::COMPETITION_TTL, static function () use ($id, &$mislukt) {
            $uitslagen = self::fetchJson('/competitions/' . rawurlencode($id) . '/results');
            if (!is_array($uitslagen)) {
                $mislukt = 'unreachable';
                return null;
            }
            if (!$uitslagen) {
                $mislukt = 'no_results';
                return null;
            }
            $info = self::fetchJson('/competitions/' . rawurlencode($id));
            $wcif = self::fetchJson('/competitions/' . rawurlencode($id) . '/wcif/public');
            $scrambles = self::fetchJson('/competitions/' . rawurlencode($id) . '/scrambles');

            $verwerkt = self::process(
                $id,
                is_array($info) ? $info : [],
                $uitslagen,
                is_array($wcif) ? $wcif : null,
                is_array($scrambles) ? $scrambles : null
            );
            if (!$verwerkt['events']) {
                $mislukt = 'no_events';
                return null;
            }
            return $verwerkt;
        });

        if (!is_array($data)) {
            return ['ok' => false, 'message' => match ($mislukt) {
                'no_results' => 'Van deze comp staan (nog) geen uitslagen bij de WCA.',
                'no_events'  => 'Op deze comp stond geen event dat je hier kunt spelen.',
                default      => 'De WCA is nu niet bereikbaar. Probeer het straks nog eens.',
            }];
        }

        return ['ok' => true, 'competition' => $data];
    }

    /**
     * Wat het keuzescherm van een comp nodig heeft, zonder alle uitslagen.
     *
     * @param array<string,mixed> $comp
     * @return array<string,mixed>
     */
    public static function summarize(array $comp): array
    {
        $events = [];
        foreach ($comp['events'] as $event => $gegevens) {
            $event = (string) $event;
            $rondes = $gegevens['rounds'];
            $events[] = [
                'id'          => $event,
                'label'       => Events::label($event),
                'rounds'      => count($rondes),
                'competitors' => count($rondes[0]['results']),
                'format'      => Ranking::label((string) $rondes[0]['format']),
                'winner'      => self::winner($rondes),
                'officialScrambles' => !empty($rondes[0]['scrambles']),
            ];
        }

        return [
            'id'          => $comp['id'],
            'name'        => $comp['name'],
            'city'        => $comp['city'],
            'country'     => $comp['country'],
            'startDate'   => $comp['startDate'],
            'endDate'     => $comp['endDate'],
            'events'      => $events,
            'attribution' => self::attribution(substr((string) $comp['fetchedAt'], 0, 10)),
        ];
    }

    /** @return array{name:string,country:?string,resultMs:?int}|null wie de finale won */
    private static function winner(array $rondes): ?array
    {
        $finale = end($rondes);
        foreach ($finale['results'] as $r) {
            if ((int) $r['p'] === 1) {
                $gemiddelde = Ranking::usesAverage((string) $finale['format']);
                $waarde = $gemiddelde && $r['a'] !== null ? $r['a'] : $r['b'];
                return ['name' => $r['n'], 'country' => $r['c'], 'resultMs' => $waarde];
            }
        }
        return null;
    }

    /**
     * Zet de ruwe WCA-antwoorden om naar onze eigen, compacte vorm.
     * Heeft geen database of netwerk nodig; tools/wca-testen.php test hem los.
     *
     * Per uitslag: n = naam, c = land, w = WCA-id, p = plek, b = beste (ms),
     * a = gemiddelde (ms), t = pogingen (ms, of null bij DNF, 'dns' bij DNS).
     *
     * @return array<string,mixed>
     */
    public static function process(string $id, array $info, array $uitslagen, ?array $wcif, ?array $scrambles): array
    {
        // --- uitslagen per event en ronde ----------------------------------
        $perEvent = [];
        foreach ($uitslagen as $r) {
            if (!is_array($r)) {
                continue;
            }
            $event = (string) ($r['event_id'] ?? $r['eventId'] ?? '');
            $rang = self::ROUND_RANK[(string) ($r['round_type_id'] ?? $r['roundTypeId'] ?? '')] ?? null;
            $format = (string) ($r['format_id'] ?? $r['formatId'] ?? 'a');
            if (!Events::isRanked($event) || $rang === null || !Ranking::isFormat($format)) {
                continue;
            }

            $pogingen = $r['attempts'] ?? null;
            if (!is_array($pogingen)) {
                $pogingen = [];
                for ($i = 1; $i <= 5; $i++) {
                    $pogingen[] = $r['value' . $i] ?? 0;
                }
            }

            $tijden = [];
            foreach (array_slice(array_values($pogingen), 0, Ranking::attempts($format)) as $waarde) {
                $waarde = (int) $waarde;
                $tijden[] = match (true) {
                    $waarde > 0   => $waarde * 10,
                    $waarde === -2 => 'dns',
                    $waarde === -1 => null,
                    default       => false, // 0: geen poging
                };
            }
            // Pogingen die er niet waren (na een gemiste cutoff) staan achteraan.
            while ($tijden && end($tijden) === false) {
                array_pop($tijden);
            }
            $tijden = array_map(static fn ($t) => $t === false ? 'dns' : $t, $tijden);

            $naam = trim((string) ($r['name'] ?? $r['person_name'] ?? ''));
            if ($naam === '') {
                continue;
            }

            $perEvent[$event][$rang]['format'] = $format;
            $perEvent[$event][$rang]['results'][] = [
                'n' => mb_substr($naam, 0, 48),
                'c' => self::country($r['country_iso2'] ?? $r['countryIso2'] ?? null),
                'w' => self::wcaId($r['wca_id'] ?? $r['personId'] ?? $r['person_id'] ?? null),
                'p' => max(1, (int) ($r['pos'] ?? 0)),
                'b' => self::centis($r['best'] ?? 0),
                'a' => self::centis($r['average'] ?? 0),
                't' => $tijden,
            ];
        }

        // --- WCIF: cutoff en limiet per ronde -------------------------------
        $wcifRondes = [];
        foreach (is_array($wcif['events'] ?? null) ? $wcif['events'] : [] as $wcifEvent) {
            if (!is_array($wcifEvent) || !is_array($wcifEvent['rounds'] ?? null)) {
                continue;
            }
            foreach ($wcifEvent['rounds'] as $index => $ronde) {
                if (is_array($ronde)) {
                    $wcifRondes[(string) ($wcifEvent['id'] ?? '')][$index + 1] = $ronde;
                }
            }
        }

        // --- scrambles: groep A per ronde -----------------------------------
        $perRondeScrambles = [];
        foreach ($scrambles ?? [] as $s) {
            if (!is_array($s) || !empty($s['is_extra'])) {
                continue;
            }
            $event = (string) ($s['event_id'] ?? '');
            $rang = self::ROUND_RANK[(string) ($s['round_type_id'] ?? '')] ?? null;
            $tekst = trim((string) ($s['scramble'] ?? ''));
            if ($rang === null || $tekst === '' || mb_strlen($tekst) > 800) {
                continue;
            }
            $groep = (string) ($s['group_id'] ?? 'A');
            $perRondeScrambles[$event][$rang][$groep][(int) ($s['scramble_num'] ?? 0)] = $tekst;
        }

        // --- samenvoegen ------------------------------------------------------
        $events = [];
        foreach ($perEvent as $event => $rangen) {
            ksort($rangen);
            $aantal = count($rangen);
            $rondes = [];
            $nummer = 0;

            foreach ($rangen as $rang => $gegevens) {
                $nummer++;
                $format = $gegevens['format'];
                $uitslagenRonde = $gegevens['results'];
                usort($uitslagenRonde, static fn (array $a, array $b): int => $a['p'] <=> $b['p']);

                $wcifRonde = $wcifRondes[(string) $event][$nummer] ?? null;
                $limiet = null;
                $cumulatief = false;
                if (is_array($wcifRonde['timeLimit'] ?? null)) {
                    $centis = (int) ($wcifRonde['timeLimit']['centiseconds'] ?? 0);
                    if ($centis > 0) {
                        $limiet = $centis * 10;
                        $cumulatief = !empty($wcifRonde['timeLimit']['cumulativeRoundIds']);
                    }
                }
                $cutoff = null;
                if (is_array($wcifRonde['cutoff'] ?? null)) {
                    $pogingenCutoff = (int) ($wcifRonde['cutoff']['numberOfAttempts'] ?? 0);
                    $waarde = (int) ($wcifRonde['cutoff']['attemptResult'] ?? 0);
                    if ($pogingenCutoff > 0 && $pogingenCutoff < Ranking::attempts($format) && $waarde > 0) {
                        $cutoff = ['attempts' => $pogingenCutoff, 'ms' => $waarde * 10];
                    }
                }

                $rondes[] = [
                    'name'      => self::roundName($nummer, $aantal),
                    'format'    => $format,
                    'attempts'  => Ranking::attempts($format),
                    'cutoff'    => $cutoff,
                    'limit'     => $limiet === null ? null : ['ms' => $limiet, 'cumulative' => $cumulatief],
                    'scrambles' => self::pickScrambles($perRondeScrambles[(string) $event][$rang] ?? [], Ranking::attempts($format)),
                    'results'   => $uitslagenRonde,
                ];
            }

            $events[(string) $event] = ['rounds' => $rondes];
        }

        // Zelfde volgorde als overal op de site.
        $volgorde = array_map('strval', array_keys(Events::LABELS));
        uksort($events, static fn ($a, $b): int =>
            array_search((string) $a, $volgorde, true) <=> array_search((string) $b, $volgorde, true));

        return [
            'id'        => $id,
            'name'      => mb_substr((string) ($info['name'] ?? $id), 0, 128),
            'city'      => mb_substr((string) ($info['city'] ?? ''), 0, 96),
            'country'   => self::country($info['country_iso2'] ?? null),
            'startDate' => (string) ($info['start_date'] ?? ''),
            'endDate'   => (string) ($info['end_date'] ?? ''),
            'fetchedAt' => gmdate('Y-m-d H:i:s'),
            'events'    => $events,
        ];
    }

    /** De scrambles van één groep (bij voorkeur A), op volgorde. */
    private static function pickScrambles(array $groepen, int $aantal): ?array
    {
        if (!$groepen) {
            return null;
        }
        ksort($groepen);
        $groep = $groepen['A'] ?? reset($groepen);
        ksort($groep);
        $lijst = array_values($groep);
        return count($lijst) >= $aantal ? array_slice($lijst, 0, $aantal) : null;
    }

    private static function roundName(int $nummer, int $aantal): string
    {
        if ($nummer === $aantal) {
            return 'Finale';
        }
        if ($aantal === 4 && $nummer === 3) {
            return 'Halve finale';
        }
        return match ($nummer) {
            1 => 'Eerste ronde',
            2 => 'Tweede ronde',
            default => 'Ronde ' . $nummer,
        };
    }

    private static function centis(mixed $waarde): ?int
    {
        $waarde = (int) $waarde;
        return $waarde > 0 ? $waarde * 10 : null;
    }

    private static function country(mixed $code): ?string
    {
        $code = strtoupper((string) $code);
        return preg_match('/^[A-Z]{2}$/', $code) === 1 ? $code : null;
    }

    private static function wcaId(mixed $id): ?string
    {
        $id = strtoupper((string) $id);
        return preg_match('/^\d{4}[A-Z]{4}\d{2}$/', $id) === 1 ? $id : null;
    }

    /* =====================================================================
     * Ophalen en bewaren
     * ================================================================== */

    /**
     * Uit de cache als die vers genoeg is, anders ophalen. Mislukt het
     * ophalen, dan liever een oude kopie dan niets.
     */
    private static function cached(string $sleutel, int $ttl, callable $ophalen): mixed
    {
        $rij = Database::first('SELECT payload, fetched_at FROM wca_cache WHERE cache_key = ?', [$sleutel]);
        if ($rij !== null && strtotime($rij['fetched_at'] . ' UTC') > time() - $ttl) {
            return json_decode((string) $rij['payload'], true);
        }

        $vers = $ophalen();
        if ($vers === null) {
            return $rij === null ? null : json_decode((string) $rij['payload'], true);
        }

        $json = json_encode($vers, JSON_UNESCAPED_UNICODE);
        if ($json !== false && strlen($json) < 15_000_000) {
            Database::run(
                'INSERT INTO wca_cache (cache_key, payload, fetched_at) VALUES (?, ?, UTC_TIMESTAMP())
                 ON DUPLICATE KEY UPDATE payload = VALUES(payload), fetched_at = VALUES(fetched_at)',
                [$sleutel, $json]
            );
        }
        return $vers;
    }

    /** Een GET naar de WCA-API. Geeft null bij elke fout; details gaan naar het logboek. */
    private static function fetchJson(string $pad): mixed
    {
        $basis = rtrim((string) Config::get('wca.base_url', self::DEFAULT_BASE), '/');
        $url = $basis . $pad;
        $agent = 'cubetimer.nl (+https://cubetimer.nl)';

        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_MAXREDIRS      => 3,
                CURLOPT_CONNECTTIMEOUT => 6,
                CURLOPT_TIMEOUT        => self::TIMEOUT,
                CURLOPT_USERAGENT      => $agent,
                CURLOPT_HTTPHEADER     => ['Accept: application/json'],
                CURLOPT_ENCODING       => '',
            ]);
            $body = curl_exec($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $fout = curl_error($ch);
            curl_close($ch);
        } else {
            $context = stream_context_create(['http' => [
                'method' => 'GET', 'timeout' => self::TIMEOUT, 'ignore_errors' => true,
                'header' => "Accept: application/json\r\nUser-Agent: {$agent}\r\n",
            ]]);
            $body = @file_get_contents($url, false, $context);
            $status = 0;
            foreach ($http_response_header ?? [] as $regel) {
                if (preg_match('~^HTTP/\S+\s+(\d{3})~', $regel, $m) === 1) {
                    $status = (int) $m[1];
                }
            }
            $fout = $body === false ? 'file_get_contents mislukt' : '';
        }

        if (!is_string($body) || $status !== 200) {
            error_log('[cubetimer] WCA ' . $pad . ' gaf ' . $status . ($fout ? ' (' . $fout . ')' : ''));
            return null;
        }

        $data = json_decode($body, true);
        if (!is_array($data)) {
            error_log('[cubetimer] WCA ' . $pad . ' gaf geen geldige JSON');
            return null;
        }
        return $data;
    }
}
