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
$profiel = $gevraagd === '' ? null : PublicProfile::find($gevraagd);

if ($profiel === null) {
    http_response_code(404);
}

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

    <!-- Voor het voorbeeldje in WhatsApp, Discord en op social media -->
    <meta property="og:type" content="profile" />
    <meta property="og:site_name" content="CubeTimer" />
    <meta property="og:title" content="<?= e($titel) ?>" />
    <meta property="og:description" content="<?= e($omschrijving) ?>" />
    <meta property="og:image" content="Pictures/CubeTimerLogo_V2.png" />
    <meta name="twitter:card" content="summary" />
    <?php if ($profiel === null): ?>
    <meta name="robots" content="noindex" />
    <?php endif; ?>

    <link rel="icon" type="image/png" href="Pictures/CubeTimerFavicon_V2.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="Style/style.css" />

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
        <a class="profile-topbar__brand" href="index.html" aria-label="Naar de timer">
            <img src="Pictures/CubeTimerLogo_V2.png" alt="CubeTimer" />
        </a>
        <a class="btn btn--primary" href="index.html">Zelf timen</a>
    </header>

<?php if ($profiel === null): ?>
    <main class="profile-main">
        <section class="panel">
            <div class="panel__body">
                <h1 class="modal__title">Profiel niet gevonden</h1>
                <p class="modal__subtitle">
                    Deze cuber bestaat niet, of heeft ervoor gekozen zijn profiel niet te delen.
                </p>
                <a class="btn btn--primary" href="index.html">Naar de timer</a>
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
                    </div>
                    <button class="btn" type="button" id="copy-link">Link kopiëren</button>
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

    <footer class="profile-footer">
        <a href="index.html">CubeTimer</a>
    </footer>

    <div class="toast-host" id="toast-host" role="status" aria-live="polite"></div>

    <script>
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
