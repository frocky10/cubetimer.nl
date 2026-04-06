import "https://cdn.cubing.net/v0/js/cubing/twisty";
import { connectSmartPuzzle } from "https://cdn.cubing.net/v0/js/cubing/bluetooth";
import CryptoJS from "https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/+esm";

const connectBtn = document.getElementById("bluetooth-connect");
const disconnectBtn = document.getElementById("bluetooth-disconnect");
const forgetMacBtn = document.getElementById("bluetooth-forget-mac");
const statusField = document.getElementById("bluetooth-status");
const deviceNameField = document.getElementById("bluetooth-device-name");
const batteryField = document.getElementById("bluetooth-battery");
const autoTimerField = document.getElementById("bluetooth-auto-timer");
const cubeStateField = document.getElementById("bluetooth-cube-state");
const scrambleProgressField = document.getElementById("bluetooth-scramble-progress");
const moveStreamField = document.getElementById("bluetooth-move-stream");
const player = document.getElementById("bluetooth-cube-player");
const viewer = player?.parentElement || null;

const MAX_MOVE_HISTORY = 24;
const SOLVED_CHECK_DEBOUNCE_MS = 140;
const QIYI_HANDSHAKE_TIMEOUT_MS = 4500;
const QIYI_POLL_INTERVAL_MS = 350;
const QIYI_SERVICE_UUID = 0xfff0;
const QIYI_CHAR_UUID = 0xfff6;
const QIYI_AES_KEY_HEX = "57b1f9abcd5ae8a79cb98ce7578c5108";
const QIYI_STORAGE_PREFIX = "cubetimer_qiyi_mac_";
const QIYI_VENDOR_PREFIX = [0xb8, 0xae, 0x1c];
const SOLVED_FACELETS = [
    3, 3, 3, 3, 3, 3, 3, 3, 3,
    1, 1, 1, 1, 1, 1, 1, 1, 1,
    4, 4, 4, 4, 4, 4, 4, 4, 4,
    2, 2, 2, 2, 2, 2, 2, 2, 2,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    5, 5, 5, 5, 5, 5, 5, 5, 5
];
const FACELET_COLORS = {
    0: "#ff8a2b",
    1: "#ff4d4d",
    2: "#ffd84d",
    3: "#f8fbff",
    4: "#37d67a",
    5: "#3f73ff"
};
const QIYI_MOVE_MAP = {
    0x1: "L'",
    0x2: "L",
    0x3: "R'",
    0x4: "R",
    0x5: "D'",
    0x6: "D",
    0x7: "U'",
    0x8: "U",
    0x9: "F'",
    0x0a: "F",
    0x0b: "B'",
    0x0c: "B"
};

let activeConnection = null;
let solvedCheckTimeout = null;
let batteryPollInterval = null;
let moveHistory = [];
let scrambleTokens = [];
let scrambleMovesMatched = [];
let solveMoves = [];
let scrambleMismatch = false;
let connectionBusy = false;
let cubeNet = null;
let cubeNetFacelets = [];
let currentFacelets = null;
let qiyiHandshakeTimeout = null;
let qiyiPollInterval = null;
let targetScrambleFacelets = null;

const FACE_ORDER = ["U", "R", "F", "D", "L", "B"];
const FACE_COORDS = buildFaceletCoordinateTables();

function getTimerApi() {
    return window.cubeTimerApi || null;
}

function setStatus(message) {
    if (statusField) {
        statusField.textContent = message;
    }
}

function setValue(node, value) {
    if (node) {
        node.textContent = value;
    }
}

function setButtons() {
    const bluetoothSupported = getTimerApi()?.getState?.().bluetoothSupported ?? true;
    if (connectBtn) {
        connectBtn.disabled = connectionBusy || !!activeConnection || !bluetoothSupported || !navigator.bluetooth;
        connectBtn.title = navigator.bluetooth
            ? bluetoothSupported
                ? ""
                : "Bluetooth cube support is only enabled for 3x3 sessions."
            : "Web Bluetooth requires Chrome or Edge on HTTPS or localhost.";
    }
    if (disconnectBtn) {
        disconnectBtn.disabled = connectionBusy || !activeConnection;
    }
    if (forgetMacBtn) {
        forgetMacBtn.disabled = connectionBusy;
    }
}

function normalizeMoveToken(move) {
    return String(move || "")
        .replace(/[\u2032’]/g, "'")
        .trim();
}

function tokenizeAlg(scramble) {
    return String(scramble || "")
        .trim()
        .split(/\s+/)
        .map(normalizeMoveToken)
        .filter(Boolean);
}

