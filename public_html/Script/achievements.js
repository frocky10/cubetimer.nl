/**
 * CubeTimer - achievements
 * ---------------------------------------------------------------------------
 * Honderdveertien stuks: vijfentwintig families in vier niveaus (brons, zilver,
 * goud, platina) plus veertien geheime.
 *
 * De server rekent uit wat je hebt; dit bestand tekent het en meldt wat er
 * nieuw bij komt. Achievements gelden met terugwerkende kracht: alles wat je
 * ooit getimed hebt telt mee zodra je inlogt.
 */
(function () {
    'use strict';

    const UI = window.CubeTimerUI;

    const openButton = document.getElementById('achievements-open');
    const modal = document.getElementById('achievements-modal');
    if (!openButton || !modal) return;

    const list = document.getElementById('achievements-list');
    const filter = document.getElementById('achievements-filter');
    const subtitle = document.getElementById('achievements-subtitle');
    const countLabel = document.getElementById('achievements-count');
    const xpLabel = document.getElementById('achievements-xp');
    const progressFill = document.getElementById('achievements-progress');
    const guestNotice = document.getElementById('achievements-guest');
    const badge = document.getElementById('achievements-badge');

    const TIER_MARKS = { brons: 'I', zilver: 'II', goud: 'III', platina: 'IV' };

    // Hoeveel er ontgrendeld zijn sinds je voor het laatst gekeken hebt. Staat
    // in localStorage zodat het ook een herlaadbeurt overleeft.
    const UNSEEN_KEY = 'cubetimer_achievements_unseen';

    let data = null;
    let categorie = 'alles';
    let laden = false;

    function getUnseen() {
        const waarde = UI.storage.get(UNSEEN_KEY, 0);
        return Number.isFinite(waarde) && waarde > 0 ? waarde : 0;
    }

    function setUnseen(aantal) {
        UI.storage.set(UNSEEN_KEY, Math.max(0, aantal));
        renderBadge();
    }

    function renderBadge() {
        const aantal = getUnseen();
        badge.hidden = aantal === 0;
        badge.textContent = String(aantal);
    }

    /* =====================================================================
     * Ophalen
     * ================================================================== */

    async function load() {
        if (laden) return;
        laden = true;
        try {
            data = await UI.api('achievements/list.php');
            render();

            // Het openen van dit scherm kan zelf iets ontgrendeld hebben.
            if (data.justUnlocked && data.justUnlocked.length) {
                announce(data.justUnlocked);
            }
        } catch (err) {
            list.innerHTML = '';
            const melding = document.createElement('p');
            melding.className = 'table-empty';
            melding.textContent = err.message || 'De achievements konden niet geladen worden.';
            list.appendChild(melding);
        } finally {
            laden = false;
        }
    }

    /** Meldt nieuwe achievements, maar overspoelt het scherm niet. */
    function announce(nieuw) {
        if (!nieuw || !nieuw.length) return;

        nieuw.slice(0, 3).forEach((achievement, index) => {
            window.setTimeout(() => {
                UI.toast(`Achievement behaald: ${achievement.title} (+${achievement.xp} XP)`, {
                    type: 'success',
                    duration: 6000
                });
            }, index * 700);
        });

        if (nieuw.length > 3) {
            window.setTimeout(() => {
                UI.toast(`En nog ${nieuw.length - 3} andere achievements. Kijk maar bij het medaille-icoon.`, {
                    type: 'success',
                    duration: 6000
                });
            }, 2100);
        }
    }

    /* =====================================================================
     * Tekenen
     * ================================================================== */

    function renderFilter() {
        filter.innerHTML = '';

        const knoppen = [{ slug: 'alles', name: 'Alles' }].concat(
            data.categories
                .filter(cat => cat.items.length > 0 || cat.slug === 'geheim')
                .map(cat => ({ slug: cat.slug, name: cat.name }))
        );

        knoppen.forEach(cat => {
            const knop = document.createElement('button');
            knop.className = 'segmented__item' + (cat.slug === categorie ? ' is-active' : '');
            knop.type = 'button';
            knop.setAttribute('role', 'tab');
            knop.setAttribute('aria-selected', cat.slug === categorie ? 'true' : 'false');
            knop.dataset.achievementCategory = cat.slug;
            knop.textContent = cat.name;
            knop.addEventListener('click', () => {
                categorie = cat.slug;
                render();
            });
            filter.appendChild(knop);
        });
    }

    function render() {
        renderFilter();

        const deel = data.total > 0 ? Math.round(data.unlocked / data.total * 100) : 0;
        progressFill.style.width = deel + '%';
        countLabel.textContent = `${data.unlocked} van ${data.total} behaald`;
        xpLabel.textContent = `${data.xpFromAchievements.toLocaleString('nl-NL')} XP uit achievements`;
        subtitle.textContent = data.authenticated
            ? `${deel}% compleet. Alles wat je ooit hebt getimed telt mee.`
            : 'Log in om ze te verzamelen. Dit is wat er te halen valt.';
        guestNotice.hidden = data.authenticated;

        list.innerHTML = '';

        data.categories
            .filter(cat => categorie === 'alles' || cat.slug === categorie)
            .forEach(cat => {
                if (cat.slug === 'geheim') {
                    if (cat.items.length || cat.hidden) list.appendChild(renderSecrets(cat));
                    return;
                }
                if (!cat.items.length) return;
                list.appendChild(renderGroup(cat));
            });
    }

    function renderGroup(cat) {
        const groep = document.createElement('section');
        groep.className = 'achievement-group';

        const naam = document.createElement('h3');
        naam.className = 'achievement-group__name';
        naam.textContent = cat.name;
        groep.appendChild(naam);

        cat.items.forEach(item => groep.appendChild(renderCard(item)));
        return groep;
    }

    function renderCard(item) {
        const compleet = item.unlockedCount === item.tiers.length;

        const card = document.createElement('article');
        card.className = 'achievement-card' + (compleet ? ' is-complete' : '');

        // --- de vier niveaus ---------------------------------------------
        const rij = document.createElement('div');
        rij.className = 'tier-row';
        item.tiers.forEach(tier => {
            const pip = document.createElement('span');
            pip.className = 'tier-pip' + (tier.unlocked ? '' : ' tier-pip--locked');
            pip.dataset.tier = tier.tier;
            pip.title = tier.unlocked
                ? `${tier.tier}: ${tier.label} — behaald${tier.rarity ? `, ${tier.rarity}% van de cubers heeft deze` : ''}`
                : `${tier.tier}: ${tier.label}`;

            const mark = document.createElement('span');
            mark.className = 'tier-pip__mark';
            mark.textContent = TIER_MARKS[tier.tier] || '?';

            const label = document.createElement('span');
            label.className = 'tier-pip__label';
            label.textContent = tier.tier.slice(0, 3);

            pip.appendChild(mark);
            pip.appendChild(label);
            rij.appendChild(pip);
        });

        // --- tekst en voortgang ------------------------------------------
        const body = document.createElement('div');
        body.className = 'achievement-card__body';

        const kop = document.createElement('div');
        kop.className = 'achievement-card__head';

        const titel = document.createElement('h4');
        titel.className = 'achievement-card__title';
        titel.textContent = item.title;
        kop.appendChild(titel);

        if (item.valueLabel) {
            const waarde = document.createElement('span');
            waarde.className = 'achievement-card__value';
            waarde.textContent = item.valueLabel;
            kop.appendChild(waarde);
        }

        const omschrijving = document.createElement('p');
        omschrijving.className = 'achievement-card__description';
        omschrijving.textContent = item.description;

        body.appendChild(kop);
        body.appendChild(omschrijving);

        if (item.next) {
            const volgende = document.createElement('div');
            volgende.className = 'achievement-next';

            const head = document.createElement('div');
            head.className = 'achievement-next__head';
            const links = document.createElement('span');
            links.textContent = `Volgende: ${item.next.tier} — ${item.next.label}`;
            const rechts = document.createElement('span');
            rechts.textContent = Math.round(item.next.progress * 100) + '%';
            head.appendChild(links);
            head.appendChild(rechts);

            const track = document.createElement('div');
            track.className = 'achievement-next__track';
            const fill = document.createElement('div');
            fill.className = 'achievement-next__fill';
            fill.style.width = Math.round(item.next.progress * 100) + '%';
            track.appendChild(fill);

            volgende.appendChild(head);
            volgende.appendChild(track);
            body.appendChild(volgende);
        } else {
            const klaar = document.createElement('p');
            klaar.className = 'achievement-done';
            klaar.textContent = 'Alle vier de niveaus binnen.';
            body.appendChild(klaar);
        }

        card.appendChild(rij);
        card.appendChild(body);
        return card;
    }

    function renderSecrets(cat) {
        const groep = document.createElement('section');
        groep.className = 'achievement-group';

        const naam = document.createElement('h3');
        naam.className = 'achievement-group__name';
        naam.textContent = cat.name;
        groep.appendChild(naam);

        if (cat.items.length) {
            const grid = document.createElement('div');
            grid.className = 'secret-grid';
            cat.items.forEach(item => {
                const kaart = document.createElement('article');
                kaart.className = 'secret-card';

                const titel = document.createElement('h4');
                titel.className = 'secret-card__title';
                titel.textContent = item.title;

                const omschrijving = document.createElement('p');
                omschrijving.className = 'secret-card__description';
                omschrijving.textContent = item.description;

                kaart.appendChild(titel);
                kaart.appendChild(omschrijving);
                grid.appendChild(kaart);
            });
            groep.appendChild(grid);
        }

        if (cat.hidden > 0) {
            const slot = document.createElement('p');
            slot.className = 'secret-locked';
            slot.textContent = cat.hidden === 1
                ? 'Er is nog een geheime achievement te ontdekken.'
                : `Er zijn nog ${cat.hidden} geheime achievements te ontdekken.`;
            groep.appendChild(slot);
        }

        return groep;
    }

    /* =====================================================================
     * Koppelen
     * ================================================================== */

    openButton.addEventListener('click', () => {
        setUnseen(0);
        UI.openModal(modal);
        load();
    });

    document.querySelectorAll('[data-close-achievements]').forEach(button => {
        button.addEventListener('click', () => UI.closeModal(modal));
    });
    UI.registerModal(modal);

    // Na een synchronisatie meldt account.js wat er ontgrendeld is.
    window.addEventListener('cubetimer:achievements-unlocked', event => {
        const nieuw = event.detail.unlocked || [];
        announce(nieuw);

        if (modal.classList.contains('visible')) {
            load();
        } else {
            setUnseen(getUnseen() + nieuw.length);
        }
    });

    window.addEventListener('cubetimer:auth-change', () => {
        data = null;
        setUnseen(0);
        if (modal.classList.contains('visible')) load();
    });

    UI.status().then(status => {
        openButton.hidden = status.features?.achievements !== true;
    });

    renderBadge();

    window.CubeTimerAchievements = { load, announce };
})();
