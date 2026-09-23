/**
 * CubeTimer - de leerpagina
 * ---------------------------------------------------------------------------
 * Tekent de OLL-, PLL- en F2L-gevallen, houdt bij wat je geleerd hebt en
 * stuurt je met één klik naar de timer om een geval te oefenen.
 *
 * De plaatjes worden niet uit een map met afbeeldingen gehaald maar ter plekke
 * getekend uit de kubusstand die `algorithms.js` per geval meelevert. Die stand
 * komt op zijn beurt uit het algoritme zelf. Een plaatje kan dus niet iets
 * anders laten zien dan de zetten eronder doen.
 *
 * Wat je hebt afgevinkt staat op je account (api/algorithms/), niet in deze
 * browser: het is iets wat je leert, geen instelling van dit apparaat. Zonder
 * account werkt de pagina gewoon, hij onthoudt dan alleen niets.
 */
(function () {
    'use strict';

    const UI = window.CubeTimerUI;
    const Algorithms = window.CubeTimerAlgorithms;
    if (!UI || !Algorithms) return;

    /* =====================================================================
     * Plaatjes tekenen
     * ================================================================== */

    /**
     * Welke plaatjes van de zijkanten hoor je vanaf boven te zien, en in welke
     * volgorde staan ze om het vlak heen?
     *
     * Een vlak wordt recht van voren getekend, maar in het plaatje kijk je van
     * bovenaf. De bovenste rij van het rechtervlak loopt daardoor van beneden
     * naar boven, en die van het achtervlak van rechts naar links. Deze tabel
     * legt dat één keer vast zodat de rest ervan af is.
     */
    const SIDE_ORDER = {
        boven: { face: 'B', cols: [2, 1, 0] },
        rechts: { face: 'R', cols: [2, 1, 0] },
        onder: { face: 'F', cols: [0, 1, 2] },
        links: { face: 'L', cols: [0, 1, 2] }
    };

    // Maten van een plaatje, in de eenheden van de viewBox.
    const CEL = 24;
    const KIER = 3;
    const TAB = 9;
    const START = TAB + KIER;
    const VLAK = 3 * CEL + 2 * KIER;
    const TOTAAL = VLAK + 2 * START;

    // Op de leerpagina ligt geel boven en wit onder, zoals bij CFOP gebruikelijk.
    const KLEUR_PER_VLAK = { U: 'yellow', D: 'white', F: 'green', B: 'blue', R: 'red', L: 'orange' };
    const kleur = face => 'var(--cube-' + KLEUR_PER_VLAK[face] + ')';
    const LEEG = 'var(--cube-blank)';

    function vierkant(x, y, breedte, hoogte, vulling, radius) {
        return `<rect x="${x}" y="${y}" width="${breedte}" height="${hoogte}" rx="${radius}"`
            + ` fill="${vulling}" stroke="var(--cube-line)" stroke-width="1" />`;
    }

    /**
     * Tekent één geval.
     *
     * `cel(row, col)` en `tab(kant, index)` geven per vakje de vulling terug.
     * Zo kan elk soort geval hetzelfde plaatje gebruiken en toch zelf bepalen
     * wat er gekleurd wordt: OLL kleurt alleen wat al goed staat, PLL kleurt de
     * zijkanten, F2L alleen de twee stukken waar het om gaat.
     */
    function tekenVlak(cel, tab, extra) {
        const delen = [];

        for (let row = 0; row < 3; row += 1) {
            for (let col = 0; col < 3; col += 1) {
                delen.push(vierkant(
                    START + col * (CEL + KIER),
                    START + row * (CEL + KIER),
                    CEL, CEL, cel(row, col), 3
                ));
            }
        }

        Object.keys(SIDE_ORDER).forEach(kant => {
            for (let i = 0; i < 3; i += 1) {
                const langs = START + i * (CEL + KIER);
                const posities = {
                    boven: [langs, 0, CEL, TAB],
                    onder: [langs, TOTAAL - TAB, CEL, TAB],
                    links: [0, langs, TAB, CEL],
                    rechts: [TOTAAL - TAB, langs, TAB, CEL]
                }[kant];
                delen.push(vierkant(posities[0], posities[1], posities[2], posities[3], tab(kant, i), 2));
            }
        });

        return `<svg class="cube-face" viewBox="0 0 ${TOTAAL} ${TOTAAL}" role="img" aria-hidden="true">`
            + delen.join('') + (extra || '') + '</svg>';
    }

    /** De kleur op een zijkantvakje, via de tabel hierboven. */
    function tabKleur(state, kant, index) {
        const { face, cols } = SIDE_ORDER[kant];
        return Algorithms.colorAt(state, face, 0, cols[index]);
    }

    /** OLL: geel wat al goed ligt, grijs wat nog gedraaid moet worden. */
    function tekenOll(geval) {
        return tekenVlak(
            (row, col) => Algorithms.colorAt(geval.state, 'U', row, col) === 'U' ? kleur('U') : LEEG,
            (kant, i) => tabKleur(geval.state, kant, i) === 'U' ? kleur('U') : LEEG
        );
    }

    /**
     * PLL: de bovenkant is al geel, dus daar valt niets te zien. Wat je wél
     * ziet zijn de zijkanten - daar herken je het geval aan - plus pijlen die
     * laten zien welk stuk waarheen moet.
     */
    function tekenPll(geval) {
        const midden = i => START + i * (CEL + KIER) + CEL / 2;

        // Waar staat een hoek of rand in het plaatje? Zelfde volgorde als in
        // pllArrows: hoeken met de klok mee vanaf achter-links, randen vanaf
        // achter.
        const hoekPunt = [[0, 0], [0, 2], [2, 2], [2, 0]];
        const randPunt = [[0, 1], [1, 2], [2, 1], [1, 0]];

        const pijlen = [];
        const teken = (punten, van, naar) => {
            if (van === naar) return;
            const [r1, c1] = punten[van];
            const [r2, c2] = punten[naar];
            pijlen.push(`<line x1="${midden(c1)}" y1="${midden(r1)}" x2="${midden(c2)}" y2="${midden(r2)}"`
                + ' class="cube-arrow" marker-end="url(#cube-arrowhead)" />');
        };
        // `pijlen[i]` zegt welk stuk er nú op plek i ligt; dat stuk moet naar i.
        geval.pijlen.corners.forEach((van, naar) => teken(hoekPunt, van, naar));
        geval.pijlen.edges.forEach((van, naar) => teken(randPunt, van, naar));

        return tekenVlak(
            () => kleur('U'),
            (kant, i) => kleur(tabKleur(geval.state, kant, i)),
            pijlen.join('')
        );
    }

    /**
     * F2L: alleen de hoek en de rand van het paar krijgen kleur, de rest blijft
     * leeg. Anders kijk je naar een plaatje vol kleur waar niets in opvalt.
     *
     * Onder het vlak komt een tweede plaatje met de sleuf rechtsvoor, want daar
     * kan bij een deel van de gevallen al iets in liggen.
     */
    const PAAR = ['1,-1,1', '1,0,1'];   // hoek rechtsvoor-onder en rand rechtsvoor

    function hoortBijPaar(state, face, row, col) {
        return PAAR.includes(Algorithms.pieceAt(state, face, row, col).join(','));
    }

    function tekenF2l(geval) {
        const boven = tekenVlak(
            (row, col) => hoortBijPaar(geval.state, 'U', row, col)
                ? kleur(Algorithms.colorAt(geval.state, 'U', row, col))
                : LEEG,
            (kant, i) => {
                const { face, cols } = SIDE_ORDER[kant];
                return hoortBijPaar(geval.state, face, 0, cols[i])
                    ? kleur(Algorithms.colorAt(geval.state, face, 0, cols[i]))
                    : LEEG;
            }
        );

        // De sleuf: twee rijen van twee, links wat je van voren ziet en rechts
        // wat je van rechts ziet. Boven de rand, onder de hoek. Ligt er niets
        // in de sleuf, dan laten we hem weg - vier lege vakjes naast een plaatje
        // vol lege vakjes zegt niets.
        const sleufVakjes = [
            ['F', 1, 2], ['R', 1, 0],
            ['F', 2, 2], ['R', 2, 0]
        ];
        const bezet = sleufVakjes.some(([face, row, col]) => hoortBijPaar(geval.state, face, row, col));
        if (!bezet) return boven;

        const breedte = 2 * CEL + KIER;
        const delen = sleufVakjes.map((plek, index) => {
            const [face, row, col] = plek;
            const vulling = hoortBijPaar(geval.state, face, row, col)
                ? kleur(Algorithms.colorAt(geval.state, face, row, col))
                : LEEG;
            return vierkant(
                (index % 2) * (CEL + KIER),
                Math.floor(index / 2) * (CEL + KIER),
                CEL, CEL, vulling, 3
            );
        });

        const sleuf = `<svg class="cube-slot" viewBox="0 0 ${breedte} ${breedte}" role="img" aria-hidden="true">`
            + delen.join('') + '</svg>';

        return '<div class="cube-pair">' + boven
            + '<div class="cube-pair__slot"><span>sleuf</span>' + sleuf + '</div></div>';
    }

    function tekenGeval(geval) {
        if (geval.soort === 'oll') return tekenOll(geval);
        if (geval.soort === 'pll') return tekenPll(geval);
        return tekenF2l(geval);
    }

    /* =====================================================================
     * De kaarten
     * ================================================================== */

    /** Wat er onder de titel van een geval staat. */
    function ondertitel(geval) {
        if (geval.soort === 'oll') {
            const hoeken = geval.hoekenGoed;
            return Algorithms.groupLabel('oll', geval.groep) + ' · '
                + (hoeken === 0 ? 'geen hoek goed'
                    : hoeken === 1 ? 'één hoek goed'
                        : hoeken + ' hoeken goed');
        }
        return Algorithms.groupLabel(geval.soort, geval.groep);
    }

    let geleerd = new Set();
    let kanOnthouden = false;

    function kaart(geval) {
        const isGeleerd = geleerd.has(geval.id);
        return `
            <article class="alg-card${isGeleerd ? ' is-learned' : ''}" data-alg="${geval.id}">
                <div class="alg-card__figure">${tekenGeval(geval)}</div>
                <div class="alg-card__body">
                    <h3 class="alg-card__title">${geval.titel}</h3>
                    <p class="alg-card__meta">${ondertitel(geval)}</p>
                    <p class="alg-card__moves">${geval.alg}</p>
                </div>
                <div class="alg-card__actions">
                    <button class="btn btn--sm" type="button" data-practice="${geval.id}">Oefenen</button>
                    <label class="alg-card__check"${kanOnthouden ? '' : ' hidden'}>
                        <input type="checkbox" data-learned="${geval.id}"${isGeleerd ? ' checked' : ''} />
                        <span>Geleerd</span>
                    </label>
                </div>
            </article>`;
    }

    /**
     * Tekent een verzameling gevallen, opgedeeld in groepen. De volgorde van de
     * groepen komt uit de labeltabel in algorithms.js, zodat hij overal gelijk
     * is.
     */
    function tekenLijst(houder, gevallen, soort) {
        const labels = soort === 'oll' ? Algorithms.OLL_GROUP_LABELS
            : soort === 'pll' ? Algorithms.PLL_GROUP_LABELS
                : Algorithms.F2L_GROUP_LABELS;

        const stukken = Object.keys(labels).map(groep => {
            const inGroep = gevallen.filter(geval => geval.groep === groep);
            if (!inGroep.length) return '';
            return `<h3 class="alg-group">${labels[groep]}`
                + `<span class="alg-group__count">${inGroep.length}</span></h3>`
                + '<div class="alg-grid">' + inGroep.map(kaart).join('') + '</div>';
        });

        houder.innerHTML = stukken.join('');
    }

    /* =====================================================================
     * Geleerd bijhouden
     * ================================================================== */

    function werkVoortgangBij() {
        document.querySelectorAll('[data-progress]').forEach(element => {
            const soort = element.dataset.progress;
            const gevallen = Algorithms.all()[soort] || [];
            const gedaan = gevallen.filter(geval => geleerd.has(geval.id)).length;
            element.textContent = `${gedaan} van de ${gevallen.length} geleerd`;
        });
    }

    async function haalGeleerdOp() {
        const status = await UI.status().catch(() => null);
        kanOnthouden = status?.features?.algorithms === true && status?.authenticated === true;

        if (!kanOnthouden) {
            geleerd = new Set();
            return;
        }
        try {
            const antwoord = await UI.api('algorithms/list.php');
            geleerd = new Set(Array.isArray(antwoord.learned) ? antwoord.learned : []);
        } catch (err) {
            geleerd = new Set();
        }
    }

    async function wisselGeleerd(id, aan, vinkje) {
        const eerder = new Set(geleerd);
        if (aan) geleerd.add(id); else geleerd.delete(id);

        document.querySelector(`[data-alg="${id}"]`)?.classList.toggle('is-learned', aan);
        werkVoortgangBij();

        try {
            await UI.api('algorithms/toggle.php', { body: { id, learned: aan } });
        } catch (err) {
            // Mislukt: terugdraaien, anders denk je dat het opgeslagen is.
            geleerd = eerder;
            if (vinkje) vinkje.checked = eerder.has(id);
            document.querySelector(`[data-alg="${id}"]`)?.classList.toggle('is-learned', eerder.has(id));
            werkVoortgangBij();
            UI.toast('Opslaan is niet gelukt: ' + err.message, { type: 'error' });
        }
    }

    /* =====================================================================
     * Oefenen
     *
     * De opzetscramble van een geval is het algoritme achterstevoren. We sturen
     * hem als parameter mee naar de timer; die zet hem vast met
     * setScrambleOverride() en laat erbij staan wat je aan het oefenen bent.
     * ================================================================== */

    function oefen(id) {
        const geval = Algorithms.byId(id);
        if (!geval) return;
        window.location.href = 'index.html?oefen=' + encodeURIComponent(geval.id);
    }

    /* =====================================================================
     * Opstarten
     * ================================================================== */

    const tabs = Array.from(document.querySelectorAll('[data-leer-tab]'));
    const panelen = Array.from(document.querySelectorAll('[data-leer-panel]'));

    function toon(naam) {
        tabs.forEach(tab => {
            const actief = tab.dataset.leerTab === naam;
            tab.classList.toggle('is-active', actief);
            tab.setAttribute('aria-selected', actief ? 'true' : 'false');
        });
        panelen.forEach(paneel => {
            paneel.hidden = paneel.dataset.leerPanel !== naam;
        });
        if (window.history.replaceState) {
            window.history.replaceState(null, '', '#' + naam);
        }
    }

    tabs.forEach(tab => tab.addEventListener('click', () => toon(tab.dataset.leerTab)));

    document.addEventListener('click', event => {
        const oefenKnop = event.target.closest('[data-practice]');
        if (oefenKnop) oefen(oefenKnop.dataset.practice);
    });

    document.addEventListener('change', event => {
        const vinkje = event.target.closest('[data-learned]');
        if (vinkje) wisselGeleerd(vinkje.dataset.learned, vinkje.checked, vinkje);
    });

    async function start() {
        await haalGeleerdOp();

        const alles = Algorithms.all();
        ['f2l', 'oll', 'pll'].forEach(soort => {
            const houder = document.querySelector(`[data-leer-list="${soort}"]`);
            if (houder) tekenLijst(houder, alles[soort], soort);
        });

        werkVoortgangBij();

        document.querySelectorAll('[data-signin-hint]').forEach(element => {
            element.hidden = kanOnthouden;
        });

        const gevraagd = (window.location.hash || '').replace('#', '');
        toon(tabs.some(tab => tab.dataset.leerTab === gevraagd) ? gevraagd : 'beginner');
    }

    start();
}());
