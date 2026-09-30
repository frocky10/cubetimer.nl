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

    const pager = document.getElementById('leaderboard-pager');
    const prevButton = document.getElementById('leaderboard-prev');
    const nextButton = document.getElementById('leaderboard-next');
    const mineButton = document.getElementById('leaderboard-mine');
    const pageLabel = document.getElementById('leaderboard-page-label');

    const STATE_KEY = 'cubetimer_board_state';
    /** Regels per pagina. De server geeft er hooguit 100 per keer. */
    const PAGE_SIZE = 50;
    /** De server bladert tot offset 10000; verder heeft geen zin. */
    const MAX_OFFSET = 10000;

    let state = Object.assign(
        { event: '333', category: 'single', period: 'all', scope: 'all' },
        UI.storage.get(STATE_KEY, {})
    );
    let eventsLoaded = false;
    let laatsteAanvraag = 0;
    // De pagina hoort niet bij de opgeslagen keuzes: je begint altijd bovenaan.
    let offset = 0;
    let myIndex = null;

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
            naam.href = UI.profielUrl(entry.user);
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
            empty.textContent = UI.t('Je volgt nog niemand. Klik op een naam in de ranglijst om iemand te volgen.');
        } else if (!data.entries.length) {
            empty.textContent = UI.t('Hier staat nog niemand. Wees de eerste.');
        }
        countLabel.textContent = data.total === 1
            ? UI.t('1 cuber op deze ranglijst')
            : UI.t('{n} cubers op deze ranglijst', { n: UI.getal(data.total) });
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
        // "Jij staat op {plek} van {totaal} met {tijd}." met de plek vetgedrukt.
        const zin = UI.t('Jij staat op {plek} van {totaal} met {tijd}.', {
            totaal: UI.getal(data.me.total),
            tijd: formatValue(data.me.valueMs)
        });
        const [voor, na] = zin.split('{plek}'); // niet vertalen
        meText.appendChild(document.createTextNode(voor));
        meText.appendChild(sterk);
        meText.appendChild(document.createTextNode(na || ''));
    }

    function renderPager(data) {
        const laatste = Math.min(MAX_OFFSET, Math.max(0, data.total - 1));
        const paginas = Math.floor(laatste / PAGE_SIZE) + 1;
        const pagina = Math.floor(offset / PAGE_SIZE) + 1;

        pager.hidden = data.total <= PAGE_SIZE && myIndex === null;
        prevButton.disabled = offset === 0;
        nextButton.disabled = offset + PAGE_SIZE > laatste;
        prevButton.hidden = nextButton.hidden = data.total <= PAGE_SIZE;
        pageLabel.hidden = data.total <= PAGE_SIZE;
        pageLabel.textContent = UI.t('Pagina {pagina} van {paginas}', { pagina, paginas });

        // "Naar mijn plek" alleen als je ergens anders staat dan hier.
        const mijnPagina = myIndex === null ? null : Math.floor(myIndex / PAGE_SIZE);
        mineButton.hidden = mijnPagina === null || mijnPagina === pagina - 1 || myIndex > MAX_OFFSET;
        if (!mineButton.hidden) mineButton.textContent = UI.t('Naar mijn plek (#{plek})', { plek: myIndex + 1 });
    }

    function goToOffset(nieuw) {
        offset = Math.max(0, Math.min(MAX_OFFSET, nieuw));
        load();
    }

    async function load() {
        const aanvraag = ++laatsteAanvraag;
        body.innerHTML = '';
        empty.hidden = true;
        countLabel.textContent = UI.t('Laden…');

        const query = new URLSearchParams({
            event: state.event,
            category: state.category,
            period: state.period,
            scope: state.scope,
            limit: String(PAGE_SIZE),
            offset: String(offset)
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
            myIndex = typeof data.myIndex === 'number' ? data.myIndex : null;
            renderPager(data);
            // Een nieuwe pagina begint bovenaan de lijst.
            body.closest('.board-wrap')?.scrollTo?.(0, 0);

            subtitle.textContent = data.period === 'all'
                ? UI.t('Alle tijden ooit neergezet.')
                : (data.period === 'day'
                    ? UI.t('De dag loopt in de tijdzone {zone}.', { zone: data.timezone })
                    : UI.t('De week loopt in de tijdzone {zone}.', { zone: data.timezone }));

            UI.storage.set(STATE_KEY, state);
        } catch (err) {
            if (aanvraag !== laatsteAanvraag) return;
            countLabel.textContent = '';
            empty.hidden = false;
            empty.textContent = state.scope === 'friends' && err.status === 401
                ? UI.t('Log in om de ranglijst van de mensen die je volgt te zien.')
                : (err.message || UI.t('De ranglijst kon niet geladen worden.'));
        }
    }

    /* ---------------------------------------------------------------------
     * Koppelen
     * ------------------------------------------------------------------ */

    // Een ander filter is een andere lijst: dan weer bovenaan beginnen.
    eventSelect?.addEventListener('change', () => {
        state.event = eventSelect.value;
        goToOffset(0);
    });

    categorySelect?.addEventListener('change', () => {
        state.category = categorySelect.value;
        goToOffset(0);
    });

    periodButtons.forEach(button => {
        button.addEventListener('click', () => {
            state.period = button.dataset.boardPeriod;
            syncControls();
            goToOffset(0);
        });
    });

    scopeButtons.forEach(button => {
        button.addEventListener('click', () => {
            state.scope = button.dataset.boardScope;
            syncControls();
            goToOffset(0);
        });
    });

    prevButton?.addEventListener('click', () => goToOffset(offset - PAGE_SIZE));
    nextButton?.addEventListener('click', () => goToOffset(offset + PAGE_SIZE));
    mineButton?.addEventListener('click', () => {
        if (myIndex !== null) goToOffset(Math.floor(myIndex / PAGE_SIZE) * PAGE_SIZE);
    });

    function open(options) {
        if (options && options.event) state.event = options.event;
        if (options && options.category) state.category = options.category;
        syncControls();
        UI.openModal(modal);
        goToOffset(0);
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
