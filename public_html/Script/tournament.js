/**
 * CubeTimer - toernooimodus
 * ---------------------------------------------------------------------------
 * Een simulatie van een echte WCA-competitie. Drie rondes van vijf solves,
 * gerangschikt op Ao5 met je beste single als tiebreak, met cutoff en
 * tijdslimiet. Na elke ronde valt het veld terug tot de besten.
 *
 * Een toernooi staat helemaal los van je sessies: zolang er een ronde loopt
 * gaan je solves naar het toernooi en niet naar je gewone tijden. Dat regelt
 * `cubeTimerApi.setSolveCapture()`.
 *
 * Alle uitslagen komen van de server. De tijden van je tegenstanders worden
 * pas berekend als jij je ronde af hebt, dus vooruitkijken kan niet.
 */
(function () {
    'use strict';

    const UI = window.CubeTimerUI;
    const api = window.cubeTimerApi;

    const openButton = document.getElementById('tournament-open');
    const modal = document.getElementById('tournament-modal');
    if (!openButton || !modal || !api) return;

    const body = document.getElementById('tournament-body');
    const subtitle = document.getElementById('tournament-subtitle');
    const footnote = document.getElementById('tournament-footnote');
    const guestNotice = document.getElementById('tournament-guest');
    const badge = document.getElementById('tournament-badge');

    const banner = document.getElementById('tournament-banner');
    const bannerTitle = document.getElementById('tournament-banner-title');
    const bannerHint = document.getElementById('tournament-banner-hint');
    const bannerOpen = document.getElementById('tournament-banner-open');

    let data = null;
    let laden = false;
    let bezigMetInsturen = false;

    /* =====================================================================
     * Ophalen
     * ================================================================== */

    async function load(toon = true) {
        if (laden) return;
        laden = true;
        try {
            data = await UI.api('tournament/state.php');
            if (toon) render();
            syncBanner();
        } catch (err) {
            if (err.status === 401) {
                data = null;
                guestNotice.hidden = false;
                body.innerHTML = '';
            } else if (toon) {
                toonMelding(err.message || 'Het toernooi kon niet geladen worden.');
            }
        } finally {
            laden = false;
        }
    }

    /**
     * Haalt de historie en de samenvatting op zonder het toernooi in beeld te
     * vervangen. Nodig vlak na de laatste ronde: dan is er geen lopend
     * toernooi meer, maar wil je de uitslag juist blijven zien.
     */
    async function verversOmheen() {
        try {
            const vers = await UI.api('tournament/state.php');
            data.history = vers.history;
            data.summary = vers.summary;
            data.difficulties = vers.difficulties;
            data.events = vers.events;
            if (vers.tournament) {
                data.tournament = vers.tournament;
            }
        } catch (err) {
            // Niet erg: het scherm toont dan de staat uit het vorige antwoord.
        }
    }

    function toonMelding(tekst) {
        body.innerHTML = '';
        const melding = document.createElement('p');
        melding.className = 'table-empty';
        melding.textContent = tekst;
        body.appendChild(melding);
    }

    function tijd(ms) {
        return ms === null || ms === undefined ? 'DNF' : UI.formatTime(ms);
    }

    /** De tijd van een poging, met de straf erin verwerkt. */
    function pogingLabel(poging) {
        if (!poging || poging.penalty === 'dnf' || poging.ms === null) return 'DNF';
        const basis = UI.formatTime(poging.ms + (poging.penalty === 'plus2' ? 2000 : 0));
        return poging.penalty === 'plus2' ? basis + '+' : basis;
    }

    /* =====================================================================
     * Tekenen
     * ================================================================== */

    function render() {
        guestNotice.hidden = true;
        body.innerHTML = '';
        footnote.textContent = '';

        if (!data) {
            toonMelding('Laden…');
            return;
        }

        if (data.tournament && data.tournament.status === 'active') {
            subtitle.textContent = 'Vijf solves per ronde. Alleen de besten gaan door.';
            body.appendChild(renderActief(data.tournament));
            body.appendChild(renderStanden(data.tournament));
            return;
        }

        if (data.tournament && data.tournament.status !== 'active') {
            body.appendChild(renderAfgerond(data.tournament));
            body.appendChild(renderStanden(data.tournament));
            return;
        }

        subtitle.textContent = 'Vijf solves per ronde, cutoff en tijdslimiet, net als op een echte comp.';
        body.appendChild(renderStart());
        if (data.history.length) body.appendChild(renderHistorie());
    }

    /* --- Startscherm ---------------------------------------------------- */

    function renderStart() {
        const wrap = document.createElement('div');
        wrap.className = 'tournament-start';

        const s = data.summary;
        if (s.played > 0) {
            const grid = document.createElement('div');
            grid.className = 'stat-grid';
            [
                ['Gespeeld', s.played], ['Gewonnen', s.won],
                ['Podiums', s.podiums], ['Beste plek', s.bestPosition ? s.bestPosition + 'e' : '--']
            ].forEach(([label, waarde]) => {
                const tegel = document.createElement('div');
                tegel.className = 'stat';
                tegel.innerHTML = '<span class="stat__label"></span><span class="stat__value"></span>';
                tegel.querySelector('.stat__label').textContent = label;
                tegel.querySelector('.stat__value').textContent = String(waarde);
                grid.appendChild(tegel);
            });
            wrap.appendChild(grid);
        }

        const rij = document.createElement('div');
        rij.className = 'field';
        const label = document.createElement('label');
        label.className = 'field__label';
        label.setAttribute('for', 'tournament-event');
        label.textContent = 'Event';
        const select = document.createElement('select');
        select.className = 'select';
        select.id = 'tournament-event';
        data.events.forEach(event => {
            const option = document.createElement('option');
            option.value = event.id;
            option.textContent = event.label;
            select.appendChild(option);
        });
        select.value = api.getActiveSessionEvent();
        rij.appendChild(label);
        rij.appendChild(select);
        wrap.appendChild(rij);

        const kop = document.createElement('p');
        kop.className = 'field__label';
        kop.textContent = 'Moeilijkheid';
        wrap.appendChild(kop);

        const kaarten = document.createElement('div');
        kaarten.className = 'difficulty-grid';
        data.difficulties.forEach(niveau => {
            const kaart = document.createElement('button');
            kaart.className = 'difficulty-card';
            kaart.type = 'button';

            const naam = document.createElement('span');
            naam.className = 'difficulty-card__name';
            naam.textContent = niveau.label;

            const omschrijving = document.createElement('span');
            omschrijving.className = 'difficulty-card__description';
            omschrijving.textContent = niveau.description;

            const veld = document.createElement('span');
            veld.className = 'difficulty-card__meta';
            veld.textContent = `Veld van ${niveau.fieldSize}`;

            kaart.appendChild(naam);
            kaart.appendChild(omschrijving);
            kaart.appendChild(veld);
            kaart.addEventListener('click', () => start(select.value, niveau.id, kaart));
            kaarten.appendChild(kaart);
        });
        wrap.appendChild(kaarten);

        const uitleg = document.createElement('p');
        uitleg.className = 'notice';
        uitleg.textContent = 'Je tegenstanders zijn verzonnen cubers, aangevuld met andere gebruikers van de site. '
            + 'Hun tijden worden gesimuleerd op hun eigen niveau; ze doen niet echt mee. '
            + 'Je toernooisolves blijven los van je gewone tijden en krijgen een eigen blok op je profiel.';
        wrap.appendChild(uitleg);

        return wrap;
    }

    function renderHistorie() {
        const groep = document.createElement('section');
        groep.className = 'achievement-group';

        const kop = document.createElement('h3');
        kop.className = 'achievement-group__name';
        kop.textContent = 'Eerder gespeeld';
        groep.appendChild(kop);

        const wrap = document.createElement('div');
        wrap.className = 'board-wrap';
        const tabel = document.createElement('table');
        tabel.className = 'board-table';
        const tbody = document.createElement('tbody');

        data.history.forEach(item => {
            const rij = document.createElement('tr');

            const plek = document.createElement('td');
            plek.className = 'board-position';
            plek.textContent = item.position === null ? '--' : item.position + 'e';

            const wat = document.createElement('td');
            wat.textContent = `${item.eventLabel} · ${item.difficultyLabel}`
                + (item.status === 'abandoned' ? ' (gestopt)' : ` · veld van ${item.fieldSize}`);

            const resultaat = document.createElement('td');
            resultaat.className = 'board-time';
            resultaat.textContent = tijd(item.ao5Ms);

            rij.appendChild(plek);
            rij.appendChild(wat);
            rij.appendChild(resultaat);
            tbody.appendChild(rij);
        });

        tabel.appendChild(tbody);
        wrap.appendChild(tabel);
        groep.appendChild(wrap);
        return groep;
    }

    /* --- Lopend toernooi ------------------------------------------------ */

    function renderActief(toernooi) {
        const wrap = document.createElement('div');
        wrap.className = 'tournament-active';

        const kop = document.createElement('div');
        kop.className = 'tournament-header';
        kop.innerHTML = '<div><p class="tournament-header__title"></p>'
                      + '<p class="tournament-header__sub"></p></div>';
        kop.querySelector('.tournament-header__title').textContent =
            `${toernooi.eventLabel} · ${toernooi.difficultyLabel}`;
        kop.querySelector('.tournament-header__sub').textContent =
            `Veld van ${toernooi.fieldSize} · ronde ${toernooi.currentRound} van ${toernooi.totalRounds}`;

        const stoppen = document.createElement('button');
        stoppen.className = 'btn btn--danger btn--sm';
        stoppen.type = 'button';
        stoppen.textContent = 'Stoppen';
        stoppen.addEventListener('click', () => abandon(toernooi.id));
        kop.appendChild(stoppen);
        wrap.appendChild(kop);

        const ronde = toernooi.round;
        if (!ronde) return wrap;

        const rondeKop = document.createElement('p');
        rondeKop.className = 'tournament-round__name';
        rondeKop.textContent = `${ronde.name} — ${ronde.entrants} deelnemers`
            + (ronde.advancing > 0 ? `, ${ronde.advancing} gaan door` : ', dit is de finale');
        wrap.appendChild(rondeKop);

        // De vijf pogingen
        const pogingen = document.createElement('div');
        pogingen.className = 'attempt-row';
        for (let i = 0; i < ronde.attemptsTotal; i++) {
            const solve = ronde.solves[i];
            const vak = document.createElement('div');
            vak.className = 'attempt' + (solve ? ' is-done' : '')
                          + (!solve && i === ronde.attemptsDone ? ' is-next' : '');
            const nummer = document.createElement('span');
            nummer.className = 'attempt__number';
            nummer.textContent = String(i + 1);
            const waarde = document.createElement('span');
            waarde.className = 'attempt__value';
            waarde.textContent = solve ? pogingLabel(solve) : '--';
            vak.appendChild(nummer);
            vak.appendChild(waarde);
            pogingen.appendChild(vak);
        }
        wrap.appendChild(pogingen);

        const regels = document.createElement('p');
        regels.className = 'field__hint';
        const delen = [];
        if (ronde.cutoffMs) {
            delen.push(`Cutoff ${UI.formatTime(ronde.cutoffMs)}: haal je die niet in twee solves, dan stopt je ronde daar.`);
        }
        if (ronde.timeLimitMs) {
            delen.push(`Tijdslimiet ${UI.formatTime(ronde.timeLimitMs)}: daarboven is het een DNF.`);
        }
        regels.textContent = delen.join(' ');
        wrap.appendChild(regels);

        const knop = document.createElement('button');
        knop.className = 'btn btn--primary btn--block';
        knop.type = 'button';
        knop.textContent = ronde.attemptsDone === 0
            ? 'Begin met solve 1'
            : `Doe solve ${ronde.attemptsDone + 1}`;
        knop.addEventListener('click', () => naarDeTimer(toernooi));
        wrap.appendChild(knop);

        return wrap;
    }

    /* --- Afgerond ------------------------------------------------------- */

    function renderAfgerond(toernooi) {
        const wrap = document.createElement('div');
        wrap.className = 'tournament-result';

        const plek = document.createElement('p');
        plek.className = 'tournament-result__position';
        plek.textContent = toernooi.finalPosition === null ? '--' : toernooi.finalPosition + 'e';

        const tekst = document.createElement('p');
        tekst.className = 'tournament-result__text';
        if (toernooi.status === 'abandoned') {
            tekst.textContent = 'Je bent met dit toernooi gestopt.';
        } else if (toernooi.finalPosition === 1) {
            tekst.textContent = `Gewonnen! Eerste van ${toernooi.fieldSize} op ${toernooi.difficultyLabel}.`;
        } else if (toernooi.finalPosition <= 3) {
            tekst.textContent = `Op het podium: ${toernooi.finalPosition}e van ${toernooi.fieldSize}.`;
        } else {
            tekst.textContent = `Je eindigde als ${toernooi.finalPosition}e van ${toernooi.fieldSize}.`;
        }

        wrap.appendChild(plek);
        wrap.appendChild(tekst);

        if (toernooi.finalAo5Ms) {
            const gemiddelde = document.createElement('p');
            gemiddelde.className = 'field__hint';
            gemiddelde.textContent = `Je gemiddelde in de laatste ronde: ${UI.formatTime(toernooi.finalAo5Ms)}`;
            wrap.appendChild(gemiddelde);
        }

        const opnieuw = document.createElement('button');
        opnieuw.className = 'btn btn--primary';
        opnieuw.type = 'button';
        opnieuw.textContent = 'Nog een toernooi';
        opnieuw.addEventListener('click', async () => {
            data.tournament = null;
            render();
        });
        wrap.appendChild(opnieuw);

        return wrap;
    }

    /* --- Uitslagen per ronde -------------------------------------------- */

    function renderStanden(toernooi) {
        const host = document.createElement('div');
        if (!toernooi.rounds || !toernooi.rounds.length) return host;

        // Nieuwste ronde bovenaan.
        toernooi.rounds.slice().reverse().forEach(ronde => {
            const groep = document.createElement('section');
            groep.className = 'achievement-group';

            const kop = document.createElement('h3');
            kop.className = 'achievement-group__name';
            kop.textContent = `${ronde.name} · ${ronde.entrants} deelnemers`;
            groep.appendChild(kop);

            const wrap = document.createElement('div');
            wrap.className = 'board-wrap';
            const tabel = document.createElement('table');
            tabel.className = 'board-table';

            const thead = document.createElement('thead');
            thead.innerHTML = '<tr><th>#</th><th>Cuber</th><th>Ao5</th><th>Beste</th></tr>';
            tabel.appendChild(thead);

            const tbody = document.createElement('tbody');
            ronde.results.forEach(resultaat => {
                const rij = document.createElement('tr');
                if (resultaat.isYou) rij.classList.add('is-me');
                if (resultaat.advanced) rij.classList.add('is-advanced');

                const plek = document.createElement('td');
                plek.className = 'board-position';
                plek.textContent = resultaat.position;

                const naam = document.createElement('td');
                const wrapNaam = document.createElement('div');
                wrapNaam.className = 'board-cuber';
                const tekst = document.createElement('span');
                tekst.className = 'board-cuber__name';
                tekst.textContent = resultaat.name;
                wrapNaam.appendChild(tekst);

                if (resultaat.kind === 'user') {
                    const merk = document.createElement('span');
                    merk.className = 'country-tag';
                    merk.textContent = 'sim';
                    merk.title = 'Een echte gebruiker van de site. Zijn tijden zijn gesimuleerd op zijn niveau; '
                               + 'hij heeft niet echt meegedaan.';
                    wrapNaam.appendChild(merk);
                }
                if (resultaat.country) {
                    const land = document.createElement('span');
                    land.className = 'country-tag';
                    land.textContent = resultaat.country;
                    land.title = UI.countryName(resultaat.country);
                    wrapNaam.appendChild(land);
                }
                naam.appendChild(wrapNaam);

                const gemiddelde = document.createElement('td');
                gemiddelde.className = 'board-time' + (resultaat.ao5Ms === null ? ' board-time--dnf' : '');
                gemiddelde.textContent = resultaat.cut ? 'cutoff' : tijd(resultaat.ao5Ms);

                const beste = document.createElement('td');
                beste.className = 'board-time';
                beste.textContent = tijd(resultaat.bestMs);

                rij.appendChild(plek);
                rij.appendChild(naam);
                rij.appendChild(gemiddelde);
                rij.appendChild(beste);
                tbody.appendChild(rij);
            });

            tabel.appendChild(tbody);
            wrap.appendChild(tabel);
            groep.appendChild(wrap);
            host.appendChild(groep);
        });

        return host;
    }

    /* =====================================================================
     * Acties
     * ================================================================== */

    async function start(event, difficulty, knop) {
        knop.disabled = true;
        try {
            const response = await UI.api('tournament/start.php', { body: { event, difficulty } });
            data.tournament = response.tournament;

            // De scrambles moeten bij het juiste event horen.
            if (api.getActiveSessionEvent() !== event) {
                api.setActiveSessionEvent(event);
            }

            render();
            syncBanner();
            UI.toast('Toernooi gestart. Succes!', { type: 'success' });
        } catch (err) {
            UI.toast(err.message || 'Het toernooi kon niet gestart worden.', { type: 'error' });
        } finally {
            knop.disabled = false;
        }
    }

    async function abandon(tournamentId) {
        const zeker = await UI.ask({
            title: 'Toernooi stoppen?',
            message: 'Je resultaat telt dan niet mee en je kunt niet verder waar je gebleven was.',
            confirmLabel: 'Stoppen',
            danger: true
        });
        if (!zeker) return;

        try {
            await UI.api('tournament/abandon.php', { body: { tournamentId } });
            stopCapture();
            await load();
            UI.toast('Toernooi gestopt.', { type: 'info' });
        } catch (err) {
            UI.toast(err.message || 'Dat is niet gelukt.', { type: 'error' });
        }
    }

    /** Sluit de modal en zet de timer klaar voor de volgende poging. */
    function naarDeTimer(toernooi) {
        UI.closeModal(modal);
        startCapture();
        syncBanner();
        UI.toast(`${toernooi.round.name}, solve ${toernooi.round.attemptsDone + 1} van ${toernooi.round.attemptsTotal}.`,
            { type: 'info' });
    }

    /* =====================================================================
     * Timer: solves opvangen
     * ================================================================== */

    function startCapture() {
        api.setSolveCapture(async entry => {
            if (bezigMetInsturen) return;
            bezigMetInsturen = true;

            try {
                const response = await UI.api('tournament/solve.php', {
                    body: {
                        tournamentId: data.tournament.id,
                        timeMs: entry.raw,
                        penalty: entry.penalty === null ? 'none' : entry.penalty,
                        scramble: entry.scramble || ''
                    }
                });

                data.tournament = response.tournament;

                if (response.roundScored) {
                    stopCapture();
                    // Alleen de historie en de samenvatting verversen. Het
                    // toernooi zelf houden we uit het antwoord: is het net
                    // afgelopen, dan kent de server geen lopend toernooi meer
                    // en zou de uitslag van het scherm verdwijnen.
                    await verversOmheen();
                    render();
                    syncBanner();
                    UI.openModal(modal);
                } else {
                    syncBanner();
                }
            } catch (err) {
                stopCapture();
                UI.toast(err.message || 'Je solve kon niet worden opgeslagen.', { type: 'error' });
                await load(false);
            } finally {
                bezigMetInsturen = false;
            }
        });
    }

    function stopCapture() {
        api.setSolveCapture(null);
    }

    /** Toont of verbergt de balk boven de timer. */
    function syncBanner() {
        const toernooi = data && data.tournament;
        const actief = toernooi && toernooi.status === 'active' && toernooi.round;

        badge.hidden = !actief;
        if (!actief) {
            banner.hidden = true;
            stopCapture();
            return;
        }

        banner.hidden = false;
        bannerTitle.textContent = `${toernooi.eventLabel} · ${toernooi.round.name}`;
        bannerHint.textContent = `Solve ${toernooi.round.attemptsDone + 1} van ${toernooi.round.attemptsTotal}`
            + ` · je tijden tellen niet mee voor je sessie`;
        startCapture();
    }

    /* =====================================================================
     * Koppelen
     * ================================================================== */

    openButton.addEventListener('click', () => {
        UI.openModal(modal);
        render();
        load();
    });

    bannerOpen.addEventListener('click', () => {
        UI.openModal(modal);
        render();
    });

    document.querySelectorAll('[data-close-tournament]').forEach(button => {
        button.addEventListener('click', () => UI.closeModal(modal));
    });
    UI.registerModal(modal);

    window.addEventListener('cubetimer:auth-change', () => {
        data = null;
        stopCapture();
        banner.hidden = true;
        badge.hidden = true;
        if (modal.classList.contains('visible')) load();
    });

    UI.status().then(status => {
        if (status.features?.tournaments !== true) {
            openButton.hidden = true;
            return;
        }
        openButton.hidden = false;
        if (status.authenticated) load(false);
    });

    window.CubeTimerTournament = { load, stopCapture };
})();