function updateScrambleProgress() {
    if (!scrambleProgressField) return;
    if (activeConnection?.type === "qiyi" && targetScrambleFacelets) {
        const ready = currentFacelets && faceletsEqual(currentFacelets, targetScrambleFacelets);
        scrambleProgressField.textContent = ready
            ? "Scramble state matched"
            : "Bring cube to the shown scramble state";
        return;
    }
    const total = scrambleTokens.length;
    const matched = scrambleMovesMatched.length;
    if (!total) {
        scrambleProgressField.textContent = "No 3x3 scramble loaded";
        return;
    }
    if (scrambleMismatch) {
        scrambleProgressField.textContent = `${matched} / ${total} moves matched, mismatch detected`;
        return;
    }
    if (matched >= total) {
        scrambleProgressField.textContent = `${total} / ${total} moves matched, ready to solve`;
        return;
    }
    scrambleProgressField.textContent = `${matched} / ${total} moves matched`;
}

function updateMoveStream() {
    if (!moveStreamField) return;
    moveStreamField.textContent = moveHistory.length ? moveHistory.join(" ") : "Waiting for moves...";
}

function faceletsEqual(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
        return false;
    }
    return left.every((value, index) => value === right[index]);
}

function buildFaceletCoordinateTables() {
    const byIndex = [];
    const byKey = new Map();
    FACE_ORDER.forEach((face, faceOffset) => {
        for (let row = 0; row < 3; row += 1) {
            for (let col = 0; col < 3; col += 1) {
                const index = faceOffset * 9 + row * 3 + col;
                const descriptor = getFaceletDescriptor(face, row, col);
                byIndex[index] = descriptor;
                byKey.set(faceletKey(descriptor), index);
            }
        }
    });
    return { byIndex, byKey };
}

function faceletKey({ x, y, z, nx, ny, nz }) {
    return `${x},${y},${z}|${nx},${ny},${nz}`;
}

function getFaceletDescriptor(face, row, col) {
    switch (face) {
        case "U":
            return { x: col - 1, y: 1, z: row - 1, nx: 0, ny: 1, nz: 0 };
        case "R":
            return { x: 1, y: 1 - row, z: 1 - col, nx: 1, ny: 0, nz: 0 };
        case "F":
            return { x: col - 1, y: 1 - row, z: 1, nx: 0, ny: 0, nz: 1 };
        case "D":
            return { x: col - 1, y: -1, z: 1 - row, nx: 0, ny: -1, nz: 0 };
        case "L":
            return { x: -1, y: 1 - row, z: col - 1, nx: -1, ny: 0, nz: 0 };
        case "B":
            return { x: 1 - col, y: 1 - row, z: -1, nx: 0, ny: 0, nz: -1 };
        default:
            throw new Error(`Unsupported face: ${face}`);
    }
}

function rotatePoint(point, face) {
    const { x, y, z } = point;
    const normal = { x: point.nx, y: point.ny, z: point.nz };
    const position = { x, y, z };
    const rotate = (vector) => {
        switch (face) {
            case "U":
                return { x: vector.z, y: vector.y, z: -vector.x };
            case "D":
                return { x: -vector.z, y: vector.y, z: vector.x };
            case "R":
                return { x: vector.x, y: vector.z, z: -vector.y };
            case "L":
                return { x: vector.x, y: -vector.z, z: vector.y };
            case "F":
                return { x: vector.y, y: -vector.x, z: vector.z };
            case "B":
                return { x: vector.y, y: -vector.x, z: vector.z };
            default:
                return vector;
        }
    };
    const nextPosition = rotate(position);
    const nextNormal = rotate(normal);
    return {
        x: nextPosition.x,
        y: nextPosition.y,
        z: nextPosition.z,
        nx: nextNormal.x,
        ny: nextNormal.y,
        nz: nextNormal.z
    };
}

function shouldRotateDescriptor(descriptor, face) {
    switch (face) {
        case "U":
            return descriptor.y === 1;
        case "D":
            return descriptor.y === -1;
        case "R":
            return descriptor.x === 1;
        case "L":
            return descriptor.x === -1;
        case "F":
            return descriptor.z === 1;
        case "B":
            return descriptor.z === -1;
        default:
            return false;
    }
}

function applyFaceTurn(facelets, face, turns = 1) {
    let next = facelets.slice();
    for (let turn = 0; turn < turns; turn += 1) {
        const updated = next.slice();
        FACE_COORDS.byIndex.forEach((descriptor, sourceIndex) => {
            const mapped = shouldRotateDescriptor(descriptor, face) ? rotatePoint(descriptor, face) : descriptor;
            const targetIndex = FACE_COORDS.byKey.get(faceletKey(mapped));
            updated[targetIndex] = next[sourceIndex];
        });
        next = updated;
    }
    return next;
}

function computeScrambleTargetFacelets(scramble) {
    let facelets = SOLVED_FACELETS.slice();
    tokenizeAlg(scramble).forEach((token) => {
        const face = token[0];
        if (!FACE_ORDER.includes(face)) return;
        const turns = token.endsWith("2") ? 2 : token.endsWith("'") ? 3 : 1;
        facelets = applyFaceTurn(facelets, face, turns);
    });
    return facelets;
}

