/**
 * CubeTimer - kleine kubusengine
 * ---------------------------------------------------------------------------
 * Genoeg 3x3 om de leerpagina en de smart cube mee te bedienen: een
 * zettenreeks uitvoeren, hem omkeren, opvragen welke kleur er op een plaatje
 * ligt, en een stand lezen en schrijven in de Kociemba-notatie die smart
 * cubes gebruiken.
 *
 * Waarom dit bestand bestaat: de OLL-patronen en de PLL-pijlen worden hiermee
 * *afgeleid* uit het algoritme zelf. Er staat dus nergens een met de hand
 * ingetikte plaatjesbeschrijving die stilletjes uit de pas kan lopen met de
 * zetten eronder. Verander je een algoritme, dan verandert het plaatje mee.
 *
 * Het model is ruimtelijk in plaats van een tabel met vaste nummers: elk
 * plaatje is een kubusblokje op een plek (x, y, z) met een richting waar het
 * naar wijst. Een draai is een echte rotatie om een as. Dat scheelt een lange
 * lijst permutaties waar makkelijk een tikfout in sluipt, en wide moves,
 * slices en herorientaties (x, y, z) volgen er gratis uit.
 *
 * Assen: x naar rechts, y omhoog, z naar voren. Een blokje heeft per as een
 * waarde uit {-1, 0, 1}.
 *
 * Dit bestand draait ook los in Node (voor de controle bij het ontwikkelen),
 * daarom `globalThis` in plaats van `window`.
 */
