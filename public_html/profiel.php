<?php
declare(strict_types=1);

/**
 * Het openbare profiel van een cuber: /profiel.php?u=naam
 *
 * Deze pagina wordt serverside gerenderd en niet door JavaScript opgebouwd.
 * Reden: een gedeelde link moet in WhatsApp, Discord en Google meteen laten
 * zien om wie het gaat, en dat werkt alleen als de titel en de omschrijving
 * al in de HTML staan.
 *
 * Met de .htaccess-regel in deze map werkt ook /u/naam.
 */

require_once __DIR__ . '/api/bootstrap.php';

$gevraagd = (string) ($_GET['u'] ?? '');
$kijker = Auth::user();
$profiel = $gevraagd === '' ? null : PublicProfile::find($gevraagd, $kijker === null ? null : (int) $kijker['id']);

if ($profiel === null) {
    http_response_code(404);
}

// Profielen horen niet in zoekmachines (zie CLAUDE.md, SEO). De header werkt
// ook voor crawlers die de HTML niet lezen; de meta-tag hieronder zegt hetzelfde.
header('X-Robots-Tag: noindex, follow');

// Delen via WhatsApp en Discord werkt wel; die hebben een volledig adres nodig.
$siteUrl = 'https://cubetimer.nl';
$profielUrl = $profiel === null ? $siteUrl . '/' : $siteUrl . '/u/' . rawurlencode($profiel['username']);