function ensureCubeNet() {
    if (!viewer || cubeNet) return;
    cubeNet = document.createElement("div");
    cubeNet.className = "bluetooth-cube-net";
    cubeNet.hidden = true;
    const layout = [];
    for (let row = 0; row < 9; row += 1) {
        for (let col = 0; col < 12; col += 1) {
            const tile = document.createElement("div");
            tile.className = "bluetooth-cube-net__facelet";
            const faceIndex = getFaceletIndexForNetPosition(row, col);
            if (faceIndex === null) {
                tile.style.visibility = "hidden";
            } else {
                tile.dataset.faceletIndex = String(faceIndex);
                layout[faceIndex] = tile;
            }
            cubeNet.appendChild(tile);
        }
    }
    cubeNetFacelets = layout;
    viewer.appendChild(cubeNet);
}

function getFaceletIndexForNetPosition(row, col) {
    if (row < 3 && col >= 3 && col < 6) {
        return row * 3 + (col - 3);
    }
    if (row >= 3 && row < 6) {
        const middleRow = row - 3;
        if (col < 3) return 36 + middleRow * 3 + col;
        if (col >= 3 && col < 6) return 18 + middleRow * 3 + (col - 3);
        if (col >= 6 && col < 9) return 9 + middleRow * 3 + (col - 6);
        if (col >= 9 && col < 12) return 45 + middleRow * 3 + (col - 9);
    }
    if (row >= 6 && col >= 3 && col < 6) {
        return 27 + (row - 6) * 3 + (col - 3);
    }
    return null;
}

function showQiyiNet(facelets = currentFacelets) {
    ensureCubeNet();
    if (player) {
        player.classList.add("bluetooth-cube-player--hidden");
    }
    if (cubeNet) {
        cubeNet.hidden = false;
    }
    if (!facelets || !cubeNetFacelets.length) return;
    facelets.forEach((value, index) => {
        const tile = cubeNetFacelets[index];
        if (!tile) return;
        tile.style.background = FACELET_COLORS[value] || "rgba(255,255,255,0.08)";
    });
}

function showTwistyPlayer() {
    if (player) {
        player.classList.remove("bluetooth-cube-player--hidden");
    }
    if (cubeNet) {
        cubeNet.hidden = true;
    }
}

function resetPlayerToScramble() {
    showTwistyPlayer();
    if (!player) return;
    player.puzzle = "3x3x3";
    player.experimentalSetupAlg = "";
    player.alg = "";
}

function showScrambleReplay() {
    showTwistyPlayer();
    if (!player) return;
    player.puzzle = "3x3x3";
    player.experimentalSetupAlg = "";
    player.alg = scrambleMovesMatched.join(" ");
}

function showSolveReplay() {
    showTwistyPlayer();
    if (!player) return;
    player.puzzle = "3x3x3";
    player.experimentalSetupAlg = scrambleTokens.join(" ");
    player.alg = solveMoves.join(" ");
}

function resetTracking({ keepMoveHistory = false } = {}) {
    scrambleMovesMatched = [];
    solveMoves = [];
    scrambleMismatch = false;
    currentFacelets = null;
    if (!keepMoveHistory) {
        moveHistory = [];
        updateMoveStream();
    }
    updateScrambleProgress();
    resetPlayerToScramble();
    setValue(autoTimerField, "Waiting for first turn");
    setValue(cubeStateField, "Unknown");
}

function syncScrambleFromTimer(scrambleText, eventId) {
    const timerState = getTimerApi()?.getState?.();
    const activeEvent = eventId || timerState?.activeEvent || "333";
    scrambleTokens = activeEvent === "333" ? tokenizeAlg(scrambleText) : [];
    targetScrambleFacelets = activeEvent === "333" && scrambleTokens.length
        ? computeScrambleTargetFacelets(scrambleText)
        : null;
    resetTracking();
    if (activeEvent !== "333") {
        setStatus("Bluetooth cube mode is only enabled for 3x3 sessions.");
        setValue(autoTimerField, "Unavailable for this event");
        setValue(cubeStateField, "Unavailable");
    } else if (activeConnection) {
        setStatus("Cube connected. Complete the scramble on the smart cube, then inspection will start automatically.");
        setValue(autoTimerField, targetScrambleFacelets ? "Complete scramble to start inspection" : "Waiting for scramble");
        setValue(cubeStateField, "Ready for scramble");
    }
    if (activeConnection?.type === "qiyi" && activeConnection.facelets) {
        showQiyiNet(activeConnection.facelets);
        currentFacelets = activeConnection.facelets.slice();
    }
    setButtons();
}

