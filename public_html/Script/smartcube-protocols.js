/**
 * CubeTimer - smart cube protocollen
 * ---------------------------------------------------------------------------
 * Eén bestand dat met elk bekend merk smart cube kan praten:
 *
 *   GAN       gen1 (356i), gen2 (12 ui, 356 i3, i Carry, Mini ui, Monster Go),
 *             gen3 (i Carry 2), gen4 (12 ui Maglev, 14 ui), en de AiCube
 *   QiYi      QY-QYSC (QiYi smart cube, X-Man) en XMD Tornado V4 i
 *   MoYu      WeiLong AI (WCU_MY32) en de oude MoYu AI (MHC)
 *   Giiker    Giiker en Xiaomi Mi Smart Magic Cube
 *   GoCube    GoCube en Rubik's Connected
 *
 * Wat hier staat is alleen het *praten*: bytes versleutelen en ontcijferen,
 * en omzetten naar een paar eenvoudige gebeurtenissen. Wat de site ermee doet
 * (timer, scramble volgen, analyse) staat in smartcube.js.
 *
 *   move      { move: "R'", cubeTime, localTime }
 *   facelets  { facelets: "UUUUUUUUURRR..." }      (Kociemba-volgorde)
 *   battery   { level: 0..100 }
 *   hardware  { name, hardware, software }
 *   keyError  { reason }                             (verkeerd MAC-adres)
 *   disconnect
 *
 * Herkomst: de GAN-protocollen (gen2, gen3, gen4 en de AiCube-sleutel) zijn
 * een omzetting naar gewoon JavaScript van gan-web-bluetooth van Andy Fedotov,
 * MIT-licentie, https://github.com/afedotov/gan-web-bluetooth. De andere
 * merken zijn zelf geschreven; de protocolgegevens (UUID's, sleutels,
 * berichtindeling) komen uit wat daar publiek over bekend is, onder meer uit
 * csTimer. Er is geen code uit csTimer overgenomen.
 *
 * Draait ook los in Node, zodat tools/smartcube-testen.js de ontcijfering kan
 * nalopen zonder echte cube. Daarom `globalThis` in plaats van `window`.
 */
