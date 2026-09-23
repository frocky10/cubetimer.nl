#!/usr/bin/env node
/**
 * Controleert de algoritmes uit public_html/Script/algorithms.js.
 *
 *     node tools/algoritmes-controleren.js
 *
 * Er is geen testframework in dit project, maar dit ene stuk leent zich er wel
 * voor: een tikfout in een algoritme zie je niet met het blote oog, en een
 * bezoeker die een fout algoritme uit zijn hoofd leert is er slechter aan toe
 * dan iemand die niets geleerd heeft. Draai dit dus na elke wijziging aan
 * `algorithms.js`.
 *
 * Wat er gecontroleerd wordt, per algoritme:
 *   - het draait de kubus niet netto (de centra blijven liggen)
 *   - het laat alles heel wat het niet mag aanraken
 *   - het lost echt iets op (geen geval dat al goed staat)
 *   - OLL maakt de bovenkant één kleur, PLL begint met een gele bovenkant
 *
 * En per verzameling: alle gevallen zijn onderling verschillend, en het zijn
 * er precies zoveel als er bestaan (57 OLL, 21 PLL, 41 F2L). Die twee samen
 * betekenen dat de lijst compleet is.
 *
 * Deze map wordt niet mee gedeployd; alleen `public_html/` gaat naar de server.
 */
'use strict';

const path = require('path');

const root = path.join(__dirname, '..', 'public_html', 'Script');
require(path.join(root, 'cube.js'));
require(path.join(root, 'algorithms.js'));

const Cube = globalThis.CubeTimerCube;
const Algorithms = globalThis.CubeTimerAlgorithms;
const S = Cube.STICKERS;

const VERWACHT = { oll: 57, pll: 21, f2l: 41 };

let fouten = 0;
function meld(regel) {
    console.log(regel);
    fouten += 1;
}

/** De stand waarin een geval begint: het algoritme achterstevoren. */
const beginstand = alg => Cube.after(Cube.invert(alg));

/** Staan alle centra nog op hun plek? Zo niet, dan draait het algoritme de kubus. */
function centraHeel(state) {
    return Cube.FACES.every(face => Cube.colorAt(state, face, 1, 1) === face);
}

/** De plekken die een F2L-algoritme voor de sleuf rechtsvoor met rust moet laten. */
const isDFR = ([x, y, z]) => x === 1 && y === -1 && z === 1;
const isFR = ([x, y, z]) => x === 1 && y === 0 && z === 1;

/** Een sleutel die zegt welk geval dit is, zodat we dubbelingen zien. */
const SLEUTELS = {
    // OLL: welke van de 21 zichtbare vakjes liggen al goed?
    oll(state) {
        const bits = [];
        for (let row = 0; row < 3; row += 1) {
            for (let col = 0; col < 3; col += 1) {
                bits.push(Cube.colorAt(state, 'U', row, col) === 'U' ? '1' : '0');
            }
        }
        ['F', 'R', 'B', 'L'].forEach(face => {
            for (let col = 0; col < 3; col += 1) {
                bits.push(Cube.colorAt(state, face, 0, col) === 'U' ? '1' : '0');
            }
        });
        return bits.join('');
    },
    // PLL: welk stuk ligt op welke plek in de bovenlaag?
    pll(state) {
        const cellen = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1], [2, 2]];
        return cellen.map(([row, col]) => S[state[Cube.slot('U', row, col)]].pos.join('')).join('|');
    },
    // F2L: waar liggen de hoek en de rand van het paar, en hoe gedraaid?
    f2l(state) {
        const waar = [];
        state.forEach((sticker, plek) => { waar[sticker] = plek; });
        const van = test => S
            .map((sticker, index) => [sticker, index])
            .filter(([sticker]) => test(sticker.pos))
            .map(([, index]) => waar[index])
            .join('.');
        return van(isDFR) + '/' + van(isFR);
    }
};

/**
 * Hetzelfde geval blijft hetzelfde als je de bovenlaag een slag draait. Bij
 * PLL geldt dat aan beide kanten: je mag voor én na het algoritme bijdraaien.
 */
function canoniek(soort, alg) {
    const draaien = ['', 'U', 'U2', "U'"];
    const achteraf = soort === 'pll' ? draaien : [''];
    let beste = null;
    draaien.forEach(voor => {
        achteraf.forEach(na => {
            const reeks = [voor, Cube.invert(alg), na].filter(Boolean).join(' ');
            const sleutel = SLEUTELS[soort](Cube.after(reeks));
            if (beste === null || sleutel < beste) beste = sleutel;
        });
    });
    return beste;
}

/** Welke plekken mag dit soort algoritme niet aanraken? */
function magNietAanraken(soort) {
    if (soort === 'f2l') {
        // Alles onder de bovenlaag, behalve het paar dat we juist plaatsen.
        return sticker => sticker.pos[1] !== 1 && !isDFR(sticker.pos) && !isFR(sticker.pos);
    }
    // OLL en PLL: de hele onderste twee lagen.
    return sticker => sticker.pos[1] !== 1;
}

const alles = Algorithms.all();

Object.keys(VERWACHT).forEach(soort => {
    const gevallen = alles[soort];
    const gezien = new Map();

    gevallen.forEach(geval => {
        const problemen = new Set();
        let state;
        try {
            state = beginstand(geval.alg);
        } catch (err) {
            meld('FOUT  ' + geval.id + ': ' + err.message);
            return;
        }

        if (!centraHeel(state)) problemen.add('draait de kubus netto');

        const beschermd = magNietAanraken(soort);
        S.forEach((sticker, index) => {
            if (beschermd(sticker) && S[state[index]].face !== sticker.face) {
                problemen.add('raakt iets aan wat heel moest blijven');
            }
        });

        // Ligt alles wat dit algoritme aangaat al goed, dan is het geen geval.
        if (SLEUTELS[soort](state) === SLEUTELS[soort](Cube.solved())) {
            problemen.add('dit geval staat al goed');
        }

        if (soort === 'oll' && Cube.topOriented(state)) problemen.add('bovenkant al één kleur');
        if (soort === 'pll' && !Cube.topOriented(state)) problemen.add('bovenkant is niet één kleur');

        if (problemen.size) {
            meld('FOUT  ' + geval.id + ': ' + [...problemen].join(', ') + '   [' + geval.alg + ']');
            return;
        }

        const sleutel = canoniek(soort, geval.alg);
        if (gezien.has(sleutel)) {
            meld('FOUT  ' + geval.id + ' is hetzelfde geval als ' + gezien.get(sleutel));
        } else {
            gezien.set(sleutel, geval.id);
        }
    });

    const compleet = gezien.size === VERWACHT[soort] && gevallen.length === VERWACHT[soort];
    if (!compleet) {
        meld('FOUT  ' + soort.toUpperCase() + ': ' + gezien.size + ' verschillende gevallen van '
            + gevallen.length + ', verwacht ' + VERWACHT[soort]);
    } else {
        console.log('ok    ' + soort.toUpperCase() + ': ' + gevallen.length
            + ' gevallen, allemaal verschillend en compleet');
    }
});

if (fouten) {
    console.log('\n' + fouten + ' probleem' + (fouten === 1 ? '' : 'en') + ' gevonden.');
    process.exit(1);
}
console.log('\nAlle algoritmes zijn in orde.');
