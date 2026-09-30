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
 *
 * Twee soorten toernooi:
 *   Gesimuleerd       bots en gesimuleerde gebruikers op een moeilijkheidsgraad
 *   Historische comp  een echte, afgelopen WCA-competitie: de echte deelnemers
 *                     met hun echte tijden, en de rondes met het echte format,
 *                     de echte cutoff en limiet en (als de WCA ze kent) de
 *                     echte scrambles. Zo zie je waar je daar was geëindigd.
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
    let wcaBeschikbaar = false;
    let startTab = 'sim';
    let wca = { query: '', results: null, featured: true, zoeken: false, comp: null, compLaden: null, fout: null };
    let eigenScramble = false;

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
                toonMelding(err.message || UI.t('Het toernooi kon niet geladen worden.'));
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
        if (poging && poging.penalty === 'dns') return 'DNS';
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
            toonMelding(UI.t('Laden…'));
            return;
        }

        if (data.tournament && data.tournament.status === 'active') {
            subtitle.textContent = data.tournament.competition
                ? UI.t('De echte rondes, tegen de echte tijden van toen. Alleen de besten gaan door.')
                : UI.t('Vijf solves per ronde. Alleen de besten gaan door.');
            body.appendChild(renderActief(data.tournament));
            body.appendChild(renderStanden(data.tournament));
            return;
        }

        if (data.tournament && data.tournament.status !== 'active') {
            body.appendChild(renderAfgerond(data.tournament));
            body.appendChild(renderStanden(data.tournament));
            return;
        }

        subtitle.textContent = startTab === 'wca'
            ? UI.t('Speel een echte comp na, tegen de echte tijden van toen.')
            : UI.t('Vijf solves per ronde, cutoff en tijdslimiet, net als op een echte comp.');
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
                [UI.t('Gespeeld'), s.played], [UI.t('Gewonnen'), s.won],
                [UI.t('Podiums'), s.podiums], [UI.t('Beste plek'), s.bestPosition ? UI.plek(s.bestPosition) : '--']
            ].forEach(([label, waarde]) => {
                const tegel = document.createElement('div');
                tegel.className = 'stat';
                tegel.innerHTML = '<span class="stat__label"></span><span class="stat__value"></span>';
                tegel.querySelector('.stat__label').textContent = label;
                tegel.querySelector('.stat__value').textContent = String(waarde);
                grid.appendChild(tegel);
            });
            wrap.appendChild(grid);
            wrap.appendChild(renderPerSoort(s));
        }

        if (wcaBeschikbaar) {
            const tabs = document.createElement('div');
            tabs.className = 'segmented';
            tabs.setAttribute('role', 'tablist');
            [['sim', UI.t('Gesimuleerd')], ['wca', UI.t('Historische comp')]].forEach(([id, label]) => {
                const tab = document.createElement('button');
                tab.type = 'button';
                tab.className = 'segmented__item' + (startTab === id ? ' is-active' : '');
                tab.setAttribute('role', 'tab');
                tab.setAttribute('aria-selected', String(startTab === id));
                tab.textContent = label;
                tab.addEventListener('click', () => {
                    startTab = id;
                    render();
                    if (id === 'wca' && wca.results === null) zoekWca('');
                });
                tabs.appendChild(tab);
            });
            wrap.appendChild(tabs);
        }

        if (startTab === 'wca' && wcaBeschikbaar) {
            wrap.appendChild(renderWca());
            return wrap;
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
        kop.textContent = UI.t('Moeilijkheid');
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
            veld.textContent = UI.t('Veld van {n}', { n: niveau.fieldSize });

            kaart.appendChild(naam);
            kaart.appendChild(omschrijving);
            kaart.appendChild(veld);
            kaart.addEventListener('click', () => start(select.value, niveau.id, kaart));
            kaarten.appendChild(kaart);
        });
        wrap.appendChild(kaarten);

        const uitleg = document.createElement('p');
        uitleg.className = 'notice';
        uitleg.textContent = UI.t('Je tegenstanders zijn verzonnen cubers, aangevuld met andere gebruikers van de site. Hun tijden worden gesimuleerd op hun eigen niveau; ze doen niet echt mee. Je toernooisolves blijven los van je gewone tijden en krijgen een eigen blok op je profiel.');
        wrap.appendChild(uitleg);

        return wrap;
    }

    /** Beste plek per soort toernooi, en per historische comp. */
    function renderPerSoort(s) {
        const host = document.createElement('div');
        host.className = 'tournament-types';

        const soorten = s.perType || [];
        if (soorten.length) {
            host.appendChild(kleineTabel(UI.t('Per soort toernooi'), [UI.t('Soort'), UI.t('Gespeeld'), UI.t('Podiums'), UI.t('Beste plek')],
                soorten.map(soort => [
                    soort.label, String(soort.played), String(soort.podiums),
                    soort.bestPosition ? UI.plek(soort.bestPosition) : '--'
                ])));
        }

        const comps = s.competitions || [];
        if (comps.length) {
            host.appendChild(kleineTabel(UI.t('Historische comps'), ['Comp', 'Event', UI.t('Beste plek')],
                comps.map(comp => [
                    comp.name || comp.competitionId, comp.eventLabel,
                    comp.bestPosition ? UI.t('{plek} van {n}', { plek: UI.plek(comp.bestPosition), n: comp.fieldSize }) : '--'
                ])));
        }
        return host;
    }

    function kleineTabel(kopTekst, koppen, rijen) {
        const groep = document.createElement('section');
        groep.className = 'achievement-group';
        const kop = document.createElement('h3');
        kop.className = 'achievement-group__name';
        kop.textContent = kopTekst;
        groep.appendChild(kop);

        const wrap = document.createElement('div');
        wrap.className = 'board-wrap';
        const tabel = document.createElement('table');
        tabel.className = 'board-table board-table--compact';
        const thead = document.createElement('thead');
        const kopRij = document.createElement('tr');
        koppen.forEach(tekst => {
            const th = document.createElement('th');
            th.textContent = tekst;
            kopRij.appendChild(th);
        });
        thead.appendChild(kopRij);
        tabel.appendChild(thead);

        const tbody = document.createElement('tbody');
        rijen.forEach(cellen => {
            const rij = document.createElement('tr');
            cellen.forEach((tekst, index) => {
                const td = document.createElement('td');
                if (index === cellen.length - 1) td.className = 'board-time';
                td.textContent = tekst;
                rij.appendChild(td);
            });
            tbody.appendChild(rij);
        });
        tabel.appendChild(tbody);
        wrap.appendChild(tabel);
        groep.appendChild(wrap);
        return groep;
    }

    /* --- Historische comp kiezen ---------------------------------------- */

    function renderWca() {
        const wrap = document.createElement('div');
        wrap.className = 'wca-picker';

        if (wca.comp) {
            wrap.appendChild(renderWcaComp(wca.comp));
            return wrap;
        }

        const formulier = document.createElement('form');
        formulier.className = 'wca-search';
        const invoer = document.createElement('input');
        invoer.className = 'input';
        invoer.type = 'search';
        invoer.id = 'wca-search-input';
        invoer.placeholder = UI.t('Zoek een comp, bijvoorbeeld "Dutch" of "Euro"');
        invoer.value = wca.query;
        invoer.setAttribute('aria-label', UI.t('Zoek een WCA-competitie'));
        const knop = document.createElement('button');
        knop.className = 'btn btn--primary';
        knop.type = 'submit';
        knop.textContent = wca.zoeken ? UI.t('Zoeken…') : UI.t('Zoeken');
        knop.disabled = wca.zoeken;
        formulier.appendChild(invoer);
        formulier.appendChild(knop);
        formulier.addEventListener('submit', event => {
            event.preventDefault();
            zoekWca(invoer.value.trim());
        });
        wrap.appendChild(formulier);

        if (wca.fout) {
            const fout = document.createElement('p');
            fout.className = 'notice';
            fout.textContent = wca.fout;
            wrap.appendChild(fout);
        }

        if (wca.results !== null) {
            const kop = document.createElement('p');
            kop.className = 'field__label';
            kop.textContent = wca.featured ? UI.t('Kampioenschappen') : (wca.results.length ? UI.t('Gevonden') : UI.t('Niets gevonden'));
            wrap.appendChild(kop);

            const lijst = document.createElement('div');
            lijst.className = 'wca-list';
            wca.results.forEach(comp => {
                const kaart = document.createElement('button');
                kaart.type = 'button';
                kaart.className = 'wca-comp';
                kaart.disabled = wca.compLaden !== null;

                const naam = document.createElement('span');
                naam.className = 'wca-comp__name';
                naam.textContent = comp.name;
                const meta = document.createElement('span');
                meta.className = 'wca-comp__meta';
                meta.textContent = wca.compLaden === comp.id
                    ? UI.t('Uitslagen ophalen bij de WCA…')
                    : [comp.city, comp.country ? UI.countryName(comp.country) : '', (comp.startDate || '').slice(0, 10)]
                        .filter(Boolean).join(' · ');
                kaart.appendChild(naam);
                kaart.appendChild(meta);
                kaart.addEventListener('click', () => kiesWca(comp.id));
                lijst.appendChild(kaart);
            });
            wrap.appendChild(lijst);
        }

        const uitleg = document.createElement('p');
        uitleg.className = 'notice';
        uitleg.textContent = UI.t('Je speelt de rondes van een echte comp, met het echte format, de echte cutoff en tijdslimiet, tegen de echte tijden van toen. Eindig je hoog genoeg om bij het aantal te horen dat in het echt doorging, dan ga jij ook door. Zo zie je waar je op die comp was geëindigd.');
        wrap.appendChild(uitleg);
        return wrap;
    }

    function renderWcaComp(comp) {
        const wrap = document.createElement('div');
        wrap.className = 'tournament-start';

        const kop = document.createElement('div');
        kop.className = 'tournament-header';
        kop.innerHTML = '<div><p class="tournament-header__title"></p><p class="tournament-header__sub"></p></div>';
        kop.querySelector('.tournament-header__title').textContent = comp.name;
        kop.querySelector('.tournament-header__sub').textContent =
            [comp.city, comp.country ? UI.countryName(comp.country) : '', comp.startDate].filter(Boolean).join(' · ');
        const terug = document.createElement('button');
        terug.className = 'btn btn--sm';
        terug.type = 'button';
        terug.textContent = UI.t('Andere comp');
        terug.addEventListener('click', () => {
            wca.comp = null;
            render();
        });
        kop.appendChild(terug);
        wrap.appendChild(kop);

        const label = document.createElement('p');
        label.className = 'field__label';
        label.textContent = UI.t('Kies een event');
        wrap.appendChild(label);

        const kaarten = document.createElement('div');
        kaarten.className = 'difficulty-grid';
        comp.events.forEach(event => {
            const kaart = document.createElement('button');
            kaart.className = 'difficulty-card';
            kaart.type = 'button';

            const naam = document.createElement('span');
            naam.className = 'difficulty-card__name';
            naam.textContent = event.label;
            const omschrijving = document.createElement('span');
            omschrijving.className = 'difficulty-card__description';
            omschrijving.textContent = [
                UI.t('{n} deelnemers', { n: event.competitors }),
                event.rounds === 1 ? UI.t('1 ronde') : UI.t('{n} rondes', { n: event.rounds }),
                event.format
            ].join(' · ') + (event.winner
                ? '. ' + (event.winner.resultMs
                    ? UI.t('Gewonnen door {naam} met {tijd}.', { naam: event.winner.name, tijd: UI.formatTime(event.winner.resultMs) })
                    : UI.t('Gewonnen door {naam}.', { naam: event.winner.name }))
                : '');
            const meta = document.createElement('span');
            meta.className = 'difficulty-card__meta';
            meta.textContent = event.officialScrambles ? UI.t('Met de echte scrambles') : UI.t('Met nieuwe scrambles');

            kaart.appendChild(naam);
            kaart.appendChild(omschrijving);
            kaart.appendChild(meta);
            kaart.addEventListener('click', () => start(event.id, null, kaart, comp.id));
            kaarten.appendChild(kaart);
        });
        wrap.appendChild(kaarten);

        const bron = document.createElement('p');
        bron.className = 'field__hint';
        bron.textContent = comp.attribution;
        wrap.appendChild(bron);
        return wrap;
    }

    async function zoekWca(query) {
        wca.query = query;
        wca.zoeken = true;
        wca.fout = null;
        render();
        try {
            const antwoord = await UI.api('tournament/wca-search.php' + (query ? '?q=' + encodeURIComponent(query) : ''));
            wca.results = antwoord.competitions;
            wca.featured = antwoord.featured;
        } catch (err) {
            wca.fout = err.message || UI.t('Zoeken is niet gelukt.');
        } finally {
            wca.zoeken = false;
            if (startTab === 'wca') render();
        }
    }

    async function kiesWca(id) {
        wca.compLaden = id;
        wca.fout = null;
        render();
        try {
            const antwoord = await UI.api('tournament/wca-competition.php?id=' + encodeURIComponent(id));
            wca.comp = antwoord.competition;
        } catch (err) {
            wca.fout = err.message || UI.t('Deze comp kon niet opgehaald worden.');
        } finally {
            wca.compLaden = null;
            if (startTab === 'wca') render();
        }
    }

    function renderHistorie() {
        const groep = document.createElement('section');
        groep.className = 'achievement-group';

        const kop = document.createElement('h3');
        kop.className = 'achievement-group__name';
        kop.textContent = UI.t('Eerder gespeeld');
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
            plek.textContent = item.position === null ? '--' : UI.plek(item.position);

            const wat = document.createElement('td');
            wat.textContent = `${item.eventLabel} · ${item.competitionName || item.difficultyLabel}`
                + (item.status === 'abandoned' ? ' ' + UI.t('(gestopt)') : ' · ' + UI.t('veld van {n}', { n: item.fieldSize }));

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
            `${toernooi.eventLabel} · ${toernooi.competition ? toernooi.competition.name : toernooi.difficultyLabel}`;
        kop.querySelector('.tournament-header__sub').textContent =
            UI.t('Veld van {n}', { n: toernooi.fieldSize }) + ' · '
            + UI.t('ronde {ronde} van {totaal}', { ronde: toernooi.currentRound, totaal: toernooi.totalRounds });

        const stoppen = document.createElement('button');
        stoppen.className = 'btn btn--danger btn--sm';
        stoppen.type = 'button';
        stoppen.textContent = UI.t('Stoppen');
        stoppen.addEventListener('click', () => abandon(toernooi.id));
        kop.appendChild(stoppen);
        wrap.appendChild(kop);

        const ronde = toernooi.round;
        if (!ronde) return wrap;

        const rondeKop = document.createElement('p');
        rondeKop.className = 'tournament-round__name';
        rondeKop.textContent = ronde.name + ' · ' + UI.t('{n} deelnemers', { n: ronde.entrants })
            + ', ' + (ronde.advancing > 0 ? UI.t('{n} gaan door', { n: ronde.advancing }) : UI.t('dit is de finale'))
            + (ronde.formatLabel && ronde.formatLabel !== 'Ao5' ? ` · ${ronde.formatLabel}` : '');
        wrap.appendChild(rondeKop);

        // De vijf pogingen
        const pogingen = document.createElement('div');
        pogingen.className = 'attempt-row';
        pogingen.style.setProperty('--attempts', String(ronde.attemptsTotal));
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
            delen.push(ronde.cutoffAttempts === 1
                ? UI.t('Cutoff {tijd}: haal je die niet in je eerste solve, dan stopt je ronde daar.', { tijd: UI.formatTime(ronde.cutoffMs) })
                : UI.t('Cutoff {tijd}: haal je die niet in {n} solves, dan stopt je ronde daar.', { tijd: UI.formatTime(ronde.cutoffMs), n: ronde.cutoffAttempts || 2 }));
        }
        if (ronde.timeLimitMs && ronde.limitCumulative) {
            const over = Math.max(0, ronde.timeLimitMs - (ronde.limitUsedMs || 0));
            delen.push(UI.t('Tijdslimiet {tijd} voor alle pogingen samen; je hebt nog {over}.', { tijd: UI.formatTime(ronde.timeLimitMs), over: UI.formatTime(over) }));
        } else if (ronde.timeLimitMs) {
            delen.push(UI.t('Tijdslimiet {tijd}: daarboven is het een DNF.', { tijd: UI.formatTime(ronde.timeLimitMs) }));
        }
        if (ronde.scramble) {
            delen.push(UI.t('Je krijgt de echte scrambles van deze ronde.'));
        }
        regels.textContent = delen.join(' ');
        wrap.appendChild(regels);

        const knop = document.createElement('button');
        knop.className = 'btn btn--primary btn--block';
        knop.type = 'button';
        knop.textContent = ronde.attemptsDone === 0
            ? UI.t('Begin met solve 1')
            : UI.t('Doe solve {n}', { n: ronde.attemptsDone + 1 });
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
        plek.textContent = toernooi.finalPosition === null ? '--' : UI.plek(toernooi.finalPosition);

        const tekst = document.createElement('p');
        tekst.className = 'tournament-result__text';
        if (toernooi.status === 'abandoned') {
            tekst.textContent = UI.t('Je bent met dit toernooi gestopt.');
        } else if (toernooi.competition) {
            tekst.textContent = toernooi.finalPosition === 1
                ? UI.t('Je had {comp} gewonnen!', { comp: toernooi.competition.name })
                : UI.t('Op {comp} was je {plek} geworden van {n}.', { comp: toernooi.competition.name, plek: UI.plek(toernooi.finalPosition), n: toernooi.fieldSize });
        } else if (toernooi.finalPosition === 1) {
            tekst.textContent = UI.t('Gewonnen! Eerste van {n} op {niveau}.', { n: toernooi.fieldSize, niveau: toernooi.difficultyLabel });
        } else if (toernooi.finalPosition <= 3) {
            tekst.textContent = UI.t('Op het podium: {plek} van {n}.', { plek: UI.plek(toernooi.finalPosition), n: toernooi.fieldSize });
        } else {
            tekst.textContent = UI.t('Je eindigde als {plek} van {n}.', { plek: UI.plek(toernooi.finalPosition), n: toernooi.fieldSize });
        }

        wrap.appendChild(plek);
        wrap.appendChild(tekst);

        if (toernooi.finalAo5Ms) {
            const gemiddelde = document.createElement('p');
            gemiddelde.className = 'field__hint';
            gemiddelde.textContent = UI.t('Je gemiddelde in de laatste ronde: {tijd}', { tijd: UI.formatTime(toernooi.finalAo5Ms) });
            wrap.appendChild(gemiddelde);
        }

        if (toernooi.competition) {
            const bron = document.createElement('p');
            bron.className = 'field__hint';
            bron.textContent = toernooi.competition.attribution;
            wrap.appendChild(bron);
        }

        const opnieuw = document.createElement('button');
        opnieuw.className = 'btn btn--primary';
        opnieuw.type = 'button';
        opnieuw.textContent = UI.t('Nog een toernooi');
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
            kop.textContent = ronde.name + ' · ' + UI.t('{n} deelnemers', { n: ronde.entrants });
            groep.appendChild(kop);

            const wrap = document.createElement('div');
            wrap.className = 'board-wrap';
            const tabel = document.createElement('table');
            tabel.className = 'board-table';

            // Bij best of telt alleen de single; dan is er geen kolom voor een gemiddelde.
            const metGemiddelde = !ronde.format || ronde.format === 'a' || ronde.format === 'm';
            const thead = document.createElement('thead');
            thead.innerHTML = '<tr><th>#</th><th>Cuber</th>' + (metGemiddelde ? '<th></th>' : '') + '<th>' + UI.t('Beste') + '</th></tr>';
            if (metGemiddelde) thead.querySelectorAll('th')[2].textContent = ronde.formatLabel || 'Ao5';
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
                const tekst = document.createElement(resultaat.wcaId ? 'a' : 'span');
                tekst.className = 'board-cuber__name';
                tekst.textContent = resultaat.name;
                if (resultaat.wcaId) {
                    tekst.href = 'https://www.worldcubeassociation.org/persons/' + encodeURIComponent(resultaat.wcaId);
                    tekst.target = '_blank';
                    tekst.rel = 'noopener noreferrer';
                    tekst.title = UI.t('WCA-profiel van {naam}', { naam: resultaat.name });
                }
                wrapNaam.appendChild(tekst);

                if (resultaat.kind === 'user') {
                    const merk = document.createElement('span');
                    merk.className = 'country-tag';
                    merk.textContent = 'sim';
                    merk.title = UI.t('Een echte gebruiker van de site. De tijden zijn gesimuleerd op zijn of haar niveau; deze cuber heeft niet echt meegedaan.');
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
                if (metGemiddelde) rij.appendChild(gemiddelde);
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

    async function start(event, difficulty, knop, competitionId) {
        if (window.CubeTimerGames?.isRunning?.()) {
            UI.toast(UI.t('Maak eerst je spelmodus of duel af.'), { type: 'warning' });
            return;
        }
        knop.disabled = true;
        try {
            const verzoek = competitionId ? { event, competitionId } : { event, difficulty };
            const response = await UI.api('tournament/start.php', { body: verzoek });
            data.tournament = response.tournament;

            // De scrambles moeten bij het juiste event horen.
            if (api.getActiveSessionEvent() !== event) {
                api.setActiveSessionEvent(event);
            }

            render();
            syncBanner();
            UI.toast(UI.t('Toernooi gestart. Succes!'), { type: 'success' });
        } catch (err) {
            UI.toast(err.message || UI.t('Het toernooi kon niet gestart worden.'), { type: 'error' });
        } finally {
            knop.disabled = false;
        }
    }

    async function abandon(tournamentId) {
        const zeker = await UI.ask({
            title: UI.t('Toernooi stoppen?'),
            message: UI.t('Je resultaat telt dan niet mee en je kunt niet verder waar je gebleven was.'),
            confirmLabel: UI.t('Stoppen'),
            danger: true
        });
        if (!zeker) return;

        try {
            await UI.api('tournament/abandon.php', { body: { tournamentId } });
            stopCapture();
            await load();
            UI.toast(UI.t('Toernooi gestopt.'), { type: 'info' });
        } catch (err) {
            UI.toast(err.message || UI.t('Dat is niet gelukt.'), { type: 'error' });
        }
    }

    /** Sluit de modal en zet de timer klaar voor de volgende poging. */
    function naarDeTimer(toernooi) {
        UI.closeModal(modal);
        startCapture();
        syncBanner();
        UI.toast(UI.t('{ronde}, solve {n} van {totaal}.', { ronde: toernooi.round.name, n: toernooi.round.attemptsDone + 1, totaal: toernooi.round.attemptsTotal }),
            { type: 'info' });
    }

    /* =====================================================================
     * Timer: solves opvangen
     * ================================================================== */

    function startCapture() {
        // Loopt er een spelmodus, dan wacht het toernooi tot die klaar is.
        if (api.getSolveCaptureOwner?.() === 'spelmodus') return;

        // De echte scramble van deze poging, bij een historische comp.
        const scramble = data?.tournament?.round?.scramble || null;
        if (scramble) {
            window.CubeTimerChallenges?.stopChallenge?.();
            api.setScrambleOverride(scramble);
            eigenScramble = true;
        } else if (eigenScramble) {
            api.setScrambleOverride(null);
            eigenScramble = false;
        }

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
                // Meteen de volgende echte scramble klaarzetten.
                const volgende = response.tournament?.round?.scramble;
                if (volgende && eigenScramble) api.setScrambleOverride(volgende);

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
                UI.toast(err.message || UI.t('Je solve kon niet worden opgeslagen.'), { type: 'error' });
                await load(false);
            } finally {
                bezigMetInsturen = false;
            }
        }, 'toernooi');
    }

    function stopCapture() {
        if (api.getSolveCaptureOwner?.() === 'toernooi') api.setSolveCapture(null);
        if (eigenScramble) {
            api.setScrambleOverride(null);
            eigenScramble = false;
        }
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
        bannerHint.textContent = UI.t('Solve {n} van {totaal}', { n: toernooi.round.attemptsDone + 1, totaal: toernooi.round.attemptsTotal })
            + ' · ' + UI.t('je tijden tellen niet mee voor je sessie');
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
        wcaBeschikbaar = status.features?.wcaTournaments === true;
        if (status.authenticated) load(false);
    });

    window.CubeTimerTournament = {
        load,
        stopCapture,
        isActive: () => Boolean(data && data.tournament && data.tournament.status === 'active')
    };
})();