(function (root) {
    'use strict';

    const aesjs = root.aesjs || (typeof require === 'function' ? require('./vendor/aes.js') : null);
    const Cube = root.CubeTimerCube;

    /* =====================================================================
     * Hulpjes
     * ================================================================== */

    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    const UUID_SUFFIX = '-0000-1000-8000-00805f9b34fb';
    const uuid16 = short => '0000' + short + UUID_SUFFIX;

    function toUuid128(uuid) {
        const tekst = String(uuid);
        if (/^[0-9a-f]{4}$/i.test(tekst)) return uuid16(tekst.toLowerCase());
        return tekst.toLowerCase();
    }

    function toBytes(value) {
        if (value instanceof Uint8Array) return value;
        if (value && value.buffer) {
            return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
        }
        return new Uint8Array(value || []);
    }

    /** "AB:12:..." naar zes getallen, of null als het geen MAC-adres is. */
    function parseMac(mac) {
        const delen = String(mac || '').trim().split(/[:\-\s]+/);
        if (delen.length !== 6 || !delen.every(d => /^[0-9a-f]{2}$/i.test(d))) return null;
        return delen.map(d => parseInt(d, 16));
    }

    function formatMac(bytes) {
        return Array.from(bytes).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
    }

    /**
     * Leest losse bits uit een bericht, zoals de GAN- en MoYu-protocollen die
     * gebruiken: velden van 1 tot 8 bits die dwars over bytegrenzen lopen, plus
     * een paar getallen van 16 of 32 bits.
     */
    class BitReader {
        constructor(bytes) {
            this.bits = Array.from(bytes).map(b => (b + 0x100).toString(2).slice(1)).join('');
        }

        get(start, length, littleEndian = false) {
            if (length <= 8) {
                return parseInt(this.bits.slice(start, start + length), 2);
            }
            if (length === 16 || length === 32) {
                const buf = new Uint8Array(length / 8);
                for (let i = 0; i < buf.length; i += 1) {
                    buf[i] = parseInt(this.bits.slice(8 * i + start, 8 * i + start + 8), 2);
                }
                const dv = new DataView(buf.buffer);
                return length === 16 ? dv.getUint16(0, littleEndian) : dv.getUint32(0, littleEndian);
            }
            throw new Error('Veldlengte niet ondersteund: ' + length); // niet vertalen: smartcube.js vertaalt
        }
    }

    const sum = lijst => lijst.reduce((a, b) => a + b, 0);

    /** Is dit een permutatie van 0..n-1? Zo niet, dan is de sleutel fout. */
    function isPermutation(lijst, n) {
        if (lijst.length !== n) return false;
        const gezien = new Set(lijst);
        return gezien.size === n && lijst.every(v => v >= 0 && v < n);
    }

    /* =====================================================================
     * Versleuteling
     * ================================================================== */

    /**
     * Het schema van GAN gen2/3/4, de AiCube en de MoYu WeiLong AI: AES-128,
     * met een sleutel en iv waar het MAC-adres (achterstevoren) bij de eerste
     * zes bytes wordt opgeteld. Alleen het eerste en het laatste blok van zestien
     * bytes worden versleuteld; bij een bericht van twintig bytes overlappen die.
     *
     * Die `% 255` (en niet 256) is geen tikfout: zo doen de cubes het zelf.
     */
    class SaltedCipher {
        constructor(key, iv, mac) {
            const salt = parseMac(mac);
            if (!salt) throw new Error('Ongeldig MAC-adres'); // niet vertalen: smartcube.js vertaalt
            salt.reverse();
            this.key = key.slice();
            this.iv = iv.slice();
            for (let i = 0; i < 6; i += 1) {
                this.key[i] = (key[i] + salt[i]) % 0xFF;
                this.iv[i] = (iv[i] + salt[i]) % 0xFF;
            }
            this.aes = new aesjs.AES(this.key);
        }

        encryptChunk(buffer, offset) {
            const blok = buffer.slice(offset, offset + 16);
            for (let i = 0; i < 16; i += 1) blok[i] ^= this.iv[i];
            buffer.set(this.aes.encrypt(blok), offset);
        }

        decryptChunk(buffer, offset) {
            const blok = this.aes.decrypt(buffer.slice(offset, offset + 16));
            for (let i = 0; i < 16; i += 1) blok[i] ^= this.iv[i];
            buffer.set(blok, offset);
        }

        encrypt(data) {
            const uit = new Uint8Array(data);
            this.encryptChunk(uit, 0);
            if (uit.length > 16) this.encryptChunk(uit, uit.length - 16);
            return uit;
        }

        decrypt(data) {
            const uit = new Uint8Array(data);
            if (uit.length > 16) this.decryptChunk(uit, uit.length - 16);
            this.decryptChunk(uit, 0);
            return uit;
        }
    }

    /** GAN gen1: hetzelfde idee, maar zonder iv en met een andere zoutregel. */
    class Gen1Cipher {
        constructor(key) {
            this.aes = new aesjs.AES(key);
        }

        decrypt(data) {
            const uit = new Uint8Array(data);
            if (uit.length > 16) {
                const off = uit.length - 16;
                uit.set(this.aes.decrypt(uit.slice(off, off + 16)), off);
            }
            if (uit.length >= 16) uit.set(this.aes.decrypt(uit.slice(0, 16)), 0);
            return uit;
        }

        encrypt(data) {
            const uit = new Uint8Array(data);
            if (uit.length >= 16) uit.set(this.aes.encrypt(uit.slice(0, 16)), 0);
            if (uit.length > 16) {
                const off = uit.length - 16;
                uit.set(this.aes.encrypt(uit.slice(off, off + 16)), off);
            }
            return uit;
        }
    }

    /** QiYi: gewoon AES-128 per blok van zestien bytes, met één vaste sleutel. */
    class BlockCipher {
        constructor(key) {
            this.aes = new aesjs.AES(key);
        }

        encrypt(data) {
            const uit = new Uint8Array(data);
            for (let i = 0; i + 16 <= uit.length; i += 16) {
                uit.set(this.aes.encrypt(uit.slice(i, i + 16)), i);
            }
            return uit;
        }

        decrypt(data) {
            const uit = new Uint8Array(data);
            for (let i = 0; i + 16 <= uit.length; i += 16) {
                uit.set(this.aes.decrypt(uit.slice(i, i + 16)), i);
            }
            return uit;
        }
    }

    const KEYS = {
        ganGen2: {
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
        // GAN gen1: één sleutel per firmwareversie (1.0.x en 1.1.x).
        ganGen1: [
            [0xc6, 0xca, 0x15, 0xdf, 0x4f, 0x6e, 0x13, 0xb6, 0x77, 0x0d, 0xe6, 0x59, 0x3a, 0xaf, 0xba, 0xa2],
            [0x43, 0xe2, 0x5b, 0xd6, 0x7d, 0xdc, 0x78, 0xd8, 0x07, 0x60, 0xa3, 0xda, 0x82, 0x3c, 0x01, 0xf1]
        ],
        qiyi: [0x57, 0xb1, 0xf9, 0xab, 0xcd, 0x5a, 0xe8, 0xa7, 0x9c, 0xb9, 0x8c, 0xe7, 0x57, 0x8c, 0x51, 0x08]
    };

    /* =====================================================================
     * Van stukjes naar facelets
     *
     * GAN en Giiker melden hun stand als "welk stuk ligt waar, hoe gedraaid"
     * in plaats van als 54 kleuren. Deze tabellen zeggen per hoek en rand op
     * welke facelets (Kociemba-index 0..53) zijn plaatjes liggen.
     * ================================================================== */

    // Volgorde zoals GAN hem gebruikt (en Kociemba): URF UFL ULB UBR DFR DLF DBL DRB.
    const CORNERS_KOCIEMBA = [
        [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
        [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51]
    ];
    // UR UF UL UB DR DF DL DB FR FL BL BR
    const EDGES_KOCIEMBA = [
        [5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25],
        [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14]
    ];

    // Giiker nummert zijn stukken in een eigen volgorde.
    const CORNERS_GIIKER = [
        [26, 15, 29], [20, 8, 9], [18, 38, 6], [24, 27, 44],
        [51, 35, 17], [45, 11, 2], [47, 0, 36], [53, 42, 33]
    ];
    const EDGES_GIIKER = [
        [25, 28], [23, 12], [19, 7], [21, 41], [32, 16], [5, 10],
        [3, 37], [30, 43], [52, 34], [48, 14], [46, 1], [50, 39]
    ];

    function cubiesToFacelets(cp, co, ep, eo, corners = CORNERS_KOCIEMBA, edges = EDGES_KOCIEMBA) {
        const faces = 'URFDLB';
        const facelets = [];
        for (let i = 0; i < 54; i += 1) facelets[i] = faces[Math.floor(i / 9)];
        for (let i = 0; i < 8; i += 1) {
            for (let p = 0; p < 3; p += 1) {
                facelets[corners[i][(p + co[i]) % 3]] = faces[Math.floor(corners[cp[i]][p] / 9)];
            }
        }
        for (let i = 0; i < 12; i += 1) {
            for (let p = 0; p < 2; p += 1) {
                facelets[edges[i][(p + eo[i]) % 2]] = faces[Math.floor(edges[ep[i]][p] / 9)];
            }
        }
        return facelets.join('');
    }

    /** Controleert de stukjes en zet ze om, of geeft null bij onzin. */
    function validCubies(cp, co, ep, eo, corners, edges) {
        if (!isPermutation(cp, 8) || !isPermutation(ep, 12)) return null;
        if (!co.every(v => v >= 0 && v <= 2) || !eo.every(v => v === 0 || v === 1)) return null;
        const facelets = cubiesToFacelets(cp, co, ep, eo, corners, edges);
        return Cube && !Cube.fromFacelets(facelets) ? null : facelets;
    }

    /** Een zet als tekst: "R", "R'" of "R2". */
    const moveName = (face, suffix) => face + (suffix || '');

    /* =====================================================================
     * Decoders
     *
     * Elke decoder krijgt ontcijferde bytes binnen en roept `emit(type, data)`
     * aan. Ze weten niets van Bluetooth; dat maakt ze los te testen. Waar een
     * cube om een antwoord vraagt (een bevestiging, of de geschiedenis van
     * gemiste zetten), gaat dat via `send(bytes)`.
     * ================================================================== */

    /** GAN gen2: 12 ui, 356 i3, i Carry, Mini ui, Monster Go, en de AiCube. */
    class GanGen2Decoder {
        constructor({ emit, send }) {
            this.emit = emit;
            this.send = send;
            this.lastSerial = -1;
            this.lastMoveTimestamp = 0;
            this.cubeTimestamp = 0;
        }

        command(type) {
            const msg = new Uint8Array(20);
            if (type === 'facelets') msg[0] = 0x04;
            else if (type === 'hardware') msg[0] = 0x05;
            else if (type === 'battery') msg[0] = 0x09;
            else if (type === 'reset') {
                msg.set([0x0A, 0x05, 0x39, 0x77, 0x00, 0x00, 0x01, 0x23, 0x45, 0x67, 0x89, 0xAB]);
            } else return null;
            return msg;
        }

        handle(bytes) {
            const t = now();
            const msg = new BitReader(bytes);
            const type = msg.get(0, 4);

            if (type === 0x02) {                       // zetten
                if (this.lastSerial === -1) return;    // pas na de eerste stand
                const serial = msg.get(4, 8);
                const diff = Math.min((serial - this.lastSerial) & 0xFF, 7);
                this.lastSerial = serial;
                for (let i = diff - 1; i >= 0; i -= 1) {
                    const face = msg.get(12 + 5 * i, 4);
                    const dir = msg.get(16 + 5 * i, 1);
                    if (face > 5) {
                        this.emit('keyError', { reason: 'onmogelijke zet' }); // niet vertalen
                        return;
                    }
                    let elapsed = msg.get(47 + 16 * i, 16);
                    if (elapsed === 0) elapsed = t - this.lastMoveTimestamp;
                    this.cubeTimestamp += elapsed;
                    this.emit('move', {
                        move: moveName('URFDLB'[face], dir ? "'" : ''),
                        cubeTime: this.cubeTimestamp,
                        localTime: i === 0 ? t : null
                    });
                }
                if (diff > 0) this.lastMoveTimestamp = t;
            } else if (type === 0x04) {                // stand
                const serial = msg.get(4, 8);
                const cp = [], co = [], ep = [], eo = [];
                for (let i = 0; i < 7; i += 1) {
                    cp.push(msg.get(12 + i * 3, 3));
                    co.push(msg.get(33 + i * 2, 2));
                }
                cp.push(28 - sum(cp));
                co.push((3 - (sum(co) % 3)) % 3);
                for (let i = 0; i < 11; i += 1) {
                    ep.push(msg.get(47 + i * 4, 4));
                    eo.push(msg.get(91 + i, 1));
                }
                ep.push(66 - sum(ep));
                eo.push((2 - (sum(eo) % 2)) % 2);

                const facelets = validCubies(cp, co, ep, eo);
                if (!facelets) {
                    this.emit('keyError', { reason: 'onleesbare stand' }); // niet vertalen
                    return;
                }
                if (this.lastSerial === -1) this.lastSerial = serial;
                this.emit('facelets', { facelets });
            } else if (type === 0x05) {                // hardware
                let name = '';
                for (let i = 0; i < 8; i += 1) name += String.fromCharCode(msg.get(i * 8 + 40, 8));
                this.emit('hardware', {
                    name: name.replace(/\0/g, '').trim(),
                    hardware: msg.get(8, 8) + '.' + msg.get(16, 8),
                    software: msg.get(24, 8) + '.' + msg.get(32, 8)
                });
            } else if (type === 0x09) {                // batterij
                this.emit('battery', { level: Math.min(msg.get(8, 8), 100) });
            } else if (type === 0x0D) {
                this.emit('disconnect', {});
            }
        }
    }

    /**
     * Gemeenschappelijk voor GAN gen3 en gen4: zetten komen met een volgnummer
     * binnen. Mist er een, dan vragen we de geschiedenis op en houden we de
     * volgende zetten vast tot het gat gevuld is. Anders loopt je stand
     * ongemerkt uit de pas zodra er één Bluetooth-pakketje verloren gaat.
     */
    class GanSerialDecoder {
        constructor({ emit, send }) {
            this.emit = emit;
            this.send = send;
            this.serial = -1;
            this.lastSerial = -1;
            this.lastLocalTimestamp = null;
            this.moveBuffer = [];
        }

        historyCommand() { return null; }

        requestHistory(serial, count) {
            if (serial % 2 === 0) serial = (serial - 1) & 0xFF;
            if (count % 2 === 1) count += 1;
            count = Math.min(count, serial + 1);
            const msg = this.historyCommand(serial, count);
            if (msg) Promise.resolve(this.send(msg)).catch(() => {});
        }

        evict(canRequest) {
            while (this.moveBuffer.length > 0) {
                const head = this.moveBuffer[0];
                const diff = this.lastSerial === -1 ? 1 : (head.serial - this.lastSerial) & 0xFF;
                if (diff > 1) {
                    if (canRequest) this.requestHistory(head.serial, diff);
                    break;
                }
                this.moveBuffer.shift();
                this.lastSerial = head.serial;
                this.emit('move', { move: head.move, cubeTime: head.cubeTime, localTime: head.localTime });
            }
            if (canRequest && this.moveBuffer.length > 16) {
                // Het gat raakt niet meer gevuld; liever opnieuw verbinden dan
                // een stand bijhouden die niet klopt.
                this.emit('disconnect', { reason: 'te veel gemiste zetten' }); // niet vertalen
            }
        }

        inRange(start, end, serial, closedStart = false, closedEnd = false) {
            return ((end - start) & 0xFF) >= ((serial - start) & 0xFF)
                && (closedStart || ((start - serial) & 0xFF) > 0)
                && (closedEnd || ((end - serial) & 0xFF) > 0);
        }

        injectMissed(move) {
            if (this.moveBuffer.length > 0) {
                const head = this.moveBuffer[0];
                if (this.moveBuffer.some(m => m.serial === move.serial)) return;
                if (!this.inRange(this.lastSerial, head.serial, move.serial)) return;
                if (move.serial === ((head.serial - 1) & 0xFF)) this.moveBuffer.unshift(move);
            } else if (this.inRange(this.lastSerial, this.serial, move.serial, false, true)) {
                this.moveBuffer.unshift(move);
            }
        }

        checkMissed() {
            const diff = (this.serial - this.lastSerial) & 0xFF;
            if (diff > 0 && this.serial !== 0) {
                const head = this.moveBuffer[0];
                const start = head ? head.serial : (this.serial + 1) & 0xFF;
                this.requestHistory(start, diff + 1);
            }
        }

        onMove(serial, face, dir, cubeTime) {
            if (this.lastSerial === -1) return;
            const t = now();
            this.lastLocalTimestamp = t;
            this.serial = serial;
            if (face < 0) {
                this.emit('keyError', { reason: 'onmogelijke zet' }); // niet vertalen
                return;
            }
            this.moveBuffer.push({
                serial,
                move: moveName('URFDLB'[face], dir ? "'" : ''),
                cubeTime,
                localTime: t
            });
            this.evict(true);
        }

        onHistory(startSerial, count, readMove) {
            for (let i = 0; i < count; i += 1) {
                const [face, dir] = readMove(i);
                if (face < 0) continue;
                this.injectMissed({
                    serial: (startSerial - i) & 0xFF,
                    move: moveName('URFDLB'[face], dir ? "'" : ''),
                    cubeTime: null,
                    localTime: null
                });
            }
            this.evict(false);
        }

        onState(serial, readCubies) {
            const t = now();
            this.serial = serial;
            if (this.lastSerial !== -1 && this.lastLocalTimestamp !== null && t - this.lastLocalTimestamp > 500) {
                this.checkMissed();
            }
            const { cp, co, ep, eo } = readCubies();
            const facelets = validCubies(cp, co, ep, eo);
            if (!facelets) {
                this.emit('keyError', { reason: 'onleesbare stand' }); // niet vertalen
                return;
            }
            if (this.lastSerial === -1) this.lastSerial = serial;
            this.emit('facelets', { facelets });
        }
    }

    /** Leest de stukjes uit een GAN gen3/gen4-bericht, vanaf een bitpositie. */
    function readGanCubies(msg, base) {
        const cp = [], co = [], ep = [], eo = [];
        for (let i = 0; i < 7; i += 1) {
            cp.push(msg.get(base + i * 3, 3));
            co.push(msg.get(base + 21 + i * 2, 2));
        }
        cp.push(28 - sum(cp));
        co.push((3 - (sum(co) % 3)) % 3);
        for (let i = 0; i < 11; i += 1) {
            ep.push(msg.get(base + 37 + i * 4, 4));
            eo.push(msg.get(base + 81 + i, 1));
        }
        ep.push(66 - sum(ep));
        eo.push((2 - (sum(eo) % 2)) % 2);
        return { cp, co, ep, eo };
    }

    const GAN_FACE_BITS = [2, 32, 8, 1, 16, 4];      // U R F D L B als bitmasker
    const GAN_HISTORY_FACES = [1, 5, 3, 0, 4, 2];

    /** GAN gen3: i Carry 2. */
    class GanGen3Decoder extends GanSerialDecoder {
        command(type) {
            const msg = new Uint8Array(16);
            if (type === 'facelets') msg.set([0x68, 0x01]);
            else if (type === 'hardware') msg.set([0x68, 0x04]);
            else if (type === 'battery') msg.set([0x68, 0x07]);
            else if (type === 'reset') {
                msg.set([0x68, 0x05, 0x05, 0x39, 0x77, 0x00, 0x00, 0x01, 0x23, 0x45, 0x67, 0x89, 0xAB]);
            } else return null;
            return msg;
        }

        historyCommand(serial, count) {
            const msg = new Uint8Array(16);
            msg.set([0x68, 0x03, serial, 0, count, 0]);
            return msg;
        }

        handle(bytes) {
            const msg = new BitReader(bytes);
            const magic = msg.get(0, 8);
            const type = msg.get(8, 8);
            const length = msg.get(16, 8);
            if (magic !== 0x55 || length === 0) return;

            if (type === 0x01) {
                this.onMove(
                    msg.get(56, 16, true),
                    GAN_FACE_BITS.indexOf(msg.get(74, 6)),
                    msg.get(72, 2),
                    msg.get(24, 32, true)
                );
            } else if (type === 0x06) {
                this.onHistory(msg.get(24, 8), (length - 1) * 2, i => [
                    GAN_HISTORY_FACES.indexOf(msg.get(32 + 4 * i, 3)),
                    msg.get(35 + 4 * i, 1)
                ]);
            } else if (type === 0x02) {
                this.onState(msg.get(24, 16, true), () => readGanCubies(msg, 40));
            } else if (type === 0x07) {
                let name = '';
                for (let i = 0; i < 5; i += 1) name += String.fromCharCode(msg.get(i * 8 + 32, 8));
                this.emit('hardware', {
                    name: name.replace(/\0/g, '').trim(),
                    software: msg.get(72, 4) + '.' + msg.get(76, 4),
                    hardware: msg.get(80, 4) + '.' + msg.get(84, 4)
                });
            } else if (type === 0x10) {
                this.emit('battery', { level: Math.min(msg.get(24, 8), 100) });
            } else if (type === 0x11) {
                this.emit('disconnect', {});
            }
        }
    }

    /** GAN gen4: 12 ui Maglev, 14 ui FreePlay. */
    class GanGen4Decoder extends GanSerialDecoder {
        constructor(options) {
            super(options);
            this.hwInfo = {};
        }

        command(type) {
            const msg = new Uint8Array(20);
            if (type === 'facelets') msg.set([0xDD, 0x04, 0x00, 0xED, 0x00, 0x00]);
            else if (type === 'hardware') {
                this.hwInfo = {};
                msg.set([0xDF, 0x03, 0x00, 0x00, 0x00]);
            } else if (type === 'battery') msg.set([0xDD, 0x04, 0x00, 0xEF, 0x00, 0x00]);
            else if (type === 'reset') {
                msg.set([0xD2, 0x0D, 0x05, 0x39, 0x77, 0x00, 0x00, 0x01, 0x23, 0x45, 0x67, 0x89, 0xAB]);
            } else return null;
            return msg;
        }

        historyCommand(serial, count) {
            const msg = new Uint8Array(20);
            msg.set([0xD1, 0x04, serial, 0, count, 0]);
            return msg;
        }

        handle(bytes) {
            const msg = new BitReader(bytes);
            const type = msg.get(0, 8);
            const length = msg.get(8, 8);

            if (type === 0x01) {
                this.onMove(
                    msg.get(48, 16, true),
                    GAN_FACE_BITS.indexOf(msg.get(66, 6)),
                    msg.get(64, 2),
                    msg.get(16, 32, true)
                );
            } else if (type === 0xD1) {
                this.onHistory(msg.get(16, 8), (length - 1) * 2, i => [
                    GAN_HISTORY_FACES.indexOf(msg.get(24 + 4 * i, 3)),
                    msg.get(27 + 4 * i, 1)
                ]);
            } else if (type === 0xED) {
                this.onState(msg.get(16, 16, true), () => readGanCubies(msg, 32));
            } else if (type >= 0xFA && type <= 0xFE) {
                if (type === 0xFC) {
                    let name = '';
                    for (let i = 0; i < length - 1; i += 1) name += String.fromCharCode(msg.get(i * 8 + 24, 8));
                    this.hwInfo.name = name.replace(/\0/g, '').trim();
                } else if (type === 0xFD) {
                    this.hwInfo.software = msg.get(24, 4) + '.' + msg.get(28, 4);
                } else if (type === 0xFE) {
                    this.hwInfo.hardware = msg.get(24, 4) + '.' + msg.get(28, 4);
                } else {
                    this.hwInfo.date = true;
                }
                if (this.hwInfo.name && this.hwInfo.software && this.hwInfo.hardware) {
                    this.emit('hardware', { ...this.hwInfo });
                }
            } else if (type === 0xEF) {
                this.emit('battery', { level: Math.min(msg.get(8 + length * 8, 8), 100) });
            } else if (type === 0xEA) {
                this.emit('disconnect', {});
            }
        }
    }

    /**
     * GAN gen1 (356i): geen meldingen, alles wordt opgevraagd. De verbinding
     * leest steeds opnieuw het zettenregister (f5) en, als daar iets nieuws in
     * staat, de tijden ertussen (f6). De stand zelf (f2) lezen we bij het begin
     * en af en toe ter controle.
     */
    const Gen1 = {
        /** Laatste zes zetten en de teller, uit f5. */
        parseMoves(bytes) {
            const moves = [];
            for (let i = 0; i < 6; i += 1) {
                const m = bytes[13 + i];
                moves.push(moveName('URFDLB'[Math.floor(m / 3)], ['', '2', "'"][m % 3]));
            }
            // Oudste eerst.
            return { count: bytes[12], moves, valid: bytes.slice(13, 19).every(m => m < 18) };
        },

        /** Tijd tussen de laatste negen zetten in ms, uit f6. Oudste eerst. */
        parseOffsets(bytes) {
            const offsets = [];
            for (let i = 0; i < 9; i += 1) offsets.push(bytes[i * 2 + 1] | (bytes[i * 2 + 2] << 8));
            return offsets;
        },

        /** De stand, uit f2: 48 plaatjes van 3 bits, per vlak met het midden erbij. */
        parseFacelets(bytes) {
            let uit = '';
            for (let i = 0; i + 2 < bytes.length; i += 3) {
                const vlak = (bytes[i ^ 1] << 16) | (bytes[(i + 1) ^ 1] << 8) | bytes[(i + 2) ^ 1];
                for (let j = 21; j >= 0; j -= 3) {
                    uit += 'URFDLB'.charAt((vlak >> j) & 0x7);
                    if (j === 12) uit += 'URFDLB'.charAt(i / 3);
                }
            }
            return uit.length === 54 && Cube && Cube.fromFacelets(uit) ? uit : null;
        }
    };

    /**
     * QiYi: elk bericht begint met 0xFE en de lengte, en eindigt met een
     * CRC-16 (Modbus). Een verkeerd ontcijferd bericht valt dus meteen door de
     * controle. De cube wil elk berichtje bevestigd zien, anders stopt hij.
     */
    function crc16modbus(data) {
        let crc = 0xFFFF;
        for (let i = 0; i < data.length; i += 1) {
            crc ^= data[i];
            for (let j = 0; j < 8; j += 1) crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
        }
        return crc;
    }

    /** Een QiYi-bericht rond `content`, met lengte, CRC en opvulling tot 16. */
    function qiyiFrame(content) {
        const msg = [0xFE, 4 + content.length, ...content];
        const crc = crc16modbus(msg);
        msg.push(crc & 0xFF, crc >> 8);
        while (msg.length % 16) msg.push(0);
        return new Uint8Array(msg);
    }

    /** De QiYi-kleurcodes, 4 bits per facelet. */
    function qiyiFacelets(bytes27) {
        let uit = '';
        for (let i = 0; i < 54; i += 1) {
            uit += 'LRDUFB'.charAt((bytes27[i >> 1] >> ((i % 2) << 2)) & 0xF);
        }
        return uit;
    }

    // Zetcode 1..12: oneven is tegen de klok in. Volgorde L R D U F B.
    function qiyiMove(code) {
        if (code < 1 || code > 12) return null;
        const face = 'LRDUFB'[(code - 1) >> 1];
        return moveName(face, code & 1 ? "'" : '');
    }

    class QiyiDecoder {
        constructor({ emit, send }) {
            this.emit = emit;
            this.send = send;          // krijgt de inhoud; de verbinding verpakt hem
            this.lastTs = 0;
            this.battery = null;
        }

        hello(mac) {
            const bytes = parseMac(mac);
            if (!bytes) return null;
            return [0x00, 0x6B, 0x01, 0x00, 0x00, 0x22, 0x06, 0x00, 0x02, 0x08, 0x00, ...bytes.slice().reverse()];
        }

        /** Krijgt een ontcijferd bericht, inclusief opvulling. */
        handle(raw) {
            const lengte = raw[1];
            if (raw[0] !== 0xFE || !lengte || lengte > raw.length) return;
            const msg = Array.from(raw.slice(0, lengte));
            if (msg.length < 3 || crc16modbus(msg) !== 0) return;

            const opcode = msg[2];
            const ts = ((msg[3] << 24) | (msg[4] << 16) | (msg[5] << 8) | msg[6]) >>> 0;
            const t = now();

            if (opcode === 0x02) {                           // begroeting van de cube
                this.send(msg.slice(2, 7));
                const facelets = qiyiFacelets(msg.slice(7, 34));
                if (Cube && !Cube.fromFacelets(facelets)) return;
                this.emit('facelets', { facelets });
                this.updateBattery(msg[35]);
                this.lastTs = ts;
            } else if (opcode === 0x03) {                    // er is gedraaid
                this.send(msg.slice(2, 7));
                // De laatste zet staat op 34, daarvoor tot negen oudere met
                // hun tijd. Zo halen we zetten terug die onderweg kwijt raakten.
                const todo = [[msg[34], ts]];
                while (todo.length < 10) {
                    const off = 91 - 5 * todo.length;
                    if (off + 4 >= msg.length) break;
                    const hisTs = ((msg[off] << 24) | (msg[off + 1] << 16) | (msg[off + 2] << 8) | msg[off + 3]) >>> 0;
                    if (hisTs <= this.lastTs) break;
                    todo.push([msg[off + 4], hisTs]);
                }
                for (let i = todo.length - 1; i >= 0; i -= 1) {
                    const move = qiyiMove(todo[i][0]);
                    if (!move) continue;
                    this.emit('move', { move, cubeTime: todo[i][1] / 1.6, localTime: i === 0 ? t : null });
                }
                const facelets = qiyiFacelets(msg.slice(7, 34));
                if (!Cube || Cube.fromFacelets(facelets)) this.emit('facelets', { facelets });
                this.updateBattery(msg[35]);
                this.lastTs = ts;
            }
        }

        updateBattery(level) {
            if (typeof level === 'number' && level !== this.battery) {
                this.battery = level;
                this.emit('battery', { level: Math.min(level, 100) });
            }
        }
    }

    /** MoYu WeiLong AI (WCU_MY32). Zelfde versleuteling als GAN gen2. */
    class Moyu32Decoder {
        constructor({ emit }) {
            this.emit = emit;
            this.moveCnt = -1;
            this.cubeTime = 0;
        }

        command(type) {
            const msg = new Uint8Array(20);
            if (type === 'hardware') msg[0] = 161;
            else if (type === 'facelets') msg[0] = 163;
            else if (type === 'battery') msg[0] = 164;
            else return null;
            return msg;
        }

        handle(bytes) {
            const msg = new BitReader(bytes);
            const type = msg.get(0, 8);
            const t = now();

            if (type === 161) {
                let name = '';
                for (let i = 0; i < 8; i += 1) name += String.fromCharCode(msg.get(8 + i * 8, 8));
                this.emit('hardware', {
                    name: name.replace(/\0/g, '').trim(),
                    hardware: msg.get(72, 8) + '.' + msg.get(80, 8),
                    software: msg.get(88, 8) + '.' + msg.get(96, 8)
                });
            } else if (type === 163) {
                // De vlakken staan in de volgorde F B U D L R, elk acht plaatjes
                // van drie bits met het midden weggelaten.
                const volgorde = [2, 5, 0, 3, 4, 1];       // URFDLB in hun indeling
                let facelets = '';
                for (const f of volgorde) {
                    for (let j = 0; j < 8; j += 1) {
                        facelets += 'FBUDLR'.charAt(msg.get(8 + f * 24 + j * 3, 3));
                        if (j === 3) facelets += 'FBUDLR'.charAt(f);
                    }
                }
                if (Cube && !Cube.fromFacelets(facelets)) {
                    this.emit('keyError', { reason: 'onleesbare stand' }); // niet vertalen
                    return;
                }
                if (this.moveCnt === -1) this.moveCnt = msg.get(152, 8);
                this.emit('facelets', { facelets });
            } else if (type === 164) {
                this.emit('battery', { level: Math.min(msg.get(8, 8), 100) });
            } else if (type === 165) {
                const cnt = msg.get(88, 8);
                if (this.moveCnt === -1 || cnt === this.moveCnt) return;
                const diff = Math.min((cnt - this.moveCnt) & 0xFF, 5);
                this.moveCnt = cnt;
                const zetten = [];
                for (let i = 0; i < 5; i += 1) {
                    const m = msg.get(96 + i * 5, 5);
                    if (m >= 12) {
                        this.emit('keyError', { reason: 'onmogelijke zet' }); // niet vertalen
                        return;
                    }
                    zetten.push({ move: moveName('FBUDLR'[m >> 1], m & 1 ? "'" : ''), offset: msg.get(8 + i * 16, 16) });
                }
                for (let i = diff - 1; i >= 0; i -= 1) {
                    this.cubeTime += zetten[i].offset;
                    this.emit('move', { move: zetten[i].move, cubeTime: this.cubeTime, localTime: i === 0 ? t : null });
                }
            }
        }
    }

    /**
     * De oude MoYu AI (MHC). Die meldt geen zetten maar draaihoeken, in stapjes
     * van een negende slag. Een zet telt pas als het vlak over de helft is.
     */
    class MhcDecoder {
        constructor({ emit }) {
            this.emit = emit;
            this.faceStatus = [0, 0, 0, 0, 0, 0];
        }

        handle(bytes) {
            const t = now();
            const n = bytes[0];
            if (!n || bytes.length < 1 + n * 6) return;
            for (let i = 0; i < n; i += 1) {
                const off = 1 + i * 6;
                const ts = ((bytes[off + 1] << 24) | (bytes[off] << 16) | (bytes[off + 3] << 8) | bytes[off + 2]) >>> 0;
                const face = bytes[off + 4];
                if (face > 5) continue;
                const dir = Math.round(bytes[off + 5] / 36);
                const vorige = this.faceStatus[face];
                const nieuw = vorige + dir;
                this.faceStatus[face] = (nieuw + 9) % 9;
                let suffix = null;
                if (vorige >= 5 && nieuw <= 4) suffix = "'";
                else if (vorige <= 4 && nieuw >= 5) suffix = '';
                if (suffix === null) continue;
                this.emit('move', {
                    move: moveName('DLBRFU'[face], suffix),
                    cubeTime: Math.round(ts / 65536 * 1000),
                    localTime: t
                });
            }
        }
    }

    /** Giiker en Xiaomi: elke melding is de hele stand plus de laatste zetten. */
    const GIIKER_KEY = [176, 81, 104, 224, 86, 137, 237, 119, 38, 26, 193, 161, 210, 126, 150, 81, 93, 13,
        236, 249, 89, 235, 88, 24, 113, 81, 214, 131, 130, 199, 2, 169, 39, 165, 171, 41];

    class GiikerDecoder {
        constructor({ emit }) {
            this.emit = emit;
            this.first = true;
        }

        nibbles(raw) {
            let data = Array.from(raw.slice(0, 20));
            if (data[18] === 0xA7) {           // versluierd; ontwarren
                const k1 = (data[19] >> 4) & 0xF;
                const k2 = data[19] & 0xF;
                data = data.slice(0, 18).map((v, i) => (v + GIIKER_KEY[i + k1] + GIIKER_KEY[i + k2]) & 0xFF);
            }
            const uit = [];
            data.forEach(v => uit.push((v >> 4) & 0xF, v & 0xF));
            return uit;
        }

        handle(raw) {
            if (raw.length < 20) return;
            const v = this.nibbles(raw);
            const t = now();
            const eo = [];
            for (let i = 0; i < 3; i += 1) {
                for (let mask = 8; mask; mask >>= 1) eo.push(v[i + 28] & mask ? 1 : 0);
            }
            const coMask = [-1, 1, -1, 1, 1, -1, 1, -1];
            const cp = [], co = [], ep = [];
            for (let i = 0; i < 8; i += 1) {
                cp.push(v[i] - 1);
                co.push(((3 + v[i + 8] * coMask[i]) % 3 + 3) % 3);
            }
            for (let i = 0; i < 12; i += 1) ep.push(v[i + 16] - 1);

            // De nieuwste zet staat vooraan.
            if (!this.first) {
                const face = 'BDLURF'.charAt(v[32] - 1);
                const suffix = ['', '2', "'"][(v[33] - 1) % 7];
                if (face && suffix !== undefined) this.emit('move', { move: face + suffix, cubeTime: null, localTime: t });
            }
            this.first = false;

            const facelets = validCubies(cp, co, ep, eo, CORNERS_GIIKER, EDGES_GIIKER);
            if (facelets) this.emit('facelets', { facelets });
        }
    }

    /** GoCube en Rubik's Connected: berichten tussen 0x2A en \r\n. */
    class GoCubeDecoder {
        constructor({ emit }) {
            this.emit = emit;
        }

        handle(raw) {
            if (raw.length < 4 || raw[0] !== 0x2A || raw[raw.length - 2] !== 0x0D || raw[raw.length - 1] !== 0x0A) return;
            const type = raw[2];
            const lengte = raw.length - 6;
            const t = now();
            if (type === 1) {
                const assen = [5, 2, 0, 3, 1, 4];      // naar URFDLB
                for (let i = 0; i < lengte; i += 2) {
                    const b = raw[3 + i];
                    const as = assen[b >> 1];
                    if (as === undefined) continue;
                    this.emit('move', { move: moveName('URFDLB'[as], b & 1 ? "'" : ''), cubeTime: null, localTime: t });
                }
            } else if (type === 2) {
                const assen = [5, 2, 0, 3, 1, 4];
                const plek = [0, 1, 2, 5, 8, 7, 6, 3];
                const verschuiving = [0, 0, 6, 2, 0, 0];
                const f = [];
                for (let a = 0; a < 6; a += 1) {
                    const basis = assen[a] * 9;
                    f[basis + 4] = 'BFUDRL'.charAt(raw[3 + a * 9]);
                    for (let i = 0; i < 8; i += 1) {
                        f[basis + plek[(i + verschuiving[a]) % 8]] = 'BFUDRL'.charAt(raw[3 + a * 9 + i + 1]);
                    }
                }
                const facelets = f.join('');
                if (!Cube || Cube.fromFacelets(facelets)) this.emit('facelets', { facelets });
            } else if (type === 5) {
                this.emit('battery', { level: Math.min(raw[3], 100) });
            }
        }
    }

    /* =====================================================================
     * Bluetooth
     *
     * Per merk: welke namen, services en fabrikantcodes erbij horen, hoe het
     * MAC-adres uit een advertentie te halen is, en hoe je een verbinding
     * opzet. `open()` krijgt een sessie mee met:
     *
     *   emit(type, data)   een gebeurtenis doorgeven
     *   needMac()          het MAC-adres opvragen (opgeslagen, uit de
     *                      advertentie, afgeleid van de naam of gevraagd)
     *   log(tekst)         voor de console
     * ================================================================== */

    const SERVICES = {
        ganGen1Data: uuid16('fff0'),
        ganGen1Meta: uuid16('180a'),
        ganGen2: '6e400001-b5a3-f393-e0a9-e50e24dc4179',
        ganGen3: '8653000a-43e6-47b7-9cb0-5fc21d4ae340',
        ganGen4: '00000010-0000-fff7-fff6-fff5fff4fff0',
        qiyi: uuid16('fff0'),
        moyu32: '0783b03e-7735-b5a0-1760-a305d2795cb0',
        mhc: uuid16('1000'),
        giikerData: uuid16('aadb'),
        giikerRw: uuid16('aaaa'),
        gocube: '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
    };

    /**
     * Schrijfacties achter elkaar zetten. Web Bluetooth weigert een schrijfactie
     * zolang de vorige nog loopt ("GATT operation already in progress"). Een
     * QiYi wil elk bericht bevestigd zien en een GAN vraagt soms de geschiedenis
     * op; zonder rij botsen die met elkaar en valt de cube stil.
     */
    function writeQueue(characteristic, log) {
        let rij = Promise.resolve();
        return bytes => {
            rij = rij.then(() => characteristic.writeValue(bytes)).catch(err => {
                log('schrijven mislukt: ' + (err && err.message ? err.message : err)); // niet vertalen
            });
            return rij;
        };
    }

    function listen(characteristic, handler) {
        const wrapper = event => handler(toBytes(event.target.value));
        characteristic.addEventListener('characteristicvaluechanged', wrapper);
        return () => characteristic.removeEventListener('characteristicvaluechanged', wrapper);
    }

    async function characteristicsOf(service) {
        const lijst = await service.getCharacteristics();
        const map = new Map();
        lijst.forEach(c => map.set(toUuid128(c.uuid), c));
        return map;
    }

    const delay = ms => new Promise(klaar => setTimeout(klaar, ms));

    /** De standaardopbouw voor cubes die met versleutelde meldingen werken. */
    function notifyConnection({ label, notify, write, cipher, decoder, requests, pollBattery, session }) {
        let actief = true;
        let huidigeCipher = cipher;
        const schrijf = write ? writeQueue(write, session.log) : () => Promise.resolve();
        const stuur = plain => (plain ? schrijf(huidigeCipher ? huidigeCipher.encrypt(plain) : plain) : Promise.resolve());
        decoder.send = stuur;

        const stop = listen(notify, bytes => {
            if (!actief) return;
            try {
                decoder.handle(huidigeCipher ? huidigeCipher.decrypt(bytes) : bytes);
            } catch (err) {
                session.log('bericht niet te lezen: ' + err.message); // niet vertalen
            }
        });

        const vraag = type => stuur(decoder.command ? decoder.command(type) : null);
        let batterijTimer = null;
        if (pollBattery) batterijTimer = setInterval(() => vraag('battery'), 60000);

        return {
            protocol: label,
            async start() {
                await notify.startNotifications();
                for (const type of requests) await vraag(type);
            },
            request: vraag,
            canReset: Boolean(decoder.command && decoder.command('reset')),
            reset() { return vraag('reset'); },
            setCipher(nieuw) { huidigeCipher = nieuw; },
            async close() {
                actief = false;
                clearInterval(batterijTimer);
                stop();
                try { await notify.stopNotifications(); } catch (err) { /* al weg */ }
            }
        };
    }

    const GAN_CICS = Array.from({ length: 256 }, (_, i) => (i << 8) | 0x01);
    const MOYU32_CICS = (() => {
        const lijst = Array.from({ length: 255 }, (_, i) => (i + 1) << 8);
        // Chrome vóór versie 130 crashte op fabrikantcode 0x0000; een ongebonden
        // MoYu gebruikt juist die. Alleen overslaan als we zeker weten dat het
        // zo'n oude Chrome is.
        const merken = typeof navigator !== 'undefined' && navigator.userAgentData && navigator.userAgentData.brands;
        const oud = Array.isArray(merken) && merken.some(m =>
            (m.brand === 'Google Chrome' || m.brand === 'Chromium') && parseInt(m.version, 10) < 130);
        if (!oud) lijst.unshift(0x0000);
        return lijst;
    })();
    const QIYI_CICS = [0x0504];

    /** De laatste zes bytes, achterstevoren: zo zit het MAC-adres bij GAN en MoYu. */
    function macFromTail(data, maxLength) {
        const bytes = toBytes(data);
        const deel = maxLength ? bytes.slice(0, maxLength) : bytes;
        if (deel.length < 6) return null;
        const mac = [];
        for (let i = 1; i <= 6; i += 1) mac.push(deel[deel.length - i]);
        return formatMac(mac);
    }

    const BRANDS = [
        {
            id: 'gan',
            label: 'GAN',
            prefixes: ['GAN', 'MG', 'AiCube'],
            services: [SERVICES.ganGen2, SERVICES.ganGen3, SERVICES.ganGen4, SERVICES.ganGen1Data, SERVICES.ganGen1Meta],
            cics: GAN_CICS,
            needsMac: true,
            macFromAdvertisement: data => macFromTail(data, 9),
            async open(device, gatt, session) {
                const services = await gatt.getPrimaryServices();
                const byUuid = new Map(services.map(s => [toUuid128(s.uuid), s]));

                const variant = [
                    { service: SERVICES.ganGen2, label: 'GAN gen2', notify: '28be4cb6-cd67-11e9-a32f-2a2ae2dbcce4', write: '28be4a4a-cd67-11e9-a32f-2a2ae2dbcce4', Decoder: GanGen2Decoder },
                    { service: SERVICES.ganGen3, label: 'GAN gen3', notify: '8653000b-43e6-47b7-9cb0-5fc21d4ae340', write: '8653000c-43e6-47b7-9cb0-5fc21d4ae340', Decoder: GanGen3Decoder },
                    { service: SERVICES.ganGen4, label: 'GAN gen4', notify: uuid16('fff6'), write: uuid16('fff5'), Decoder: GanGen4Decoder }
                ].find(v => byUuid.has(v.service));

                if (!variant) {
                    if (byUuid.has(SERVICES.ganGen1Data) && byUuid.has(SERVICES.ganGen1Meta)) {
                        return openGanGen1(byUuid.get(SERVICES.ganGen1Data), byUuid.get(SERVICES.ganGen1Meta), session);
                    }
                    throw new Error('Deze GAN-cube gebruikt een protocol dat we niet kennen.'); // niet vertalen: smartcube.js vertaalt
                }

                const chars = await characteristicsOf(byUuid.get(variant.service));
                const aiCube = String(device.name || '').startsWith('AiCube');
                const keys = aiCube ? KEYS.aiCube : KEYS.ganGen2;
                const maakCipher = mac => new SaltedCipher(keys.key, keys.iv, mac);
                const mac = await session.needMac();
                const decoder = new variant.Decoder({ emit: session.emit });
                const conn = notifyConnection({
                    label: aiCube ? 'AiCube (GAN gen2)' : variant.label,
                    notify: chars.get(variant.notify),
                    write: chars.get(variant.write),
                    cipher: maakCipher(mac),
                    decoder,
                    requests: ['hardware', 'facelets', 'battery'],
                    pollBattery: true,
                    session
                });
                conn.needsMac = true;
                conn.setMac = async nieuw => {
                    conn.setCipher(maakCipher(nieuw));
                    await conn.request('facelets');
                    await conn.request('battery');
                };
                return conn;
            }
        },
        {
            id: 'qiyi',
            label: 'QiYi',
            prefixes: ['QY-QYSC', 'XMD-TornadoV4-i'],
            services: [SERVICES.qiyi],
            cics: QIYI_CICS,
            needsMac: true,
            // Bij QiYi staan de laatste twee bytes van het MAC-adres in de naam.
            defaultMac(name) {
                const m = /^(QY-QYSC|XMD-TornadoV4-i)-.-([0-9A-F]{2})([0-9A-F]{2})$/i.exec(String(name || '').trim());
                return m ? 'CC:A3:00:00:' + m[2].toUpperCase() + ':' + m[3].toUpperCase() : null;
            },
            macFromAdvertisement(data) {
                const bytes = toBytes(data);
                if (bytes.length < 6) return null;
                return formatMac(Array.from(bytes.slice(0, 6)).reverse());
            },
            async open(device, gatt, session) {
                const service = await gatt.getPrimaryService(SERVICES.qiyi);
                const chars = await characteristicsOf(service);
                const char = chars.get(uuid16('fff6'));
                if (!char) throw new Error('Deze QiYi-cube heeft niet de verwachte aansluiting.'); // niet vertalen: smartcube.js vertaalt

                const cipher = new BlockCipher(KEYS.qiyi);
                const schrijf = writeQueue(char, session.log);
                const decoder = new QiyiDecoder({
                    emit: session.emit,
                    send: content => schrijf(cipher.encrypt(qiyiFrame(content)))
                });
                let actief = true;
                const stop = listen(char, bytes => {
                    if (!actief) return;
                    decoder.handle(cipher.decrypt(bytes));
                });
                const zegHallo = mac => {
                    const hello = decoder.hello(mac);
                    return hello ? schrijf(cipher.encrypt(qiyiFrame(hello))) : Promise.resolve();
                };
                const mac = await session.needMac();

                return {
                    protocol: 'QiYi',
                    needsMac: true,
                    canReset: false,
                    async start() {
                        await char.startNotifications();
                        await zegHallo(mac);
                    },
                    request() { return Promise.resolve(); },
                    reset() { return Promise.resolve(); },
                    async setMac(nieuw) { await zegHallo(nieuw); },
                    async close() {
                        actief = false;
                        stop();
                        try { await char.stopNotifications(); } catch (err) { /* al weg */ }
                    }
                };
            }
        },
        {
            id: 'moyu32',
            label: 'MoYu',
            prefixes: ['WCU_MY3'],
            services: [SERVICES.moyu32],
            cics: MOYU32_CICS,
            needsMac: true,
            defaultMac(name) {
                const m = /^WCU_MY32_([0-9A-F]{2})([0-9A-F]{2})$/i.exec(String(name || '').trim());
                return m ? 'CF:30:16:00:' + m[1].toUpperCase() + ':' + m[2].toUpperCase() : null;
            },
            macFromAdvertisement: data => macFromTail(data),
            async open(device, gatt, session) {
                const service = await gatt.getPrimaryService(SERVICES.moyu32);
                const chars = await characteristicsOf(service);
                const maakCipher = mac => new SaltedCipher(KEYS.moyu32.key, KEYS.moyu32.iv, mac);
                const mac = await session.needMac();
                const conn = notifyConnection({
                    label: 'MoYu WeiLong AI',
                    notify: chars.get('0783b03e-7735-b5a0-1760-a305d2795cb1'),
                    write: chars.get('0783b03e-7735-b5a0-1760-a305d2795cb2'),
                    cipher: maakCipher(mac),
                    decoder: new Moyu32Decoder({ emit: session.emit }),
                    requests: ['hardware', 'facelets', 'battery'],
                    pollBattery: true,
                    session
                });
                conn.needsMac = true;
                conn.setMac = async nieuw => {
                    conn.setCipher(maakCipher(nieuw));
                    await conn.request('facelets');
                    await conn.request('battery');
                };
                return conn;
            }
        },
        {
            id: 'mhc',
            label: 'MoYu (oud)',
            prefixes: ['MHC'],
            services: [SERVICES.mhc],
            cics: [],
            needsMac: false,
            reportsState: false,
            async open(device, gatt, session) {
                const service = await gatt.getPrimaryService(SERVICES.mhc);
                const chars = await characteristicsOf(service);
                const turn = chars.get(uuid16('1003'));
                if (!turn) throw new Error('Deze MoYu-cube heeft niet de verwachte aansluiting.'); // niet vertalen: smartcube.js vertaalt
                return notifyConnection({
                    label: 'MoYu AI (MHC)',
                    notify: turn,
                    write: null,
                    cipher: null,
                    decoder: new MhcDecoder({ emit: session.emit }),
                    requests: [],
                    pollBattery: false,
                    session
                });
            }
        },
        {
            id: 'giiker',
            label: 'Giiker',
            prefixes: ['Gi', 'Mi Smart Magic Cube', 'Hi-'],
            services: [SERVICES.giikerData, SERVICES.giikerRw],
            cics: [],
            needsMac: false,
            async open(device, gatt, session) {
                const service = await gatt.getPrimaryService(SERVICES.giikerData);
                const chars = await characteristicsOf(service);
                const data = chars.get(uuid16('aadc'));
                const decoder = new GiikerDecoder({ emit: session.emit });
                const conn = notifyConnection({
                    label: 'Giiker',
                    notify: data,
                    write: null,
                    cipher: null,
                    decoder,
                    requests: [],
                    pollBattery: false,
                    session
                });
                const start = conn.start;
                conn.start = async () => {
                    await start();
                    decoder.handle(toBytes(await data.readValue()));
                };
                // Batterij: los kanaal, antwoord op 0xB5.
                conn.request = async type => {
                    if (type !== 'battery') return;
                    try {
                        const rw = await gatt.getPrimaryService(SERVICES.giikerRw);
                        const rwChars = await characteristicsOf(rw);
                        const lees = rwChars.get(uuid16('aaab'));
                        const schrijf = rwChars.get(uuid16('aaac'));
                        const antwoord = new Promise(klaar => {
                            const stop = listen(lees, bytes => { stop(); klaar(bytes[1]); });
                        });
                        await lees.startNotifications();
                        await schrijf.writeValue(new Uint8Array([0xB5]));
                        const level = await Promise.race([antwoord, delay(3000).then(() => null)]);
                        if (typeof level === 'number') session.emit('battery', { level: Math.min(level, 100) });
                    } catch (err) {
                        session.log('batterij opvragen mislukt: ' + err.message); // niet vertalen
                    }
                };
                return conn;
            }
        },
        {
            id: 'gocube',
            label: 'GoCube',
            prefixes: ['GoCube', 'Rubiks'],
            services: [SERVICES.gocube],
            cics: [],
            needsMac: false,
            async open(device, gatt, session) {
                const service = await gatt.getPrimaryService(SERVICES.gocube);
                const chars = await characteristicsOf(service);
                const write = chars.get('6e400002-b5a3-f393-e0a9-e50e24dcca9e');
                const decoder = new GoCubeDecoder({ emit: session.emit });
                // GoCube kent geen opdrachtnamen, alleen twee losse bytes.
                decoder.command = type => (type === 'facelets' ? new Uint8Array([51])
                    : type === 'battery' ? new Uint8Array([50]) : null);
                return notifyConnection({
                    label: 'GoCube',
                    notify: chars.get('6e400003-b5a3-f393-e0a9-e50e24dcca9e'),
                    write,
                    cipher: null,
                    decoder,
                    requests: ['facelets', 'battery'],
                    pollBattery: true,
                    session
                });
            }
        }
    ];

    /** GAN gen1 (356i, 2019): alles wordt opgevraagd in plaats van gemeld. */
    async function openGanGen1(dataService, metaService, session) {
        const meta = await characteristicsOf(metaService);
        const versie = toBytes(await meta.get(uuid16('2a28')).readValue());
        const v = (versie[0] << 16) | (versie[1] << 8) | versie[2];
        if (!(v > 0x010007 && (v & 0xFFFE00) === 0x010000)) {
            session.log('onbekende firmware van de GAN 356i: versie ' + v.toString(16)); // niet vertalen
            throw new Error('Deze firmware van de GAN 356i kennen we niet.'); // niet vertalen: smartcube.js vertaalt
        }
        const hw = toBytes(await meta.get(uuid16('2a23')).readValue());
        const key = KEYS.ganGen1[(v >> 8) & 0xFF].slice();
        for (let i = 0; i < 6; i += 1) key[i] = (key[i] + hw[5 - i]) & 0xFF;
        const cipher = new Gen1Cipher(key);

        const chars = await characteristicsOf(dataService);
        const lees = async short => cipher.decrypt(toBytes(await chars.get(uuid16(short)).readValue()));

        let actief = true;
        let teller = -1;
        let cubeTime = 0;

        async function leesStand() {
            const facelets = Gen1.parseFacelets(await lees('fff2'));
            if (facelets) session.emit('facelets', { facelets });
            else session.emit('keyError', { reason: 'onleesbare stand' }); // niet vertalen
        }

        async function lus() {
            while (actief) {
                try {
                    const f5 = await lees('fff5');
                    const { count, moves, valid } = Gen1.parseMoves(f5);
                    if (teller === -1) {
                        teller = count;
                    } else if (count === teller || !valid) {
                        // Niets nieuws. Even rust, anders wordt dit een lus die
                        // de hele pagina bezet houdt.
                        await delay(10);
                    } else {
                        const nieuw = (count - teller) & 0xFF;
                        teller = count;
                        if (nieuw > moves.length) {
                            // Te veel gemist om na te spelen: de stand opnieuw lezen.
                            await leesStand();
                        } else {
                            const offsets = Gen1.parseOffsets(await lees('fff6'));
                            const t = now();
                            for (let i = moves.length - nieuw; i < moves.length; i += 1) {
                                cubeTime += offsets[offsets.length - moves.length + i] || 0;
                                session.emit('move', { move: moves[i], cubeTime, localTime: i === moves.length - 1 ? t : null });
                            }
                        }
                    }
                } catch (err) {
                    if (!actief) return;
                    session.log('uitlezen mislukt: ' + err.message); // niet vertalen
                    await delay(250);
                }
            }
        }

        return {
            protocol: 'GAN gen1',
            needsMac: false,
            canReset: false,
            async start() {
                await leesStand();
                lus();
            },
            async request(type) {
                if (type === 'battery' && chars.get(uuid16('fff7'))) {
                    const f7 = await lees('fff7');
                    session.emit('battery', { level: Math.min(f7[7], 100) });
                } else if (type === 'facelets') {
                    await leesStand();
                }
            },
            reset() { return Promise.resolve(); },
            async close() { actief = false; }
        };
    }

    /* =====================================================================
     * Verbinden
     * ================================================================== */

    function isSupported() {
        return typeof navigator !== 'undefined' && Boolean(navigator.bluetooth);
    }

    /** Alles wat het keuzevenster moet weten: alleen cubes, en álle cubes. */
    function requestOptions() {
        const filters = [];
        const services = new Set();
        const cics = new Set();
        BRANDS.forEach(brand => {
            brand.prefixes.forEach(prefix => filters.push({ namePrefix: prefix }));
            brand.services.forEach(s => services.add(s));
            brand.cics.forEach(c => cics.add(c));
        });
        return {
            filters,
            optionalServices: Array.from(services),
            optionalManufacturerData: Array.from(cics)
        };
    }

    /** Welk merk hoort bij deze naam? De langste passende naam wint. */
    function brandFor(name) {
        let beste = null;
        let lengte = 0;
        const tekst = String(name || '');
        BRANDS.forEach(brand => brand.prefixes.forEach(prefix => {
            if (tekst.startsWith(prefix) && prefix.length > lengte) {
                beste = brand;
                lengte = prefix.length;
            }
        }));
        return beste;
    }

    /**
     * Probeert het MAC-adres uit de advertentie van de cube te lezen. Dat lukt
     * alleen in Chrome op Windows en macOS (en Android); op Linux en ChromeOS
     * bestaat de functie wel maar komt er nooit iets binnen, dus daar slaan we
     * het meteen over in plaats van tien seconden te wachten.
     */
    function macFromAdvertisements(device, brand, wachttijd = 7000) {
        if (!brand || !brand.macFromAdvertisement || typeof device.watchAdvertisements !== 'function') {
            return Promise.resolve(null);
        }
        const platform = typeof navigator !== 'undefined' && navigator.userAgentData && navigator.userAgentData.platform;
        if (platform === 'Linux' || platform === 'Chrome OS') return Promise.resolve(null);

        return new Promise(klaar => {
            const abort = new AbortController();
            let klaarGemeld = false;
            const einde = mac => {
                if (klaarGemeld) return;
                klaarGemeld = true;
                device.removeEventListener('advertisementreceived', opAdvertentie);
                abort.abort();
                klaar(mac);
            };
            const opAdvertentie = event => {
                const data = event.manufacturerData;
                if (!data || !data.size) return;              // volgende afwachten
                for (const cic of brand.cics) {
                    if (data.has(cic)) {
                        einde(brand.macFromAdvertisement(data.get(cic)));
                        return;
                    }
                }
            };
            device.addEventListener('advertisementreceived', opAdvertentie);
            device.watchAdvertisements({ signal: abort.signal }).catch(() => einde(null));
            setTimeout(() => einde(null), wachttijd);
        });
    }

    /**
     * Opent de verbinding met een gekozen apparaat.
     *
     * `hooks`:
     *   emit(type, data)           gebeurtenissen van de cube
     *   status(stap)               'mac-zoeken' | 'verbinden' | 'klaar'
     *   storedMac(naam)            eerder gebruikt MAC-adres, of null
     *   askMac({ naam, voorstel, reden })  vraagt de gebruiker, of null
     *   log(tekst)
     */
    async function open(device, hooks) {
        const log = tekst => hooks.log && hooks.log('[smartcube] ' + tekst); // niet vertalen
        let brand = brandFor(device.name);

        // Het MAC-adres zoeken moet vóór het verbinden: een verbonden cube
        // stopt met adverteren.
        let advertised = null;
        const stored = brand && brand.needsMac ? hooks.storedMac(device.name) : null;
        if (brand && brand.needsMac && !stored) {
            hooks.status('mac-zoeken');
            advertised = await macFromAdvertisements(device, brand);
            if (advertised) log('MAC-adres uit de advertentie: ' + advertised); // niet vertalen
        }

        hooks.status('verbinden');
        const gatt = await device.gatt.connect();

        if (!brand) {
            const services = await gatt.getPrimaryServices();
            const uuids = services.map(s => toUuid128(s.uuid));
            brand = BRANDS.find(b => b.services.some(s => uuids.includes(s))) || null;
            if (!brand) throw new Error('Dit apparaat herkennen we niet als smart cube.'); // niet vertalen: smartcube.js vertaalt
        }

        const macInfo = { mac: null, source: null };
        const session = {
            log,
            emit: hooks.emit,
            async needMac() {
                const voorstel = brand.defaultMac ? brand.defaultMac(device.name) : null;
                const kandidaten = [
                    [stored, 'opgeslagen'],
                    [advertised, 'advertentie'],
                    [voorstel, 'naam']
                ];
                for (const [mac, bron] of kandidaten) {
                    if (parseMac(mac)) {
                        macInfo.mac = mac;
                        macInfo.source = bron;
                        return mac;
                    }
                }
                const gevraagd = await hooks.askMac({ naam: device.name, voorstel: null, reden: 'onbekend' });
                if (!parseMac(gevraagd)) throw new Error('Zonder MAC-adres kan deze cube niet verbinden.'); // niet vertalen: smartcube.js vertaalt
                macInfo.mac = gevraagd;
                macInfo.source = 'ingevoerd';
                return gevraagd;
            }
        };

        // Waakhond voor het MAC-adres. Met een verkeerde sleutel verstaat de
        // cube onze vragen niet en zwijgt hij gewoon; dat is dus ook een
        // sleutelfout, alleen een die je aan de stilte herkent.
        let geldigOntvangen = false;
        let waakhond = null;
        const wachttijd = typeof hooks.keyTimeout === 'number' ? hooks.keyTimeout : 5000;
        const opnieuwWaken = () => {
            clearTimeout(waakhond);
            geldigOntvangen = false;
            waakhond = setTimeout(() => {
                if (!geldigOntvangen) hooks.emit('keyError', { reason: 'geen antwoord' }); // niet vertalen
            }, wachttijd);
        };
        session.emit = (type, data) => {
            if (type === 'facelets' || type === 'battery' || type === 'move') {
                geldigOntvangen = true;
                clearTimeout(waakhond);
            }
            hooks.emit(type, data);
        };

        const conn = await brand.open(device, gatt, session);
        conn.brand = brand;
        conn.name = device.name || brand.label;
        conn.mac = macInfo;
        conn.reportsState = brand.reportsState !== false;
        conn.device = device;

        if (conn.needsMac) {
            const setMac = conn.setMac;
            conn.setMac = async mac => {
                macInfo.mac = mac;
                macInfo.source = 'ingevoerd';
                opnieuwWaken();
                await setMac(mac);
            };
            const close = conn.close;
            conn.close = async () => {
                clearTimeout(waakhond);
                await close();
            };
        }

        await conn.start();
        if (conn.needsMac) opnieuwWaken();
        hooks.status('klaar');
        return conn;
    }

    /**
     * Opent het keuzevenster en verbindt. Roep dit rechtstreeks aan vanuit een
     * klik: Chrome toont het venster alleen als het direct op een handeling van
     * de gebruiker volgt. De vorige versie opende na een mislukte poging een
     * tweede venster, en dat werd daarom vaak geweigerd.
     */
    async function connect(hooks) {
        if (!isSupported()) throw new Error('Web Bluetooth ontbreekt in deze browser.'); // niet vertalen: smartcube.js vertaalt
        const device = await navigator.bluetooth.requestDevice(requestOptions());
        return open(device, hooks);
    }

    root.CubeTimerSmartCube = {
        isSupported,
        connect,
        open,
        brandFor,
        requestOptions,
        parseMac,
        formatMac,
        BRANDS: BRANDS.map(b => ({ id: b.id, label: b.label, needsMac: b.needsMac })),

        // Voor tools/smartcube-testen.js: de losse onderdelen.
        _test: {
            SaltedCipher, Gen1Cipher, BlockCipher, KEYS,
            GanGen2Decoder, GanGen3Decoder, GanGen4Decoder, Gen1,
            QiyiDecoder, qiyiFrame, crc16modbus,
            Moyu32Decoder, MhcDecoder, GiikerDecoder, GoCubeDecoder,
            cubiesToFacelets, CORNERS_GIIKER, EDGES_GIIKER, BRANDS
        }
    };
}(typeof window !== 'undefined' ? window : globalThis));