function isSolvedFacelets(facelets) {
    if (!Array.isArray(facelets) || facelets.length !== SOLVED_FACELETS.length) return false;
    return facelets.every((value, index) => value === SOLVED_FACELETS[index]);
}

function scheduleSolvedCheck() {
    window.clearTimeout(solvedCheckTimeout);
    solvedCheckTimeout = window.setTimeout(async () => {
        const timerApi = getTimerApi();
        if (!activeConnection || !timerApi?.getState?.().running) return;
        const solved = await updateCubeStateLabel();
        if (solved) {
            timerApi.stopTimerFromBluetooth?.();
            setValue(autoTimerField, "Solve detected and timer stopped");
            syncScrambleFromTimer(window.currentScramble || "", timerApi.getState?.().activeEvent);
            setStatus("Cube solved. A new scramble has been generated.");
        }
    }, SOLVED_CHECK_DEBOUNCE_MS);
}

function handleScrambleTracking(moveToken) {
    if (!scrambleTokens.length) {
        return true;
    }
    const nextExpected = scrambleTokens[scrambleMovesMatched.length];
    if (moveToken === nextExpected) {
        scrambleMovesMatched.push(moveToken);
        scrambleMismatch = false;
        if (activeConnection?.type !== "qiyi") {
            showScrambleReplay();
        }
        updateScrambleProgress();
        if (scrambleMovesMatched.length === scrambleTokens.length) {
            setValue(autoTimerField, "Scramble matched, first solve turn starts timer");
            setValue(cubeStateField, "Scrambled");
        } else {
            setValue(autoTimerField, "Tracking scramble");
            setValue(cubeStateField, "Scrambling");
        }
        return true;
    }
    scrambleMismatch = true;
    updateScrambleProgress();
    setValue(autoTimerField, "Scramble mismatch, reset or finish manually");
    setValue(cubeStateField, "Scramble mismatch");
    return false;
}

function canAutoStartSolve() {
    const timerState = getTimerApi()?.getState?.();
    if (!timerState?.bluetoothSupported) return false;
    if (!scrambleTokens.length) return true;
    return scrambleMovesMatched.length === scrambleTokens.length && !scrambleMismatch;
}

function registerMove(moveToken) {
    const timerApi = getTimerApi();
    if (!moveToken || !timerApi) return;

    moveHistory.push(moveToken);
    moveHistory = moveHistory.slice(-MAX_MOVE_HISTORY);
    updateMoveStream();

    const timerState = timerApi.getState?.();
    if (!timerState?.running) {
        if (canAutoStartSolve()) {
            const started = timerApi.startTimerFromBluetooth?.();
            if (started) {
                solveMoves = [moveToken];
                if (activeConnection?.type !== "qiyi") {
                    showSolveReplay();
                }
                setValue(autoTimerField, "Running from cube turns");
                setValue(cubeStateField, "Solving");
                scheduleSolvedCheck();
                return;
            }
        }
        handleScrambleTracking(moveToken);
        return;
    }

    solveMoves.push(moveToken);
    if (activeConnection?.type !== "qiyi") {
        showSolveReplay();
    }
    setValue(autoTimerField, "Running from cube turns");
    setValue(cubeStateField, "Solving");
    scheduleSolvedCheck();
}

function registerStateChangeFromPolling(nextFacelets) {
    const timerApi = getTimerApi();
    if (!timerApi) {
        return;
    }

    const timerState = timerApi.getState?.();
    const scrambleReady = !!targetScrambleFacelets && faceletsEqual(nextFacelets, targetScrambleFacelets);

    if (!timerState?.running) {
        if (scrambleReady) {
            if (timerState.inspectionState === "idle") {
                const inspectionStarted = timerApi.startInspectionFromBluetooth?.();
                if (inspectionStarted) {
                    setValue(autoTimerField, "Inspection running");
                    setValue(cubeStateField, "Scrambled");
                }
            } else {
                setValue(autoTimerField, "Inspection running");
                setValue(cubeStateField, "Scrambled");
            }
            return;
        }

        if (timerState.inspectionState === "running" || timerState.inspectionState === "finished") {
            moveHistory.push("[state]");
            moveHistory = moveHistory.slice(-MAX_MOVE_HISTORY);
            updateMoveStream();
            const started = timerApi.startTimerFromBluetooth?.();
            if (started) {
                solveMoves = [];
                setValue(autoTimerField, "Running from cube state updates");
                setValue(cubeStateField, "Solving");
                scheduleSolvedCheck();
            }
            return;
        }

        setValue(autoTimerField, targetScrambleFacelets ? "Complete scramble to start inspection" : "Waiting for scramble");
        return;
    }

    moveHistory.push("[state]");
    moveHistory = moveHistory.slice(-MAX_MOVE_HISTORY);
    updateMoveStream();
    setValue(autoTimerField, "Running from cube state updates");
    setValue(cubeStateField, "Solving");
    scheduleSolvedCheck();
}

