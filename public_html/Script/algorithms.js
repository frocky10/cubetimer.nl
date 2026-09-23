/**
 * CubeTimer - algoritmes voor 3x3
 * ---------------------------------------------------------------------------
 * De volledige OLL (57) en PLL (21), plus alle 41 F2L-gevallen.
 *
 * Hier staan alléén de zetten. Het plaatje bij een geval, de groep waar hij in
 * hoort en de opzetscramble om ermee te oefenen worden allemaal *uitgerekend*
 * uit het algoritme zelf, met de kubusengine uit `cube.js`. Er is dus geen
 * tweede lijst met vormbeschrijvingen die uit de pas kan lopen: verander je een
 * algoritme, dan verandert het plaatje mee.
 *
 * Elk algoritme in dit bestand is gecontroleerd: het laat de onderste twee
 * lagen heel, het lost precies zijn eigen geval op, en per soort zijn alle
 * gevallen onderling verschillend en compleet (57, 21 en 41 stuks).
 *
 * De F2L-algoritmes zijn gezocht in plaats van overgeschreven: voor elk geval
 * het kortste dat binnen R, U en F bestaat, en bij gelijke lengte de variant
 * met de minste F-zetten (die vragen een hergreep).
 */
(function (root) {
    'use strict';

    const Cube = root.CubeTimerCube;

    /* =====================================================================
     * De zetten
     * ================================================================== */

    /** OLL: de bovenkant in één kleur krijgen. Nummering zoals die algemeen is. */
    const OLL = [
    { nummer: 1, alg: "R U2 R2 F R F' U2 R' F R F'" },
    { nummer: 2, alg: "F R U R' U' F' f R U R' U' f'" },
    { nummer: 3, alg: "f R U R' U' f' U' F R U R' U' F'" },
    { nummer: 4, alg: "f R U R' U' f' U F R U R' U' F'" },
    { nummer: 5, alg: "r' U2 R U R' U r" },
    { nummer: 6, alg: "r U2 R' U' R U' r'" },
    { nummer: 7, alg: "r U R' U R U2 r'" },
    { nummer: 8, alg: "r' U' R U' R' U2 r" },
    { nummer: 9, alg: "R U R' U' R' F R2 U R' U' F'" },
    { nummer: 10, alg: "R U R' U R' F R F' R U2 R'" },
    { nummer: 11, alg: "r U R' U R' F R F' R U2 r'" },
    { nummer: 12, alg: "M' R' U' R U' R' U2 R U' R r'" },
    { nummer: 13, alg: "F U R U' R2 F' R U R U' R'" },
    { nummer: 14, alg: "R' F R U R' F' R F U' F'" },
    { nummer: 15, alg: "l' U' l L' U' L U l' U l" },
    { nummer: 16, alg: "r U r' R U R' U' r U' r'" },
    { nummer: 17, alg: "F R' F' R2 r' U R U' R' U' M'" },
    { nummer: 18, alg: "r U R' U R U2 r2 U' R U' R' U2 r" },
    { nummer: 19, alg: "r' R U R U R' U' M' R' F R F'" },
    { nummer: 20, alg: "r U R' U' M2 U R U' R' U' M'" },
    { nummer: 21, alg: "R U2 R' U' R U R' U' R U' R'" },
    { nummer: 22, alg: "R U2 R2 U' R2 U' R2 U2 R" },
    { nummer: 23, alg: "R2 D' R U2 R' D R U2 R" },
    { nummer: 24, alg: "r U R' U' r' F R F'" },
    { nummer: 25, alg: "F' r U R' U' r' F R" },
    { nummer: 26, alg: "R U2 R' U' R U' R'" },
    { nummer: 27, alg: "R U R' U R U2 R'" },
    { nummer: 28, alg: "r U R' U' r' R U R U' R'" },
    { nummer: 29, alg: "M U R U R' U' R' F R F' M'" },
    { nummer: 30, alg: "F R' F R2 U' R' U' R U R' F2" },
    { nummer: 31, alg: "R' U' F U R U' R' F' R" },
    { nummer: 32, alg: "L U F' U' L' U L F L'" },
    { nummer: 33, alg: "R U R' U' R' F R F'" },
    { nummer: 34, alg: "R U R2 U' R' F R U R U' F'" },
    { nummer: 35, alg: "R U2 R2 F R F' R U2 R'" },
    { nummer: 36, alg: "L' U' L U' L' U L U L F' L' F" },
    { nummer: 37, alg: "F R' F' R U R U' R'" },
    { nummer: 38, alg: "R U R' U R U' R' U' R' F R F'" },
    { nummer: 39, alg: "L F' L' U' L U F U' L'" },
    { nummer: 40, alg: "R' F R U R' U' F' U R" },
    { nummer: 41, alg: "R U R' U R U2 R' F R U R' U' F'" },
    { nummer: 42, alg: "R' U' R U' R' U2 R F R U R' U' F'" },
    { nummer: 43, alg: "F' U' L' U L F" },
    { nummer: 44, alg: "F U R U' R' F'" },
    { nummer: 45, alg: "F R U R' U' F'" },
    { nummer: 46, alg: "R' U' R' F R F' U R" },
    { nummer: 47, alg: "R' U' R' F R F' R' F R F' U R" },
    { nummer: 48, alg: "F R U R' U' R U R' U' F'" },
    { nummer: 49, alg: "r U' r2 U r2 U r2 U' r" },
    { nummer: 50, alg: "r' U r2 U' r2 U' r2 U r'" },
    { nummer: 51, alg: "F U R U' R' U R U' R' F'" },
    { nummer: 52, alg: "R U R' U R U' B U' B' R'" },
    { nummer: 53, alg: "l' U2 L U L' U' L U L' U l" },
    { nummer: 54, alg: "r U2 R' U' R U R' U' R U' r'" },
    { nummer: 55, alg: "R U2 R2 U' R U' R' U2 F R F'" },
    { nummer: 56, alg: "r U r' U R U' R' U R U' R' r U' r'" },
    { nummer: 57, alg: "R U R' U' M' U R U' r'" },
    ];

    /** PLL: de bovenlaag op zijn plek leggen. De letters zijn de gangbare namen. */
    const PLL = [
    { letter: "Aa", alg: "x L2 D2 L' U' L D2 L' U L' x'" },
    { letter: "Ab", alg: "x L U' L D2 L' U L D2 L2 x'" },
    { letter: "E", alg: "x' L' U L D' L' U' L D L' U' L D' L' U L D x" },
    { letter: "F", alg: "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R" },
    { letter: "Ga", alg: "R2 U R' U R' U' R U' R2 U' D R' U R D'" },
    { letter: "Gb", alg: "R' U' R U D' R2 U R' U R U' R U' R2 D" },
    { letter: "Gc", alg: "R2 U' R U' R U R' U R2 U D' R U' R' D" },
    { letter: "Gd", alg: "R U R' U' D R2 U' R U' R' U R' U R2 D'" },
    { letter: "H", alg: "M2 U M2 U2 M2 U M2" },
    { letter: "Ja", alg: "R' U L' U2 R U' R' U2 R L" },
    { letter: "Jb", alg: "R U R' F' R U R' U' R' F R2 U' R' U'" },
    { letter: "Na", alg: "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'" },
    { letter: "Nb", alg: "R' U R U' R' F' U' F R U R' F R' F' R U' R" },
    { letter: "Ra", alg: "R U' R' U' R U R D R' U' R D' R' U2 R' U'" },
    { letter: "Rb", alg: "R2 F R U R U' R' F' R U2 R' U2 R" },
    { letter: "T", alg: "R U R' U' R' F R2 U' R' U' R U R' F'" },
    { letter: "Ua", alg: "R U' R U R U R U' R' U' R2" },
    { letter: "Ub", alg: "R2 U R U R' U' R' U' R' U R'" },
    { letter: "V", alg: "R' U R' U' y R' F' R2 U' R' U R' F R F y'" },
    { letter: "Y", alg: "F R U' R' U' R U R' F' R U R' U' R' F R F'" },
    { letter: "Z", alg: "M2 U M2 U M' U2 M2 U2 M' U2" },
    ];

    /** F2L: hoek en rand als paar in hun sleuf rechtsvoor zetten. */
    const F2L = [
    { nummer: 1, alg: "F' U F" },
    { nummer: 2, alg: "R U R'" },
    { nummer: 3, alg: "F' U' F" },
    { nummer: 4, alg: "R U' R'" },
    { nummer: 5, alg: "F' U F R U R'" },
    { nummer: 6, alg: "F' U' F R U R'" },
    { nummer: 7, alg: "R U R' F' U' F" },
    { nummer: 8, alg: "R U' R2 F R F'" },
    { nummer: 9, alg: "R U2 R2 F R F'" },
    { nummer: 10, alg: "R U' R' F' U' F" },
    { nummer: 11, alg: "R U2 R' F' U' F" },
    { nummer: 12, alg: "R U2 R' F' U2 F" },
    { nummer: 13, alg: "F' U F U R U' R'" },
    { nummer: 14, alg: "F' U F U2 R U R'" },
    { nummer: 15, alg: "F' U2 F2 R' F' R" },
    { nummer: 16, alg: "R U' R' U R U R'" },
    { nummer: 17, alg: "R U2 R' U R U R'" },
    { nummer: 18, alg: "F' U F U' F' U' F" },
    { nummer: 19, alg: "F' U' F U R U' R'" },
    { nummer: 20, alg: "F2 U2 F U F' U F2" },
    { nummer: 21, alg: "R U R' U' F' U' F" },
    { nummer: 22, alg: "R U R' U2 R U' R'" },
    { nummer: 23, alg: "R U' R' U F' U' F" },
    { nummer: 24, alg: "R U' R' U' R U R'" },
    { nummer: 25, alg: "R U2 R' U F' U' F" },
    { nummer: 26, alg: "R U2 R' U' R U R'" },
    { nummer: 27, alg: "R' U2 R2 U R2 U R" },
    { nummer: 28, alg: "F2 U2 R' F R U2 F2" },
    { nummer: 29, alg: "R U' R' U' F' U' F" },
    { nummer: 30, alg: "R U' R' U2 F' U' F" },
    { nummer: 31, alg: "R U' R' U2 R U' R'" },
    { nummer: 32, alg: "R U2 R' U2 R U' R'" },
    { nummer: 33, alg: "F2 U2 R' F' R U2 F2" },
    { nummer: 34, alg: "R2 U2 F R2 F' U2 R2" },
    { nummer: 35, alg: "R2 U2 R' U' R U' R2" },
    { nummer: 36, alg: "R2 U2 R2 U' R2 U' R2" },
    { nummer: 37, alg: "R U F R U R' U' F' R'" },
    { nummer: 38, alg: "R U2 R U R' U R U2 R2" },
    { nummer: 39, alg: "R F U R U' R' F' U' R'" },
    { nummer: 40, alg: "R2 U2 F R2 F' U2 R' U R'" },
    { nummer: 41, alg: "R2 U2 R' U' R U' R' U2 R'" },
    ];

    /* =====================================================================
     * Wat we uit de zetten afleiden
     * ================================================================== */

    /** De vier randen van de bovenkant, met de klok mee vanaf achter. */
    const EDGE_CELLS = [[0, 1], [1, 2], [2, 1], [1, 0]];
    /** De vier hoeken van de bovenkant, met de klok mee vanaf achter-links. */
    const CORNER_CELLS = [[0, 0], [0, 2], [2, 2], [2, 0]];
    /** De zijkanten die je van de bovenlaag ziet, met de klok mee. */
    const SIDES = ['B', 'R', 'F', 'L'];

    /** De stand waarin een geval begint: het algoritme achterstevoren. */
    function caseState(alg) {
        return Cube.after(Cube.invert(alg));
    }

    /**
     * De scramble waarmee je het geval opzet om te oefenen. Dat is het
     * algoritme achterstevoren: precies genoeg om er weer voor te staan.
     */
    function setup(alg) {
        return Cube.invert(alg);
    }

    /**
     * Het plaatje van een OLL: welke van de 21 zichtbare vakjes al goed staan.
     * `top` is de bovenkant (9 vakjes, rij voor rij), `sides` is per zijkant
     * de bovenste rij van drie, van links naar rechts gezien vanaf die kant.
     */
    function ollPattern(alg) {
        const state = caseState(alg);
        const top = [];
        for (let row = 0; row < 3; row += 1) {
            for (let col = 0; col < 3; col += 1) {
                top.push(Cube.colorAt(state, 'U', row, col) === 'U');
            }
        }
        const sides = {};
        SIDES.forEach(face => {
            sides[face] = [0, 1, 2].map(col => Cube.colorAt(state, face, 0, col) === 'U');
        });
        return { top, sides };
    }

    /** In welke groep hoort een OLL, afgaand op de randen die al goed staan? */
    function ollGroup(alg) {
        const state = caseState(alg);
        const edges = EDGE_CELLS.map(([row, col]) => Cube.colorAt(state, 'U', row, col) === 'U');
        const count = edges.filter(Boolean).length;
        if (count === 0) return 'punt';
        if (count === 4) return 'kruis';
        return (edges[0] && edges[2]) || (edges[1] && edges[3]) ? 'lijn' : 'haak';
    }

    /** Hoeveel hoeken staan er al goed? Handig als extra zinnetje bij een geval. */
    function ollCornerCount(alg) {
        const state = caseState(alg);
        return CORNER_CELLS.filter(([row, col]) => Cube.colorAt(state, 'U', row, col) === 'U').length;
    }

    /**
     * Het plaatje van een PLL: waar elk stuk van de bovenlaag naartoe moet.
     * Per hoek en per rand een index 0..3 die zegt op welke plek hij hoort.
     * Uit die twee lijstjes tekent de pagina de pijlen.
     */
    function pllArrows(alg) {
        const state = caseState(alg);
        const map = cells => cells.map(([row, col]) => {
            const home = Cube.STICKERS[state[Cube.slot('U', row, col)]].pos.join(',');
            return cells.findIndex(([r, c]) => Cube.STICKERS[Cube.slot('U', r, c)].pos.join(',') === home);
        });
        return { corners: map(CORNER_CELLS), edges: map(EDGE_CELLS) };
    }

    /** Wat verzet een PLL: alleen hoeken, alleen randen, of allebei? */
    function pllGroup(alg) {
        const { corners, edges } = pllArrows(alg);
        const movesCorners = corners.some((from, index) => from !== index);
        const movesEdges = edges.some((from, index) => from !== index);
        if (movesCorners && movesEdges) return 'beide';
        return movesCorners ? 'hoeken' : 'randen';
    }

    /**
     * Het plaatje van een F2L-geval: waar liggen de hoek en de rand van het
     * paar, en hoe liggen ze gedraaid. De pagina tekent daar de bovenlaag en
     * de sleuf rechtsvoor mee.
     *
     * `corner` en `edge` geven per plaatje van het stuk terug op welke plek
     * het nu ligt, als vlak + rij + kolom.
     */
    function f2lPieces(alg) {
        const state = caseState(alg);
        const where = new Array(54);
        state.forEach((sticker, slotIndex) => { where[sticker] = slotIndex; });

        const find = predicate => Cube.STICKERS
            .map((sticker, index) => ({ sticker, index }))
            .filter(({ sticker }) => predicate(sticker.pos))
            .map(({ sticker, index }) => {
                const at = Cube.STICKERS[where[index]];
                return { color: sticker.face, face: at.face, row: at.row, col: at.col };
            });

        return {
            corner: find(([x, y, z]) => x === 1 && y === -1 && z === 1),
            edge: find(([x, y, z]) => x === 1 && y === 0 && z === 1)
        };
    }

    /**
     * Ligt bij dit F2L-geval al iets in de sleuf? Bepaalt de groep.
     * We kijken naar de hoogte van het stuk: y = 1 is de bovenlaag, alles
     * daaronder is de sleuf zelf (al dan niet verkeerd om).
     */
    function f2lGroup(alg) {
        const state = caseState(alg);
        const where = new Array(54);
        state.forEach((sticker, slotIndex) => { where[sticker] = slotIndex; });

        const heightOf = predicate => {
            const home = Cube.STICKERS.findIndex(sticker => predicate(sticker.pos));
            return Cube.STICKERS[where[home]].pos[1];
        };

        const cornerInSlot = heightOf(([x, y, z]) => x === 1 && y === -1 && z === 1) !== 1;
        const edgeInSlot = heightOf(([x, y, z]) => x === 1 && y === 0 && z === 1) !== 1;

        if (cornerInSlot && edgeInSlot) return 'beide-in-sleuf';
        if (cornerInSlot) return 'hoek-in-sleuf';
        if (edgeInSlot) return 'rand-in-sleuf';
        return 'beide-boven';
    }

    /* =====================================================================
     * De lijsten zoals de pagina ze wil hebben
     * ================================================================== */

    const OLL_GROUP_LABELS = {
        punt: 'Punt (geen rand goed)',
        haak: 'Haak (twee randen naast elkaar)',
        lijn: 'Lijn (twee randen tegenover elkaar)',
        kruis: 'Kruis (alle randen goed)'
    };

    const PLL_GROUP_LABELS = {
        hoeken: 'Alleen hoeken',
        randen: 'Alleen randen',
        beide: 'Hoeken en randen'
    };

    const F2L_GROUP_LABELS = {
        'beide-boven': 'Hoek en rand liggen allebei boven',
        'rand-in-sleuf': 'De rand zit al in de sleuf',
        'hoek-in-sleuf': 'De hoek zit al in de sleuf',
        'beide-in-sleuf': 'Allebei zitten ze al in de sleuf'
    };

    /** Bouwt de lijst op en hangt er alles aan wat de pagina nodig heeft. */
    function build() {
        const oll = OLL.map(item => ({
            id: 'OLL-' + item.nummer,
            soort: 'oll',
            titel: 'OLL ' + item.nummer,
            alg: item.alg,
            setup: setup(item.alg),
            groep: ollGroup(item.alg),
            hoekenGoed: ollCornerCount(item.alg),
            patroon: ollPattern(item.alg)
        }));

        const pll = PLL.map(item => ({
            id: 'PLL-' + item.letter,
            soort: 'pll',
            titel: item.letter + '-perm',
            alg: item.alg,
            setup: setup(item.alg),
            groep: pllGroup(item.alg),
            pijlen: pllArrows(item.alg)
        }));

        const f2l = F2L.map(item => ({
            id: 'F2L-' + item.nummer,
            soort: 'f2l',
            titel: 'F2L ' + item.nummer,
            alg: item.alg,
            setup: setup(item.alg),
            groep: f2lGroup(item.alg),
            stukken: f2lPieces(item.alg)
        }));

        return { oll, pll, f2l };
    }

    let cache = null;

    root.CubeTimerAlgorithms = {
        /** Alle gevallen, één keer uitgerekend en daarna bewaard. */
        all() {
            if (!cache) cache = build();
            return cache;
        },
        /** Eén geval op zijn id, bijvoorbeeld 'OLL-27' of 'PLL-T'. */
        byId(id) {
            const sets = this.all();
            return [...sets.oll, ...sets.pll, ...sets.f2l].find(item => item.id === id) || null;
        },
        groupLabel(soort, groep) {
            const labels = soort === 'oll' ? OLL_GROUP_LABELS
                : soort === 'pll' ? PLL_GROUP_LABELS
                    : F2L_GROUP_LABELS;
            return labels[groep] || groep;
        },
        OLL_GROUP_LABELS,
        PLL_GROUP_LABELS,
        F2L_GROUP_LABELS
    };
}(typeof window !== 'undefined' ? window : globalThis));
