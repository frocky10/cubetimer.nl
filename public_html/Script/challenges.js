/**
 * CubeTimer - daily challenges
 * ---------------------------------------------------------------------------
 * Elke dag drie opdrachten:
 *
 *   Scramble van de dag  Iedereen dezelfde scramble, een poging, eigen
 *                        dagranglijst.
 *   Blijf oefenen        Doe vandaag een X aantal solves.
 *   Sneller dan jezelf   Doe een solve onder je eigen doeltijd (de server
 *                        rekent die uit en zet hem in de omschrijving).
 *
 * De twee laatste worden serverside bijgehouden bij elke synchronisatie; daar
 * hoeft dit bestand niets voor te doen behalve de stand tonen.
 *
 * De scramble van de dag werkt anders: je zet de timer in challengemodus, de
 * scramble wordt vastgezet, en je eerstvolgende solve wordt ingestuurd.
 */
(function () {
    'use strict';

    const UI = window.CubeTimerUI;
    const api = window.cubeTimerApi;

    const openButton = document.getElementById('challenges-open');
    const modal = document.getElementById('challenges-modal');
    if (!openButton || !modal || !api) return;

    const list = document.getElementById('challenges-list');
    const dateLabel = document.getElementById('challenges-date');
    const guestNotice = document.getElementById('challenges-guest');
    const badge = document.getElementById('challenges-badge');

    const banner = document.getElementById('challenge-banner');
    const bannerHint = document.getElementById('challenge-banner-hint');
    const bannerCancel = document.getElementById('challenge-banner-cancel');

    let data = null;
    let ingelogd = false;
    let actieveChallenge = null;   // de challenge waarvoor de timer klaarstaat
    let laden = false;

    /* =====================================================================
     * Ophalen en tekenen
     * ================================================================== */

    async function load() {
        if (laden) return;
        laden = true;
        try {
            data = await UI.api('challenges/today.php');
            ingelogd = data.authenticated === true;
            voorraadEvents = Object.keys(data.poolSizes || {});
            render();
        } catch (err) {
            list.innerHTML = '';
            const melding = document.createElement('p');
            melding.className = 'table-empty';
            melding.textContent = err.message || 'De challenges konden niet geladen worden.';
            list.appendChild(melding);
        } finally {
            laden = false;
        }
    }

    function updateBadge() {
        if (!data || !ingelogd) {
            badge.hidden = true;
            return;
        }
        const open = data.challenges.filter(challenge => !challenge.completed).length;
        badge.hidden = open === 0;
        badge.textContent = String(open);
    }

    function render() {
        list.innerHTML = '';
        guestNotice.hidden = ingelogd;

        const datum = new Date(data.date + 'T12:00:00');
        dateLabel.textContent = datum.toLocaleDateString('nl-NL', {
            weekday: 'long', day: 'numeric', month: 'long'
        });

        if (!data.challenges.length) {
            const leeg = document.createElement('p');
            leeg.className = 'table-empty';
            leeg.textContent = 'Er staan vandaag nog geen opdrachten klaar.';
            list.appendChild(leeg);
        }

        data.challenges.forEach(challenge => {
            list.appendChild(
                challenge.type === 'scramble_of_the_day'
                    ? renderScrambleCard(challenge)
                    : renderTaskCard(challenge)
            );
        });

        updateBadge();
    }

    /** Kaart met kop, omschrijving en XP-label; gedeeld door alle soorten. */
    function baseCard(challenge) {
        const card = document.createElement('article');
        card.className = 'challenge-card' + (challenge.completed ? ' is-done' : '');

        const head = document.createElement('div');
        head.className = 'challenge-card__head';

        const tekst = document.createElement('div');
        const titel = document.createElement('h3');
        titel.className = 'challenge-card__title';
        titel.textContent = challenge.title;
        const omschrijving = document.createElement('p');
        omschrijving.className = 'challenge-card__description';
        omschrijving.textContent = challenge.description;
        tekst.appendChild(titel);
        tekst.appendChild(omschrijving);

        const xp = document.createElement('span');
        xp.className = 'challenge-card__xp';
        xp.textContent = (challenge.completed ? '✓ ' : '+') + challenge.xpReward + ' XP';

        head.appendChild(tekst);
        head.appendChild(xp);
        card.appendChild(head);
        return card;
    }

    function renderTaskCard(challenge) {
        const card = baseCard(challenge);

        const progress = document.createElement('div');
        progress.className = 'challenge-progress';

        const head = document.createElement('div');
        head.className = 'challenge-progress__head';
        const links = document.createElement('span');
        links.textContent = challenge.completed ? 'Gehaald!' : 'Voortgang';
        const rechts = document.createElement('span');
        rechts.textContent = `${Math.min(challenge.progress, challenge.target)} / ${challenge.target}`;
        head.appendChild(links);
        head.appendChild(rechts);

        const track = document.createElement('div');
        track.className = 'challenge-progress__track';
        const fill = document.createElement('div');
        fill.className = 'challenge-progress__fill';
        const deel = challenge.target > 0
            ? Math.min(100, Math.round((challenge.progress / challenge.target) * 100))
            : 0;
        fill.style.width = deel + '%';
        track.appendChild(fill);

        progress.appendChild(head);
        progress.appendChild(track);
        card.appendChild(progress);

        if (!ingelogd) {
            const hint = document.createElement('p');
            hint.className = 'field__hint';
            hint.textContent = 'Log in om je voortgang bij te houden.';
            card.appendChild(hint);
        }

        return card;
    }

    function renderScrambleCard(challenge) {
        const card = baseCard(challenge);

        const scramble = document.createElement('p');
        if (challenge.attempted || !ingelogd) {
            scramble.className = 'challenge-scramble';
            scramble.textContent = challenge.scramble;
        } else {
            // Niet vooraf laten zien: dan kun je hem rustig vooruit oefenen.
            scramble.className = 'challenge-scramble challenge-scramble--hidden';
            scramble.textContent = 'De scramble verschijnt zodra je begint.';
        }
        card.appendChild(scramble);

        if (challenge.completed && challenge.valueMs !== null) {
            const resultaat = document.createElement('p');
            resultaat.className = 'challenge-result';
            const tijd = document.createElement('span');
            tijd.className = 'challenge-result__time';
            tijd.textContent = UI.formatTime(challenge.valueMs);
            resultaat.appendChild(document.createTextNode('Jouw tijd: '));
            resultaat.appendChild(tijd);
            card.appendChild(resultaat);
        } else if (challenge.attempted) {
            const resultaat = document.createElement('p');
            resultaat.className = 'challenge-result';
            resultaat.textContent = 'Je poging van vandaag was een DNF. Morgen weer een kans.';
            card.appendChild(resultaat);
        } else if (ingelogd) {
            const knop = document.createElement('button');
            knop.className = 'btn btn--primary';
            knop.type = 'button';
            knop.textContent = 'Doe de scramble van de dag';
            knop.addEventListener('click', () => startChallenge(challenge));
            card.appendChild(knop);
        }

        if (challenge.leaderboard && challenge.leaderboard.length) {
            card.appendChild(renderDayBoard(challenge.leaderboard));
        } else {
            const nog = document.createElement('p');
            nog.className = 'field__hint';
            nog.textContent = 'Nog niemand heeft hem vandaag gedaan.';
            card.appendChild(nog);
        }

        return card;
    }

    function renderDayBoard(entries) {
        const wrap = document.createElement('div');
        wrap.className = 'board-wrap';

        const table = document.createElement('table');
        table.className = 'board-table';

        const body = document.createElement('tbody');
        entries.forEach(entry => {
            const row = document.createElement('tr');

            const positie = document.createElement('td');
            positie.className = 'board-position';
            positie.textContent = entry.position;

            const naam = document.createElement('td');
            naam.textContent = entry.user;

            const tijd = document.createElement('td');
            tijd.className = 'board-time' + (entry.valueMs === null ? ' board-time--dnf' : '');
            tijd.textContent = entry.valueMs === null ? 'DNF' : UI.formatTime(entry.valueMs);

            row.appendChild(positie);
            row.appendChild(naam);
            row.appendChild(tijd);
            body.appendChild(row);
        });

        table.appendChild(body);
        wrap.appendChild(table);
        return wrap;
    }

    /* =====================================================================
     * Challengemodus: de scramble van de dag timen
     * ================================================================== */

    async function startChallenge(challenge) {
        // De scramble hoort bij een bepaald event; staat je sessie op iets
        // anders, dan is het aanbod om te wisselen logischer dan een waarschuwing.
        if (api.getActiveSessionEvent() !== challenge.event) {
            const wisselen = await UI.ask({
                title: 'Naar ' + challenge.eventLabel + ' wisselen?',
                message: `De scramble van de dag is voor ${challenge.eventLabel}, `
                       + `maar je sessie staat op ${api.getEventLabel(api.getActiveSessionEvent())}. `
                       + 'Zal ik je sessie omzetten?',
                confirmLabel: 'Omzetten',
                cancelLabel: 'Laat maar zo'
            });
            if (wisselen) {
                api.setActiveSessionEvent(challenge.event);
            }
        }

        actieveChallenge = challenge;

        api.setScrambleOverride(challenge.scramble);
        banner.hidden = false;
        bannerHint.textContent = api.getActiveSessionEvent() === challenge.event
            ? 'Je hebt een poging. Je volgende solve telt.'
            : `Let op: je sessie staat op ${api.getEventLabel(api.getActiveSessionEvent())}, `
              + `de scramble is er een voor ${challenge.eventLabel}.`;

        UI.closeModal(modal);
        UI.toast(`Scramble van de dag voor ${challenge.eventLabel} staat klaar. Je volgende solve telt.`,
            { type: 'info' });
    }

    function stopChallenge(melding) {
        if (!actieveChallenge) return;
        actieveChallenge = null;
        api.setScrambleOverride(null);
        banner.hidden = true;
        if (melding) UI.toast(melding, { type: 'info' });
    }

    bannerCancel?.addEventListener('click', () => stopChallenge('Challenge afgebroken. Je gewone scramble staat weer klaar.'));

    // Zodra er in challengemodus een solve klaar is, sturen we die in.
    window.addEventListener('cubetimer:solve', async event => {
        if (!actieveChallenge) return;

        const challenge = actieveChallenge;
        const solve = event.detail.solve;
        actieveChallenge = null;
        api.setScrambleOverride(null);
        banner.hidden = true;

        try {
            const response = await UI.api('challenges/submit.php', {
                body: {
                    challengeId: challenge.id,
                    timeMs: solve.raw,
                    penalty: solve.penalty === null ? 'none' : solve.penalty,
                    solveClientId: solve.id
                }
            });
            UI.toast(response.message, { type: 'success' });
            await load();
        } catch (err) {
            UI.toast(err.message || 'Je poging kon niet worden ingestuurd.', { type: 'error' });
        }
    });

    /* =====================================================================
     * Scramblevoorraad aanvullen
     *
     * PHP kan zelf geen officiele WCA-scrambles maken, cubing.js in de browser
     * wel. Af en toe sturen we er daarom eentje mee terug. Ze worden pas na
     * een dag gebruikt en willekeurig gekozen, dus je kunt er niets mee
     * sturen wat je zelf morgen krijgt.
     * ================================================================== */

    // Per event een klein stapeltje, dat we in een keer opsturen.
    const voorraad = {};
    const voorraadTimers = {};

    // Alleen events waarvoor de server een scramble van de dag kan maken.
    let voorraadEvents = [];

    window.addEventListener('cubetimer:scramble-change', event => {
        if (!ingelogd) return;
        if (actieveChallenge) return;
        // Een vastgezette scramble (van de dag, of een oefengeval van de
        // leerpagina) is niet willekeurig en hoort niet in de voorraad.
        if (event.detail.override) return;

        const eventId = event.detail.eventType;
        if (!voorraadEvents.includes(eventId)) return;

        const scramble = (event.detail.scramble || '').trim();
        if (!scramble) return;

        voorraad[eventId] = voorraad[eventId] || [];
        if (voorraad[eventId].includes(scramble)) return;

        voorraad[eventId].push(scramble);
        if (voorraad[eventId].length < 5) return;

        window.clearTimeout(voorraadTimers[eventId]);
        voorraadTimers[eventId] = window.setTimeout(() => {
            const zending = voorraad[eventId].splice(0, voorraad[eventId].length);
            UI.api('challenges/contribute.php', { body: { event: eventId, scrambles: zending } })
                .catch(() => { /* achtergrondwerk; hier hoeft niemand iets van te merken */ });
        }, 2000);
    });

    /* =====================================================================
     * Koppelen
     * ================================================================== */

    openButton.addEventListener('click', () => {
        UI.openModal(modal);
        load();
    });

    document.querySelectorAll('[data-close-challenges]').forEach(button => {
        button.addEventListener('click', () => UI.closeModal(modal));
    });
    UI.registerModal(modal);

    // Na een synchronisatie kan de voortgang veranderd zijn.
    window.addEventListener('cubetimer:synced', () => {
        if (ingelogd) load();
    });

    // Bij in- of uitloggen verandert wat je te zien krijgt.
    window.addEventListener('cubetimer:auth-change', () => {
        stopChallenge();
        load();
    });

    UI.status().then(status => {
        if (status.features?.challenges !== true) {
            openButton.hidden = true;
            return;
        }
        openButton.hidden = false;
        load();
    });

    window.CubeTimerChallenges = { load, stopChallenge };
})();