function handleGanMove(event) {
    registerMove(normalizeMoveToken(event?.latestAlgLeaf));
}

async function updateBattery() {
    if (!activeConnection) {
        setValue(batteryField, "--");
        return;
    }
    if (activeConnection.type === "qiyi") {
        setValue(batteryField, Number.isFinite(activeConnection.battery) ? `${activeConnection.battery}%` : "--");
        return;
    }
    if (typeof activeConnection.puzzle?.getBattery !== "function") {
        setValue(batteryField, "--");
        return;
    }
    try {
        const battery = await activeConnection.puzzle.getBattery();
        setValue(batteryField, Number.isFinite(battery) ? `${battery}%` : "--");
    } catch {
        setValue(batteryField, "--");
    }
}

async function updateCubeStateLabel() {
    if (!activeConnection) return false;
    if (activeConnection.type === "qiyi") {
        const solved = isSolvedFacelets(activeConnection.facelets);
        setValue(cubeStateField, solved ? "Solved" : getTimerApi()?.getState?.().running ? "Solving" : "Scrambled");
        return solved;
    }
    try {
        const pattern = await activeConnection.puzzle.getPattern?.();
        const solved = pattern?.experimentalIsSolved?.() === true || pattern?.isSolved?.() === true;
        setValue(cubeStateField, solved ? "Solved" : getTimerApi()?.getState?.().running ? "Solving" : "Scrambled");
        return !!solved;
    } catch {
        setValue(cubeStateField, getTimerApi()?.getState?.().running ? "Solving" : "Connected");
        return false;
    }
}

function padToBlock(bytes) {
    const paddedLength = Math.ceil(bytes.length / 16) * 16;
    const result = new Uint8Array(paddedLength);
    result.set(bytes);
    return result;
}

function bytesToWordArray(bytes) {
    return CryptoJS.lib.WordArray.create(bytes);
}

function wordArrayToBytes(wordArray) {
    const words = wordArray.words;
    const sigBytes = wordArray.sigBytes;
    const bytes = new Uint8Array(sigBytes);
    for (let i = 0; i < sigBytes; i += 1) {
        bytes[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
    }
    return bytes;
}

function encryptQiyiMessage(bytes) {
    const padded = padToBlock(bytes);
    const encrypted = CryptoJS.AES.encrypt(
        bytesToWordArray(padded),
        CryptoJS.enc.Hex.parse(QIYI_AES_KEY_HEX),
        {
            mode: CryptoJS.mode.ECB,
            padding: CryptoJS.pad.NoPadding
        }
    );
    return wordArrayToBytes(encrypted.ciphertext);
}

function decryptQiyiMessage(bytes) {
    const decrypted = CryptoJS.AES.decrypt(
        { ciphertext: bytesToWordArray(bytes) },
        CryptoJS.enc.Hex.parse(QIYI_AES_KEY_HEX),
        {
            mode: CryptoJS.mode.ECB,
            padding: CryptoJS.pad.NoPadding
        }
    );
    return wordArrayToBytes(decrypted);
}

function crc16Modbus(bytes) {
    let crc = 0xffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let i = 0; i < 8; i += 1) {
            const lsb = crc & 0x0001;
            crc >>= 1;
            if (lsb) {
                crc ^= 0xa001;
            }
        }
    }
    return crc & 0xffff;
}

function withChecksum(bytes) {
    const data = Uint8Array.from(bytes);
    const crc = crc16Modbus(data);
    const result = new Uint8Array(data.length + 2);
    result.set(data);
    result[result.length - 2] = crc & 0xff;
    result[result.length - 1] = (crc >> 8) & 0xff;
    return result;
}

function parseMacAddress(rawMac) {
    const normalized = String(rawMac || "").trim().replace(/[^a-fA-F0-9]/g, "");
    if (normalized.length !== 12) return null;
    const bytes = [];
    for (let i = 0; i < normalized.length; i += 2) {
        bytes.push(parseInt(normalized.slice(i, i + 2), 16));
    }
    return bytes;
}

function formatMacAddress(macBytes) {
    return macBytes.map((byte) => byte.toString(16).padStart(2, "0")).join(":").toUpperCase();
}

function getMacStorageKey(name) {
    return `${QIYI_STORAGE_PREFIX}${String(name || "unknown").trim()}`;
}

function clearStoredMacAddress(name) {
    if (!name) return;
    localStorage.removeItem(getMacStorageKey(name));
}

