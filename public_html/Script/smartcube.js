/**
 * CubeTimer - smart cube
 * ---------------------------------------------------------------------------
 * De knop in de balk, het venster om te verbinden, de hulpregel onder de
 * scramble, en de koppeling met de timer:
 *
 *   scramble klaar            → inspectie start (als die aanstaat)
 *   eerste draai daarna       → timer start
 *   cube opgelost             → timer stopt, met de tijd van de klok in de
 *                               cube en een analyse (zetten, TPS, fases)
 *
 * Het praten met de cube staat in smartcube-protocols.js, het rekenwerk in
 * smartcube-engine.js. Die worden pas geladen als je het venster opent: wie
 * geen smart cube heeft, hoeft ze ook niet te downloaden. cube.js en aes.js
 * gaan mee.
 *
 * De analyse in het solve-venster staat ook hier, en werkt ook zonder
 * Bluetooth: een solve met een smart cube op je laptop wil je ook op je
 * telefoon kunnen teruglezen.
 */
(function () {
    'use strict';

    const UI = window.CubeTimerUI;
    const api = window.cubeTimerApi;
    if (!UI || !api) return;

    const $ = id => document.getElementById(id);

    /* =====================================================================
     * Analyse in het solve-venster
     * ================================================================== */

    const FASE_NAMEN = { cross: 'Kruis', f2l: 'F2L', oll: 'OLL', pll: 'PLL' };
    const KLEUR_NAMEN = { U: 'wit', D: 'geel', F: 'groen', B: 'blauw', R: 'rood', L: 'oranje' };
    const getal = (n, decimalen = 2) => Number(n).toLocaleString('nl-NL', {
        minimumFractionDigits: decimalen,
        maximumFractionDigits: decimalen
    });

    function escapeHtml(tekst) {
        return String(tekst).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function renderAnalysis(container, analysis) {
        if (!container) return;
        if (!analysis || typeof analysis !== 'object') {
            container.hidden = true;
            container.innerHTML = '';
            return;
        }
        const fases = Array.isArray(analysis.phases) ? analysis.phases : [];
        const totaal = fases.reduce((s, f) => s + (f.ms || 0), 0);

        const balk = totaal > 0 ? `
            <div class="solve-analysis__bar" role="img" aria-label="Verdeling van de tijd over de fases">
                ${fases.map(f => `<span class="solve-analysis__seg solve-analysis__seg--${escapeHtml(f.key)}"
                    style="flex-grow:${Math.max(f.ms, 1)}" title="${escapeHtml(FASE_NAMEN[f.key] || f.key)}"></span>`).join('')}
            </div>` : '';

        const rijen = fases.map(f => `
            <tr>
                <th scope="row"><span class="solve-analysis__key solve-analysis__key--${escapeHtml(f.key)}"></span>${escapeHtml(FASE_NAMEN[f.key] || f.key)}</th>
                <td>${escapeHtml(UI.formatTime ? UI.formatTime(f.ms) : api.formatTime(f.ms))}</td>
                <td>${Number(f.moves) || 0} ${Number(f.moves) === 1 ? 'zet' : 'zetten'}</td>
            </tr>`).join('');

        const kruis = analysis.crossFace && KLEUR_NAMEN[analysis.crossFace]
            ? ` · kruis op ${KLEUR_NAMEN[analysis.crossFace]}` : '';

        container.innerHTML = `
            <span class="field__label">Smart cube</span>
            <p class="solve-analysis__headline">
                <strong>${Number(analysis.moves) || 0}</strong> zetten ·
                <strong>${getal(analysis.tps || 0)}</strong> per seconde${kruis}
            </p>
            ${balk}
            ${rijen ? `<table class="solve-analysis__table"><tbody>${rijen}</tbody></table>` : ''}
            ${analysis.solution ? `<details class="solve-analysis__solution"><summary>Oplossing</summary><p>${escapeHtml(analysis.solution)}</p></details>` : ''}
        `;
        container.hidden = false;
    }

    window.addEventListener('cubetimer:solve-open', event => {
        renderAnalysis($('modal-analysis'), event.detail && event.detail.solve && event.detail.solve.analysis);
    });

    /* =====================================================================
     * Zonder Web Bluetooth: geen knop. De analyse hierboven werkt wel.
     * ================================================================== */

    const knop = $('smartcube-open');
    const modal = $('smartcube-modal');
    if (!knop || !modal || !navigator.bluetooth) return;
    knop.hidden = false;

    /* =====================================================================
     * Scripts pas laden als het nodig is
     * ================================================================== */

    // Per bestand de naam die het achterlaat, zodat we weten of het al klaar is.
    const BIBLIOTHEKEN = [
        ['Script/vendor/aes.js', 'aesjs'],
        ['Script/cube.js', 'CubeTimerCube'],
        ['Script/smartcube-protocols.js', 'CubeTimerSmartCube'],
        ['Script/smartcube-engine.js', 'CubeTimerSmartEngine']
    ];
    let geladen = null;

    function laad() {
        if (!geladen) {
            geladen = BIBLIOTHEKEN.reduce((eerder, [src, naam]) => eerder.then(() => new Promise((klaar, mislukt) => {
                if (window[naam]) {
                    klaar();
                    return;
                }
                const bestaand = document.querySelector(`script[src="${src}"]`);
                if (bestaand) {
                    // Wordt al geladen (bijvoorbeeld cube.js door de oefenknop).
                    bestaand.addEventListener('load', () => klaar(), { once: true });
                    bestaand.addEventListener('error', () => mislukt(new Error('Kon ' + src + ' niet laden')), { once: true });
                    return;
                }
                const el = document.createElement('script');
                el.src = src;
                el.onload = () => klaar();
                el.onerror = () => mislukt(new Error('Kon ' + src + ' niet laden'));
                document.head.appendChild(el);
            })), Promise.resolve()).catch(err => {
                geladen = null;
                throw err;
            });
        }
        return geladen;
    }

    /* =====================================================================
     * Toestand
     * ================================================================== */

    const MAC_KEY = 'cubetimer_cube_macs';

    let conn = null;           // de open verbinding, of null
    let tracker = null;        // CubeTimerSmartEngine.Tracker
    let beginGehad = false;    // eerste stand van de cube ontvangen?
    let wijStartten = false;   // draait de timer omdat de cube hem startte?
    let batterij = null;
    let achterkant = false;
    let macVraag = null;       // { klaar } van een openstaande vraag om het adres
    let verbindenBezig = false;

    const opgeslagenMacs = () => UI.storage.get(MAC_KEY, {}) || {};

    function bewaarMac(naam, mac) {
        if (!naam || !mac) return;
        const alle = opgeslagenMacs();
        if (alle[naam] === mac) return;
        alle[naam] = mac;
        UI.storage.set(MAC_KEY, alle);
    }

    function vergeetMac(naam) {
        const alle = opgeslagenMacs();
        if (!(naam in alle)) return;
        delete alle[naam];
        UI.storage.set(MAC_KEY, alle);
    }

    const is333 = () => api.getState().activeEvent === '333';

    /* =====================================================================
     * Het venster
     * ================================================================== */

    function toonView(naam) {
        modal.querySelectorAll('[data-sc-view]').forEach(el => { el.hidden = el.dataset.scView !== naam; });
        const titels = {
            idle: 'Verbind je smart cube',
            busy: 'Verbinden…',
            mac: 'Nog één ding nodig',
            connected: 'Verbonden'
        };
        $('smartcube-title').textContent = titels[naam] || 'Smart cube';
        $('smartcube-subtitle').hidden = naam !== 'idle';
    }

    function toonFout(tekst) {
        const el = $('smartcube-error');
        el.textContent = tekst || '';
        el.hidden = !tekst;
    }

    const STAPPEN = ['kiezen', 'mac-zoeken', 'verbinden', 'stand'];
    function toonStap(stap) {
        const nu = STAPPEN.indexOf(stap);
        modal.querySelectorAll('[data-sc-step]').forEach(li => {
            const i = STAPPEN.indexOf(li.dataset.scStep);
            li.classList.toggle('is-done', i < nu);
            li.classList.toggle('is-active', i === nu);
        });
    }

    function zetKnopStand(stand) {
        knop.dataset.state = stand;
        const teksten = { off: 'Smart cube', busy: 'Smart cube: verbinden…', on: 'Smart cube verbonden' };
        knop.title = teksten[stand] || 'Smart cube';
    }

    function openVenster() {
        UI.openModal(modal);
        if (!conn && !verbindenBezig) toonView('idle');
        laad().catch(() => toonFout('De smart-cubeonderdelen konden niet geladen worden. Ververs de pagina.'));
    }

    function sluitVenster() {
        UI.closeModal(modal);
    }

    UI.registerModal && UI.registerModal(modal, sluitVenster);
    knop.addEventListener('click', openVenster);
    modal.querySelectorAll('[data-close-smartcube]').forEach(b => b.addEventListener('click', sluitVenster));

    /* =====================================================================
     * De 3D-cube: isometrisch, in SVG, met de kleuren uit het thema
     * ================================================================== */

    // Zoals een WCA-scramble: wit boven, groen voor.
    const KLEUR = { U: 'white', D: 'yellow', F: 'green', B: 'blue', R: 'red', L: 'orange' };
    const COS = Math.cos(Math.PI / 6);
    const SIN = 0.5;

    function projecteer(x, y, z) {
        return [(x - z) * COS, (x + z) * SIN - y];
    }

    /** Een vlakje als veelhoek. `hoek(a, b)` geeft het 3D-punt bij (a, b) in [0, 1]. */
    function vlakje(hoek, kleur) {
        const marge = 0.06;
        const punten = [[marge, marge], [1 - marge, marge], [1 - marge, 1 - marge], [marge, 1 - marge]]
            .map(([a, b]) => projecteer(...hoek(a, b)))
            .map(([px, py]) => `${(px * 30 + 100).toFixed(1)},${(py * 30 + 100).toFixed(1)}`)
            .join(' ');
        return `<polygon points="${punten}" fill="var(--cube-${KLEUR[kleur]})" />`;
    }

    function tekenKubus(state) {
        const Cube = window.CubeTimerCube;
        if (!Cube || !state) return '';
        const s = achterkant ? Cube.apply(state, 'x2 y') : state;
        const delen = [];
        // Boven: rij 0 is achter, kolom 0 is links. Hoogte 1,5.
        for (let r = 0; r < 3; r += 1) {
            for (let c = 0; c < 3; c += 1) {
                delen.push(vlakje((a, b) => [c - 1.5 + a, 1.5, r - 1.5 + b], Cube.colorAt(s, 'U', r, c)));
            }
        }
        // Voor: z = 1,5, rij 0 boven.
        for (let r = 0; r < 3; r += 1) {
            for (let c = 0; c < 3; c += 1) {
                delen.push(vlakje((a, b) => [c - 1.5 + a, 1.5 - r - b, 1.5], Cube.colorAt(s, 'F', r, c)));
            }
        }
        // Rechts: x = 1,5, kolom 0 is voor.
        for (let r = 0; r < 3; r += 1) {
            for (let c = 0; c < 3; c += 1) {
                delen.push(vlakje((a, b) => [1.5, 1.5 - r - b, 1.5 - c - a], Cube.colorAt(s, 'R', r, c)));
            }
        }
        return `<svg viewBox="15 5 170 190" class="smartcube-svg">
            <polygon class="smartcube-svg__body" points="${[
                projecteer(-1.5, 1.5, -1.5), projecteer(1.5, 1.5, -1.5), projecteer(1.5, -1.5, -1.5),
                projecteer(1.5, -1.5, 1.5), projecteer(-1.5, -1.5, 1.5), projecteer(-1.5, 1.5, 1.5)
            ].map(([x, y]) => `${(x * 30 + 100).toFixed(1)},${(y * 30 + 100).toFixed(1)}`).join(' ')}" />
            ${delen.join('')}
        </svg>`;
    }

    /* =====================================================================
     * Bijwerken van alles wat je ziet
     * ================================================================== */

    const scrambleBox = $('Scrambles');
    const stage = $('smartcube-stage');

    function statusTekst(p) {
        if (!beginGehad) return ['Verbonden', 'Even de stand van de cube ophalen…'];
        if (!is333()) return ['Alleen voor 3x3', 'Kies een 3x3-sessie om met je smart cube te timen.'];
        if (p.phase === 'solving') return ['Solve loopt', 'De timer stopt vanzelf als de cube opgelost is.'];
        if (!p.total) return ['Wacht op scramble', 'Zodra de scramble er is, kun je beginnen.'];
        switch (p.status) {
            case 'klaar': return ['Klaar', 'Je eerste draai start de timer.'];
            case 'afwijking': return ['Klopt niet meer', 'Draai je laatste zetten terug, of los de cube op en begin opnieuw.'];
            case 'eerst-oplossen': return ['Eerst oplossen', 'De cube is niet opgelost. Los hem op, dan kun je scramblen.'];
            case 'bezig': return ['Scramble ' + p.done + ' van ' + p.total, p.half ? 'Nog een kwartslag voor deze zet.' : 'Ga zo door.'];
            default: return ['Scramble', 'Volg de scramble op je cube.'];
        }
    }

    function tekenScramble(p) {
        if (!scrambleBox || scrambleBox.classList.contains('is-loading')) return;
        if (!conn || !p || !p.total || !is333()) {
            // Terug naar gewone tekst als er niets te volgen is.
            if (scrambleBox.querySelector('.sc-move')) scrambleBox.textContent = window.currentScramble || scrambleBox.textContent;
            return;
        }
        const klaar = p.phase === 'solving' || p.status === 'klaar';
        scrambleBox.innerHTML = p.tokens.map((zet, i) => {
            let klasse = 'sc-move';
            if (klaar || i < p.done) klasse += ' is-done';
            else if (i === p.done) klasse += p.status === 'afwijking' ? ' is-wrong' : ' is-next';
            if (i === p.done && p.half) klasse += ' is-half';
            return `<span class="${klasse}">${escapeHtml(zet)}</span>`;
        }).join(' ');
    }

    function werkBij() {
        const verbonden = Boolean(conn);
        zetKnopStand(verbindenBezig ? 'busy' : verbonden ? 'on' : 'off');

        if (stage) stage.hidden = !verbonden;
        if (!verbonden || !tracker) {
            tekenScramble(null);
            return;
        }

        const p = tracker.progress;
        const [titel, hint] = statusTekst(p);
        $('smartcube-stage-title').textContent = titel;
        $('smartcube-stage-hint').textContent = hint;
        const pct = p.total ? Math.round(((p.done + (p.half ? 0.5 : 0)) / p.total) * 100) : 0;
        $('smartcube-stage-progress').style.width = (p.phase === 'solving' ? 100 : pct) + '%';
        stage.dataset.status = p.phase === 'solving' ? 'solving' : p.status || 'wacht';
        $('smartcube-stage-cube').innerHTML = tekenKubus(tracker.state);
        tekenScramble(p);

        // In het venster
        $('smartcube-cube').innerHTML = tekenKubus(tracker.state);
        $('smartcube-state').textContent = !beginGehad ? 'ophalen…' : tracker.isSolved ? 'Opgelost' : p.phase === 'solving' ? 'Bezig met solve' : 'Door elkaar';
        $('smartcube-event-hint').hidden = is333();
    }

    function werkBatterijBij() {
        $('smartcube-battery').textContent = batterij === null ? '--' : batterij + '%';
        const balk = $('smartcube-battery-bar');
        balk.style.width = (batterij || 0) + '%';
        balk.dataset.laag = batterij !== null && batterij <= 15 ? 'true' : 'false';
        knop.style.setProperty('--sc-battery', (batterij || 0) + '%');
    }

    /* =====================================================================
     * Gebeurtenissen van de cube
     * ================================================================== */

    function beginStand(facelets) {
        tracker.reset(facelets);
        tracker.setScramble(is333() ? window.currentScramble || '' : '');
        beginGehad = true;
        toonStap('stand');
    }

    function opZet(data) {
        if (!tracker) return;
        if (!beginGehad) {
            // Cubes zonder eigen stand (oude MoYu) gaan uit van opgelost.
            beginStand(null);
        }

        // Stopte iemand de timer met de spatiebalk, dan hoort de solve daar ook bij.
        if (tracker.phase === 'solving' && !api.getState().running) {
            tracker.cancelSolve();
            wijStartten = false;
        }

        const uit = tracker.applyMove(data);
        if (uit.start && is333()) {
            wijStartten = api.startTimerFromBluetooth();
        }
        if (uit.solved) {
            if (wijStartten && api.getState().running) {
                api.stopTimerFromBluetooth({ ms: uit.ms, analysis: uit.analysis || undefined });
            }
            wijStartten = false;
        }
        if (tracker.progress.status === 'klaar' && tracker.phase === 'armed') startInspectie();
        werkBij();
    }

    let inspectieVoorScramble = null;
    function startInspectie() {
        if (!api.getSetting('inspection') || !is333()) return;
        // Eén keer per scramble, niet bij elke zet daarna.
        if (inspectieVoorScramble === window.currentScramble) return;
        inspectieVoorScramble = window.currentScramble;
        api.startInspectionFromBluetooth();
    }

    function opStand(facelets) {
        if (!tracker) return;
        if (!beginGehad) {
            beginStand(facelets);
            if (conn && conn.mac && conn.mac.mac) bewaarMac(conn.name, conn.mac.mac);
            werkBij();
            return;
        }
        const r = tracker.syncFacelets(facelets);
        if (r === 'solved' && wijStartten && api.getState().running) {
            // Laatste zet niet ontvangen, maar de cube zegt zelf: opgelost.
            api.stopTimerFromBluetooth({});
            tracker.cancelSolve();
            wijStartten = false;
        }
        if (r) werkBij();
    }

    function opGebeurtenis(type, data) {
        if (type === 'move') opZet(data);
        else if (type === 'facelets') opStand(data.facelets);
        else if (type === 'battery') {
            batterij = data.level;
            werkBatterijBij();
            if (conn && conn.mac && conn.mac.mac) bewaarMac(conn.name, conn.mac.mac);
        } else if (type === 'hardware' && data.name) {
            $('smartcube-name').textContent = conn ? conn.name + ' (' + data.name + ')' : data.name;
        } else if (type === 'keyError') opSleutelfout(data.reason);
        else if (type === 'disconnect') verbreek('De cube heeft de verbinding verbroken.');
    }

    /** Verkeerd MAC-adres: vragen om het juiste, zonder opnieuw te verbinden. */
    let sleutelfoutBezig = false;
    async function opSleutelfout(reden) {
        if (!conn || !conn.needsMac || sleutelfoutBezig || beginGehad) return;
        sleutelfoutBezig = true;
        vergeetMac(conn.name);
        UI.openModal(modal);
        const mac = await vraagMac({
            naam: conn.name,
            reden: 'verkeerd',
            voorstel: conn.mac && conn.mac.mac
        });
        sleutelfoutBezig = false;
        if (!mac || !conn) {
            verbreek('Verbinding gestopt: zonder het juiste MAC-adres kan de cube niet praten.');
            return;
        }
        toonView('busy');
        toonStap('stand');
        await conn.setMac(mac);
        console.info('[smartcube] opnieuw geprobeerd met ' + mac + ' (' + reden + ')');
    }

    /* =====================================================================
     * Het MAC-adres vragen
     * ================================================================== */

    function vraagMac({ naam, reden, voorstel }) {
        toonView('mac');
        const lead = $('smartcube-mac-lead');
        lead.textContent = reden === 'verkeerd'
            ? `Het MAC-adres ${voorstel ? '(' + voorstel + ') ' : ''}werkt niet voor ${naam}. Vul het juiste adres in.`
            : `${naam} versleutelt wat hij stuurt met zijn eigen MAC-adres, en dat kan de browser niet zelf uitlezen. Vul het één keer in.`;
        const input = $('smartcube-mac-input');
        input.value = '';
        $('smartcube-mac-error').textContent = '';
        window.requestAnimationFrame(() => input.focus());
        return new Promise(klaar => { macVraag = { klaar }; });
    }

    function beantwoordMac(waarde) {
        const vraag = macVraag;
        macVraag = null;
        if (vraag) vraag.klaar(waarde);
    }

    // Tijdens het typen de dubbele punten er zelf tussen zetten.
    $('smartcube-mac-input').addEventListener('input', event => {
        const hex = event.target.value.replace(/[^0-9a-f]/gi, '').toUpperCase().slice(0, 12);
        event.target.value = hex.match(/.{1,2}/g)?.join(':') || '';
    });

    $('smartcube-mac-form').addEventListener('submit', event => {
        event.preventDefault();
        const waarde = $('smartcube-mac-input').value.trim();
        const Smart = window.CubeTimerSmartCube;
        if (!Smart || !Smart.parseMac(waarde)) {
            $('smartcube-mac-error').textContent = 'Dat is geen MAC-adres. Het ziet eruit als AB:12:34:CD:56:EF.';
            return;
        }
        toonView('busy');
        beantwoordMac(Smart.formatMac(Smart.parseMac(waarde)));
    });

    $('smartcube-mac-cancel').addEventListener('click', () => beantwoordMac(null));

    /* =====================================================================
     * Verbinden en verbreken
     * ================================================================== */

    function uitlegFout(err) {
        const naam = err && err.name;
        const tekst = String(err && err.message || err || '');
        if (naam === 'NotFoundError' && /cancel/i.test(tekst)) return null;          // zelf geannuleerd
        if (naam === 'NotFoundError') return 'Geen cube gevonden. Staat hij aan en is hij niet met een andere app of tab verbonden?';
        if (naam === 'SecurityError') return 'De browser staat Bluetooth hier niet toe. Het werkt alleen via https.';
        if (naam === 'NetworkError') return 'De verbinding viel weg tijdens het verbinden. Draai even aan de cube en probeer het opnieuw.';
        if (/user gesture/i.test(tekst)) return 'De browser wil dat je nog een keer op Verbinden klikt.';
        return tekst || 'Verbinden is niet gelukt.';
    }

    async function verbind() {
        const Smart = window.CubeTimerSmartCube;
        const Engine = window.CubeTimerSmartEngine;
        if (!Smart || !Engine) {
            toonFout('Even geduld, de onderdelen worden nog geladen. Klik zo nog een keer.');
            laad().catch(() => {});
            return;
        }
        if (verbindenBezig || conn) return;

        toonFout('');
        verbindenBezig = true;
        beginGehad = false;
        batterij = null;
        tracker = new Engine.Tracker();
        toonView('busy');
        toonStap('kiezen');
        werkBij();

        try {
            // Rechtstreeks vanuit de klik: anders weigert Chrome het venster.
            conn = await Smart.connect({
                emit: (type, data) => {
                    try { opGebeurtenis(type, data); } catch (err) { console.error('[smartcube]', err); }
                },
                status: stap => toonStap(stap),
                storedMac: naam => opgeslagenMacs()[naam] || null,
                askMac: ({ naam, reden, voorstel }) => vraagMac({ naam, reden, voorstel }),
                log: tekst => console.debug(tekst)
            });
            conn.device.addEventListener('gattserverdisconnected', () => verbreek('De verbinding met de cube is weggevallen.'), { once: true });

            $('smartcube-name').textContent = conn.name;
            $('smartcube-protocol').textContent = conn.protocol;
            $('smartcube-solved').hidden = !(conn.canReset || !conn.reportsState);
            $('smartcube-change-mac').hidden = !conn.needsMac;
            werkBatterijBij();
            conn.request('battery');
            toonView('connected');
            UI.toast(conn.name + ' is verbonden.', { type: 'success' });
        } catch (err) {
            if (conn) {
                try { await conn.close(); } catch (e) { /* al weg */ }
            }
            conn = null;
            tracker = null;
            const uitleg = uitlegFout(err);
            toonView('idle');
            toonFout(uitleg);
            if (uitleg) console.warn('[smartcube] verbinden mislukt:', err);
        } finally {
            verbindenBezig = false;
            werkBij();
        }
    }

    async function verbreek(melding) {
        if (!conn) return;
        const oud = conn;
        conn = null;
        beantwoordMac(null);
        if (tracker && tracker.phase === 'solving') tracker.cancelSolve();
        tracker = null;
        wijStartten = false;
        try { await oud.close(); } catch (err) { /* al weg */ }
        try { if (oud.device && oud.device.gatt && oud.device.gatt.connected) oud.device.gatt.disconnect(); } catch (err) { /* al weg */ }
        toonView('idle');
        toonFout('');
        werkBij();
        if (melding) UI.toast(melding, { type: 'info' });
    }

    $('smartcube-connect').addEventListener('click', verbind);
    $('smartcube-disconnect').addEventListener('click', () => verbreek('Smart cube losgekoppeld.'));

    $('smartcube-solved').addEventListener('click', async () => {
        if (!conn || !tracker) return;
        if (conn.canReset) {
            try { await conn.reset(); } catch (err) { /* de cube stuurt straks toch zijn stand */ }
        }
        tracker.reset(null);
        tracker.setScramble(is333() ? window.currentScramble || '' : '');
        werkBij();
        UI.toast('De stand staat weer op opgelost.', { type: 'success' });
    });

    $('smartcube-change-mac').addEventListener('click', async () => {
        if (!conn) return;
        const mac = await vraagMac({ naam: conn.name, reden: 'wijzigen', voorstel: conn.mac && conn.mac.mac });
        if (!mac || !conn) {
            toonView(conn ? 'connected' : 'idle');
            return;
        }
        vergeetMac(conn.name);
        beginGehad = false;
        await conn.setMac(mac);
        toonView('connected');
    });

    $('smartcube-flip').addEventListener('click', event => {
        achterkant = !achterkant;
        event.currentTarget.setAttribute('aria-pressed', achterkant ? 'true' : 'false');
        event.currentTarget.textContent = achterkant ? 'Voorkant' : 'Achterkant';
        werkBij();
    });

    /* =====================================================================
     * Signalen van de rest van de site
     * ================================================================== */

    window.addEventListener('cubetimer:scramble-change', event => {
        if (!tracker) return;
        const is3 = (event.detail && event.detail.eventType) === '333';
        tracker.setScramble(is3 ? event.detail.scramble || '' : '');
        werkBij();
    });

    window.addEventListener('cubetimer:event-change', () => {
        if (!tracker) return;
        tracker.setScramble(is333() ? window.currentScramble || '' : '');
        werkBij();
    });

    // Een nieuwe solve (ook met de spatiebalk) maakt een eventuele halve
    // smart-cubesolve ongeldig.
    window.addEventListener('cubetimer:solve', () => {
        if (tracker && tracker.phase === 'solving' && !api.getState().running) {
            tracker.cancelSolve();
            wijStartten = false;
            werkBij();
        }
    });

    // Tab dicht of pagina weg: netjes loskoppelen, anders blijft de cube bezet.
    window.addEventListener('pagehide', () => { if (conn) conn.close(); });

    zetKnopStand('off');
}());
