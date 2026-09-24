/**
 * CubeTimer - spelmodi
 * ---------------------------------------------------------------------------
 * Andere manieren van timen, elk met een eigen record:
 *
 *   Streak    zet een doel (sub X) en kijk hoe vaak je dat achter elkaar haalt
 *   Survival  een limiet die na elke geslaagde solve een stukje krimpt
 *   Ladder    elke solve sneller dan de vorige
 *   Speedrun  zoveel mogelijk cubes in vijf minuten, allemaal vooraf gescrambeld
 *   Duel      een vriend op dezelfde scrambles, ieder wanneer het uitkomt
 *
 * Streak, survival en ladder gebruiken de gewone timer: zolang er een ronde
 * loopt, vangt `cubeTimerApi.setSolveCapture()` je solves op, zodat ze niet in
 * je sessie belanden. De speedrun heeft een eigen klok in het venster, want
 * daar loopt de tijd door terwijl je de ene na de andere cube oplost.
 *
 * De browser speelt het spel, zodat het ook zonder account en zonder
 * internet werkt. Ingelogd gaat de ronde daarna naar de server, die zelf de
 * score natelt en bijhoudt of het een record is. Er is bewust geen ranglijst.
 *
 * Een lopende ronde staat in localStorage (`cubetimer_game_v1`), zodat een
 * per ongeluk herladen pagina je reeks van veertig niet kost.
 */