async function getQiyiMacAddress(device) {
    const storageKey = getMacStorageKey(device?.name);
    const cached = localStorage.getItem(storageKey);
    const parsedCached = parseMacAddress(cached);
    if (parsedCached) {
        return parsedCached;
    }

    const discovered = await discoverQiyiMacAddress(device);
    if (discovered) {
        localStorage.setItem(storageKey, formatMacAddress(discovered));
        return discovered;
    }

    const input = window.prompt(
        `Enter the Bluetooth MAC address for ${device?.name || "your cube"}.\nExample: AA:BB:CC:DD:EE:FF\nOn macOS, you can find it in System Information > Bluetooth after pairing the cube once.`,
        cached || ""
    );
    const parsed = parseMacAddress(input);
    if (!parsed) {
        throw new Error("A valid Bluetooth MAC address is required for this QiYi/X-Man cube.");
    }
    localStorage.setItem(storageKey, input.trim());
    return parsed;
}

function scoreMacCandidate(bytes) {
    if (bytes.length !== 6) return -1;
    const directPrefix = QIYI_VENDOR_PREFIX.every((value, index) => bytes[index] === value);
    const reversePrefix = QIYI_VENDOR_PREFIX.every((value, index) => bytes[5 - index] === value);
    if (directPrefix) return 3;
    if (reversePrefix) return 2;
    return 1;
}

function collectMacCandidatesFromBytes(bytes, candidates) {
    if (!bytes || bytes.length < 6) return;
    for (let index = 0; index <= bytes.length - 6; index += 1) {
        const candidate = Array.from(bytes.slice(index, index + 6));
        const score = scoreMacCandidate(candidate);
        if (score < 0) continue;
        candidates.push({ score, bytes: candidate });
    }
}

function getBestMacCandidate(candidates) {
    if (!candidates.length) return null;
    candidates.sort((left, right) => right.score - left.score);
    return candidates[0].bytes;
}

function extractQiyiMacFromAdvertisement(event) {
    const candidates = [];
    if (event.manufacturerData) {
        for (const value of event.manufacturerData.values()) {
            collectMacCandidatesFromBytes(new Uint8Array(value.buffer.slice(0)), candidates);
        }
    }
    if (event.serviceData) {
        for (const value of event.serviceData.values()) {
            collectMacCandidatesFromBytes(new Uint8Array(value.buffer.slice(0)), candidates);
        }
    }
    if (event.uuids?.length) {
        event.uuids.forEach((uuid) => {
            const stripped = String(uuid).replace(/[^a-fA-F0-9]/g, "");
            if (stripped.length >= 12) {
                const maybeMac = parseMacAddress(stripped.slice(-12));
                if (maybeMac) {
                    candidates.push({ score: scoreMacCandidate(maybeMac), bytes: maybeMac });
                }
            }
        });
    }
    return getBestMacCandidate(candidates);
}

async function discoverQiyiMacAddress(device) {
    if (!device?.watchAdvertisements) {
        return null;
    }

    setStatus("Listening for cube advertisements to detect its MAC address...");

    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            device.removeEventListener("advertisementreceived", handleAdvertisement);
            resolve(value);
        };

        const handleAdvertisement = (event) => {
            const candidate = extractQiyiMacFromAdvertisement(event);
            if (candidate) {
                finish(candidate);
            }
        };

        const timeoutId = window.setTimeout(() => finish(null), 3500);
        device.addEventListener("advertisementreceived", handleAdvertisement, { once: false });
        device.watchAdvertisements()
            .catch(() => finish(null));
    });
}

function buildQiyiAppHello(macBytes) {
    const payload = [
        0xfe, 0x15,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00,
        ...macBytes.slice().reverse()
    ];
    return withChecksum(payload);
}

function buildQiyiAck(message) {
    return withChecksum([
        0xfe, 0x09,
        message[2], message[3], message[4], message[5], message[6]
    ]);
}

function buildQiyiRequestState() {
    return withChecksum([0xfe, 0x09, 0x05, 0x05, 0x05, 0x05, 0x05]);
}

function parseQiyiFacelets(bytes27) {
    const facelets = [];
    for (const byte of bytes27) {
        facelets.push(byte & 0x0f, (byte >> 4) & 0x0f);
    }
    return facelets.slice(0, 54);
}

async function qiyiWrite(characteristic, message) {
    await characteristic.writeValue(encryptQiyiMessage(message));
}

function startQiyiPolling(connection) {
    window.clearInterval(qiyiPollInterval);
    qiyiPollInterval = window.setInterval(() => {
        if (activeConnection !== connection || connection.type !== "qiyi") return;
        qiyiWrite(connection.characteristic, buildQiyiRequestState()).catch(() => {
            // Ignore polling errors; the next poll or reconnect can recover.
        });
    }, QIYI_POLL_INTERVAL_MS);
}

function qiyiConnectionName(device) {
    return device?.name || "QiYi/X-Man smart cube";
}

