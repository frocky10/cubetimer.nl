#!/usr/bin/env node
/**
 * Test de smart-cubedrivers zonder echte cube.
 *
 *     node tools/smartcube-testen.js
 *
 * Per merk wordt een nepcube (tools/nep-smartcube.js) verbonden via de echte
 * verbindingscode in public_html/Script/smartcube-protocols.js. Dan draaien we
 * een reeks zetten, laten er een paar onderweg verloren gaan, en controleren:
 *
 *   - komen alle zetten aan, in de goede volgorde, ook de verloren?
 *   - klopt de stand die de site bijhoudt met de echte stand van de cube?
 *   - komt de batterij door?
 *   - geeft een verkeerd MAC-adres een nette foutmelding in plaats van rommel?
 *
 * Voor GAN gaat het een stap verder: dezelfde nepcube wordt ook aan de
 * originele bibliotheek gan-web-bluetooth gevoerd, en de uitkomsten moeten
 * gelijk zijn. Dat is een onafhankelijke controle; voor de andere merken
 * bestaat zo'n referentie niet in bruikbare vorm, en toetst de test alleen
 * of heen en terug klopt. Een echte cube blijft dus de laatste test.
 *
 * De vergelijking met gan-web-bluetooth draait alleen als die bibliotheek te
 * vinden is. Zet daarvoor GAN_REF op de map van het npm-pakket, bijvoorbeeld:
 *
 *     npm pack gan-web-bluetooth && tar xzf gan-web-bluetooth-*.tgz
 *     (cd package && npm install aes-js rxjs)
 *     GAN_REF=$PWD/package node tools/smartcube-testen.js
 */
'use strict';

const path = require('path');
const script = path.join(__dirname, '..', 'public_html', 'Script');

globalThis.aesjs = require(path.join(script, 'vendor', 'aes.js'));
require(path.join(script, 'cube.js'));
require(path.join(script, 'smartcube-protocols.js'));
require(path.join(__dirname, 'nep-smartcube.js'));

const Cube = globalThis.CubeTimerCube;
const Smart = globalThis.CubeTimerSmartCube;
const Nep = globalThis.NepSmartCube;

const wacht = ms => new Promise(klaar => setTimeout(klaar, ms));
let fouten = 0;
function check(voorwaarde, tekst) {
    console.log((voorwaarde ? 'ok    ' : 'FOUT  ') + tekst);
    if (!voorwaarde) fouten += 1;
}

/** Een vaste reeks zodat elke run hetzelfde doet. */
function reeks(n, seed = 7) {
    let s = seed;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7FFFFFFF; return s / 0x7FFFFFFF; };
    const uit = [];
    let vorige = '';
    while (uit.length < n) {
        const face = 'URFDLB'[Math.floor(rnd() * 6)];
        if (face === vorige) continue;
        vorige = face;
        uit.push(face + (rnd() < 0.5 ? '' : "'"));
    }
    return uit;
}

/** Verbindt met onze eigen code en houdt bij wat er binnenkomt. */
async function verbindEigen(sim, { mac = null } = {}) {
    const log = { moves: [], facelets: [], battery: [], keyErrors: [], hardware: [] };
    const conn = await Smart.open(sim.device, {
        emit(type, data) {
            if (type === 'move') log.moves.push(data);
            if (type === 'facelets') log.facelets.push(data.facelets);
            if (type === 'battery') log.battery.push(data.level);
            if (type === 'keyError') log.keyErrors.push(data.reason);
            if (type === 'hardware') log.hardware.push(data);
        },
        status() {},
        storedMac: () => mac,
        askMac: async () => null,
        keyTimeout: 150,
        log: () => {}
    });
    await wacht(30);
    return { conn, log };
}

/** De stand die de site zou bijhouden: beginstand plus alle zetten. */
function bijgehouden(log) {
    let state = Cube.fromFacelets(log.facelets[0]);
    log.moves.forEach(m => { state = Cube.apply(state, m.move); });
    return Cube.toFacelets(state);
}

async function speel(sim, zetten, dropIndex = new Set()) {
    for (let i = 0; i < zetten.length; i += 1) {
        sim.turn(zetten[i], { drop: dropIndex.has(i) });
        await wacht(5);
    }
    await wacht(40);
}

/* -------------------------------------------------------------------------
 * GAN gen2, gen3, gen4 en AiCube
 * ---------------------------------------------------------------------- */

