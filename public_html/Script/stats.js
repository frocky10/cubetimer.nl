/**
 * CubeTimer - statistieken
 * ---------------------------------------------------------------------------
 * Vult het statistiekenpaneel in de sidebar met drie periodes:
 *
 *   Sessie      de sessie die nu open staat
 *   Vandaag     alle solves van vandaag, over alle sessies van het actieve event
 *   Deze week   idem, maar vanaf maandag 00:00
 *
 * "Vandaag" en "Deze week" kijken bewust over sessiegrenzen heen: de meeste
 * mensen starten per dag een nieuwe sessie, en dan zegt een dagtotaal per
 * sessie weinig. Het event filtert wel mee, want een 2x2-tijd hoort niet in
 * hetzelfde gemiddelde als een 5x5-tijd.
 *
 * Alles rekent op de lokale tijd van de bezoeker; een solve van 23:58 valt dus
 * op de dag die je verwacht.
 */
(function () {
    'use strict';

    const UI = window.CubeTimerUI;

    const scopeContainer = document.getElementById('stats-scope');
    const scopeButtons = Array.from(document.querySelectorAll('[data-stats-scope]'));
    const scopeLabel = document.getElementById('stats-scope-label');
    const countLabel = document.getElementById('stats-count');
    const footnote = document.getElementById('stats-footnote');

    const output = {
        best: document.getElementById('stat-best'),
        worst: document.getElementById('stat-worst'),
        mean: document.getElementById('stat-mean'),
        median: document.getElementById('stat-median'),
        ao5: document.getElementById('stat-ao5'),
        ao12: document.getElementById('stat-ao12')
    };

    if (!scopeContainer || !output.best) return;

    const SCOPE_KEY = 'cubetimer_stats_scope';
    const SCOPES = {
        session: { label: 'Huidige sessie', note: 'Alleen de sessie die je nu open hebt.' },
        today: { label: 'Vandaag', note: 'Alle sessies van dit event, vanaf 00:00 vannacht.' },
        week: { label: 'Deze week', note: 'Alle sessies van dit event, vanaf maandag 00:00.' }
    };

    let scope = UI.storage.get(SCOPE_KEY, 'session');
    if (!Object.prototype.hasOwnProperty.call(SCOPES, scope)) scope = 'session';

    /* ---------------------------------------------------------------------
     * Periodes
     * ------------------------------------------------------------------ */

    function startOfToday() {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    }

    /** Maandag 00:00 van de lopende week (ISO: de week begint op maandag). */
    function startOfWeek() {
        const now = new Date();
        const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const dayIndex = (midnight.getDay() + 6) % 7; // zondag (0) wordt 6
        midnight.setDate(midnight.getDate() - dayIndex);
        return midnight.getTime();
    }

    /* ---------------------------------------------------------------------
     * Solves verzamelen
     * ------------------------------------------------------------------ */

    /** De solves die bij de gekozen periode horen, op tijd gesorteerd. */
    function collectSolves() {
        const api = window.cubeTimerApi;
        if (!api) return [];

        const sessions = api.getSessions();
        const activeId = api.getActiveSessionId();

        if (scope === 'session') {
            const active = sessions.find(session => session.id === activeId);
            return active ? active.times.slice() : [];
        }

        const activeEvent = api.getActiveSessionEvent();
        const since = scope === 'today' ? startOfToday() : startOfWeek();

        const solves = [];
        sessions.forEach(session => {
            if (session.event !== activeEvent) return;
            session.times.forEach(entry => {
                if (!entry || !entry.timestamp) return;
                const at = Date.parse(entry.timestamp);
                if (Number.isNaN(at) || at < since) return;
                solves.push(entry);
            });
        });

        solves.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
        return solves;
    }

    /* ---------------------------------------------------------------------
     * Rekenwerk
     * ------------------------------------------------------------------ */

    /** Het beste gemiddelde over elk aaneengesloten blok van `count` solves. */
    function bestRollingAverage(entries, count) {
        const api = window.cubeTimerApi;
        if (!api || entries.length < count) return null;

        let best = null;
        for (let start = 0; start + count <= entries.length; start += 1) {
            const value = api.averageOf(entries.slice(start, start + count));
            if (typeof value !== 'number') continue;
            if (best === null || value < best) best = value;
        }
        return best;
    }

    function median(values) {
        if (!values.length) return null;
        const sorted = values.slice().sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
            ? (sorted[middle - 1] + sorted[middle]) / 2
            : sorted[middle];
    }

    function computeStats(entries) {
        const api = window.cubeTimerApi;
        const valid = entries
            .map(entry => api.getEffectiveTime(entry))
            .filter(value => value !== null);

        return {
            total: entries.length,
            solved: valid.length,
            dnf: entries.length - valid.length,
            best: valid.length ? Math.min(...valid) : null,
            worst: valid.length ? Math.max(...valid) : null,
            mean: valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null,
            median: median(valid),
            ao5: bestRollingAverage(entries, 5),
            ao12: bestRollingAverage(entries, 12)
        };
    }

    /* ---------------------------------------------------------------------
     * Weergave
     * ------------------------------------------------------------------ */

    function show(element, value) {
        if (!element) return;
        const hasValue = typeof value === 'number' && Number.isFinite(value);
        element.textContent = hasValue ? UI.formatTime(Math.round(value)) : '--';
        element.classList.toggle('stat__value--muted', !hasValue);
    }

    function describeCount(stats) {
        const word = stats.total === 1 ? 'solve' : 'solves';
        if (stats.dnf === 0) return `${stats.total} ${word}`;
        return `${stats.total} ${word} · ${stats.dnf} DNF`;
    }

    function render() {
        if (!window.cubeTimerApi) return;

        const entries = collectSolves();
        const stats = computeStats(entries);

        if (scopeLabel) {
            scopeLabel.textContent = scope === 'session'
                ? SCOPES.session.label
                : `${SCOPES[scope].label} · ${window.cubeTimerApi.getEventLabel(window.cubeTimerApi.getActiveSessionEvent())}`;
        }
        if (countLabel) countLabel.textContent = describeCount(stats);
        if (footnote) footnote.textContent = SCOPES[scope].note;

        show(output.best, stats.best);
        show(output.worst, stats.worst);
        show(output.mean, stats.mean);
        show(output.median, stats.median);
        show(output.ao5, stats.ao5);
        show(output.ao12, stats.ao12);
    }

    /* ---------------------------------------------------------------------
     * Koppelen
     * ------------------------------------------------------------------ */

    function setScope(next) {
        if (!Object.prototype.hasOwnProperty.call(SCOPES, next)) return;
        scope = next;
        UI.storage.set(SCOPE_KEY, scope);
        scopeButtons.forEach(button => {
            const isActive = button.dataset.statsScope === scope;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        render();
    }

    scopeButtons.forEach(button => {
        button.addEventListener('click', () => setScope(button.dataset.statsScope));
    });

    window.addEventListener('cubetimer:data-change', render);
    window.addEventListener('cubetimer:event-change', render);

    // Rond middernacht klopt "vandaag" niet meer; elke minuut een goedkope check.
    let lastDayStart = startOfToday();
    window.setInterval(() => {
        const current = startOfToday();
        if (current !== lastDayStart) {
            lastDayStart = current;
            render();
        }
    }, 60000);

    setScope(scope);

    window.CubeTimerStats = { render, computeStats, collectSolves };
})();
