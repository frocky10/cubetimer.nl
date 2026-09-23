/**
 * CubeTimer - smart cube: het rekenwerk
 * ---------------------------------------------------------------------------
 * Houdt de stand van de cube bij, volgt de scramble, weet wanneer een solve
 * begint en eindigt, en maakt er na afloop een analyse van. Geen Bluetooth en
 * geen interface: dat doen smartcube-protocols.js en smartcube.js. Daardoor
 * is dit deel los te testen (tools/smartcube-testen.js).
 *
 * De scramble wordt gevolgd op de *stand*, niet door zetten af te tellen.
 * Smart cubes melden alleen kwartslagen, dus een R2 uit de scramble komt
 * binnen als R R, of als R' R'. En wie een zet verkeerd doet en hem meteen
 * terugdraait, zit daarna gewoon weer op het goede spoor. Met tellen gaat
 * dat allebei mis; met vergelijken van standen niet.
 */
(function (root) {
    'use strict';

    const Cube = root.CubeTimerCube;

    const PHASES = [
        { key: 'cross', label: 'Kruis' },
        { key: 'f2l', label: 'F2L' },
        { key: 'oll', label: 'OLL' },
        { key: 'pll', label: 'PLL' }
    ];

    const tegenover = { U: 'D', D: 'U', F: 'B', B: 'F', R: 'L', L: 'R' };

    /* =====================================================================
     * Zetten samenvoegen
     *
     * Een smart cube meldt R2 als twee keer R. Voor de oplossing die je terug
     * wilt lezen, en voor het aantal zetten, voegen we opeenvolgende draaien
     * van hetzelfde vlak samen: R R wordt R2, R R' valt weg.
     * ================================================================== */

    function mergeMoves(moves) {
        const uit = [];
        moves.forEach(move => {
            const face = move[0];
            const kwart = move.includes('2') ? 2 : move.includes("'") ? 3 : 1;
            const vorige = uit[uit.length - 1];
            if (vorige && vorige.face === face) {
                vorige.kwart = (vorige.kwart + kwart) % 4;
                if (vorige.kwart === 0) uit.pop();
            } else {
                uit.push({ face, kwart });
            }
        });
        return uit.map(m => m.face + ['', '', '2', "'"][m.kwart]);
    }

    /* =====================================================================
     * Tijden
     * ================================================================== */

    /**
     * Zet de tijden van de zetten om naar milliseconden vanaf de eerste zet.
     *
     * Heeft de cube zelf een klok (GAN, QiYi, MoYu), dan gebruiken we die: de
     * Bluetooth-vertraging schommelt, de klok in de cube niet. Ontbreekt een
     * tijd (bij een zet die later is teruggehaald), dan vullen we die in met
     * de buren. Zonder klok in de cube gebruiken we het moment van ontvangst.
     */
    function moveTimes(moves) {
        const heeftKlok = moves.length > 0 && moves.filter(m => typeof m.cubeTime === 'number').length >= moves.length / 2;
        const bron = moves.map(m => (heeftKlok ? m.cubeTime : m.localTime));

        // Gaten vullen: eerst naar achteren, dan naar voren.
        for (let i = bron.length - 2; i >= 0; i -= 1) {
            if (typeof bron[i] !== 'number' && typeof bron[i + 1] === 'number') bron[i] = bron[i + 1];
        }
        for (let i = 1; i < bron.length; i += 1) {
            if (typeof bron[i] !== 'number') bron[i] = bron[i - 1];
        }
        if (!bron.length || typeof bron[0] !== 'number') return { times: moves.map(() => 0), hardware: false };

        const start = bron[0];
        let vorige = 0;
        const times = bron.map(t => {
            // Nooit terug in de tijd, ook niet als een klok even hikt.
            vorige = Math.max(vorige, Math.round(t - start));
            return vorige;
        });
        return { times, hardware: heeftKlok };
    }

    /* =====================================================================
     * De analyse
     * ================================================================== */

    const normaal = face => Cube.NORMALS[face];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const isEdge = pos => pos.filter(v => v !== 0).length === 2;

    function crossDone(state, face) {
        const n = normaal(face);
        return Cube.piecesSolved(state, pos => isEdge(pos) && dot(pos, n) === 1);
    }

    function f2lDone(state, face) {
        const n = normaal(face);
        return Cube.piecesSolved(state, pos => dot(pos, n) >= 0);
    }

    function ollDone(state, face) {
        return f2lDone(state, face) && Cube.faceUniform(state, tegenover[face]);
    }

    /**
     * Splitst een solve in kruis, F2L, OLL en PLL.
     *
     * Het kruis mag op elke kleur: we kijken welk kruis er het eerst ligt.
     * Een fase die je overslaat (een OLL-skip) krijgt nul zetten en nul tijd.
     * Een fase die er tussendoor even lag en weer werd afgebroken telt pas als
     * hij er echt ligt op het moment dat de volgende begint; daarom zoeken we
     * steeds het laatste moment dat een fase af was vóór de volgende af is.
     */
    function analyse(startFacelets, moves) {
        const start = Cube.fromFacelets(startFacelets);
        if (!start || !moves.length) return null;

        const states = [start];
        let state = start;
        moves.forEach(m => { state = Cube.apply(state, m.move); states.push(state); });
        const eind = states.length - 1;
        const { times, hardware } = moveTimes(moves);
        const tijdNa = i => (i <= 0 ? 0 : times[i - 1]);   // state i = na zet i

        // Welk kruis ligt er het eerst?
        let kruisVlak = null;
        let kruisIndex = Infinity;
        ['U', 'D', 'F', 'B', 'R', 'L'].forEach(face => {
            const i = states.findIndex(s => crossDone(s, face));
            if (i !== -1 && i < kruisIndex) {
                kruisIndex = i;
                kruisVlak = face;
            }
        });

        const merged = mergeMoves(moves.map(m => m.move));
        const duur = times[times.length - 1] || 0;
        const basis = {
            moves: merged.length,
            tps: duur > 0 ? Math.round((merged.length / (duur / 1000)) * 100) / 100 : 0,
            solution: merged.join(' '),
            hardwareTimes: hardware
        };
        if (!kruisVlak || !Cube.isSolved(states[eind])) return { ...basis, phases: [] };

        // Het eerste moment waarop elke fase af is, en blijft tot de volgende.
        const eerste = (vanaf, test) => {
            for (let i = vanaf; i <= eind; i += 1) if (test(states[i])) return i;
            return eind;
        };
        const fAf = eerste(kruisIndex, s => f2lDone(s, kruisVlak));
        const oAf = eerste(fAf, s => ollDone(s, kruisVlak));
        const pAf = eind;
        const grenzen = [kruisIndex, fAf, oAf, pAf];

        // Aantal zetten per fase, na samenvoegen binnen de fase.
        const phases = PHASES.map((phase, k) => {
            const van = k === 0 ? 0 : grenzen[k - 1];
            const tot = grenzen[k];
            const zetten = mergeMoves(moves.slice(van, tot).map(m => m.move)).length;
            return {
                key: phase.key,
                ms: Math.max(0, tijdNa(tot) - tijdNa(van)),
                moves: zetten
            };
        });

        return { ...basis, crossFace: kruisVlak, phases };
    }

    /* =====================================================================
     * De tracker
     * ================================================================== */

    const SOLVED = () => Cube.toFacelets(Cube.solved());

    class Tracker {
        constructor() {
            this.state = Cube.solved();
            this.facelets = SOLVED();
            this.scramble = [];
            this.targets = [];
            this.step = 0;
            this.phase = 'idle';          // idle | scrambling | armed | solving
            this.solveMoves = [];
            this.solveStart = null;
            this.recent = [];
            this.lastMatch = 0;
        }

        /** Beginstand zetten, bijvoorbeeld na het verbinden. */
        reset(facelets) {
            const state = facelets ? Cube.fromFacelets(facelets) : Cube.solved();
            if (!state) return false;
            this.state = state;
            this.facelets = Cube.toFacelets(state);
            this.recent = [];
            this.cancelSolve();
            this.follow();
            return true;
        }

        /**
         * Nieuwe scramble om te volgen. Per zet bewaren we de stand erna, en bij
         * een halve slag ook de stand halverwege (na één kwartslag, links- of
         * rechtsom), zodat de voortgang ook tussendoor klopt.
         */
        setScramble(text) {
            this.scramble = [];
            this.targets = [{ step: 0, facelets: SOLVED() }];
            let tokens = [];
            try {
                tokens = Cube.parse(text || '');
            } catch (err) {
                tokens = [];
            }
            const toegestaan = tokens.every(t => 'URFDLB'.includes(t.face));
            if (toegestaan) {
                let state = Cube.solved();
                tokens.forEach((t, i) => {
                    const naam = t.face + ['', '', '2', "'"][t.quarters];
                    this.scramble.push(naam);
                    if (t.quarters === 2) {
                        this.targets.push({ step: 2 * i + 1, facelets: Cube.toFacelets(Cube.apply(state, t.face)) });
                        this.targets.push({ step: 2 * i + 1, facelets: Cube.toFacelets(Cube.apply(state, t.face + "'")) });
                    }
                    state = Cube.apply(state, naam);
                    this.targets.push({ step: 2 * (i + 1), facelets: Cube.toFacelets(state) });
                });
            }
            if (this.phase !== 'solving') this.phase = this.scramble.length ? 'scrambling' : 'idle';
            this.lastMatch = 0;
            this.follow();
        }

        /** Hoe ver is de scramble, en wat is de stand van zaken? */
        follow() {
            if (this.phase === 'solving' || !this.scramble.length) return;
            let beste = -1;
            this.targets.forEach(t => {
                if (t.facelets === this.facelets && t.step > beste) beste = t.step;
            });
            const totaal = 2 * this.scramble.length;
            if (beste === totaal) {
                this.step = totaal;
                this.status = 'klaar';
                this.phase = 'armed';
            } else if (beste >= 0) {
                this.step = beste;
                this.lastMatch = beste;
                this.status = beste === 0 ? 'wacht' : 'bezig';
                this.phase = 'scrambling';
            } else {
                // Niets past. Was je al bezig, dan is het een verkeerde zet;
                // anders lag de cube bij het begin al niet opgelost.
                this.status = this.lastMatch > 0 ? 'afwijking' : 'eerst-oplossen';
                this.phase = 'scrambling';
            }
        }

        get progress() {
            return {
                done: Math.floor(this.step / 2),
                half: this.step % 2 === 1,
                total: this.scramble.length,
                status: this.status || 'wacht',
                phase: this.phase,
                tokens: this.scramble.slice()
            };
        }

        get isSolved() {
            return this.facelets === SOLVED();
        }

        /**
         * Een zet van de cube. Geeft terug wat er daardoor gebeurde, zodat de
         * interface en de timer kunnen reageren:
         *   { start: true }                 de solve is net begonnen
         *   { solved: true, analysis, ms }  de solve is af
         */
        applyMove(move) {
            const naam = move.move;
            this.state = Cube.apply(this.state, naam);
            this.facelets = Cube.toFacelets(this.state);
            this.recent.push(naam);
            if (this.recent.length > 40) this.recent.shift();

            const uit = {};
            if (this.phase === 'armed') {
                this.phase = 'solving';
                this.solveStart = this.targets[this.targets.length - 1].facelets;
                this.solveMoves = [];
                uit.start = true;
            }
            if (this.phase === 'solving') {
                this.solveMoves.push(move);
                if (this.isSolved) {
                    const analysis = analyse(this.solveStart, this.solveMoves);
                    const { times } = moveTimes(this.solveMoves);
                    uit.solved = true;
                    uit.analysis = analysis;
                    uit.ms = times[times.length - 1] || 0;
                    uit.hardware = analysis ? analysis.hardwareTimes : false;
                    this.phase = 'idle';
                    this.solveMoves = [];
                }
                return uit;
            }
            this.follow();
            return uit;
        }

        /**
         * De cube meldt zijn eigen stand. Wijkt die af van wat wij denken, dan
         * heeft de cube gelijk: dan is er ergens een zet gemist die we niet
         * konden terughalen.
         */
        syncFacelets(facelets) {
            if (facelets === this.facelets) return false;
            const state = Cube.fromFacelets(facelets);
            if (!state) return false;
            this.state = state;
            this.facelets = facelets;
            if (this.phase === 'solving' && this.isSolved) {
                // Opgelost volgens de cube zelf; de laatste zet kwam niet door.
                return 'solved';
            }
            this.follow();
            return true;
        }

        cancelSolve() {
            if (this.phase === 'solving') this.phase = this.scramble.length ? 'scrambling' : 'idle';
            this.solveMoves = [];
            this.solveStart = null;
        }
    }

    root.CubeTimerSmartEngine = { Tracker, analyse, mergeMoves, moveTimes, PHASES };
}(typeof window !== 'undefined' ? window : globalThis));