async function testGan(gen, { aiCube = false } = {}) {
    const naam = aiCube ? 'AiCube' : 'GAN gen' + gen;
    const sim = new Nep.SIMS.gan({ gen, aiCube });
    const { conn, log } = await verbindEigen(sim, { mac: sim.mac });
    check(conn.protocol.includes(aiCube ? 'AiCube' : 'gen' + gen), naam + ': protocol herkend als "' + conn.protocol + '"');
    check(log.facelets[0] === Cube.toFacelets(Cube.solved()), naam + ': beginstand opgelost ontvangen');
    check(log.battery.includes(77), naam + ': batterij 77% ontvangen');

    const zetten = reeks(40, gen * 11);
    // Gen2 stuurt de laatste zeven zetten altijd mee; gen3/4 vragen de
    // geschiedenis op. In beide gevallen mogen er zetten wegvallen.
    await speel(sim, zetten, new Set([5, 17, 18, 31]));
    check(log.moves.map(m => m.move).join(' ') === zetten.join(' '),
        naam + ': alle 40 zetten aangekomen, ook de 4 die onderweg wegvielen');
    check(bijgehouden(log) === sim.facelets, naam + ': bijgehouden stand gelijk aan de echte');
    check(log.keyErrors.length === 0, naam + ': geen sleutelfouten');
    await conn.close();

    // Verkeerd MAC-adres: nette melding, geen rommel als stand.
    const fout = await verbindEigen(new Nep.SIMS.gan({ gen, aiCube }), { mac: '11:22:33:44:55:66' });
    await wacht(200);
    check(fout.log.keyErrors.length > 0 && fout.log.facelets.length === 0,
        naam + ': verkeerd MAC-adres geeft een sleutelfout (' + (fout.log.keyErrors[0] || 'geen') + ')');
    await fout.conn.close();
}

/** Dezelfde nepcube, maar dan via gan-web-bluetooth zelf. */
async function vergelijkMetGanOrigineel(gen) {
    let ref;
    try {
        ref = require(path.join(process.env.GAN_REF || '', 'dist', 'cjs', 'index.cjs'));
    } catch (err) {
        return false;
    }
    const zetten = reeks(40, gen * 11);
    const drop = new Set([5, 17, 18, 31]);

    const simRef = new Nep.SIMS.gan({ gen });
    Nep.install(simRef, globalThis.navigator);
    const conn = await ref.connectGanCube(async () => simRef.mac);
    const refMoves = [];
    const refFacelets = [];
    conn.events$.subscribe(e => {
        if (e.type === 'MOVE') refMoves.push({ move: e.move, cubeTime: e.cubeTimestamp });
        if (e.type === 'FACELETS') refFacelets.push(e.facelets);
    });
    await conn.sendCubeCommand({ type: 'REQUEST_FACELETS' });
    await wacht(30);
    await speel(simRef, zetten, drop);
    await conn.sendCubeCommand({ type: 'REQUEST_FACELETS' });
    await wacht(30);

    const simEigen = new Nep.SIMS.gan({ gen });
    const eigen = await verbindEigen(simEigen, { mac: simEigen.mac });
    await speel(simEigen, zetten, drop);
    await eigen.conn.request('facelets');
    await wacht(30);

    check(refMoves.map(m => m.move).join(' ') === eigen.log.moves.map(m => m.move).join(' '),
        'GAN gen' + gen + ' tegen gan-web-bluetooth: zelfde zetten, in dezelfde volgorde');
    if (gen !== 2) {
        check(refMoves.map(m => m.cubeTime).join(',') === eigen.log.moves.map(m => m.cubeTime).join(','),
            'GAN gen' + gen + ' tegen gan-web-bluetooth: zelfde tijden van de cube');
    }
    check(refFacelets[refFacelets.length - 1] === eigen.log.facelets[eigen.log.facelets.length - 1],
        'GAN gen' + gen + ' tegen gan-web-bluetooth: zelfde eindstand');
    await conn.disconnect();
    await eigen.conn.close();
    return true;
}

/* -------------------------------------------------------------------------
 * De andere merken
 * ---------------------------------------------------------------------- */

async function testQiyi() {
    const sim = new Nep.SIMS.qiyi();
    // Geen opgeslagen MAC: de driver moet hem uit de naam afleiden.
    const { conn, log } = await verbindEigen(sim);
    check(conn.mac.source === 'naam' && conn.mac.mac === sim.mac, 'QiYi: MAC-adres afgeleid uit de naam (' + conn.mac.mac + ')');
    check(sim.greeted, 'QiYi: begroeting met het juiste MAC-adres aangekomen');
    check(log.facelets.length > 0 && log.battery.includes(88), 'QiYi: stand en batterij ontvangen');

    const zetten = reeks(30, 3);
    await speel(sim, zetten, new Set([4, 12, 13]));
    check(log.moves.map(m => m.move).join(' ') === zetten.join(' '), 'QiYi: alle 30 zetten, ook de 3 die wegvielen');
    check(bijgehouden(log) === sim.facelets, 'QiYi: bijgehouden stand gelijk aan de echte');
    check(sim.acks === sim.sent, 'QiYi: elk ontvangen bericht bevestigd (' + sim.acks + ' van ' + sim.sent + '), anders stopt de cube');
    check(log.moves.every(m => typeof m.cubeTime === 'number'), 'QiYi: tijden van de cube aanwezig');
    await conn.close();

    const fout = await verbindEigen(new Nep.SIMS.qiyi({ name: 'QY-QYSC-S-FFFF' }));
    await wacht(200);
    check(fout.log.facelets.length === 0 && fout.log.keyErrors.includes('geen antwoord'),
        'QiYi met verkeerd MAC-adres: cube zwijgt, en dat wordt als sleutelfout gemeld');
    await fout.conn.close();
}

