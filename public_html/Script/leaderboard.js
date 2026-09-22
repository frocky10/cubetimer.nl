/**
 * CubeTimer - ranglijsten
 * ---------------------------------------------------------------------------
 * Toont per event en per categorie wie het snelst is, over alle tijd, deze
 * week of vandaag.
 *
 * Alles wat hier binnenkomt is door de server uitgerekend uit de solves die
 * gesynchroniseerd zijn. De browser stuurt geen gemiddelden in; die zou je
 * met de console kunnen verzinnen.
 */
(function () {
    'use strict';

    const UI = window.CubeTimerUI;

    const openButton = document.getElementById('leaderboard-open');
    const modal = document.getElementById('leaderboard-modal');
    if (!openButton || !modal) return;

    const eventSelect = document.getElementById('leaderboard-event');
    const categorySelect = document.getElementById('leaderboard-category');
    const periodButtons = Array.from(document.querySelectorAll('[data-board-period]'));
    const scopeButtons = Array.from(document.querySelectorAll('[data-board-scope]'));
    const body = document.getElementById('leaderboard-body');
    const empty = document.getElementById('leaderboard-empty');
    const countLabel = document.getElementById('leaderboard-count');
    const subtitle = document.getElementById('leaderboard-subtitle');

    const mePanel = document.getElementById('leaderboard-me');
    const meBadge = document.getElementById('leaderboard-me-badge');
    const meRank = document.getElementById('leaderboard-me-rank');
    const meText = document.getElementById('leaderboard-me-text');

    const STATE_KEY = 'cubetimer_board_state';

    let state = Object.assign(
        { event: '333', category: 'single', period: 'all', scope: 'all' },
        UI.storage.get(STATE_KEY, {})
    );
    let eventsLoaded = false;
    let laatsteAanvraag = 0;

    /* ---------------------------------------------------------------------
     * Keuzelijsten
     * ------------------------------------------------------------------ */

    function fillEvents(events) {
        if (!eventSelect) return;
        const beschikbaar = events && events.length
            ? events
            : [{ id: '333', label: '3x3x3' }];

        eventSelect.innerHTML = '';
        beschikbaar.forEach(event => {
            const option = document.createElement('option');
            option.value = event.id;
            option.textContent = event.entries
                ? `${event.label} (${event.entries})`
                : event.label;
            eventSelect.appendChild(option);
        });

        // Staat het opgeslagen event er niet meer bij, val dan terug op het eerste.
        if (!beschikbaar.some(event => event.id === state.event)) {
            state.event = beschikbaar[0].id;
        }
        eventSelect.value = state.event;
        eventsLoaded = true;
    }

    function syncControls() {
        if (eventSelect && eventsLoaded) eventSelect.value = state.event;
        if (categorySelect) categorySelect.value = state.category;
        periodButtons.forEach(button => {
            const isActive = button.dataset.boardPeriod === state.period;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        scopeButtons.forEach(button => {
            const isActive = button.dataset.boardScope === state.scope;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
    }

    /* ---------------------------------------------------------------------
     * Ophalen en tekenen
     * ------------------------------------------------------------------ */

    function formatValue(ms) {
        return ms === null || ms === undefined ? 'DNF' : UI.formatTime(ms);
    }

    function renderRows(data, mijnNaam) {
        body.innerHTML = '';

        data.entries.forEach(entry => {
            const row = document.createElement('tr');
            if (mijnNaam && entry.user === mijnNaam) row.classList.add('is-me');

            const positie = document.createElement('td');
            positie.className = 'board-position';
            positie.textContent = entry.position;

            const cuber = document.createElement('td');
            const wrap = document.createElement('div');
            wrap.className = 'board-cuber';

            const badge = document.createElement('span');
            badge.className = 'rank-badge rank-badge--sm';
            badge.dataset.tier = entry.tier || 'brons';
            const badgeValue = document.createElement('span');
            badgeValue.className = 'rank-badge__value';
            badgeValue.textContent = entry.level;
            badge.appendChild(badgeValue);

            // De naam is een link naar het openbare profiel.
            const naam = document.createElement('a');
            naam.className = 'board-cuber__link';
            naam.href = 'profiel.php?u=' + encodeURIComponent(entry.user);
            naam.textContent = entry.user;

            wrap.appendChild(badge);
            wrap.appendChild(naam);

            if (entry.country) {
                const land = document.createElement('span');
                land.className = 'country-tag';
                land.textContent = entry.country;
                land.title = UI.countryName(entry.country);
                wrap.appendChild(land);
            }

            cuber.appendChild(wrap);

            const tijd = document.createElement('td');
            tijd.className = 'board-time';
            tijd.textContent = formatValue(entry.valueMs);

            row.appendChild(positie);
            row.appendChild(cuber);
            row.appendChild(tijd);
            body.appendChild(row);
        });

        empty.hidden = data.entries.length > 0;
        if (!data.entries.length && data.scope === 'friends') {
            empty.textContent = 'Je volgt nog niemand. Klik op een naam in de ranglijst om iemand te volgen.';
        } else if (!data.entries.length) {
            empty.textContent = 'Hier staat nog niemand. Wees de eerste.';
        }
        countLabel.textContent = data.total === 1
            ? '1 cuber op deze ranglijst'
            : `${data.total} cubers op deze ranglijst`;
    }

    function renderMe(data) {
        if (!data.me) {
            mePanel.hidden = true;
            return;
        }
        mePanel.hidden = false;
        meRank.textContent = data.me.label;
        meBadge.dataset.tier = data.me.tier || 'brons';
        meText.innerHTML = '';

        const sterk = document.createElement('strong');
        sterk.textContent = data.me.label;
        meText.appendChild(document.createTextNode('Jij staat op '));
        meText.appendChild(sterk);
        meText.appendChild(document.createTextNode(
            ` van ${data.me.total} met ${formatValue(data.me.valueMs)}.`
        ));
    }

    async function load() {
        const aanvraag = ++laatsteAanvraag;
        body.innerHTML = '';
        empty.hidden = true;
        countLabel.textContent = 'Laden…';

        const query = new URLSearchParams({
            event: state.event,
            category: state.category,
            period: state.period,
            scope: state.scope,
            limit: '100'
        });

        try {
            const data = await UI.api('leaderboard/list.php?' + query.toString());
            if (aanvraag !== laatsteAanvraag) return; // er kwam alweer een nieuwere

            if (!eventsLoaded) {
                fillEvents(data.events);
                syncControls();
            }

            const mij = window.CubeTimerAccount?.currentUsername?.() || null;
            renderRows(data, mij);
            renderMe(data);

            subtitle.textContent = data.period === 'all'
                ? 'Alle tijden ooit neergezet.'
                : `De ${data.period === 'day' ? 'dag' : 'week'} loopt in de tijdzone ${data.timezone}.`;

            UI.storage.set(STATE_KEY, state);
        } catch (err) {
            if (aanvraag !== laatsteAanvraag) return;
            countLabel.textContent = '';
            empty.hidden = false;
            empty.textContent = state.scope === 'friends' && err.status === 401
                ? 'Log in om de ranglijst van de mensen die je volgt te zien.'
                : (err.message || 'De ranglijst kon niet geladen worden.');
        }
    }

    /* ---------------------------------------------------------------------
     * Koppelen
     * ------------------------------------------------------------------ */

    eventSelect?.addEventListener('change', () => {
        state.event = eventSelect.value;
        load();
    });

    categorySelect?.addEventListener('change', () => {
        state.category = categorySelect.value;
        load();
    });

    periodButtons.forEach(button => {
        button.addEventListener('click', () => {
            state.period = button.dataset.boardPeriod;
            syncControls();
            load();
        });
    });

    scopeButtons.forEach(button => {
        button.addEventListener('click', () => {
            state.scope = button.dataset.boardScope;
            syncControls();
            load();
        });
    });

    function open(options) {
        if (options && options.event) state.event = options.event;
        if (options && options.category) state.category = options.category;
        syncControls();
        UI.openModal(modal);
        load();
    }

    openButton.addEventListener('click', () => open());
    document.querySelectorAll('[data-close-leaderboard]').forEach(button => {
        button.addEventListener('click', () => UI.closeModal(modal));
    });
    UI.registerModal(modal);

    syncControls();

    UI.status().then(status => {
        openButton.hidden = status.features?.leaderboards !== true;
    });

    // Na in- of uitloggen klopt "jouw positie" niet meer.
    window.addEventListener('cubetimer:auth-change', () => {
        if (modal.classList.contains('visible')) load();
    });

    window.CubeTimerLeaderboard = { open, reload: load };
})();