(function () {
    'use strict';

    const UI = window.CubeTimerUI;
    const api = window.cubeTimerApi;

    const openButton = document.getElementById('games-open');
    const modal = document.getElementById('games-modal');
    if (!openButton || !modal || !api) return;

    const body = document.getElementById('games-body');
    const title = document.getElementById('games-title');
    const subtitle = document.getElementById('games-subtitle');
    const footnote = document.getElementById('games-footnote');
    const badge = document.getElementById('games-badge');

    const banner = document.getElementById('games-banner');
    const bannerTitle = document.getElementById('games-banner-title');
    const bannerHint = document.getElementById('games-banner-hint');
    const bannerOpen = document.getElementById('games-banner-open');
    const bannerStop = document.getElementById('games-banner-stop');

    const STORAGE_KEY = 'cubetimer_game_v1';
    const OWNER = 'spelmodus';

    const MODES = {
        streak: {
            label: 'Streak',
            description: 'Zet een doel en kijk hoe vaak je er achter elkaar onder blijft. '
                + 'De eerste solve erboven, of een DNF, stopt de reeks.'
        },
        survival: {
            label: 'Survival',
            description: 'Je begint met een ruime limiet, en na elke geslaagde solve gaat er een stukje af. '
                + 'Hoe lang houd je het vol?'
        },
        ladder: {
            label: 'Ladder',
            description: 'Elke solve moet sneller zijn dan de vorige. De eerste is gratis. Hoe hoog klim je?'
        },
        speedrun: {
            label: 'Speedrun',
            description: 'Zoveel mogelijk cubes oplossen in vijf minuten. Je scrambelt ze allemaal van tevoren, '
                + 'dus je hebt meerdere cubes nodig.'
        },
        duel: {
            label: 'Duel',
            description: 'Daag een vriend uit op dezelfde scrambles. Ieder speelt wanneer het uitkomt, '
                + 'en je ziet elkaars tijden pas als jullie allebei klaar zijn.'
        }
    };

    let status = { authenticated: false, features: {} };
    let overview = null;
    let view = { name: 'menu' };
    let run = null;        // lopende streak, survival of ladder
    let duelRun = null;    // duel dat nu gespeeld wordt
    let speedrun = null;   // lopende speedrun
    let bezig = false;

    /* =====================================================================
     * Kleine hulpjes
     * ================================================================== */

    function el(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined && text !== null) element.textContent = text;
        return element;
    }

    function button(label, className, onClick) {
        const knop = el('button', 'btn ' + (className || ''), label);
        knop.type = 'button';
        knop.addEventListener('click', onClick);
        return knop;
    }

    /** 15000 wordt "15 s", 12500 wordt "12,5 s". Zelfde als op de server. */
    function seconden(ms) {
        return (Math.round(ms / 10) / 100).toFixed(2).replace(/\.?0+$/, '').replace('.', ',') + ' s';
    }

    function tijd(ms) {
        return ms === null || ms === undefined ? 'DNF' : UI.formatTime(ms);
    }

    function pogingLabel(poging) {
        if (!poging || poging.penalty === 'dnf' || poging.ms === null) return 'DNF';
        const basis = UI.formatTime(poging.ms + (poging.penalty === 'plus2' ? 2000 : 0));
        return poging.penalty === 'plus2' ? basis + '+' : basis;
    }

    function effectief(solve) {
        if (!solve || solve.ms === null || solve.penalty === 'dnf') return null;
        return solve.ms + (solve.penalty === 'plus2' ? 2000 : 0);
    }

    function eventLabel(id) {
        return api.getEventLabel ? api.getEventLabel(id) : id;
    }

    function events() {
        if (overview && overview.events) return overview.events;
        return api.getEventOptions().map(option => ({ id: option.id, label: option.label }));
    }

    function eventSelect(id, gekozen) {
        const select = el('select', 'select');
        select.id = id;
        events().forEach(event => {
            const option = el('option', null, event.label);
            option.value = event.id;
            select.appendChild(option);
        });
        select.value = events().some(e => e.id === gekozen) ? gekozen : '333';
        return select;
    }

    function veld(labelTekst, invoer, hint) {
        const rij = el('div', 'field');
        const label = el('label', 'field__label', labelTekst);
        label.setAttribute('for', invoer.id);
        rij.appendChild(label);
        rij.appendChild(invoer);
        if (hint) rij.appendChild(el('p', 'field__hint', hint));
        return rij;
    }

    function magBewaren() {
        return status.authenticated && status.features?.games === true;
    }

    function survivalStap(event) {
        return overview?.rules?.survivalSteps?.[event] ?? 500;
    }

    function survivalLimiet(start, index, event) {
        const stap = survivalStap(event);
        return Math.max(stap, start - index * stap);
    }

    /** Zelfde als Duels::formatFor op de server. */
    function duelPogingen(event) {
        if (event === '666' || event === '777') return 3;
        if (event === '333bf' || event === '444bf' || event === '555bf') return 3;
        return 5;
    }

    /** Wacht tot cubing.js geladen is en maakt dan een reeks scrambles. */
    function maakScrambles(event, aantal) {
        const klaar = () => window.generateScrambles(event, aantal);
        if (typeof window.generateScrambles === 'function') return klaar();
        return new Promise((resolve, reject) => {
            const wacht = setTimeout(() => reject(new Error('De scrambles laden niet.')), 20000);
            window.addEventListener('cubetimer:scrambler-ready', () => {
                clearTimeout(wacht);
                klaar().then(resolve, reject);
            }, { once: true });
        });
    }

    /* --- Opslag van een lopende ronde en de laatste instellingen ---------- */

    function leesOpslag() {
        const opgeslagen = UI.storage.get(STORAGE_KEY, {});
        return opgeslagen && typeof opgeslagen === 'object' ? opgeslagen : {};
    }

    /** Lukt opslaan niet (privémodus), dan onthouden we het zolang de pagina openstaat. */
    function schrijfOpslag(wijziging) {
        UI.storage.set(STORAGE_KEY, Object.assign(leesOpslag(), wijziging));
    }

    function voorkeur(sleutel, standaard) {
        const prefs = leesOpslag().prefs || {};
        return prefs[sleutel] ?? standaard;
    }

    function bewaarVoorkeur(sleutel, waarde) {
        const prefs = leesOpslag().prefs || {};
        prefs[sleutel] = waarde;
        schrijfOpslag({ prefs });
    }

    /* =====================================================================
     * Ophalen
     * ================================================================== */

    async function load() {
        try {
            overview = await UI.api('games/overview.php');
        } catch (err) {
            // Zonder server kun je nog steeds spelen; alleen niets bewaren.
            overview = overview || null;
        }
        syncBadge();
        if (modal.classList.contains('visible') && !speedrunLoopt()) render();
    }

    function syncBadge() {
        const wachtend = overview?.duels?.waiting || 0;
        badge.hidden = wachtend === 0;
        badge.textContent = String(wachtend);
    }

    /* =====================================================================
     * Tekenen
     * ================================================================== */

    function go(naam, extra) {
        view = Object.assign({ name: naam }, extra || {});
        render();
    }

    function render() {
        body.innerHTML = '';
        footnote.textContent = '';
        title.textContent = 'Spelmodi';

        switch (view.name) {
            case 'setup': renderSetup(view.mode); break;
            case 'result': renderResult(view.result); break;
            case 'speedrun': renderSpeedrun(); break;
            case 'duels': renderDuels(); break;
            case 'duel-result': renderDuelResult(view.duel); break;
            default: renderMenu();
        }
    }

    /* --- Menu ----------------------------------------------------------- */

    function recordVoor(mode, event) {
        const records = (overview?.records || []).filter(r => r.mode === mode && r.event === event);
        if (!records.length) return null;
        return records.slice().sort((a, b) => b.score - a.score || (a.tiebreakMs ?? Infinity) - (b.tiebreakMs ?? Infinity))[0];
    }

    function renderMenu() {
        subtitle.textContent = 'Een andere manier van timen, met een eigen record per modus.';
        const wrap = el('div', 'games');

        if (run || duelRun) {
            const lopend = el('p', 'notice');
            lopend.textContent = run
                ? `Je ${MODES[run.mode].label.toLowerCase()} loopt nog. Sluit dit venster om verder te gaan.`
                : `Je duel tegen ${duelRun.them.username} loopt nog. Sluit dit venster om verder te gaan.`;
            wrap.appendChild(lopend);
        }

        if (!magBewaren()) {
            wrap.appendChild(el('p', 'notice', status.features?.games
                ? 'Spelen kan zo. Log in om je records te bewaren en vrienden uit te dagen.'
                : 'Spelen kan zo. Records bewaren is op deze server niet beschikbaar.'));
        }

        const event = api.getActiveSessionEvent();
        const kaarten = el('div', 'difficulty-grid');
        Object.entries(MODES).forEach(([mode, info]) => {
            const kaart = el('button', 'difficulty-card game-card');
            kaart.type = 'button';
            kaart.dataset.mode = mode;
            kaart.appendChild(el('span', 'difficulty-card__name', info.label));
            kaart.appendChild(el('span', 'difficulty-card__description', info.description));

            let meta = '';
            if (mode === 'duel') {
                const wachtend = overview?.duels?.waiting || 0;
                if (!status.features?.duels) meta = 'Niet beschikbaar';
                else if (!status.authenticated) meta = 'Log in om te spelen';
                else meta = wachtend ? `${wachtend} ${wachtend === 1 ? 'duel wacht' : 'duels wachten'} op jou` : 'Tegen een vriend';
            } else {
                const record = recordVoor(mode, event);
                // Bij de speedrun staat het aantal cubes al in de score.
                const instelling = record && record.variantLabel && mode !== 'speedrun' ? ` (${record.variantLabel})` : '';
                meta = record ? `Record ${eventLabel(event)}: ${record.scoreLabel}${instelling}` : eventLabel(event);
            }
            kaart.appendChild(el('span', 'difficulty-card__meta', meta));

            kaart.disabled = mode === 'duel' && (!status.features?.duels || !status.authenticated);
            kaart.addEventListener('click', () => {
                if (mode === 'duel') go('duels');
                else go('setup', { mode });
            });
            kaarten.appendChild(kaart);
        });
        wrap.appendChild(kaarten);

        if (overview?.records?.length) wrap.appendChild(renderRecords(overview.records));
        if (overview?.recent?.length) wrap.appendChild(renderRecent(overview.recent));

        body.appendChild(wrap);
    }

    function groep(kopTekst, inhoud) {
        const sectie = el('section', 'achievement-group');
        sectie.appendChild(el('h3', 'achievement-group__name', kopTekst));
        sectie.appendChild(inhoud);
        return sectie;
    }

    function tabel(koppen, rijen) {
        const wrap = el('div', 'board-wrap');
        const t = el('table', 'board-table');
        if (koppen) {
            const thead = el('thead');
            const tr = el('tr');
            // Een kolom met tijden lijnt ook in de kop rechts uit.
            const eersteRij = rijen[0] || [];
            koppen.forEach((k, index) => tr.appendChild(el('th', (eersteRij[index]?.[1] || '').includes('board-time') ? 'board-time' : null, k)));
            thead.appendChild(tr);
            t.appendChild(thead);
        }
        const tbody = el('tbody');
        rijen.forEach(cellen => {
            const tr = el('tr');
            cellen.forEach(([tekst, klasse]) => tr.appendChild(el('td', klasse || null, tekst)));
            tbody.appendChild(tr);
        });
        t.appendChild(tbody);
        wrap.appendChild(t);
        return wrap;
    }

    function renderRecords(records) {
        return groep('Jouw records', tabel(['Modus', 'Event', 'Record'], records.map(r => [
            [r.modeLabel + (r.variantLabel ? ' · ' + r.variantLabel : '')],
            [r.eventLabel],
            [r.scoreLabel, 'board-time']
        ])));
    }

    function renderRecent(recent) {
        return groep('Laatst gespeeld', tabel(null, recent.map(r => [
            [new Date(r.at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })],
            [r.modeLabel + (r.variantLabel ? ' · ' + r.variantLabel : '') + ' · ' + r.eventLabel],
            [r.scoreLabel, 'board-time']
        ])));
    }

    /* --- Instellen ------------------------------------------------------ */

    function renderSetup(mode) {
        const info = MODES[mode];
        title.textContent = info.label;
        subtitle.textContent = info.description;

        const wrap = el('div', 'games');
        const eventKeuze = eventSelect('games-event', voorkeur(mode + ':event', api.getActiveSessionEvent()));
        wrap.appendChild(veld('Event', eventKeuze));

        let variantInvoer = null;
        let hint = null;

        if (mode === 'streak' || mode === 'survival') {
            variantInvoer = el('input', 'input');
            variantInvoer.id = 'games-variant';
            variantInvoer.type = 'text';
            variantInvoer.inputMode = 'decimal';
            variantInvoer.autocomplete = 'off';
            const standaard = voorkeur(mode + ':variant', mode === 'streak' ? 20000 : 30000);
            variantInvoer.value = String(standaard / 1000).replace('.', ',');
            hint = el('p', 'field__hint');
            const rij = veld(mode === 'streak' ? 'Doel: sub … seconden' : 'Startlimiet in seconden', variantInvoer);
            rij.appendChild(hint);
            wrap.appendChild(rij);
        } else if (mode === 'speedrun') {
            const grenzen = overview?.rules?.speedrunCubes || { min: 2, max: 12 };
            variantInvoer = el('input', 'input');
            variantInvoer.id = 'games-variant';
            variantInvoer.type = 'number';
            variantInvoer.min = String(grenzen.min);
            variantInvoer.max = String(grenzen.max);
            variantInvoer.value = String(voorkeur('speedrun:variant', 5));
            wrap.appendChild(veld('Aantal cubes', variantInvoer,
                `Hoeveel cubes je klaar hebt liggen: ${grenzen.min} tot ${grenzen.max}. Je record geldt per aantal.`));
        }

        function werkHintBij() {
            if (!hint) return;
            const ms = leesSeconden(variantInvoer.value);
            if (mode === 'streak') {
                hint.textContent = ms ? `Elke solve onder ${seconden(ms)} telt. Je record geldt per doeltijd.` : '';
            } else {
                const stap = survivalStap(eventKeuze.value);
                hint.textContent = `Na elke geslaagde solve gaat er ${seconden(stap)} van de limiet af.`
                    + (ms ? ` Je record geldt per startlimiet.` : '');
            }
        }
        variantInvoer?.addEventListener('input', werkHintBij);
        eventKeuze.addEventListener('change', werkHintBij);
        werkHintBij();

        if (mode === 'ladder') {
            wrap.appendChild(el('p', 'field__hint', 'Een DNF, of een solve die niet sneller is dan de vorige, stopt de ladder.'));
        }

        const knoppen = el('div', 'games__actions');
        knoppen.appendChild(button('Terug', '', () => go('menu')));
        knoppen.appendChild(button(mode === 'speedrun' ? 'Scrambles maken' : 'Start', 'btn--primary', async event => {
            const event_ = eventKeuze.value;
            let variant = 0;
            if (mode === 'streak' || mode === 'survival') {
                variant = leesSeconden(variantInvoer.value);
                const minimum = mode === 'streak' ? 1000 : 3000;
                if (!variant || variant < minimum) {
                    UI.toast(`Vul een tijd in van minstens ${minimum / 1000} seconden.`, { type: 'warning' });
                    variantInvoer.focus();
                    return;
                }
                variant = mode === 'streak' ? Math.round(variant / 10) * 10 : Math.round(variant / 100) * 100;
            } else if (mode === 'speedrun') {
                const grenzen = overview?.rules?.speedrunCubes || { min: 2, max: 12 };
                variant = parseInt(variantInvoer.value, 10);
                if (!(variant >= grenzen.min && variant <= grenzen.max)) {
                    UI.toast(`Kies ${grenzen.min} tot ${grenzen.max} cubes.`, { type: 'warning' });
                    return;
                }
            }
            bewaarVoorkeur(mode + ':event', event_);
            if (variant) bewaarVoorkeur(mode + ':variant', variant);

            if (mode === 'speedrun') {
                event.currentTarget.disabled = true;
                await prepareSpeedrun(event_, variant);
                return;
            }
            startRun(mode, event_, variant);
        }));
        wrap.appendChild(knoppen);

        body.appendChild(wrap);
    }

    function leesSeconden(tekst) {
        const waarde = parseFloat(String(tekst || '').replace(',', '.'));
        return Number.isFinite(waarde) && waarde > 0 ? Math.round(waarde * 1000) : 0;
    }

    /* =====================================================================
     * Streak, survival, ladder: via de gewone timer
     * ================================================================== */

    function captureVrij() {
        const eigenaar = api.getSolveCaptureOwner?.();
        if (eigenaar && eigenaar !== OWNER) {
            UI.toast('Er loopt nog een toernooi. Maak dat eerst af, of stop ermee.', { type: 'warning' });
            return false;
        }
        return true;
    }

    function startRun(mode, event, variant) {
        if (!captureVrij()) return;
        stopDuel(false);
        window.CubeTimerChallenges?.stopChallenge?.();

        if (api.getActiveSessionEvent() !== event) api.setActiveSessionEvent(event);

        run = { mode, event, variant, solves: [], score: 0, vorige: null, startedAt: Date.now() };
        schrijfOpslag({ run });
        api.setSolveCapture(onRunSolve, OWNER);
        syncBanner();
        UI.closeModal(modal);
        UI.toast(`${MODES[mode].label} gestart. Je solves tellen niet mee voor je sessie.`, { type: 'info' });
    }

    function onRunSolve(entry) {
        if (!run) return;
        const solve = {
            ms: entry.raw === null || entry.raw === undefined ? null : Math.round(entry.raw),
            penalty: entry.penalty || 'none'
        };
        if (solve.ms === null) solve.penalty = 'dnf';
        run.solves.push(solve);

        const t = effectief(solve);
        const index = run.solves.length - 1;
        let gelukt = false;
        if (run.mode === 'streak') gelukt = t !== null && t < run.variant;
        if (run.mode === 'survival') gelukt = t !== null && t <= survivalLimiet(run.variant, index, run.event);
        if (run.mode === 'ladder') gelukt = t !== null && (run.vorige === null || t < run.vorige);

        if (!gelukt) {
            finishRun('fout');
            return;
        }

        run.score++;
        run.vorige = t;
        schrijfOpslag({ run });
        syncBanner();
    }

    async function stopRunVraag() {
        if (!run) return;
        const zeker = await UI.ask({
            title: `${MODES[run.mode].label} stoppen?`,
            message: run.score > 0 ? `Je score tot nu toe (${run.score}) telt gewoon.` : 'Je hebt nog niets gescoord.',
            confirmLabel: 'Stoppen'
        });
        if (zeker) finishRun('gestopt');
    }

    async function finishRun(reden) {
        const klaar = run;
        run = null;
        schrijfOpslag({ run: null });
        loslaten();
        syncBanner();
        if (!klaar || !klaar.solves.length) return;

        const resultaat = {
            mode: klaar.mode, event: klaar.event, variant: klaar.variant,
            score: klaar.score, solves: klaar.solves, reden, saved: false, run: null
        };
        await bewaarRonde(resultaat, { solves: klaar.solves });
        UI.openModal(modal);
        go('result', { result: resultaat });
    }

    async function bewaarRonde(resultaat, gegevens) {
        if (!magBewaren()) return;
        try {
            const antwoord = await UI.api('games/finish.php', {
                body: Object.assign({ mode: resultaat.mode, event: resultaat.event, variant: resultaat.variant }, gegevens)
            });
            resultaat.saved = true;
            resultaat.run = antwoord.run;
            resultaat.score = antwoord.run.score;
            if (overview) {
                overview.records = antwoord.records;
                overview.recent = antwoord.recent;
            }
        } catch (err) {
            resultaat.error = err.message || 'Je ronde kon niet bewaard worden.';
        }
    }

    function loslaten() {
        if (api.getSolveCaptureOwner?.() === OWNER) api.setSolveCapture(null);
        // Stond er een toernooi te wachten, dan mag dat de solves weer opvangen.
        window.CubeTimerTournament?.load?.(false);
    }

    /* --- Uitslag -------------------------------------------------------- */

    function scoreTekst(mode, score, variant) {
        switch (mode) {
            case 'streak': return `${score} op rij onder ${seconden(variant)}`;
            case 'survival': return `${score} overleefd, vanaf ${seconden(variant)}`;
            case 'ladder': return `${score} ${score === 1 ? 'trede' : 'treden'} geklommen`;
            case 'speedrun': return `${score} van ${variant} cubes in vijf minuten`;
            default: return String(score);
        }
    }

    function renderResult(r) {
        title.textContent = MODES[r.mode].label;
        subtitle.textContent = eventLabel(r.event);

        const wrap = el('div', 'games');
        const kaart = el('div', 'tournament-result');
        kaart.appendChild(el('p', 'tournament-result__position', String(r.score)));
        kaart.appendChild(el('p', 'tournament-result__text', scoreTekst(r.mode, r.score, r.variant)));

        if (r.run?.isRecord) {
            kaart.appendChild(el('p', 'game-record', 'Nieuw record!'));
            api.triggerConfetti?.();
        } else if (r.run?.previousRecord) {
            kaart.appendChild(el('p', 'field__hint', `Je record hier is ${r.run.previousRecord.score}.`));
        }
        if (r.mode === 'speedrun' && r.laps?.length === r.variant) {
            kaart.appendChild(el('p', 'field__hint', `Alle cubes klaar in ${UI.formatTime(r.laps[r.laps.length - 1])}.`));
        }
        wrap.appendChild(kaart);

        if (!r.saved) {
            wrap.appendChild(el('p', 'notice', r.error
                || (status.features?.games ? 'Log in om je records te bewaren.' : 'Records bewaren is op deze server niet beschikbaar.')));
        }

        if (r.solves?.length) {
            const rijen = r.solves.map((solve, index) => {
                let regel = '';
                if (r.mode === 'survival') regel = 'limiet ' + UI.formatTime(survivalLimiet(r.variant, index, r.event));
                if (r.mode === 'streak') regel = 'doel ' + seconden(r.variant);
                const gelukt = index < r.score;
                return [[String(index + 1), 'board-position'], [regel], [pogingLabel(solve), 'board-time' + (gelukt ? '' : ' board-time--dnf')]];
            });
            wrap.appendChild(groep('Je solves', tabel(null, rijen)));
        }
        if (r.laps?.length) {
            wrap.appendChild(groep('Rondetijden', tabel(null, r.laps.map((lap, index) => [
                [`Cube ${index + 1}`], [UI.formatTime(lap - (index ? r.laps[index - 1] : 0))], [UI.formatTime(lap), 'board-time']
            ]))));
        }

        const knoppen = el('div', 'games__actions');
        knoppen.appendChild(button('Menu', '', () => go('menu')));
        knoppen.appendChild(button('Nog een keer', 'btn--primary', () => {
            if (r.mode === 'speedrun') prepareSpeedrun(r.event, r.variant);
            else startRun(r.mode, r.event, r.variant);
        }));
        wrap.appendChild(knoppen);
        body.appendChild(wrap);
    }

    /* =====================================================================
     * Speedrun: eigen klok in het venster
     * ================================================================== */

    function speedrunLoopt() {
        return speedrun !== null && speedrun.fase === 'loopt';
    }

    async function prepareSpeedrun(event, cubes) {
        if (!captureVrij()) return;
        if (run) {
            UI.toast('Maak eerst je lopende ronde af.', { type: 'warning' });
            return;
        }
        speedrun = { event, cubes, scrambles: null, fase: 'laden', start: 0, laps: [], klok: null };
        go('speedrun');
        try {
            speedrun.scrambles = await maakScrambles(event, cubes);
            speedrun.fase = 'klaar';
        } catch (err) {
            speedrun = null;
            UI.toast(err.message || 'De scrambles konden niet gemaakt worden.', { type: 'error' });
            go('setup', { mode: 'speedrun' });
            return;
        }
        render();
    }

    function speedrunDuur() {
        return overview?.rules?.speedrunMs || 300000;
    }

    function renderSpeedrun() {
        title.textContent = 'Speedrun';
        const s = speedrun;
        if (!s) {
            go('menu');
            return;
        }
        subtitle.textContent = `${s.cubes} cubes · ${eventLabel(s.event)} · vijf minuten`;

        const wrap = el('div', 'games speedrun');

        if (s.fase === 'laden') {
            wrap.appendChild(el('p', 'table-empty', 'Scrambles maken…'));
            body.appendChild(wrap);
            return;
        }

        const klok = el('div', 'speedrun__clock', UI.formatTime(s.fase === 'loopt'
            ? Math.max(0, speedrunDuur() - (performance.now() - s.start)) : speedrunDuur()));
        klok.id = 'speedrun-clock';
        wrap.appendChild(klok);

        const lijst = el('ol', 'speedrun__list');
        s.scrambles.forEach((scramble, index) => {
            const item = el('li', 'speedrun__item');
            if (index < s.laps.length) item.classList.add('is-done');
            if (s.fase === 'loopt' && index === s.laps.length) item.classList.add('is-current');
            item.appendChild(el('span', 'speedrun__number', String(index + 1)));
            item.appendChild(el('span', 'speedrun__scramble', scramble));
            item.appendChild(el('span', 'speedrun__lap', index < s.laps.length ? UI.formatTime(s.laps[index]) : ''));
            lijst.appendChild(item);
        });

        if (s.fase === 'klaar') {
            wrap.appendChild(el('p', 'notice', 'Scramble alle cubes en leg ze op volgorde klaar. '
                + 'Druk dan op Start (of de spatiebalk). Na elke cube druk je nog een keer.'));
            wrap.appendChild(lijst);
            const knoppen = el('div', 'games__actions');
            knoppen.appendChild(button('Andere scrambles', '', () => prepareSpeedrun(s.event, s.cubes)));
            knoppen.appendChild(button('Start', 'btn--primary', startSpeedrun));
            wrap.appendChild(knoppen);
        } else {
            const groot = button(`Cube ${s.laps.length + 1} klaar`, 'btn--primary btn--block speedrun__lap-button', lapSpeedrun);
            wrap.appendChild(groot);
            wrap.appendChild(lijst);
            const knoppen = el('div', 'games__actions');
            const ongedaan = button('Laatste ongedaan', '', () => {
                if (!speedrun?.laps.length) return;
                speedrun.laps.pop();
                render();
            });
            ongedaan.disabled = !s.laps.length;
            knoppen.appendChild(ongedaan);
            knoppen.appendChild(button('Stoppen', 'btn--danger', () => stopSpeedrunVraag()));
            wrap.appendChild(knoppen);
        }

        body.appendChild(wrap);
    }

    function startSpeedrun() {
        if (!speedrun || speedrun.fase !== 'klaar') return;
        speedrun.fase = 'loopt';
        speedrun.start = performance.now();
        speedrun.laps = [];
        document.activeElement?.blur?.();
        render();
        tik();
    }

    /** Werkt de klok bij, elke frame, tot de tijd op is. */
    function tik() {
        if (!speedrunLoopt()) return;
        const over = speedrunDuur() - (performance.now() - speedrun.start);
        const klok = document.getElementById('speedrun-clock');
        if (klok) {
            klok.textContent = UI.formatTime(Math.max(0, over));
            klok.classList.toggle('is-urgent', over < 30000);
        }
        if (over <= 0) {
            finishSpeedrun();
            return;
        }
        speedrun.klok = requestAnimationFrame(tik);
    }

    function lapSpeedrun() {
        if (!speedrunLoopt()) return;
        const verstreken = Math.round(performance.now() - speedrun.start);
        if (verstreken > speedrunDuur()) return;
        speedrun.laps.push(verstreken);
        document.activeElement?.blur?.();
        if (speedrun.laps.length >= speedrun.cubes) {
            finishSpeedrun();
            return;
        }
        render();
    }

    async function stopSpeedrunVraag() {
        const zeker = await UI.ask({
            title: 'Speedrun stoppen?',
            message: 'De cubes die je al klaar had, tellen gewoon.',
            confirmLabel: 'Stoppen'
        });
        if (zeker && speedrunLoopt()) finishSpeedrun();
    }

    async function finishSpeedrun() {
        const s = speedrun;
        if (!s) return;
        cancelAnimationFrame(s.klok);
        speedrun = null;

        const resultaat = {
            mode: 'speedrun', event: s.event, variant: s.cubes, score: s.laps.length,
            laps: s.laps.slice(), saved: false, run: null
        };
        await bewaarRonde(resultaat, { laps: s.laps });
        go('result', { result: resultaat });
    }

    document.addEventListener('keydown', event => {
        if (event.code !== 'Space' || view.name !== 'speedrun' || !speedrun || !modal.classList.contains('visible')) return;
        const tag = event.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        event.preventDefault();
        if (event.repeat) return;
        if (speedrun.fase === 'klaar') startSpeedrun();
        else if (speedrun.fase === 'loopt') lapSpeedrun();
    });
    // Een knop met focus zou op de spatie ook nog "klikken"; dat voorkomen we.
    document.addEventListener('keyup', event => {
        if (event.code === 'Space' && view.name === 'speedrun' && speedrun && modal.classList.contains('visible')) {
            event.preventDefault();
        }
    });

    /* =====================================================================
     * Duels
     * ================================================================== */

    function renderDuels() {
        title.textContent = 'Duel';
        subtitle.textContent = MODES.duel.description;
        const wrap = el('div', 'games');
        const duels = overview?.duels;

        if (!duels) {
            wrap.appendChild(el('p', 'notice', 'Log in om een vriend uit te dagen.'));
            wrap.appendChild(button('Terug', '', () => go('menu')));
            body.appendChild(wrap);
            return;
        }

        const totalen = el('div', 'stat-grid');
        [['Gewonnen', duels.totals.won, 'stat--success'], ['Verloren', duels.totals.lost, ''], ['Gelijk', duels.totals.drawn, '']]
            .forEach(([label, waarde, extra]) => {
                const tegel = el('div', 'stat ' + extra);
                tegel.appendChild(el('span', 'stat__label', label));
                tegel.appendChild(el('span', 'stat__value', String(waarde)));
                totalen.appendChild(tegel);
            });
        wrap.appendChild(totalen);

        // --- uitdagen
        const formulier = el('div', 'duel-form');
        if (!duels.friends.length) {
            formulier.appendChild(el('p', 'notice', 'Je hebt nog geen vrienden om uit te dagen. Volg iemand via de ranglijst '
                + 'of zijn profiel; zodra jullie elkaar allebei volgen, zijn jullie vrienden.'));
        } else {
            const vriend = el('select', 'select');
            vriend.id = 'duel-friend';
            duels.friends.forEach(f => {
                const option = el('option', null, f.username);
                option.value = f.username;
                vriend.appendChild(option);
            });
            const eventKeuze = eventSelect('duel-event', api.getActiveSessionEvent());
            const rij = el('div', 'duel-form__row');
            rij.appendChild(veld('Vriend', vriend));
            rij.appendChild(veld('Event', eventKeuze));
            formulier.appendChild(rij);
            const knop = button('Uitdagen', 'btn--primary', () => createDuel(vriend.value, eventKeuze.value, knop));
            formulier.appendChild(knop);
            formulier.appendChild(el('p', 'field__hint', `Jullie krijgen dezelfde scrambles. Na ${overview.rules.duelDays} dagen `
                + 'vervalt een duel; wie dan klaar was, wint.'));
        }
        wrap.appendChild(groep('Iemand uitdagen', formulier));

        // --- open duels
        if (duels.open.length) {
            const lijst = el('div', 'duel-list');
            duels.open.forEach(duel => lijst.appendChild(duelKaart(duel)));
            wrap.appendChild(groep('Open duels', lijst));
        }

        if (duels.recent.length) {
            const lijst = el('div', 'duel-list');
            duels.recent.forEach(duel => lijst.appendChild(duelKaart(duel)));
            wrap.appendChild(groep('Afgelopen', lijst));
        }

        wrap.appendChild(button('Terug', '', () => go('menu')));
        body.appendChild(wrap);
    }

    function duelKaart(duel) {
        const kaart = el('div', 'duel-card');
        if (duel.result) kaart.dataset.result = duel.result;

        const tekst = el('div', 'duel-card__text');
        tekst.appendChild(el('strong', null, `${duel.role === 'challenger' ? 'Jij tegen' : 'Uitdaging van'} ${duel.them.username}`));

        let regel = `${duel.eventLabel} · ${duel.formatLabel}`;
        if (duel.status === 'open') {
            regel += ` · jij ${duel.you.attempts.length}/${duel.attemptsTotal} · ${duel.them.username} `
                + (duel.them.done ? 'klaar' : `${duel.them.attemptsDone}/${duel.attemptsTotal}`);
        } else if (duel.result) {
            const woord = { win: 'Gewonnen', loss: 'Verloren', draw: 'Gelijk' }[duel.result];
            regel += ` · ${woord}: ${duelScore(duel, duel.you)} tegen ${duelScore(duel, duel.them)}`;
        } else {
            regel += ` · ${{ expired: 'verlopen', declined: 'afgewezen', cancelled: 'ingetrokken' }[duel.status] || duel.status}`;
        }
        tekst.appendChild(el('span', null, regel));
        kaart.appendChild(tekst);

        const knoppen = el('div', 'duel-card__actions');
        if (duel.status === 'open' && !duel.you.done) {
            knoppen.appendChild(button(duel.you.attempts.length ? 'Verder' : 'Speel', 'btn--primary btn--sm', () => startDuel(duel)));
        }
        const magAfwijzen = duel.status === 'open' && (duel.role === 'opponent' ? !duel.you.done : duel.them.attemptsDone === 0);
        if (magAfwijzen) {
            knoppen.appendChild(button(duel.role === 'opponent' ? 'Afwijzen' : 'Intrekken', 'btn--sm', () => declineDuel(duel)));
        }
        if (duel.status !== 'open' && duel.them.attempts) {
            knoppen.appendChild(button('Bekijk', 'btn--sm', () => go('duel-result', { duel })));
        }
        kaart.appendChild(knoppen);
        return kaart;
    }

    function duelScore(duel, kant) {
        const gemiddelde = duel.format === 'a' || duel.format === 'm';
        if (gemiddelde && kant.average !== null) return UI.formatTime(kant.average);
        if (kant.best !== null && kant.best !== undefined) return (gemiddelde ? 'DNF (' + UI.formatTime(kant.best) + ')' : UI.formatTime(kant.best));
        return kant.done === false ? 'niet gespeeld' : 'DNF';
    }

    async function createDuel(vriend, event, knop) {
        knop.disabled = true;
        knop.textContent = 'Scrambles maken…';
        try {
            const scrambles = await maakScrambles(event, duelPogingen(event));
            const antwoord = await UI.api('duels/create.php', { body: { opponent: vriend, event, scrambles } });
            UI.toast(`${vriend} is uitgedaagd. Speel jij alvast?`, { type: 'success' });
            await load();
            startDuel(antwoord.duel);
        } catch (err) {
            UI.toast(err.message || 'Het duel kon niet aangemaakt worden.', { type: 'error' });
            knop.disabled = false;
            knop.textContent = 'Uitdagen';
        }
    }

    async function declineDuel(duel) {
        const zeker = await UI.ask({
            title: duel.role === 'opponent' ? 'Duel afwijzen?' : 'Duel intrekken?',
            message: duel.role === 'opponent' ? `${duel.them.username} ziet dat je niet meedoet.` : 'Het duel verdwijnt voor jullie allebei.',
            confirmLabel: duel.role === 'opponent' ? 'Afwijzen' : 'Intrekken',
            danger: true
        });
        if (!zeker) return;
        try {
            const antwoord = await UI.api('duels/decline.php', { body: { duelId: duel.id } });
            UI.toast(antwoord.message, { type: 'info' });
            if (duelRun?.id === duel.id) stopDuel(false);
            await load();
        } catch (err) {
            UI.toast(err.message || 'Dat is niet gelukt.', { type: 'error' });
        }
    }

    function startDuel(duel) {
        if (!captureVrij()) return;
        if (run) {
            UI.toast('Maak eerst je lopende ronde af.', { type: 'warning' });
            return;
        }
        if (!duel.nextScramble) return;
        window.CubeTimerChallenges?.stopChallenge?.();
        if (api.getActiveSessionEvent() !== duel.event) api.setActiveSessionEvent(duel.event);

        duelRun = duel;
        api.setSolveCapture(onDuelSolve, OWNER);
        api.setScrambleOverride(duel.nextScramble);
        syncBanner();
        UI.closeModal(modal);
        UI.toast(`Duel tegen ${duel.them.username}: poging ${duel.you.attempts.length + 1} van ${duel.attemptsTotal}.`, { type: 'info' });
    }

    async function onDuelSolve(entry) {
        if (!duelRun || bezig) return;
        bezig = true;
        const duel = duelRun;
        bannerHint.textContent = 'Opslaan…';
        try {
            const antwoord = await UI.api('duels/solve.php', {
                body: {
                    duelId: duel.id,
                    timeMs: entry.raw,
                    penalty: entry.penalty === null || entry.penalty === undefined ? 'none' : entry.penalty
                }
            });
            const vers = antwoord.duel;
            if (vers.you.done || !vers.nextScramble) {
                stopDuel(false);
                await load();
                UI.openModal(modal);
                go('duel-result', { duel: vers });
                return;
            }
            duelRun = vers;
            api.setScrambleOverride(vers.nextScramble);
            syncBanner();
        } catch (err) {
            stopDuel(false);
            UI.toast(err.message || 'Je poging kon niet worden opgeslagen.', { type: 'error' });
            await load();
        } finally {
            bezig = false;
        }
    }

    function stopDuel(melden) {
        if (!duelRun) return;
        const duel = duelRun;
        duelRun = null;
        api.setScrambleOverride(null);
        loslaten();
        syncBanner();
        if (melden) UI.toast(`Duel onderbroken. Je kunt later verder bij poging ${duel.you.attempts.length + 1}.`, { type: 'info' });
    }

    function renderDuelResult(duel) {
        title.textContent = 'Duel';
        subtitle.textContent = `${duel.eventLabel} · ${duel.formatLabel} · tegen ${duel.them.username}`;
        const wrap = el('div', 'games');

        const kaart = el('div', 'tournament-result');
        if (duel.status === 'open') {
            kaart.appendChild(el('p', 'tournament-result__text', 'Klaar!'));
            kaart.appendChild(el('p', 'field__hint', `Nu is ${duel.them.username} aan de beurt. `
                + 'Je ziet de uitslag zodra die ook klaar is.'));
            kaart.appendChild(el('p', 'tournament-result__position', duelScore(duel, duel.you)));
        } else {
            const woord = { win: 'Gewonnen!', loss: 'Verloren', draw: 'Gelijkspel' }[duel.result] || 'Afgelopen';
            kaart.appendChild(el('p', 'tournament-result__text', woord));
            kaart.appendChild(el('p', 'tournament-result__position',
                `${duelScore(duel, duel.you)}`));
            kaart.appendChild(el('p', 'field__hint', `${duel.them.username}: ${duelScore(duel, duel.them)}`));
            if (duel.result === 'win') api.triggerConfetti?.();
        }
        wrap.appendChild(kaart);

        const rijen = [];
        for (let i = 0; i < duel.attemptsTotal; i++) {
            rijen.push([
                [String(i + 1), 'board-position'],
                [duel.you.attempts[i] ? pogingLabel(duel.you.attempts[i]) : '--', 'board-time'],
                [duel.them.attempts ? (duel.them.attempts[i] ? pogingLabel(duel.them.attempts[i]) : '--') : '?', 'board-time']
            ]);
        }
        wrap.appendChild(groep('Pogingen', tabel(['#', 'Jij', duel.them.username], rijen)));

        if (duel.scrambles) {
            const lijst = el('ol', 'speedrun__list');
            duel.scrambles.forEach((scramble, index) => {
                const item = el('li', 'speedrun__item');
                item.appendChild(el('span', 'speedrun__number', String(index + 1)));
                item.appendChild(el('span', 'speedrun__scramble', scramble));
                lijst.appendChild(item);
            });
            wrap.appendChild(groep('Scrambles', lijst));
        }

        const knoppen = el('div', 'games__actions');
        knoppen.appendChild(button('Naar de duels', 'btn--primary', () => go('duels')));
        wrap.appendChild(knoppen);
        body.appendChild(wrap);
    }

    /* =====================================================================
     * De balk boven de timer
     * ================================================================== */

    function syncBanner() {
        if (run) {
            banner.hidden = false;
            const info = MODES[run.mode];
            if (run.mode === 'streak') {
                bannerTitle.textContent = `${info.label} · sub ${seconden(run.variant)}`;
                bannerHint.textContent = `${run.score} op rij`;
            } else if (run.mode === 'survival') {
                bannerTitle.textContent = `${info.label} · limiet ${UI.formatTime(survivalLimiet(run.variant, run.solves.length, run.event))}`;
                bannerHint.textContent = `${run.score} overleefd`;
            } else {
                bannerTitle.textContent = run.vorige === null ? info.label : `${info.label} · sneller dan ${UI.formatTime(run.vorige)}`;
                bannerHint.textContent = `${run.score} ${run.score === 1 ? 'trede' : 'treden'}`;
            }
            const record = recordVoor(run.mode, run.event);
            if (record && (record.variant === run.variant || run.mode === 'ladder')) {
                bannerHint.textContent += ` · record ${record.score}`;
            }
            bannerHint.textContent += ' · telt niet mee voor je sessie';
            bannerStop.textContent = 'Stoppen';
            return;
        }
        if (duelRun) {
            banner.hidden = false;
            bannerTitle.textContent = `Duel tegen ${duelRun.them.username} · ${duelRun.eventLabel}`;
            bannerHint.textContent = `Poging ${duelRun.you.attempts.length + 1} van ${duelRun.attemptsTotal} · telt niet mee voor je sessie`;
            bannerStop.textContent = 'Onderbreken';
            return;
        }
        banner.hidden = true;
    }

    bannerStop.addEventListener('click', () => {
        if (run) stopRunVraag();
        else if (duelRun) stopDuel(true);
    });
    bannerOpen.addEventListener('click', () => {
        UI.openModal(modal);
        go('menu');
    });

    /* =====================================================================
     * Koppelen
     * ================================================================== */

    openButton.addEventListener('click', () => {
        UI.openModal(modal);
        if (!speedrun) go('menu');
        else render();
        load();
    });

    function sluiten() {
        if (speedrunLoopt()) {
            stopSpeedrunVraag();
            return;
        }
        if (speedrun && speedrun.fase === 'klaar') speedrun = null;
        UI.closeModal(modal);
    }
    document.querySelectorAll('[data-close-games]').forEach(knop => knop.addEventListener('click', sluiten));
    UI.registerModal(modal, sluiten);

    // Een ander event kiezen past niet bij een lopende ronde.
    window.addEventListener('cubetimer:event-change', () => {
        if (run && api.getActiveSessionEvent() !== run.event) {
            UI.toast('Je koos een ander event, dus je ronde is gestopt.', { type: 'info' });
            finishRun('event');
        }
        if (duelRun && api.getActiveSessionEvent() !== duelRun.event) stopDuel(true);
    });

    window.addEventListener('cubetimer:auth-change', event => {
        if (event.detail?.status) status = event.detail.status;
        stopDuel(false);
        load();
    });

    UI.status().then(s => {
        status = s || status;
        load();

        // Een ronde die nog liep toen de pagina herladen werd, gaat gewoon door.
        const bewaard = leesOpslag().run;
        if (bewaard && bewaard.mode && MODES[bewaard.mode] && Date.now() - (bewaard.startedAt || 0) < 24 * 3600 * 1000) {
            if (api.getSolveCaptureOwner?.() && api.getSolveCaptureOwner() !== OWNER) return;
            run = bewaard;
            if (api.getActiveSessionEvent() !== run.event) api.setActiveSessionEvent(run.event);
            api.setSolveCapture(onRunSolve, OWNER);
            syncBanner();
        } else if (bewaard) {
            schrijfOpslag({ run: null });
        }
    });

    window.CubeTimerGames = {
        load,
        isRunning: () => run !== null || duelRun !== null || speedrunLoopt()
    };
})();