/** Korte hulpfunctie: alles wat de pagina in gaat wordt ge-escaped. */
function e(?string $tekst): string
{
    return htmlspecialchars((string) $tekst, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Een datum als 2026-09-22 naar '22 september 2026'. */
function datum(string $isoDatum): string
{
    $maanden = [1 => 'januari', 'februari', 'maart', 'april', 'mei', 'juni',
                'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
    $delen = explode('-', $isoDatum);
    if (count($delen) !== 3) {
        return $isoDatum;
    }
    return (int) $delen[2] . ' ' . ($maanden[(int) $delen[1]] ?? '') . ' ' . $delen[0];
}

/** Milliseconden naar mm:ss:mmm, hetzelfde formaat als de timer. */
function tijd(?int $ms): string
{
    if ($ms === null) {
        return '--';
    }
    return sprintf('%02d:%02d:%03d', intdiv($ms, 60000), intdiv($ms % 60000, 1000), $ms % 1000);
}

$titel = $profiel === null
    ? 'Profiel niet gevonden · CubeTimer'
    : $profiel['displayName'] . ' op CubeTimer';

if ($profiel === null) {
    $omschrijving = 'Deze cuber bestaat niet, of deelt zijn profiel niet.';
} else {
    $beste = $profiel['events'][0]['records']['single'] ?? null;
    $omschrijving = sprintf(
        'Level %d · %s solves · %d van de %d achievements%s',
        $profiel['xp']['level'],
        number_format($profiel['solves'], 0, ',', '.'),
        $profiel['achievements']['unlocked'],
        $profiel['achievements']['total'],
        $profiel['rank'] !== null
            ? sprintf(' · %s op %s', $profiel['rank']['label'], $profiel['mainEvent']['label'])
            : ''
    );
}

$CATEGORIE_LABELS = [
    'single' => 'Beste', 'mo3' => 'Mo3', 'ao5' => 'Ao5',
    'ao12' => 'Ao12', 'ao50' => 'Ao50', 'ao100' => 'Ao100',
];
?>
<!DOCTYPE html>
<html lang="nl" data-theme="dark">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#060911" media="(prefers-color-scheme: dark)" />
    <meta name="theme-color" content="#f4f7fd" media="(prefers-color-scheme: light)" />
    <title><?= e($titel) ?></title>
    <meta name="description" content="<?= e($omschrijving) ?>" />

    <!-- Niet in zoekmachines, wel volgbaar naar de rest van de site. -->
    <meta name="robots" content="noindex, follow" />

    <!-- Voor het voorbeeldje in WhatsApp, Discord en op social media. Een
         og:image moet een volledig adres zijn, anders tonen ze niets. -->
    <meta property="og:type" content="profile" />
    <meta property="og:site_name" content="CubeTimer" />
    <meta property="og:locale" content="nl_NL" />
    <meta property="og:url" content="<?= e($profielUrl) ?>" />
    <meta property="og:title" content="<?= e($titel) ?>" />
    <meta property="og:description" content="<?= e($omschrijving) ?>" />
    <meta property="og:image" content="<?= e($siteUrl) ?>/Pictures/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />

    <!-- Paden vanaf de root: via /u/naam zou "Style/..." onder /u/ uitkomen. -->
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="icon" type="image/png" href="/Pictures/favicon-192.png" sizes="192x192" />
    <link rel="apple-touch-icon" href="/Pictures/apple-touch-icon.png" />
    <link rel="stylesheet" href="/Style/style.css" />

    <script>
        (function () {
            try {
                var stored = localStorage.getItem('cubetimer_theme');
                if (stored !== 'light' && stored !== 'dark') {
                    stored = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
                }
                document.documentElement.setAttribute('data-theme', stored);
            } catch (err) { /* privemodus: dan blijft het donkere thema staan */ }
        })();
    </script>
</head>
<body class="profile-page">
    <header class="profile-topbar">
        <a class="profile-topbar__brand" href="/" aria-label="Naar de timer">
            <img src="/Pictures/CubeTimerLogo_V2.png" alt="CubeTimer" width="752" height="345" />
        </a>
        <a class="btn btn--primary" href="/">Zelf timen</a>
    </header>

<?php if ($profiel === null): ?>
    <main class="profile-main">
        <section class="panel">
            <div class="panel__body">
                <h1 class="modal__title">Profiel niet gevonden</h1>
                <p class="modal__subtitle">
                    Deze cuber bestaat niet, of heeft ervoor gekozen zijn profiel niet te delen.
                </p>
                <a class="btn btn--primary" href="/">Naar de timer</a>
            </div>
        </section>
    </main>
<?php else: ?>
    <main class="profile-main">
        <!-- Kop met badge, naam en de belangrijkste cijfers -->
        <section class="panel profile-hero">
            <div class="panel__body">
                <div class="profile-hero__head">
                    <span class="rank-badge" data-tier="<?= e($profiel['xp']['tier']['slug']) ?>">
                        <span class="rank-badge__value"><?= e($profiel['rank']['label'] ?? '--') ?></span>
                        <span class="rank-badge__level">Lv. <?= (int) $profiel['xp']['level'] ?></span>
                    </span>
                    <div class="profile-hero__meta">
                        <h1 class="profile-hero__name">
                            <?= e($profiel['displayName']) ?>
                            <?php if ($profiel['country']): ?>
                                <span class="country-tag"><?= e($profiel['country']) ?></span>
                            <?php endif; ?>
                        </h1>
                        <p class="profile-hero__sub">
                            Level <?= (int) $profiel['xp']['level'] ?> · <?= e($profiel['xp']['tier']['name']) ?>
                            · lid sinds <?= e(datum($profiel['memberSince'])) ?>
                        </p>
                        <?php if ($profiel['rank'] !== null): ?>
                        <p class="profile-hero__sub">
                            <?= e($profiel['rank']['label']) ?> van <?= (int) $profiel['rank']['total'] ?>
                            op <?= e($profiel['mainEvent']['label']) ?> met <?= e(tijd($profiel['rank']['valueMs'])) ?>
                        </p>
                        <?php endif; ?>
                        <p class="profile-hero__sub" id="follow-counts">
                            <strong><?= (int) $profiel['follows']['followers'] ?></strong>
                            <?= $profiel['follows']['followers'] === 1 ? 'volger' : 'volgers' ?> ·
                            <strong><?= (int) $profiel['follows']['following'] ?></strong> volgend ·
                            <strong><?= (int) $profiel['follows']['friends'] ?></strong>
                            <?= $profiel['follows']['friends'] === 1 ? 'vriend' : 'vrienden' ?>
                            <?php if ($profiel['relation']['friends']): ?>
                                · <span class="country-tag">vrienden</span>
                            <?php elseif ($profiel['relation']['followsYou']): ?>
                                · <span class="country-tag">volgt jou</span>
                            <?php endif; ?>
                        </p>
                    </div>
                    <div class="profile-hero__actions">
                        <?php if ($kijker !== null && !$profiel['isSelf']): ?>
                        <button class="btn <?= $profiel['relation']['following'] ? '' : 'btn--primary' ?>"
                                type="button" id="follow-button"
                                data-username="<?= e($profiel['username']) ?>"
                                data-following="<?= $profiel['relation']['following'] ? '1' : '0' ?>">
                            <?= $profiel['relation']['following'] ? 'Ontvolgen' : 'Volgen' ?>
                        </button>
                        <?php endif; ?>
                        <button class="btn" type="button" id="copy-link">Link kopiëren</button>
                    </div>
                </div>

                <div class="xp-bar">
                    <div class="xp-bar__head">
                        <span><?= (int) $profiel['xp']['inLevel'] ?> / <?= (int) $profiel['xp']['neededForNext'] ?> XP</span>
                        <span>naar level <?= (int) $profiel['xp']['level'] + 1 ?></span>
                    </div>
                    <div class="xp-bar__track">
                        <div class="xp-bar__fill" style="width: <?= (int) round($profiel['xp']['inLevel'] / $profiel['xp']['neededForNext'] * 100) ?>%"></div>
                    </div>
                </div>

                <div class="stat-grid">
                    <div class="stat">
                        <span class="stat__label">Solves</span>
                        <span class="stat__value"><?= number_format($profiel['solves'], 0, ',', '.') ?></span>
                    </div>
                    <div class="stat stat--accent">
                        <span class="stat__label">XP</span>
                        <span class="stat__value"><?= number_format($profiel['xp']['total'], 0, ',', '.') ?></span>
                    </div>
                    <div class="stat">
                        <span class="stat__label">Reeks (dagen)</span>
                        <span class="stat__value"><?= (int) $profiel['streak']['current'] ?></span>
                    </div>
                    <div class="stat">
                        <span class="stat__label">Achievements</span>
                        <span class="stat__value"><?= (int) $profiel['achievements']['unlocked'] ?>/<?= (int) $profiel['achievements']['total'] ?></span>
                    </div>
                </div>
            </div>
        </section>

        <!-- Records per event -->
        <section class="panel">
            <div class="panel__head"><h2 class="panel__title">Records</h2></div>
            <div class="panel__body">
                <?php if (!$profiel['events']): ?>
                    <p class="table-empty">Nog geen records.</p>
                <?php else: ?>
                    <div class="records-table">
                        <?php foreach ($profiel['events'] as $event): ?>
                        <div class="records-event">
                            <span class="records-event__name"><?= e($event['label']) ?></span>
                            <div class="records-event__grid">
                                <?php foreach ($CATEGORIE_LABELS as $categorie => $label): ?>
                                    <?php if (!isset($event['records'][$categorie])) { continue; } ?>
                                    <div class="records-cell<?= $categorie === 'single' ? ' records-cell--best' : '' ?>">
                                        <span class="records-cell__label"><?= e($label) ?></span>
                                        <span class="records-cell__value"><?= e(tijd($event['records'][$categorie])) ?></span>
                                    </div>
                                <?php endforeach; ?>
                            </div>
                        </div>
                        <?php endforeach; ?>
                    </div>
                <?php endif; ?>
            </div>
        </section>

        <!-- Toernooien: aparte cijfers, want die tijden komen onder heel andere
             omstandigheden tot stand dan gewone oefensolves. -->
        <?php if ($profiel['tournaments']['played'] > 0): ?>
        <section class="panel">
            <div class="panel__head"><h2 class="panel__title">Toernooien</h2></div>
            <div class="panel__body">
                <div class="stat-grid">
                    <div class="stat">
                        <span class="stat__label">Gespeeld</span>
                        <span class="stat__value"><?= (int) $profiel['tournaments']['played'] ?></span>
                    </div>
                    <div class="stat stat--success">
                        <span class="stat__label">Gewonnen</span>
                        <span class="stat__value"><?= (int) $profiel['tournaments']['won'] ?></span>
                    </div>
                    <div class="stat">
                        <span class="stat__label">Podiums</span>
                        <span class="stat__value"><?= (int) $profiel['tournaments']['podiums'] ?></span>
                    </div>
                    <div class="stat stat--accent">
                        <span class="stat__label">Beste plek</span>
                        <span class="stat__value"><?= $profiel['tournaments']['bestPosition'] === null
                            ? '--' : (int) $profiel['tournaments']['bestPosition'] . 'e' ?></span>
                    </div>
                </div>

                <?php if (!empty($profiel['tournaments']['perType'])): ?>
                <div class="board-wrap">
                    <table class="board-table board-table--compact">
                        <thead><tr><th>Soort</th><th>Gespeeld</th><th>Podiums</th><th>Beste plek</th></tr></thead>
                        <tbody>
                        <?php foreach ($profiel['tournaments']['perType'] as $soort): ?>
                            <tr>
                                <td><?= e($soort['label']) ?></td>
                                <td><?= (int) $soort['played'] ?></td>
                                <td><?= (int) $soort['podiums'] ?></td>
                                <td class="board-time"><?= $soort['bestPosition'] === null ? '--' : (int) $soort['bestPosition'] . 'e' ?></td>
                            </tr>
                        <?php endforeach; ?>
                        <?php foreach ($profiel['tournaments']['competitions'] ?? [] as $comp): ?>
                            <tr>
                                <td><?= e(($comp['name'] ?? $comp['competitionId']) . ' · ' . $comp['eventLabel']) ?></td>
                                <td><?= (int) $comp['played'] ?></td>
                                <td></td>
                                <td class="board-time"><?= $comp['bestPosition'] === null ? '--'
                                    : (int) $comp['bestPosition'] . 'e van ' . (int) $comp['fieldSize'] ?></td>
                            </tr>
                        <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
                <?php endif; ?>

                <?php if ($profiel['tournaments']['events']): ?>
                <div class="records-table">
                    <?php foreach ($profiel['tournaments']['events'] as $event): ?>
                    <div class="records-event">
                        <span class="records-event__name"><?= e($event['label']) ?></span>
                        <div class="records-event__grid">
                            <?php foreach (['single' => 'Beste', 'ao5' => 'Ao5'] as $categorie => $label): ?>
                                <?php if (!isset($event['records'][$categorie])) { continue; } ?>
                                <div class="records-cell<?= $categorie === 'single' ? ' records-cell--best' : '' ?>">
                                    <span class="records-cell__label"><?= e($label) ?></span>
                                    <span class="records-cell__value"><?= e(tijd($event['records'][$categorie])) ?></span>
                                </div>
                            <?php endforeach; ?>
                        </div>
                    </div>
                    <?php endforeach; ?>
                </div>
                <p class="field__hint">Toernooitijden staan los van de records hierboven.</p>
                <?php endif; ?>
            </div>
        </section>
        <?php endif; ?>

        <!-- Spelmodi: records per modus, en hoe de duels gingen. Geen ranglijst. -->
        <?php
        $duels = $profiel['games']['duels'];
        $duelsGespeeld = $duels['won'] + $duels['lost'] + $duels['drawn'];
        ?>
        <?php if ($profiel['games']['records'] || $duelsGespeeld > 0): ?>
        <section class="panel">
            <div class="panel__head"><h2 class="panel__title">Spelmodi</h2></div>
            <div class="panel__body">
                <?php if ($duelsGespeeld > 0): ?>
                <div class="stat-grid">
                    <div class="stat stat--success">
                        <span class="stat__label">Duels gewonnen</span>
                        <span class="stat__value"><?= (int) $duels['won'] ?></span>
                    </div>
                    <div class="stat">
                        <span class="stat__label">Verloren</span>
                        <span class="stat__value"><?= (int) $duels['lost'] ?></span>
                    </div>
                    <div class="stat">
                        <span class="stat__label">Gelijk</span>
                        <span class="stat__value"><?= (int) $duels['drawn'] ?></span>
                    </div>
                </div>
                <?php endif; ?>

                <?php if ($profiel['games']['records']): ?>
                <div class="board-wrap">
                    <table class="board-table board-table--compact">
                        <thead><tr><th>Modus</th><th>Event</th><th>Record</th></tr></thead>
                        <tbody>
                        <?php foreach ($profiel['games']['records'] as $record): ?>
                            <tr>
                                <td><?= e($record['modeLabel'] . ($record['variantLabel'] !== '' ? ' · ' . $record['variantLabel'] : '')) ?></td>
                                <td><?= e($record['eventLabel']) ?></td>
                                <td class="board-time"><?= e($record['scoreLabel']) ?></td>
                            </tr>
                        <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
                <?php endif; ?>
            </div>
        </section>
        <?php endif; ?>

        <!-- Uitgelichte achievements -->
        <section class="panel">
            <div class="panel__head"><h2 class="panel__title">Achievements</h2></div>
            <div class="panel__body">
                <?php if (!$profiel['achievements']['highlights']): ?>
                    <p class="table-empty">Nog geen achievements behaald.</p>
                <?php else: ?>
                    <div class="secret-grid">
                        <?php foreach ($profiel['achievements']['highlights'] as $achievement): ?>
                        <article class="badge-card" data-tier="<?= e($achievement['tier']) ?>">
                            <span class="badge-card__tier"><?= e(ucfirst($achievement['tier'])) ?></span>
                            <span class="badge-card__title"><?= e($achievement['title']) ?></span>
                        </article>
                        <?php endforeach; ?>
                    </div>
                <?php endif; ?>
            </div>
        </section>
    </main>
<?php endif; ?>

    <footer class="site-footer">
        <a href="/">CubeTimer</a>
        <a href="/privacy.html">Privacy</a>
        <a href="/voorwaarden.html">Voorwaarden</a>
        <a href="/#cookie-instellingen">Cookie-instellingen</a>
    </footer>

    <div class="toast-host" id="toast-host" role="status" aria-live="polite"></div>

    <script>
        document.getElementById('follow-button')?.addEventListener('click', async function () {
            var knop = this;
            var volgen = knop.dataset.following !== '1';
            knop.disabled = true;
            try {
                var response = await fetch('/api/follows/toggle.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                    credentials: 'same-origin',
                    body: JSON.stringify({ username: knop.dataset.username, follow: volgen })
                });
                var data = await response.json();
                if (!data.ok) throw new Error(data.message || 'Dat is niet gelukt.');

                knop.dataset.following = data.relation.following ? '1' : '0';
                knop.textContent = data.relation.following ? 'Ontvolgen' : 'Volgen';
                knop.classList.toggle('btn--primary', !data.relation.following);
                // De pagina hoeft niet opnieuw geladen; alleen het aantal klopt niet meer.
                window.location.reload();
            } catch (err) {
                knop.textContent = err.message;
            } finally {
                knop.disabled = false;
            }
        });

        document.getElementById('copy-link')?.addEventListener('click', async function () {
            var knop = this;
            try {
                await navigator.clipboard.writeText(window.location.href);
                knop.textContent = 'Gekopieerd!';
            } catch (err) {
                // Zonder toestemming voor het klembord: de URL selecteerbaar tonen.
                knop.textContent = window.location.href;
            }
            window.setTimeout(function () { knop.textContent = 'Link kopiëren'; }, 2500);
        });
    </script>
</body>
</html>