async function testMoyu32() {
    const sim = new Nep.SIMS.moyu32();
    const { conn, log } = await verbindEigen(sim);
    check(conn.mac.source === 'naam', 'MoYu: MAC-adres afgeleid uit de naam (' + conn.mac.mac + ')');
    check(log.facelets.length > 0 && log.battery.includes(55), 'MoYu: stand en batterij ontvangen');
    const zetten = reeks(30, 5);
    await speel(sim, zetten);
    check(log.moves.map(m => m.move).join(' ') === zetten.join(' '), 'MoYu: alle 30 zetten');
    check(bijgehouden(log) === sim.facelets, 'MoYu: bijgehouden stand gelijk aan de echte');
    await conn.close();

    const fout = await verbindEigen(new Nep.SIMS.moyu32(), { mac: '11:22:33:44:55:66' });
    await wacht(200);
    check(fout.log.keyErrors.length > 0 && fout.log.facelets.length === 0, 'MoYu met verkeerd MAC-adres: sleutelfout');
    await fout.conn.close();
}

async function testGen1() {
    const sim = new Nep.SIMS.gen1();
    const { conn, log } = await verbindEigen(sim);
    check(conn.protocol === 'GAN gen1', 'GAN gen1: protocol herkend');
    check(log.facelets[0] === Cube.toFacelets(Cube.solved()), 'GAN gen1: stand uitgelezen');
    const zetten = reeks(20, 9);
    for (const z of zetten) { sim.turn(z); await wacht(15); }
    await wacht(60);
    check(log.moves.map(m => m.move).join(' ') === zetten.join(' '), 'GAN gen1: alle 20 zetten via uitlezen');
    await conn.request('battery');
    await wacht(20);
    check(log.battery.includes(64), 'GAN gen1: batterij uitgelezen');
    await conn.close();
}

async function testGiiker() {
    const sim = new Nep.SIMS.giiker();
    const { conn, log } = await verbindEigen(sim);
    check(log.facelets[0] === Cube.toFacelets(Cube.solved()), 'Giiker: beginstand uitgelezen');
    const zetten = reeks(25, 13);
    await speel(sim, zetten);
    check(log.moves.map(m => m.move).join(' ') === zetten.join(' '), 'Giiker: alle 25 zetten');
    check(log.facelets[log.facelets.length - 1] === sim.facelets, 'Giiker: gemelde stand gelijk aan de echte');
    await conn.close();
}

async function testGoCube() {
    const sim = new Nep.SIMS.gocube();
    const { conn, log } = await verbindEigen(sim);
    check(log.facelets[0] === Cube.toFacelets(Cube.solved()) && log.battery.includes(91), 'GoCube: stand en batterij');
    const zetten = reeks(25, 17);
    await speel(sim, zetten);
    check(log.moves.map(m => m.move).join(' ') === zetten.join(' '), 'GoCube: alle 25 zetten');
    await conn.request('facelets');
    await wacht(20);
    check(log.facelets[log.facelets.length - 1] === sim.facelets, 'GoCube: opgevraagde stand gelijk aan de echte');
    await conn.close();
}

function testKeuzevenster() {
    const opties = Smart.requestOptions();
    const prefixen = opties.filters.map(f => f.namePrefix);
    check(['GAN', 'MG', 'AiCube', 'QY-QYSC', 'XMD-TornadoV4-i', 'WCU_MY3', 'MHC', 'Gi', 'GoCube', 'Rubiks'].every(p => prefixen.includes(p)),
        'keuzevenster: alle merken staan in het filter (' + prefixen.length + ' namen)');
    check(!opties.acceptAllDevices, 'keuzevenster: toont alleen cubes, geen koptelefoons');
    check(Smart.brandFor('GANicXS_12AB').id === 'gan' && Smart.brandFor('Giiker').id === 'giiker'
        && Smart.brandFor('GoCube_1').id === 'gocube' && Smart.brandFor('QY-QYSC-S-1234').id === 'qiyi',
        'merk herkend aan de naam, de langste passende naam wint');
}

(async function main() {
    testKeuzevenster();
    for (const gen of [2, 3, 4]) await testGan(gen);
    await testGan(2, { aiCube: true });
    let vergeleken = false;
    for (const gen of [2, 3, 4]) vergeleken = (await vergelijkMetGanOrigineel(gen)) || vergeleken;
    if (!vergeleken) console.log('--    vergelijking met gan-web-bluetooth overgeslagen (zet GAN_REF)');
    await testGen1();
    await testQiyi();
    await testMoyu32();
    await testGiiker();
    await testGoCube();

    if (fouten) {
        console.log('\n' + fouten + ' controle' + (fouten === 1 ? '' : 's') + ' mislukt.');
        process.exit(1);
    }
    console.log('\nAlle drivers doen wat ze moeten doen.');
    process.exit(0);
}());
