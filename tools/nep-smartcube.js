/**
 * Nagebootste smart cubes, om zonder echte cube te kunnen testen.
 *
 * Bootst Web Bluetooth na (apparaat, services, kenmerken, meldingen) en per
 * merk een cube die zich gedraagt zoals het protocol voorschrijft: antwoordt
 * op verzoeken, meldt zetten versleuteld, en kan een zet "kwijtraken" om te
 * testen of gemiste zetten worden teruggehaald.
 *
 * Gebruikt door tools/smartcube-testen.js (Node) en door de browsertest, die
 * dit bestand in de pagina laadt. Heeft aes.js en cube.js nodig.
 *
 * Belangrijk: deze nabootsing is geschreven vanuit hetzelfde begrip van de
 * protocollen als de drivers zelf. Voor GAN toetst de test daarom ook tegen
 * het origineel (gan-web-bluetooth); voor de andere merken bewijst een groene
 * test dat heen en terug klopt, niet dat een echte cube het zo doet.
 */
(function (root) {
    'use strict';

    const aesjs = root.aesjs || require('../public_html/Script/vendor/aes.js');
    const Cube = root.CubeTimerCube;

    const uuid16 = s => '0000' + s + '-0000-1000-8000-00805f9b34fb';

    /* ---------------------------------------------------------------------
     * Nep-Web Bluetooth
     * ------------------------------------------------------------------ */

    class Emitter {
        constructor() { this.listeners = {}; }
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
        removeEventListener(type, fn) {
            this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn);
        }
        dispatch(type, event) { (this.listeners[type] || []).slice().forEach(fn => fn(event)); }
    }

    class FakeCharacteristic extends Emitter {
        constructor(uuid, { onWrite, onRead } = {}) {
            super();
            this.uuid = uuid;
            this.onWrite = onWrite;
            this.onRead = onRead;
            this.notifying = false;
            this.value = null;
            this.busy = false;
        }
        async startNotifications() { this.notifying = true; return this; }
        async stopNotifications() { this.notifying = false; return this; }
        async writeValue(data) {
            // Zoals Chrome: twee schrijfacties tegelijk is een fout.
            if (this.busy) throw new Error('GATT operation already in progress.');
            this.busy = true;
            await Promise.resolve();
            const bytes = new Uint8Array(data.buffer ? data.buffer.slice(data.byteOffset || 0, (data.byteOffset || 0) + data.byteLength) : data);
            this.busy = false;
            if (this.onWrite) setTimeout(() => this.onWrite(bytes), 0);
        }
        async writeValueWithResponse(data) { return this.writeValue(data); }
        async readValue() {
            const bytes = this.onRead ? this.onRead() : new Uint8Array(0);
            return new DataView(new Uint8Array(bytes).buffer);
        }
        notify(bytes) {
            if (!this.notifying) return;
            this.value = new DataView(new Uint8Array(bytes).buffer);
            this.dispatch('characteristicvaluechanged', { target: this });
        }
    }

    class FakeService {
        constructor(uuid, characteristics) {
            this.uuid = uuid;
            this.chars = characteristics;
        }
        async getCharacteristic(uuid) {
            const c = this.chars.find(x => x.uuid === uuid.toLowerCase());
            if (!c) throw new Error('No Characteristics matching UUID ' + uuid);
            return c;
        }
        async getCharacteristics() { return this.chars.slice(); }
    }

    class FakeDevice extends Emitter {
        constructor(name, services, { manufacturerData = null } = {}) {
            super();
            this.name = name;
            this.id = 'nep-' + name;
            const device = this;
            this.gatt = {
                connected: false,
                device,
                async connect() { this.connected = true; return this; },
                disconnect() {
                    if (!this.connected) return;
                    this.connected = false;
                    device.dispatch('gattserverdisconnected', { target: device });
                },
                async getPrimaryServices() { return services.slice(); },
                async getPrimaryService(uuid) {
                    const s = services.find(x => x.uuid === uuid.toLowerCase());
                    if (!s) throw new Error('No Services matching UUID ' + uuid);
                    return s;
                }
            };
            if (manufacturerData) {
                this.watchAdvertisements = async () => {
                    setTimeout(() => {
                        this.dispatch('advertisementreceived', { manufacturerData: new Map() });  // eerst leeg, zoals Windows
                        this.dispatch('advertisementreceived', { manufacturerData });
                    }, 10);
                };
            }
        }
    }

    /* ---------------------------------------------------------------------
     * Bits schrijven
     * ------------------------------------------------------------------ */

    class BitWriter {
        constructor(bytes) { this.bits = new Array(bytes * 8).fill('0'); }
        set(start, length, value, littleEndian = false) {
            if (length === 16 || length === 32) {
                const n = length / 8;
                const bytes = [];
                for (let i = 0; i < n; i += 1) bytes.push((value >>> (8 * i)) & 0xFF);
                if (!littleEndian) bytes.reverse();
                bytes.forEach((b, i) => this.set(start + 8 * i, 8, b));
                return this;
            }
            const s = (value >>> 0).toString(2).padStart(length, '0').slice(-length);
            for (let i = 0; i < length; i += 1) this.bits[start + i] = s[i];
            return this;
        }
        bytes() {
            const out = new Uint8Array(this.bits.length / 8);
            for (let i = 0; i < out.length; i += 1) out[i] = parseInt(this.bits.slice(i * 8, i * 8 + 8).join(''), 2);
            return out;
        }
    }

    /* ---------------------------------------------------------------------
     * Versleuteling, zoals de cube het doet (spiegel van de drivers)
     * ------------------------------------------------------------------ */

    function saltedKey(base, mac) {
        const salt = mac.split(':').map(h => parseInt(h, 16)).reverse();
        const key = base.key.slice(), iv = base.iv.slice();
        for (let i = 0; i < 6; i += 1) {
            key[i] = (base.key[i] + salt[i]) % 0xFF;
            iv[i] = (base.iv[i] + salt[i]) % 0xFF;
        }
        const aes = new aesjs.AES(key);
        const enc = (buf, off) => {
            const b = buf.slice(off, off + 16);
            for (let i = 0; i < 16; i += 1) b[i] ^= iv[i];
            buf.set(aes.encrypt(b), off);
        };
        const dec = (buf, off) => {
            const b = aes.decrypt(buf.slice(off, off + 16));
            for (let i = 0; i < 16; i += 1) b[i] ^= iv[i];
            buf.set(b, off);
        };
        return {
            encrypt(data) { const u = new Uint8Array(data); enc(u, 0); if (u.length > 16) enc(u, u.length - 16); return u; },
            decrypt(data) { const u = new Uint8Array(data); if (u.length > 16) dec(u, u.length - 16); dec(u, 0); return u; }
        };
    }

    const KEYS = {
        gan: {
            key: [0x01, 0x02, 0x42, 0x28, 0x31, 0x91, 0x16, 0x07, 0x20, 0x05, 0x18, 0x54, 0x42, 0x11, 0x12, 0x53],
            iv: [0x11, 0x03, 0x32, 0x28, 0x21, 0x01, 0x76, 0x27, 0x20, 0x95, 0x78, 0x14, 0x32, 0x12, 0x02, 0x43]
        },
        aiCube: {
            key: [0x05, 0x12, 0x02, 0x45, 0x02, 0x01, 0x29, 0x56, 0x12, 0x78, 0x12, 0x76, 0x81, 0x01, 0x08, 0x03],
            iv: [0x01, 0x44, 0x28, 0x06, 0x86, 0x21, 0x22, 0x28, 0x51, 0x05, 0x08, 0x31, 0x82, 0x02, 0x21, 0x06]
        },
        moyu32: {
            key: [0x15, 0x77, 0x3a, 0x5c, 0x67, 0x0e, 0x2d, 0x1f, 0x17, 0x67, 0x2a, 0x13, 0x9b, 0x67, 0x52, 0x57],
            iv: [0x11, 0x23, 0x26, 0x25, 0x86, 0x2a, 0x2c, 0x3b, 0x55, 0x06, 0x7f, 0x31, 0x7e, 0x67, 0x21, 0x57]
        },
        gen1: [0xc6, 0xca, 0x15, 0xdf, 0x4f, 0x6e, 0x13, 0xb6, 0x77, 0x0d, 0xe6, 0x59, 0x3a, 0xaf, 0xba, 0xa2],
        qiyi: [0x57, 0xb1, 0xf9, 0xab, 0xcd, 0x5a, 0xe8, 0xa7, 0x9c, 0xb9, 0x8c, 0xe7, 0x57, 0x8c, 0x51, 0x08]
    };

    /* ---------------------------------------------------------------------
     * Van facelets naar stukjes (omgekeerde van cubiesToFacelets)
     * ------------------------------------------------------------------ */

    const CORNERS = [[8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11], [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51]];
    const EDGES = [[5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25], [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14]];
    const CORNERS_GIIKER = [[26, 15, 29], [20, 8, 9], [18, 38, 6], [24, 27, 44], [51, 35, 17], [45, 11, 2], [47, 0, 36], [53, 42, 33]];
    const EDGES_GIIKER = [[25, 28], [23, 12], [19, 7], [21, 41], [32, 16], [5, 10], [3, 37], [30, 43], [52, 34], [48, 14], [46, 1], [50, 39]];

    function cubies(facelets, corners = CORNERS, edges = EDGES) {
        const face = i => 'URFDLB'[Math.floor(i / 9)];
        const zoek = (map, i, n) => {
            for (let j = 0; j < map.length; j += 1) {
                for (let o = 0; o < n; o += 1) {
                    let ok = true;
                    for (let p = 0; p < n; p += 1) {
                        if (facelets[map[i][(p + o) % n]] !== face(map[j][p])) { ok = false; break; }
                    }
                    if (ok) return [j, o];
                }
            }
            throw new Error('Geen geldige stand');
        };
        const cp = [], co = [], ep = [], eo = [];
        for (let i = 0; i < 8; i += 1) { const [j, o] = zoek(corners, i, 3); cp.push(j); co.push(o); }
        for (let i = 0; i < 12; i += 1) { const [j, o] = zoek(edges, i, 2); ep.push(j); eo.push(o); }
        return { cp, co, ep, eo };
    }

    /* ---------------------------------------------------------------------
     * De nepcubes
     * ------------------------------------------------------------------ */

    const FACES = 'URFDLB';
    const splitMove = m => ({ face: m[0], suffix: m.slice(1) });

    /** Basis: houdt de echte stand bij met cube.js. */
    class SimBase {
        constructor() {
            this.state = Cube.solved();
            this.clock = 1000;
            this.log = [];
        }
        get facelets() { return Cube.toFacelets(this.state); }
        applyMove(m) { this.state = Cube.apply(this.state, m); }
    }

    /** GAN gen2, gen3 en gen4 (en de AiCube, met de andere sleutel). */
    class GanSim extends SimBase {
        constructor({ gen = 2, mac = 'AB:12:34:CD:56:EF', name, battery = 77, aiCube = false } = {}) {
            super();
            this.gen = gen;
            this.mac = mac;
            this.battery = battery;
            this.serial = 0;
            this.recent = [];      // voor gen2: de laatste zeven zetten
            this.history = {};     // serial -> zet, voor gen3/4
            this.cipher = saltedKey(aiCube ? KEYS.aiCube : KEYS.gan, mac);
            const svc = {
                2: ['6e400001-b5a3-f393-e0a9-e50e24dc4179', '28be4cb6-cd67-11e9-a32f-2a2ae2dbcce4', '28be4a4a-cd67-11e9-a32f-2a2ae2dbcce4'],
                3: ['8653000a-43e6-47b7-9cb0-5fc21d4ae340', '8653000b-43e6-47b7-9cb0-5fc21d4ae340', '8653000c-43e6-47b7-9cb0-5fc21d4ae340'],
                4: ['00000010-0000-fff7-fff6-fff5fff4fff0', uuid16('fff6'), uuid16('fff5')]
            }[gen];
            this.stateChar = new FakeCharacteristic(svc[1]);
            this.commandChar = new FakeCharacteristic(svc[2], { onWrite: bytes => this.onCommand(this.cipher.decrypt(bytes)) });
            const macBytes = mac.split(':').map(h => parseInt(h, 16));
            const mfd = new Uint8Array([0x00, 0x01, 0x02, ...macBytes.slice().reverse()]);
            this.device = new FakeDevice(name || (aiCube ? 'AiCube-1234' : 'GANicXS_12AB'),
                [new FakeService(svc[0], [this.stateChar, this.commandChar])],
                { manufacturerData: new Map([[0x0101, new DataView(mfd.buffer)]]) });
        }

        send(bytes) { this.stateChar.notify(this.cipher.encrypt(bytes)); }

        faceletsMessage() {
            const { cp, co, ep, eo } = cubies(this.facelets);
            if (this.gen === 2) {
                const w = new BitWriter(20).set(0, 4, 0x4).set(4, 8, this.serial & 0xFF);
                for (let i = 0; i < 7; i += 1) { w.set(12 + i * 3, 3, cp[i]); w.set(33 + i * 2, 2, co[i]); }
                for (let i = 0; i < 11; i += 1) { w.set(47 + i * 4, 4, ep[i]); w.set(91 + i, 1, eo[i]); }
                return w.bytes();
            }
            const w = new BitWriter(20);
            let base;
            if (this.gen === 3) { w.set(0, 8, 0x55).set(8, 8, 0x02).set(16, 8, 0x0F).set(24, 16, this.serial & 0xFFFF, true); base = 40; }
            else { w.set(0, 8, 0xED).set(8, 8, 0x12).set(16, 16, this.serial & 0xFFFF, true); base = 32; }
            for (let i = 0; i < 7; i += 1) { w.set(base + i * 3, 3, cp[i]); w.set(base + 21 + i * 2, 2, co[i]); }
            for (let i = 0; i < 11; i += 1) { w.set(base + 37 + i * 4, 4, ep[i]); w.set(base + 81 + i, 1, eo[i]); }
            return w.bytes();
        }

        batteryMessage() {
            if (this.gen === 2) return new BitWriter(20).set(0, 4, 0x9).set(8, 8, this.battery).bytes();
            if (this.gen === 3) return new BitWriter(20).set(0, 8, 0x55).set(8, 8, 0x10).set(16, 8, 1).set(24, 8, this.battery).bytes();
            return new BitWriter(20).set(0, 8, 0xEF).set(8, 8, 1).set(16, 8, this.battery).bytes();
        }

        onCommand(msg) {
            this.log.push(Array.from(msg.slice(0, 6)));
            const c = this.gen === 2 ? msg[0] : this.gen === 3 ? (msg[0] === 0x68 ? msg[1] : -1) : msg[0];
            if (this.gen === 2) {
                if (c === 0x04) this.send(this.faceletsMessage());
                if (c === 0x09) this.send(this.batteryMessage());
                return;
            }
            if (this.gen === 3) {
                if (c === 0x01) this.send(this.faceletsMessage());
                if (c === 0x07) this.send(this.batteryMessage());
                if (c === 0x03) this.sendHistory(msg[2], msg[4]);
                return;
            }
            if (msg[0] === 0xDD && msg[3] === 0xED) this.send(this.faceletsMessage());
            if (msg[0] === 0xDD && msg[3] === 0xEF) this.send(this.batteryMessage());
            if (msg[0] === 0xD1) this.sendHistory(msg[2], msg[4]);
        }

        sendHistory(startSerial, count) {
            const w = new BitWriter(20);
            const faceCode = f => [1, 5, 3, 0, 4, 2][FACES.indexOf(f)];   // U R F D L B zoals de cube ze codeert
            const base = this.gen === 3 ? 32 : 24;
            if (this.gen === 3) w.set(0, 8, 0x55).set(8, 8, 0x06).set(16, 8, count / 2 + 1).set(24, 8, startSerial);
            else w.set(0, 8, 0xD1).set(8, 8, count / 2 + 1).set(16, 8, startSerial);
            for (let i = 0; i < count; i += 1) {
                const m = this.history[(startSerial - i) & 0xFF];
                if (!m) { w.set(base + 4 * i, 3, 7); continue; }   // 7 = geen zet
                w.set(base + 4 * i, 3, faceCode(m[0])).set(base + 4 * i + 3, 1, m.includes("'") ? 1 : 0);
            }
            this.send(w.bytes());
        }

        /** Een kwartslag. `drop` = het pakketje gaat onderweg verloren. */
        turn(m, { drop = false, elapsed = 120 } = {}) {
            this.applyMove(m);
            this.clock += elapsed;
            this.serial = (this.serial + 1) & 0xFF;
            const { face, suffix } = splitMove(m);
            const dir = suffix === "'" ? 1 : 0;
            this.history[this.serial] = m;
            this.recent.unshift({ face, dir, elapsed });
            this.recent = this.recent.slice(0, 7);
            if (drop) return;

            if (this.gen === 2) {
                const w = new BitWriter(20).set(0, 4, 0x2).set(4, 8, this.serial);
                this.recent.forEach((r, i) => {
                    w.set(12 + 5 * i, 4, FACES.indexOf(r.face)).set(16 + 5 * i, 1, r.dir).set(47 + 16 * i, 16, r.elapsed);
                });
                this.send(w.bytes());
                return;
            }
            const bit = [2, 32, 8, 1, 16, 4][FACES.indexOf(face)];
            const w = new BitWriter(20);
            if (this.gen === 3) {
                w.set(0, 8, 0x55).set(8, 8, 0x01).set(16, 8, 0x09)
                    .set(24, 32, this.clock, true).set(56, 16, this.serial, true).set(72, 2, dir).set(74, 6, bit);
            } else {
                w.set(0, 8, 0x01).set(8, 8, 0x09)
                    .set(16, 32, this.clock, true).set(48, 16, this.serial, true).set(64, 2, dir).set(66, 6, bit);
            }
            this.send(w.bytes());
        }

        /** Zoals een echte cube: af en toe uit zichzelf de stand sturen. */
        periodicState() { this.send(this.faceletsMessage()); }
    }

    /** GAN gen1 (356i): alles via uitlezen. */
    class Gen1Sim extends SimBase {
        constructor({ name = 'GAN-12AB', battery = 64 } = {}) {
            super();
            this.battery = battery;
            this.hw = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66];
            const key = KEYS.gen1.slice();
            for (let i = 0; i < 6; i += 1) key[i] = (key[i] + this.hw[5 - i]) & 0xFF;
            this.aes = new aesjs.AES(key);
            this.count = 0;
            this.moves = [0, 0, 0, 0, 0, 0];    // oudste eerst
            this.offsets = new Array(9).fill(0);
            const enc = bytes => {
                const u = new Uint8Array(bytes);
                u.set(this.aes.encrypt(u.slice(0, 16)), 0);
                if (u.length > 16) u.set(this.aes.encrypt(u.slice(u.length - 16)), u.length - 16);
                return u;
            };
            const meta = new FakeService(uuid16('180a'), [
                new FakeCharacteristic(uuid16('2a28'), { onRead: () => [0x01, 0x00, 0x08] }),
                new FakeCharacteristic(uuid16('2a23'), { onRead: () => this.hw })
            ]);
            const data = new FakeService(uuid16('fff0'), [
                new FakeCharacteristic(uuid16('fff2'), { onRead: () => enc(this.stateBytes()) }),
                new FakeCharacteristic(uuid16('fff5'), { onRead: () => enc(this.movesBytes()) }),
                new FakeCharacteristic(uuid16('fff6'), { onRead: () => enc(this.offsetBytes()) }),
                new FakeCharacteristic(uuid16('fff7'), { onRead: () => enc(this.batteryBytes()) })
            ]);
            this.device = new FakeDevice(name, [meta, data]);
        }
        stateBytes() {
            const f = this.facelets;
            const out = new Uint8Array(18);
            for (let face = 0; face < 6; face += 1) {
                const idx = [0, 1, 2, 3, 5, 6, 7, 8].map(k => face * 9 + k);
                let vlak = 0;
                idx.forEach(i => { vlak = (vlak << 3) | FACES.indexOf(f[i]); });
                const i = face * 3;
                out[i ^ 1] = (vlak >> 16) & 0xFF;
                out[(i + 1) ^ 1] = (vlak >> 8) & 0xFF;
                out[(i + 2) ^ 1] = vlak & 0xFF;
            }
            return out;
        }
        movesBytes() {
            const out = new Uint8Array(20);
            out[12] = this.count & 0xFF;
            this.moves.forEach((m, i) => { out[13 + i] = m; });
            return out;
        }
        offsetBytes() {
            const out = new Uint8Array(20);
            this.offsets.forEach((o, i) => { out[i * 2 + 1] = o & 0xFF; out[i * 2 + 2] = o >> 8; });
            return out;
        }
        batteryBytes() { const out = new Uint8Array(20); out[7] = this.battery; return out; }
        turn(m, { elapsed = 150 } = {}) {
            this.applyMove(m);
            this.count = (this.count + 1) & 0xFF;
            const { face, suffix } = splitMove(m);
            const code = FACES.indexOf(face) * 3 + (suffix === '2' ? 1 : suffix === "'" ? 2 : 0);
            this.moves = [...this.moves.slice(1), code];
            this.offsets = [...this.offsets.slice(1), elapsed];
        }
    }

    function crc16modbus(data) {
        let crc = 0xFFFF;
        for (let i = 0; i < data.length; i += 1) {
            crc ^= data[i];
            for (let j = 0; j < 8; j += 1) crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
        }
        return crc;
    }

    /** QiYi: vaste sleutel, praat pas na een begroeting met het juiste MAC-adres. */
    class QiyiSim extends SimBase {
        constructor({ mac = 'CC:A3:00:00:4E:21', name = 'QY-QYSC-S-4E21', battery = 88 } = {}) {
            super();
            this.mac = mac;
            this.battery = battery;
            this.aes = new aesjs.AES(KEYS.qiyi);
            this.ts = 5000;
            this.recent = [];
            this.acks = 0;
            this.sent = 0;
            this.greeted = false;
            this.char = new FakeCharacteristic(uuid16('fff6'), { onWrite: bytes => this.onWrite(bytes) });
            this.device = new FakeDevice(name, [new FakeService(uuid16('fff0'), [this.char])]);
        }
        enc(bytes) {
            const u = new Uint8Array(bytes);
            for (let i = 0; i < u.length; i += 16) u.set(this.aes.encrypt(u.slice(i, i + 16)), i);
            return u;
        }
        dec(bytes) {
            const u = new Uint8Array(bytes);
            for (let i = 0; i < u.length; i += 16) u.set(this.aes.decrypt(u.slice(i, i + 16)), i);
            return u;
        }
        frame(body) {
            const len = body.length + 4;
            const msg = [0xFE, len, ...body];
            const crc = crc16modbus(msg);
            msg.push(crc & 0xFF, crc >> 8);
            while (msg.length % 16) msg.push(0);
            return msg;
        }
        faceletBytes() {
            const out = new Array(27).fill(0);
            const f = this.facelets;
            for (let i = 0; i < 54; i += 1) out[i >> 1] |= 'LRDUFB'.indexOf(f[i]) << ((i % 2) << 2);
            return out;
        }
        onWrite(bytes) {
            const msg = Array.from(this.dec(bytes));
            const body = msg.slice(0, msg[1]);
            if (crc16modbus(body) !== 0) return;
            if (body[2] === 0x00 && body[3] === 0x6B) {
                const mac = body.slice(13, 19).reverse().map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
                if (mac !== this.mac) return;           // verkeerd MAC: de cube zwijgt
                this.greeted = true;
                this.sendState(0x02, 0);
            } else {
                this.acks += 1;
            }
        }
        sendState(opcode, moveCode) {
            this.ts += 200;
            const body = new Array(89).fill(0);   // opcode t/m index 90
            body[0] = opcode;
            body[1] = (this.ts >>> 24) & 0xFF; body[2] = (this.ts >>> 16) & 0xFF;
            body[3] = (this.ts >>> 8) & 0xFF; body[4] = this.ts & 0xFF;
            this.faceletBytes().forEach((b, i) => { body[5 + i] = b; });
            body[32] = moveCode;
            body[33] = this.battery;
            // Geschiedenis: de zetten vóór deze, met hun tijd.
            this.recent.slice(1, 10).forEach((r, k) => {
                const off = 91 - 5 * (k + 1) - 2;
                body[off] = (r.ts >>> 24) & 0xFF; body[off + 1] = (r.ts >>> 16) & 0xFF;
                body[off + 2] = (r.ts >>> 8) & 0xFF; body[off + 3] = r.ts & 0xFF;
                body[off + 4] = r.code;
            });
            this.sent += 1;
            this.char.notify(this.enc(this.frame(body)));
        }
        turn(m, { drop = false } = {}) {
            this.applyMove(m);
            const { face, suffix } = splitMove(m);
            const code = 'LRDUFB'.indexOf(face) * 2 + (suffix === "'" ? 1 : 2);
            this.recent.unshift({ code, ts: this.ts + 200 });
            if (drop) { this.ts += 200; return; }
            this.recent[0].ts = this.ts + 200;
            this.sendState(0x03, code);
        }
    }

    /** MoYu WeiLong AI. */
    class Moyu32Sim extends SimBase {
        constructor({ mac = 'CF:30:16:00:1A:2B', name = 'WCU_MY32_1A2B', battery = 55 } = {}) {
            super();
            this.cipher = saltedKey(KEYS.moyu32, mac);
            this.battery = battery;
            this.count = 0;
            this.recent = [];
            this.notifyChar = new FakeCharacteristic('0783b03e-7735-b5a0-1760-a305d2795cb1');
            this.writeChar = new FakeCharacteristic('0783b03e-7735-b5a0-1760-a305d2795cb2', {
                onWrite: bytes => this.onCommand(this.cipher.decrypt(bytes))
            });
            this.device = new FakeDevice(name, [new FakeService('0783b03e-7735-b5a0-1760-a305d2795cb0', [this.notifyChar, this.writeChar])]);
        }
        send(bytes) { this.notifyChar.notify(this.cipher.encrypt(bytes)); }
        onCommand(msg) {
            if (msg[0] === 163) {
                const w = new BitWriter(20).set(0, 8, 163);
                const f = this.facelets;
                const volgorde = [2, 5, 0, 3, 4, 1];   // hun vlaknummer per URFDLB
                volgorde.forEach((hun, k) => {
                    const idx = [0, 1, 2, 3, 5, 6, 7, 8].map(j => k * 9 + j);
                    idx.forEach((fi, j) => w.set(8 + hun * 24 + j * 3, 3, 'FBUDLR'.indexOf(f[fi])));
                });
                w.set(152, 8, this.count);
                this.send(w.bytes());
            } else if (msg[0] === 164) {
                this.send(new BitWriter(20).set(0, 8, 164).set(8, 8, this.battery).bytes());
            }
        }
        turn(m, { elapsed = 130 } = {}) {
            this.applyMove(m);
            this.count = (this.count + 1) & 0xFF;
            const { face, suffix } = splitMove(m);
            this.recent.unshift({ code: 'FBUDLR'.indexOf(face) * 2 + (suffix === "'" ? 1 : 0), elapsed });
            this.recent = this.recent.slice(0, 5);
            const w = new BitWriter(20).set(0, 8, 165).set(88, 8, this.count);
            this.recent.forEach((r, i) => { w.set(96 + i * 5, 5, r.code).set(8 + i * 16, 16, r.elapsed); });
            this.send(w.bytes());
        }
    }

    /** Giiker: elke melding bevat de hele stand. */
    class GiikerSim extends SimBase {
        constructor({ name = 'GiC12345' } = {}) {
            super();
            this.last = [0, 0];
            this.char = new FakeCharacteristic(uuid16('aadc'), { onRead: () => this.bytes() });
            this.device = new FakeDevice(name, [new FakeService(uuid16('aadb'), [this.char])]);
        }
        bytes() {
            const { cp, co, ep, eo } = cubies(this.facelets, CORNERS_GIIKER, EDGES_GIIKER);
            const mask = [-1, 1, -1, 1, 1, -1, 1, -1];
            const v = new Array(40).fill(0);
            for (let i = 0; i < 8; i += 1) {
                v[i] = cp[i] + 1;
                v[i + 8] = mask[i] === 1 ? (co[i] === 0 ? 3 : co[i]) : [3, 2, 1][co[i]];
            }
            for (let i = 0; i < 12; i += 1) v[i + 16] = ep[i] + 1;
            for (let i = 0; i < 3; i += 1) {
                v[28 + i] = (eo[i * 4] << 3) | (eo[i * 4 + 1] << 2) | (eo[i * 4 + 2] << 1) | eo[i * 4 + 3];
            }
            v[32] = this.last[0]; v[33] = this.last[1];
            const out = new Uint8Array(20);
            for (let i = 0; i < 20; i += 1) out[i] = (v[i * 2] << 4) | v[i * 2 + 1];
            return out;
        }
        turn(m) {
            this.applyMove(m);
            const { face, suffix } = splitMove(m);
            this.last = ['BDLURF'.indexOf(face) + 1, suffix === '2' ? 2 : suffix === "'" ? 3 : 1];
            this.char.notify(this.bytes());
        }
    }

    /** GoCube / Rubik's Connected. */
    class GoCubeSim extends SimBase {
        constructor({ name = 'GoCube_1234', battery = 91 } = {}) {
            super();
            this.battery = battery;
            this.notifyChar = new FakeCharacteristic('6e400003-b5a3-f393-e0a9-e50e24dcca9e');
            this.writeChar = new FakeCharacteristic('6e400002-b5a3-f393-e0a9-e50e24dcca9e', {
                onWrite: bytes => {
                    if (bytes[0] === 51) this.sendState();
                    if (bytes[0] === 50) this.sendRaw([5, this.battery]);
                }
            });
            this.device = new FakeDevice(name, [new FakeService('6e400001-b5a3-f393-e0a9-e50e24dcca9e', [this.notifyChar, this.writeChar])]);
        }
        sendRaw(body) {
            const msg = [0x2A, body.length + 3, ...body];
            msg.push(msg.reduce((a, b) => (a + b) & 0xFF, 0), 0x0D, 0x0A);
            this.notifyChar.notify(msg);
        }
        sendState() {
            const f = this.facelets;
            const assen = [5, 2, 0, 3, 1, 4];
            const plek = [0, 1, 2, 5, 8, 7, 6, 3];
            const off = [0, 0, 6, 2, 0, 0];
            const body = [2];
            for (let a = 0; a < 6; a += 1) {
                const basis = assen[a] * 9;
                body.push('BFUDRL'.indexOf(f[basis + 4]));
                for (let i = 0; i < 8; i += 1) body.push('BFUDRL'.indexOf(f[basis + plek[(i + off[a]) % 8]]));
            }
            this.sendRaw(body);
        }
        turn(m) {
            this.applyMove(m);
            const { face, suffix } = splitMove(m);
            const as = [5, 2, 0, 3, 1, 4].indexOf(FACES.indexOf(face));
            this.sendRaw([1, as * 2 + (suffix === "'" ? 1 : 0), 0]);
        }
    }

    const SIMS = { gan: GanSim, gen1: Gen1Sim, qiyi: QiyiSim, moyu32: Moyu32Sim, giiker: GiikerSim, gocube: GoCubeSim };

    /** Zet een nepcube klaar als het apparaat dat het keuzevenster teruggeeft. */
    function install(sim, target = root.navigator) {
        const bluetooth = {
            lastOptions: null,
            async requestDevice(options) {
                bluetooth.lastOptions = options;
                const naam = sim.device.name;
                const past = (options.filters || []).some(f => f.namePrefix && naam.startsWith(f.namePrefix));
                if (!past) throw new Error('No devices found');
                return sim.device;
            },
            async getAvailability() { return true; }
        };
        Object.defineProperty(target, 'bluetooth', { value: bluetooth, configurable: true, writable: true });
        return bluetooth;
    }

    root.NepSmartCube = { SIMS, install, cubies, FakeDevice, FakeService, FakeCharacteristic, BitWriter };
}(typeof window !== 'undefined' ? window : globalThis));