(function (root) {
    'use strict';

    /** De zes vlakken met hun normaal: de richting waar ze naar buiten wijzen. */
    const FACES = {
        U: [0, 1, 0],
        D: [0, -1, 0],
        F: [0, 0, 1],
        B: [0, 0, -1],
        R: [1, 0, 0],
        L: [-1, 0, 0]
    };

    const FACE_NAMES = Object.keys(FACES);

    /**
     * Waar ligt rij r, kolom k van een vlak?
     * Elk vlak wordt bekeken zoals je hem in een uitgevouwen kubus tekent:
     * U van bovenaf met achter bovenaan, D van onderaf met voor bovenaan, en de
     * vier zijkanten recht van voren.
     */
    function cellPosition(face, row, col) {
        switch (face) {
            case 'U': return [col - 1, 1, row - 1];
            case 'D': return [col - 1, -1, 1 - row];
            case 'F': return [col - 1, 1 - row, 1];
            case 'B': return [1 - col, 1 - row, -1];
            case 'R': return [1, 1 - row, 1 - col];
            case 'L': return [-1, 1 - row, col - 1];
            default: throw new Error('Onbekend vlak: ' + face);
        }
    }

    function cross(a, b) {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
        ];
    }

    function dot(a, b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    /**
     * Draait een vector een kwartslag met de klok mee, gezien vanaf de kant
     * waar `n` naar wijst. Dat is de gewone betekenis van "R" of "U".
     */
    function turn(v, n) {
        const d = dot(n, v);
        const c = cross(n, v);
        return [n[0] * d - c[0], n[1] * d - c[1], n[2] * d - c[2]];
    }

    /** Een plaatje als sleutel, zodat het in een Map past. */
    function key(pos, normal) {
        return pos.join(',') + '|' + normal.join(',');
    }

    /**
     * Alle 54 plaatjes, in een vaste volgorde: per vlak rij voor rij.
     * `home` is het vlak waar het plaatje van huis uit ligt, en dus zijn kleur.
     */
    const STICKERS = [];
    FACE_NAMES.forEach(face => {
        for (let row = 0; row < 3; row += 1) {
            for (let col = 0; col < 3; col += 1) {
                STICKERS.push({
                    face,
                    row,
                    col,
                    pos: cellPosition(face, row, col),
                    normal: FACES[face].slice()
                });
            }
        }
    });

    /** Van plek+richting naar de index in STICKERS. */
    const SLOT_INDEX = new Map();
    STICKERS.forEach((sticker, index) => {
        SLOT_INDEX.set(key(sticker.pos, sticker.normal), index);
    });

    /**
     * De draaiingen die de notatie kent. `axis` is de kant waar de draai met de
     * klok mee omheen gaat, `layers` zijn de lagen die meedraaien, gemeten als
     * het inproduct van de plek met die as: 1 is de buitenste laag, 0 het
     * midden, -1 de overkant.
     */
    const TURNS = {
        U: { axis: FACES.U, layers: [1] },
        D: { axis: FACES.D, layers: [1] },
        F: { axis: FACES.F, layers: [1] },
        B: { axis: FACES.B, layers: [1] },
        R: { axis: FACES.R, layers: [1] },
        L: { axis: FACES.L, layers: [1] },

        // Wide moves: de buitenste laag plus het midden.
        u: { axis: FACES.U, layers: [1, 0] },
        d: { axis: FACES.D, layers: [1, 0] },
        f: { axis: FACES.F, layers: [1, 0] },
        b: { axis: FACES.B, layers: [1, 0] },
        r: { axis: FACES.R, layers: [1, 0] },
        l: { axis: FACES.L, layers: [1, 0] },

        // Slices: alleen het midden, in de richting van het vlak in de naam.
        M: { axis: FACES.L, layers: [0] },
        E: { axis: FACES.D, layers: [0] },
        S: { axis: FACES.F, layers: [0] },

        // Herorientaties: de hele kubus.
        x: { axis: FACES.R, layers: [1, 0, -1] },
        y: { axis: FACES.U, layers: [1, 0, -1] },
        z: { axis: FACES.F, layers: [1, 0, -1] }
    };

    /** Voor elke draai: waar gaat de inhoud van elk plaatje naartoe? */
    const PERMUTATIONS = {};
    Object.keys(TURNS).forEach(name => {
        const { axis, layers } = TURNS[name];
        const to = new Array(54);
        STICKERS.forEach((sticker, index) => {
            if (!layers.includes(dot(axis, sticker.pos))) {
                to[index] = index;
                return;
            }
            const pos = turn(sticker.pos, axis);
            const normal = turn(sticker.normal, axis);
            const target = SLOT_INDEX.get(key(pos, normal));
            if (target === undefined) {
                throw new Error('Draai ' + name + ' loopt buiten de kubus');
            }
            to[index] = target;
        });
        PERMUTATIONS[name] = to;
    });

    const MOVE_PATTERN = /^([UDFBRLudfbrlMESxyz])(2'?|'2?)?$/;

    /** Splitst "R U R' U'" in losse zetten en controleert ze meteen. */
    function parse(algorithm) {
        const tokens = String(algorithm || '')
            .replace(/[()]/g, ' ')
            .replace(/[’′]/g, "'")
            .replace(/([UDFBRL])w/g, (match, face) => face.toLowerCase())
            .trim()
            .split(/\s+/)
            .filter(Boolean);

        return tokens.map(token => {
            const match = MOVE_PATTERN.exec(token);
            if (!match) {
                throw new Error('Onbekende zet: ' + token);
            }
            const suffix = match[2] || '';
            let quarters = 1;
            if (suffix.includes('2')) quarters = 2;
            if (suffix.includes("'")) quarters = suffix.includes('2') ? 2 : 3;
            if (suffix === "2'" || suffix === "'2") quarters = 2;
            return { face: match[1], quarters };
        });
    }

    /** Draait de zetten om: dezelfde reeks achterstevoren en andersom. */
    function invert(algorithm) {
        return parse(algorithm)
            .reverse()
            .map(move => {
                const suffix = move.quarters === 1 ? "'" : move.quarters === 2 ? '2' : '';
                return move.face + suffix;
            })
            .join(' ');
    }

    /** Een opgeloste kubus: op plek i ligt plaatje i. */
    function solved() {
        return STICKERS.map((_, index) => index);
    }

    /**
     * Voert de zetten uit op een stand. `state[i]` zegt welk plaatje er op
     * plek i ligt; de kleur van dat plaatje is STICKERS[state[i]].face.
     */
    function apply(state, algorithm) {
        const next = state.slice();
        parse(algorithm).forEach(move => {
            const permutation = PERMUTATIONS[move.face];
            for (let q = 0; q < move.quarters; q += 1) {
                const before = next.slice();
                for (let i = 0; i < 54; i += 1) {
                    next[permutation[i]] = before[i];
                }
            }
        });
        return next;
    }

    /** De stand na een reeks zetten, vanaf opgelost. */
    function after(algorithm) {
        return apply(solved(), algorithm);
    }

    /** De index in de stand van rij/kolom op een vlak. */
    function slot(face, row, col) {
        return SLOT_INDEX.get(key(cellPosition(face, row, col), FACES[face]));
    }

    /** Welke kleur (vlaknaam) ligt er op rij/kolom van een vlak? */
    function colorAt(state, face, row, col) {
        return STICKERS[state[slot(face, row, col)]].face;
    }

    /** Ligt elk plaatje weer thuis? */
    function isSolved(state) {
        return state.every((sticker, index) => STICKERS[sticker].face === STICKERS[index].face);
    }

    /**
     * Staan de onderste twee lagen goed? Dat is de controle die telt bij OLL
     * en PLL: die algoritmes mogen alles behalve de rest van de kubus slopen.
     */
    function firstTwoLayersSolved(state) {
        return STICKERS.every((sticker, index) => {
            if (sticker.pos[1] === 1) return true;          // bovenste laag: mag alles
            return STICKERS[state[index]].face === sticker.face;
        });
    }

    /** Ligt de hele bovenkant in één kleur? (Dat is waar OLL op uitkomt.) */
    function topOriented(state) {
        for (let row = 0; row < 3; row += 1) {
            for (let col = 0; col < 3; col += 1) {
                if (colorAt(state, 'U', row, col) !== 'U') return false;
            }
        }
        return true;
    }

    /* =====================================================================
     * Facelets: de kubus als tekst van 54 letters
     *
     * Smart cubes melden hun stand in de gangbare Kociemba-volgorde: eerst U,
     * dan R, F, D, L en B, elk vlak rij voor rij. Die volgorde en onze eigen
     * rij/kolom-indeling per vlak blijken precies samen te vallen, dus de
     * omzetting is alleen een kwestie van opzoeken.
     * ================================================================== */

    const KOCIEMBA = ['U', 'R', 'F', 'D', 'L', 'B'];

    function kociembaIndex(face, row, col) {
        return KOCIEMBA.indexOf(face) * 9 + row * 3 + col;
    }

    /** De stand als Kociemba-tekst, bijv. "UUUUUUUUURRRRRRRRR...". */
    function toFacelets(state) {
        let uit = '';
        KOCIEMBA.forEach(face => {
            for (let row = 0; row < 3; row += 1) {
                for (let col = 0; col < 3; col += 1) {
                    uit += colorAt(state, face, row, col);
                }
            }
        });
        return uit;
    }

    /** De sleutel van een stuk: de vlakken waar het naar wijst, gesorteerd. */
    function pieceKey(faces) {
        return faces.slice().sort().join('');
    }

    /** Welke plaatjes horen bij welk stuk, per plek. */
    const PIECES = (() => {
        const perPlek = new Map();
        STICKERS.forEach((sticker, index) => {
            const plek = sticker.pos.join(',');
            if (!perPlek.has(plek)) perPlek.set(plek, []);
            perPlek.get(plek).push(index);
        });
        return Array.from(perPlek.values());
    })();

    /** Van "de kleuren van dit stuk" naar de plaatjes van het stuk dat zo hoort. */
    const HOME_BY_COLORS = new Map(PIECES.map(slots => [
        pieceKey(slots.map(index => STICKERS[index].face)),
        slots
    ]));

    /**
     * Zet een Kociemba-tekst om naar een stand, of geeft null als de tekst
     * geen echte kubus beschrijft (een stuk met kleuren die niet bestaan, of
     * hetzelfde stuk twee keer). Dat laatste is ook hoe we merken dat een
     * smart cube met de verkeerde sleutel wordt uitgelezen: dan komt er
     * willekeurige rommel uit, en die valt hier door de mand.
     */
    function fromFacelets(text) {
        if (typeof text !== 'string' || text.length !== 54) return null;
        const state = new Array(54);
        const gebruikt = new Set();

        for (const slots of PIECES) {
            const kleuren = slots.map(index => {
                const s = STICKERS[index];
                return text.charAt(kociembaIndex(s.face, s.row, s.col));
            });
            const thuis = HOME_BY_COLORS.get(pieceKey(kleuren));
            if (!thuis) return null;
            const sleutel = thuis.join(',');
            if (gebruikt.has(sleutel)) return null;
            gebruikt.add(sleutel);

            slots.forEach((slotIndex, i) => {
                const doel = thuis.find(index => STICKERS[index].face === kleuren[i]);
                if (doel === undefined) return;
                state[slotIndex] = doel;
            });
        }
        return state.some(value => value === undefined) ? null : state;
    }

    /**
     * Liggen alle stukken die aan `test(pos)` voldoen goed? Een stuk ligt goed
     * als elk van zijn plaatjes de kleur heeft van het vlak waar het op zit.
     * Gebruikt voor de solve-analyse: kruis, F2L, OLL.
     */
    function piecesSolved(state, test) {
        return PIECES.every(slots => {
            if (!test(STICKERS[slots[0]].pos)) return true;
            return slots.every(index => STICKERS[state[index]].face === STICKERS[index].face);
        });
    }

    /** Heeft elk plaatje op dit vlak dezelfde kleur als het midden? */
    function faceUniform(state, face) {
        const midden = colorAt(state, face, 1, 1);
        for (let row = 0; row < 3; row += 1) {
            for (let col = 0; col < 3; col += 1) {
                if (colorAt(state, face, row, col) !== midden) return false;
            }
        }
        return true;
    }

    root.CubeTimerCube = {
        FACES: FACE_NAMES,
        NORMALS: FACES,
        toFacelets,
        fromFacelets,
        piecesSolved,
        faceUniform,
        STICKERS,
        parse,
        invert,
        solved,
        apply,
        after,
        slot,
        colorAt,
        isSolved,
        firstTwoLayersSolved,
        topOriented
    };
}(typeof window !== 'undefined' ? window : globalThis));