function updateQiyiState(facelets, battery, solvedOverride = false, source = "state") {
    if (!activeConnection || activeConnection.type !== "qiyi") return;
    window.clearTimeout(qiyiHandshakeTimeout);
    qiyiHandshakeTimeout = null;
    if (!activeConnection.receivedPacket) {
        setStatus("QiYi/X-Man cube connected and synced.");
    }
    const previousFacelets = Array.isArray(activeConnection.facelets) ? activeConnection.facelets.slice() : null;
    activeConnection.receivedPacket = true;
    activeConnection.facelets = facelets.slice();
    activeConnection.battery = battery;
    currentFacelets = facelets.slice();
    showQiyiNet(facelets);
    updateBattery();
    const solved = solvedOverride || isSolvedFacelets(facelets);
    setValue(cubeStateField, solved ? "Solved" : getTimerApi()?.getState?.().running ? "Solving" : "Scrambled");
    if (source !== "move" && previousFacelets && !faceletsEqual(previousFacelets, facelets)) {
        registerStateChangeFromPolling(facelets);
    }
    if (solved) {
        scheduleSolvedCheck();
    }
}

async function handleQiyiNotification(event) {
    const connection = activeConnection;
    if (!connection || connection.type !== "qiyi") return;
    const encrypted = new Uint8Array(event.target.value.buffer.slice(0));
    const decrypted = decryptQiyiMessage(encrypted);
    if (decrypted[0] !== 0xfe) return;
    const message = decrypted.slice(0, decrypted[1]);
    const opcode = message[2];

    if (opcode === 0x02) {
        const facelets = parseQiyiFacelets(message.slice(7, 34));
        updateQiyiState(facelets, message[35], false, "hello");
        await qiyiWrite(connection.characteristic, buildQiyiAck(message));
        await qiyiWrite(connection.characteristic, buildQiyiRequestState());
        return;
    }

    if (opcode === 0x03) {
        const facelets = parseQiyiFacelets(message.slice(7, 34));
        const moveToken = QIYI_MOVE_MAP[message[34]] || "";
        const needsAck = message[91] === 1;
        updateQiyiState(facelets, message[35], needsAck, "move");
        if (moveToken) {
            registerMove(moveToken);
        }
        if (needsAck) {
            await qiyiWrite(connection.characteristic, buildQiyiAck(message));
        }
        return;
    }

    if (opcode === 0x05 || opcode === 0x04) {
        const facelets = parseQiyiFacelets(message.slice(7, 34));
        updateQiyiState(facelets, message[35], false, "poll");
    }
}

async function connectGanCube() {
    const puzzle = await connectSmartPuzzle();
    puzzle.experimentalAddBasicRotationTransformer?.();
    puzzle.addAlgLeafListener?.(handleGanMove);
    activeConnection = {
        type: "gan",
        name: puzzle.name?.() || "Connected smart cube",
        puzzle
    };
    showTwistyPlayer();
    setValue(deviceNameField, activeConnection.name);
    setValue(autoTimerField, "Waiting for first turn");
    setStatus("Cube connected. Follow the scramble on your smart cube, then the first solve turn will start the timer.");
    await updateCubeStateLabel();
    await updateBattery();
    window.clearInterval(batteryPollInterval);
    batteryPollInterval = window.setInterval(updateBattery, 60000);
}

async function connectQiyiCube() {
    setStatus("Select your X-Man / QiYi smart cube.");
    const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [QIYI_SERVICE_UUID]
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(QIYI_SERVICE_UUID);
    const characteristic = await service.getCharacteristic(QIYI_CHAR_UUID);
    const macBytes = await getQiyiMacAddress(device);

    const connection = {
        type: "qiyi",
        name: qiyiConnectionName(device),
        device,
        server,
        characteristic,
        facelets: SOLVED_FACELETS.slice(),
        battery: null,
        macStorageKey: getMacStorageKey(device?.name),
        receivedPacket: false
    };
    activeConnection = connection;

    characteristic.addEventListener("characteristicvaluechanged", handleQiyiNotification);
    await characteristic.startNotifications();
    await qiyiWrite(characteristic, buildQiyiAppHello(macBytes));
    await qiyiWrite(characteristic, buildQiyiRequestState());
    startQiyiPolling(connection);
    qiyiHandshakeTimeout = window.setTimeout(() => {
        if (activeConnection !== connection || connection.receivedPacket) return;
        clearStoredMacAddress(device?.name);
        disconnectCube("The cube did not respond after pairing. The saved MAC was cleared. Try connect again and re-enter it if needed.");
    }, QIYI_HANDSHAKE_TIMEOUT_MS);

    setValue(deviceNameField, activeConnection.name);
    setValue(autoTimerField, "Waiting for first turn");
    setStatus("QiYi/X-Man cube paired. Waiting for the first cube packet...");
    showQiyiNet(activeConnection.facelets);
}

function shouldTryQiyiFallback(error) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("0000aadb") || message.includes("no services matching uuid");
}

async function connectCube() {
    if (connectionBusy || activeConnection) return;
    const timerApi = getTimerApi();
    if (!timerApi?.getState?.().bluetoothSupported) {
        setStatus("Switch the session event to 3x3 to use a Bluetooth cube.");
        return;
    }
    if (!navigator.bluetooth) {
        setStatus("Web Bluetooth is not available in this browser. Use Chrome or Edge on HTTPS or localhost.");
        setButtons();
        return;
    }

    connectionBusy = true;
    setButtons();
    setStatus("Opening Bluetooth device picker...");

    try {
        await connectQiyiCube();
        syncScrambleFromTimer(window.currentScramble || "", timerApi.getState?.().activeEvent);
    } catch (error) {
        const message = String(error?.message || "");
        if (message.toLowerCase().includes("user cancelled")) {
            activeConnection = null;
            setStatus("Bluetooth pairing was cancelled.");
            setValue(deviceNameField, "Not connected");
            setValue(batteryField, "--");
            setValue(autoTimerField, "Waiting for first turn");
            setValue(cubeStateField, "Unknown");
        } else if (shouldTryQiyiFallback(error) || message.toLowerCase().includes("no devices found")) {
            try {
                setStatus("QiYi/X-Man scan failed. Trying the generic smart-cube connector as fallback.");
                await connectGanCube();
                syncScrambleFromTimer(window.currentScramble || "", timerApi.getState?.().activeEvent);
            } catch (fallbackError) {
                activeConnection = null;
                const message = fallbackError?.message ? String(fallbackError.message) : "QiYi/X-Man connection failed.";
                setStatus(`Unable to connect: ${message}`);
                setValue(deviceNameField, "Not connected");
                setValue(batteryField, "--");
                setValue(autoTimerField, "Waiting for first turn");
                setValue(cubeStateField, "Unknown");
            }
        } else {
            activeConnection = null;
            const message = error?.message ? String(error.message) : "Connection failed.";
            setStatus(`Unable to connect: ${message}`);
            setValue(deviceNameField, "Not connected");
            setValue(batteryField, "--");
            setValue(autoTimerField, "Waiting for first turn");
            setValue(cubeStateField, "Unknown");
        }
    } finally {
        connectionBusy = false;
        setButtons();
    }
}

async function disconnectCube(statusMessage = "Bluetooth cube disconnected.") {
    window.clearTimeout(solvedCheckTimeout);
    window.clearTimeout(qiyiHandshakeTimeout);
    qiyiHandshakeTimeout = null;
    window.clearInterval(qiyiPollInterval);
    qiyiPollInterval = null;
    window.clearInterval(batteryPollInterval);
    batteryPollInterval = null;

    try {
        if (activeConnection?.type === "qiyi") {
            activeConnection.characteristic?.removeEventListener("characteristicvaluechanged", handleQiyiNotification);
            activeConnection.device?.gatt?.disconnect?.();
        } else {
            await activeConnection?.puzzle?.disconnect?.();
        }
    } catch {
        // Ignore disconnect errors and still reset local state.
    }

    activeConnection = null;
    setValue(deviceNameField, "Not connected");
    setValue(batteryField, "--");
    setValue(autoTimerField, "Waiting for first turn");
    setValue(cubeStateField, "Unknown");
    setStatus(statusMessage);
    resetTracking();
    setButtons();
}

function forgetStoredMac() {
    const name = activeConnection?.type === "qiyi" ? activeConnection.name : deviceNameField?.textContent;
    clearStoredMacAddress(name);
    setStatus("Saved QiYi/X-Man MAC address cleared.");
}

window.addEventListener("cubetimer:scramble-change", (event) => {
    syncScrambleFromTimer(event.detail?.scramble || "", event.detail?.eventType);
});

window.addEventListener("cubetimer:event-change", (event) => {
    const eventId = event.detail?.eventId || "333";
    syncScrambleFromTimer(window.currentScramble || "", eventId);
    if (eventId !== "333") {
        setStatus("Bluetooth cube mode is only enabled for 3x3 sessions.");
    } else if (activeConnection) {
        setStatus("Cube connected. Follow the scramble on your smart cube, then the first solve turn will start the timer.");
    }
});

connectBtn?.addEventListener("click", connectCube);
disconnectBtn?.addEventListener("click", disconnectCube);
forgetMacBtn?.addEventListener("click", forgetStoredMac);

syncScrambleFromTimer(window.currentScramble || "", getTimerApi()?.getState?.().activeEvent);
if (!navigator.bluetooth) {
    setStatus("Web Bluetooth is not available in this browser. Use Chrome or Edge on HTTPS or localhost.");
}
setButtons();

window.addEventListener("error", (event) => {
    if (!String(event.filename || "").includes("bluetoothCube")) return;
    setStatus(`Bluetooth cube script error: ${event.message}`);
});
