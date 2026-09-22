const UI = window.CubeTimerUI;

let startTime = null;
let running = false;
let times = [];
let lastDisplayTime = 0;
let holdTimeout = null;
let ready = false;
let holdActive = false;
const STORAGE_KEY = 'cubetimer_sessions_v1';
let sessions = {};
let activeSessionId = null;
const EVENT_OPTIONS = [
    { id: '333', label: '3x3x3' },
    { id: '222', label: '2x2x2' },
    { id: '444', label: '4x4x4' },
    { id: '555', label: '5x5x5' },
    { id: '666', label: '6x6x6' },
    { id: '777', label: '7x7x7' },
    { id: '333bf', label: '3x3x3 Blindfolded' },
    { id: '333fm', label: '3x3x3 Fewest Moves' },
    { id: '333oh', label: '3x3x3 One-Handed' },
    { id: 'clock', label: 'Clock' },
    { id: 'minx', label: 'Megaminx' },
    { id: 'pyram', label: 'Pyraminx' },
    { id: 'skewb', label: 'Skewb' },
    { id: 'sq1', label: 'Square-1' },
    { id: '444bf', label: '4x4x4 Blindfolded' },
    { id: '555bf', label: '5x5x5 Blindfolded' },
    { id: '333mbf', label: '3x3x3 Multi-Blind' },
    { id: 'fto', label: 'Face-Turning Octahedron' },
    { id: 'master_tetraminx', label: 'Master Tetraminx' }
];
const DEFAULT_EVENT = EVENT_OPTIONS[0].id;

/* ---------------------------------------------------------------------------
 * Instellingen
 * Staan in localStorage en worden door settings.js aan de UI gekoppeld.
 * ------------------------------------------------------------------------ */
const SETTINGS_KEY = 'cubetimer_settings_v1';
const THEME_KEY = 'cubetimer_theme';

const DEFAULT_SETTINGS = {
    theme: 'system',            // system | dark | light
    focusMode: true,            // alles dimmen tijdens het timen
    confetti: true,             // confetti bij een nieuw sessierecord
    inspection: true,           // WCA-inspectie van 15 seconden
    holdTime: 500,              // ms spatiebalk vasthouden voor groen licht
    confirmDestructive: true    // navragen bij leegmaken en verwijderen
};

let settings = { ...DEFAULT_SETTINGS };

function loadSettings() {
    const stored = UI.storage.get(SETTINGS_KEY, null);
    if (stored && typeof stored === 'object') {
        settings = { ...DEFAULT_SETTINGS, ...stored };
    }
    // Losse waardes alsnog valideren, want localStorage is te bewerken.
    if (!['system', 'dark', 'light'].includes(settings.theme)) settings.theme = 'system';
    settings.holdTime = [0, 300, 500, 800].includes(Number(settings.holdTime))
        ? Number(settings.holdTime)
        : DEFAULT_SETTINGS.holdTime;
    ['focusMode', 'confetti', 'inspection', 'confirmDestructive'].forEach(key => {
        settings[key] = settings[key] !== false;
    });
}

function getSetting(key) {
    return settings[key];
}

function updateSetting(key, value) {
    if (!(key in DEFAULT_SETTINGS)) return;
    settings[key] = value;
    UI.storage.set(SETTINGS_KEY, settings);
    if (key === 'theme') applyTheme();
    if (key === 'focusMode' && value === false) {
        document.body.classList.remove('is-timing');
    }
}

/** Zet het thema op basis van de instelling (of het systeem). */
function applyTheme() {
    const preference = settings.theme;
    const resolved = preference === 'system'
        ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
        : preference;

    document.documentElement.setAttribute('data-theme', resolved);
    // Apart opgeslagen, zodat het inline script in de <head> het thema al kan
    // zetten voordat de pagina getekend wordt.
    try {
        window.localStorage.setItem(THEME_KEY, resolved);
    } catch (err) {
        /* privemodus: dan flitst het thema bij het laden, meer niet */
    }

    const isLight = resolved === 'light';
    document.querySelector('.moon')?.classList.toggle('active', !isLight);
    document.querySelector('.sun')?.classList.toggle('active', isLight);
    renderGraph();
}

const light1 = document.getElementById('light1');
const light2 = document.getElementById('light2');
const timerDisplay = document.getElementById('timer');
const readyLightsContainer = document.getElementById('ready-lights');
const scrambleDisplay = document.getElementById('Scrambles');

let inspectionState = 'idle';
let inspectionStartTime = null;
let inspectionAnimationFrame = null;
const inspectionColorClasses = ['inspection-orange', 'inspection-red'];
const INSPECTION_LIMIT_MS = 15000;
let pendingInspectionPlusTwo = false;
const tableBody = document.getElementById('table-body');
const timesEmpty = document.getElementById('times-empty');
const timesCount = document.getElementById('times-count');
const editModal = document.getElementById('time-modal');
const modalCurrentTime = document.getElementById('modal-current-time');
const modalNormalBtn = document.getElementById('modal-normalize');
const modalPlusTwoBtn = document.getElementById('modal-plus2');
const modalDnfBtn = document.getElementById('modal-dnf');
const modalDeleteBtn = document.getElementById('modal-delete');
const modalCloseBtns = document.querySelectorAll('[data-close-modal]');
const modalDateField = document.getElementById('modal-date');
const modalScrambleField = document.getElementById('modal-scramble');
const settingsModal = document.getElementById('settings-modal');
const settingsOpenBtn = document.getElementById('settings-open');
const settingsCloseBtns = document.querySelectorAll('[data-close-settings]');
const settingsTabBtns = document.querySelectorAll('[data-settings-tab]');
const settingsPanels = document.querySelectorAll('[data-settings-panel]');
const sessionSelect = document.getElementById('session-select');
const sessionNewBtn = document.getElementById('session-new');
const sessionRenameBtn = document.getElementById('session-rename');
const sessionResetBtn = document.getElementById('session-reset');
const sessionDeleteBtn = document.getElementById('session-delete');
const cubeSelect = document.getElementById('cube-select');
const cubeDisplay = document.getElementById('cube-display');
const sessionGraphCanvas = document.getElementById('session-graph-canvas');
const sessionGraphCtx = sessionGraphCanvas ? sessionGraphCanvas.getContext('2d') : null;
const sessionPrDisplay = document.getElementById('session-pr');
const confettiCanvas = document.getElementById('confetti-canvas');
const confettiCtx = confettiCanvas ? confettiCanvas.getContext('2d') : null;
const confettiColors = ['#4bd3ff', '#ff6ec7', '#ffd54f', '#7bff8a', '#ff4b4b'];

let editIndex = null;
let lastBestTime = null;
let confettiPieces = [];
let confettiAnimationFrame = null;
let confettiEndTime = 0;

function isBluetoothCubeEventSupported(eventId = getActiveSessionEvent()) {
    return eventId === '333';
}

function formatTime(ms) {
    const total = Math.floor(ms);
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    const milliseconds = total % 1000;
    return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}:${String(milliseconds).padStart(3,'0')}`;
}

function updateTimer() {
    if (!running) return;
    lastDisplayTime = performance.now() - startTime;
    timerDisplay.textContent = formatTime(lastDisplayTime);
    requestAnimationFrame(updateTimer);
}

function getEffectiveTime(entry) {
    if (!entry) return null;
    if (entry.penalty === 'dnf' || entry.raw === null) return null;
    let total = entry.raw;
    if (entry.penalty === 'plus2') total += 2000;
    return total;
}

function getDisplayLabel(entry) {
    if (!entry) return '';
    if (entry.penalty === 'dnf' || entry.raw === null) return 'DNF';
    const time = getEffectiveTime(entry);
    if (time === null) return 'DNF';
    const formatted = formatTime(time);
    return entry.penalty === 'plus2' ? `${formatted}+` : formatted;
}

/**
 * WCA-gemiddelde over een reeks solves: beste en slechtste vallen weg.
 * Een DNF telt als de slechtste tijd, dus een enkele DNF mag; vanaf twee
 * DNF's is het gemiddelde zelf een DNF.
 *
 * @returns {number|'DNF'|null} milliseconden, 'DNF', of null bij te weinig solves
 */
function averageOf(entries) {
    if (!entries || entries.length < 3) return null;
    const values = entries.map(getEffectiveTime);
    if (values.filter(value => value === null).length > 1) return 'DNF';

    // null (DNF) sorteert achteraan en wordt daardoor weggetrimd als slechtste.
    const sorted = values.slice().sort((a, b) => {
        if (a === null) return 1;
        if (b === null) return -1;
        return a - b;
    });
    const trimmed = sorted.slice(1, sorted.length - 1);
    if (!trimmed.length || trimmed.some(value => value === null)) return 'DNF';
    return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
}

/** Het lopende gemiddelde over de laatste `count` solves, als tekst. */
function calculateAverage(list, count) {
    if (list.length < count) return '--';
    const result = averageOf(list.slice(-count));
    if (result === null) return '--';
    return result === 'DNF' ? 'DNF' : formatTime(Math.round(result));
}

function applyInspectionDisplay(seconds) {
    const clamped = Math.min(seconds, 15);
    timerDisplay.classList.add('inspection-mode');
    timerDisplay.classList.remove(...inspectionColorClasses);
    if (clamped >= 12) {
        timerDisplay.classList.add('inspection-red');
    } else if (clamped >= 8) {
        timerDisplay.classList.add('inspection-orange');
    }
    timerDisplay.textContent = String(clamped).padStart(2, '0');
}

function clearInspectionDisplay(resetText = true) {
    timerDisplay.classList.remove('inspection-mode', ...inspectionColorClasses);
    if (resetText) {
        timerDisplay.textContent = "00:00:000";
    }
}

function startInspectionTimer() {
    inspectionState = 'running';
    inspectionStartTime = performance.now();
    pendingInspectionPlusTwo = false;
    readyLightsContainer.classList.add('lights-hidden');
    updateInspectionTimer();
}

function updateInspectionTimer() {
    if (inspectionState !== 'running') return;
    const elapsedSeconds = Math.floor((performance.now() - inspectionStartTime) / 1000) + 1;
    applyInspectionDisplay(Math.min(elapsedSeconds, 15));
    if (elapsedSeconds >= 15) {
        finishInspection(true);
        return;
    }
    inspectionAnimationFrame = requestAnimationFrame(updateInspectionTimer);
}

function finishInspection(keepDisplay = false) {
    if (inspectionAnimationFrame) {
        cancelAnimationFrame(inspectionAnimationFrame);
        inspectionAnimationFrame = null;
    }
    if (inspectionState === 'idle') return;
    inspectionState = 'finished';
    if (!keepDisplay) {
        clearInspectionDisplay();
    }
}

function resetInspectionCycle() {
    if (inspectionAnimationFrame) {
        cancelAnimationFrame(inspectionAnimationFrame);
        inspectionAnimationFrame = null;
    }
    inspectionState = 'idle';
    inspectionStartTime = null;
    pendingInspectionPlusTwo = false;
}

function resizeConfettiCanvas() {
    if (!confettiCanvas || !confettiCtx) return;
    const ratio = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    confettiCanvas.width = width * ratio;
    confettiCanvas.height = height * ratio;
    confettiCanvas.style.width = `${width}px`;
    confettiCanvas.style.height = `${height}px`;
    confettiCtx.setTransform(1, 0, 0, 1, 0, 0);
    confettiCtx.scale(ratio, ratio);
}

function triggerConfetti() {
    if (!confettiCtx || !confettiCanvas) return;
    if (!getSetting('confetti')) return;
    stopConfetti();
    resizeConfettiCanvas();
    confettiCanvas.classList.add('active');
    const centerX = window.innerWidth / 2;
    const spread = Math.min(240, window.innerWidth / 2);
    confettiPieces = Array.from({ length: 160 }, () => ({
        x: centerX + (Math.random() - 0.5) * spread,
        y: window.innerHeight + Math.random() * 40,
        size: 8 + Math.random() * 6,
        color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
        velocityX: (Math.random() - 0.5) * 6,
        velocityY: -(8 + Math.random() * 6),
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 10
    }));
    confettiEndTime = performance.now() + 4200;
    if (!confettiAnimationFrame) {
        confettiAnimationFrame = requestAnimationFrame(animateConfetti);
    }
}

function animateConfetti() {
    if (!confettiCtx || !confettiCanvas) return;
    const now = performance.now();
    const width = window.innerWidth;
    const height = window.innerHeight;
    confettiCtx.clearRect(0, 0, width, height);
    confettiPieces.forEach(piece => {
        confettiCtx.save();
        confettiCtx.translate(piece.x, piece.y);
        confettiCtx.rotate((piece.rotation * Math.PI) / 180);
        confettiCtx.fillStyle = piece.color;
        confettiCtx.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size);
        confettiCtx.restore();
        piece.x += piece.velocityX;
        piece.y += piece.velocityY;
        piece.rotation += piece.rotationSpeed;
        piece.velocityY += 0.12;
    });
    confettiPieces = confettiPieces.filter(piece => piece.y < height + 200);
    if (now < confettiEndTime && confettiPieces.length) {
        confettiAnimationFrame = requestAnimationFrame(animateConfetti);
    } else {
        stopConfetti();
    }
}

function stopConfetti() {
    if (confettiAnimationFrame) {
        cancelAnimationFrame(confettiAnimationFrame);
        confettiAnimationFrame = null;
    }
    if (confettiCtx) {
        confettiCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
    confettiPieces = [];
    confettiCanvas?.classList.remove('active');
}

function generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getEventLabel(eventId) {
    const match = EVENT_OPTIONS.find(option => option.id === eventId);
    return match ? match.label : eventId;
}

function ensureSessionEvent(session) {
    if (!session) return;
    const isValid = EVENT_OPTIONS.some(option => option.id === session.event);
    if (!isValid) {
        session.event = DEFAULT_EVENT;
    }
}

function getActiveSessionEvent() {
    const session = sessions[activeSessionId];
    if (!session) return DEFAULT_EVENT;
    ensureSessionEvent(session);
    return session.event;
}

function updateCubeDisplay() {
    if (!cubeDisplay) return;
    cubeDisplay.textContent = getEventLabel(getActiveSessionEvent());
}

function refreshCubeControls() {
    if (cubeSelect) {
        cubeSelect.value = getActiveSessionEvent();
    }
    updateCubeDisplay();
}

function populateCubeSelect() {
    if (!cubeSelect) return;
    cubeSelect.innerHTML = '';
    EVENT_OPTIONS.forEach(option => {
        const opt = document.createElement('option');
        opt.value = option.id;
        opt.textContent = option.label;
        cubeSelect.appendChild(opt);
    });
}

/**
 * Zolang dit gevuld is, blijft die scramble staan in plaats van dat er een
 * nieuwe wordt gegenereerd. Gebruikt door de scramble van de dag: iedereen
 * moet dezelfde krijgen.
 */
let scrambleOverride = null;

function setScrambleOverride(scramble) {
    scrambleOverride = scramble || null;
    generateScrambleForActiveEvent();
}

function generateScrambleForActiveEvent() {
    if (scrambleOverride) {
        if (scrambleDisplay) {
            scrambleDisplay.classList.remove('is-loading');
            scrambleDisplay.textContent = scrambleOverride;
        }
        window.currentScramble = scrambleOverride;
        return;
    }

    const event = getActiveSessionEvent();
    if (typeof window.generateScramble === 'function') {
        window.generateScramble(event);
    } else {
        window.pendingScrambleEvent = event;
    }
}

function persistSessions() {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions, activeSessionId }));
    } catch (err) {
        console.warn('Unable to save sessions', err);
    }
}

function loadSessionsFromStorage() {
    if (typeof localStorage === 'undefined') {
        createDefaultSession();
        return;
    }
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const data = JSON.parse(raw);
            if (data?.sessions && Object.keys(data.sessions).length) {
                sessions = data.sessions;
                Object.values(sessions).forEach(session => {
                    ensureSessionEvent(session);
                    ensureSolveIds(session);
                });
                const fallbackId = Object.keys(sessions)[0];
                activeSessionId = data.activeSessionId && sessions[data.activeSessionId] ? data.activeSessionId : fallbackId;
                return;
            }
        }
    } catch (err) {
        console.warn('Unable to load sessions', err);
    }
    createDefaultSession();
}

function createDefaultSession() {
    const id = generateSessionId();
    sessions = {
        [id]: { id, name: 'Session 1', times: [], event: DEFAULT_EVENT }
    };
    activeSessionId = id;
}

/**
 * Zorgt dat elke solve een uniek id heeft. Oudere sessies uit localStorage
 * hebben dat nog niet; zonder id kan de server niet ontdubbelen bij het
 * synchroniseren.
 */
function ensureSolveIds(session) {
    if (!session || !Array.isArray(session.times)) return false;
    let changed = false;
    session.times.forEach(entry => {
        if (entry && !entry.id) {
            entry.id = UI.uniqueId('solve');
            changed = true;
        }
    });
    return changed;
}

function syncActiveSessionTimes() {
    if (!sessions[activeSessionId]) {
        createDefaultSession();
    }
    ensureSessionEvent(sessions[activeSessionId]);
    times = sessions[activeSessionId].times || [];
    lastBestTime = null;
}

function refreshSessionSelect() {
    if (!sessionSelect) return;
    sessionSelect.innerHTML = '';
    Object.values(sessions).forEach(session => {
        const option = document.createElement('option');
        option.value = session.id;
        option.textContent = session.name;
        if (session.id === activeSessionId) option.selected = true;
        sessionSelect.appendChild(option);
    });
}

function setActiveSession(id) {
    if (!sessions[id]) return;
    activeSessionId = id;
    ensureSessionEvent(sessions[activeSessionId]);
    syncActiveSessionTimes();
    renderTimes();
    refreshSessionSelect();
    persistSessions();
    refreshCubeControls();
    generateScrambleForActiveEvent();
}

async function createNewSession() {
    const defaultName = `Sessie ${Object.keys(sessions).length + 1}`;
    const input = await UI.ask({
        title: 'Nieuwe sessie',
        message: 'Onder welke naam wil je deze sessie opslaan?',
        confirmLabel: 'Aanmaken',
        input: { label: 'Naam', value: defaultName }
    });
    if (input === null) return;
    const name = input.trim() ? input.trim() : defaultName;
    const id = generateSessionId();
    const inheritedEvent = getActiveSessionEvent();
    sessions[id] = { id, name, times: [], event: inheritedEvent };
    setActiveSession(id);
}

async function renameActiveSession() {
    const session = sessions[activeSessionId];
    if (!session) return;
    const input = await UI.ask({
        title: 'Sessie hernoemen',
        confirmLabel: 'Opslaan',
        input: { label: 'Naam', value: session.name }
    });
    if (input === null || !input.trim()) return;
    session.name = input.trim();
    refreshSessionSelect();
    updateCubeDisplay();
    persistSessions();
}

async function resetActiveSession() {
    const session = sessions[activeSessionId];
    if (!session) return;
    if (getSetting('confirmDestructive')) {
        const confirmed = await UI.ask({
            title: 'Sessie leegmaken?',
            message: `Alle ${session.times.length} tijden in "${session.name}" worden gewist. Dit kun je niet ongedaan maken.`,
            confirmLabel: 'Leegmaken',
            danger: true
        });
        if (!confirmed) return;
    }
    session.times = [];
    syncActiveSessionTimes();
    renderTimes();
    persistSessions();
    generateScrambleForActiveEvent();
}

async function deleteActiveSession() {
    const session = sessions[activeSessionId];
    if (getSetting('confirmDestructive')) {
        const confirmed = await UI.ask({
            title: 'Sessie verwijderen?',
            message: `"${session?.name ?? 'Deze sessie'}" en alle tijden erin verdwijnen definitief.`,
            confirmLabel: 'Verwijderen',
            danger: true
        });
        if (!confirmed) return;
    }
    delete sessions[activeSessionId];
    const remainingIds = Object.keys(sessions);
    if (!remainingIds.length) {
        createDefaultSession();
    } else {
        activeSessionId = remainingIds[0];
    }
    syncActiveSessionTimes();
    renderTimes();
    refreshSessionSelect();
    persistSessions();
    refreshCubeControls();
    generateScrambleForActiveEvent();
}

function renderTimes() {
    if (!tableBody) return;
    tableBody.innerHTML = '';

    // De snelste geldige tijd krijgt een PB-markering in de tabel.
    const validTimes = times.map(getEffectiveTime).filter(value => value !== null);
    const best = validTimes.length ? Math.min(...validTimes) : null;
    let bestMarked = false;

    times.forEach((entry, index) => {
        const row = document.createElement('tr');
        row.dataset.index = index;

        const effective = getEffectiveTime(entry);
        const timeClass = entry.penalty === 'dnf' || entry.raw === null
            ? 'time-dnf'
            : entry.penalty === 'plus2' ? 'time-plus2' : '';

        if (!bestMarked && best !== null && effective === best) {
            row.classList.add('is-best');
            bestMarked = true;
        }

        const upto = times.slice(0, index + 1);
        row.innerHTML = `
            <td class="col-index">${index + 1}</td>
            <td class="time-cell ${timeClass}">${getDisplayLabel(entry)}</td>
            <td class="avg-cell">${calculateAverage(upto, 5)}</td>
            <td class="avg-cell">${calculateAverage(upto, 12)}</td>
        `;
        tableBody.appendChild(row);
    });

    if (timesEmpty) timesEmpty.hidden = times.length > 0;
    if (timesCount) timesCount.textContent = String(times.length);

    renderGraph();
    renderSessionPr();
    notifyDataChange();
}

/** Laat de rest van de app (statistieken, synchronisatie) weten dat er data wijzigde. */
function notifyDataChange() {
    window.dispatchEvent(new CustomEvent('cubetimer:data-change', {
        detail: {
            activeSessionId,
            event: getActiveSessionEvent(),
            solveCount: times.length
        }
    }));
}

function registerDNF() {
    resetLights();
    document.body.classList.remove('is-timing');
    readyLightsContainer.classList.add('lights-hidden');
    ready = false;
    running = false;
    holdActive = false;
    clearTimeout(holdTimeout);
    clearInspectionDisplay(false);
    timerDisplay.textContent = "DNF";
    pendingInspectionPlusTwo = false;
    saveTime(null);
    resetInspectionCycle();
    generateScrambleForActiveEvent();
}

function saveTime(ms, penalty = null, metadata = {}) {
    const timestamp = new Date().toISOString();
    const scramble = (window.currentScramble || scrambleDisplay?.textContent || '').trim();
    const entry = {
        id: UI.uniqueId('solve'),
        raw: ms,
        penalty: ms === null ? 'dnf' : penalty,
        timestamp,
        scramble,
        source: metadata.source || 'manual'
    };
    times.push(entry);
    renderTimes();
    persistSessions();

    window.dispatchEvent(new CustomEvent('cubetimer:solve', {
        detail: {
            solve: { ...entry },
            event: getActiveSessionEvent(),
            index: times.length - 1
        }
    }));
}

function startTimer() {
    resetLights();
    const now = performance.now();
    if (inspectionStartTime !== null) {
        pendingInspectionPlusTwo = (now - inspectionStartTime) >= INSPECTION_LIMIT_MS;
    } else {
        pendingInspectionPlusTwo = false;
    }
    startTime = now;
    running = true;
    holdActive = false;
    if (getSetting('focusMode')) {
        document.body.classList.add('is-timing');
    }
    updateTimer();
}

function stopTimer() {
    resetLights();
    document.body.classList.remove('is-timing');
    readyLightsContainer.classList.remove('lights-hidden');
    ready = false;
    running = false;
    holdActive = false;
    clearTimeout(holdTimeout);
    const penalty = pendingInspectionPlusTwo ? 'plus2' : null;
    saveTime(lastDisplayTime, penalty);
    pendingInspectionPlusTwo = false;
    resetInspectionCycle();
    generateScrambleForActiveEvent();
}

function startTimerFromBluetooth() {
    if (!isBluetoothCubeEventSupported()) return false;
    if (running) return false;
    if (editModal && editModal.classList.contains('visible')) return false;
    if (inspectionState === 'running' || inspectionState === 'finished') {
        finishInspection();
    }
    startTimer();
    return true;
}

function startInspectionFromBluetooth() {
    if (!isBluetoothCubeEventSupported()) return false;
    if (running) return false;
    if (editModal && editModal.classList.contains('visible')) return false;
    if (inspectionState !== 'idle') return false;
    startInspectionTimer();
    return true;
}

function stopTimerFromBluetooth() {
    if (!running) return false;
    stopTimer();
    return true;
}

/**
 * De spatiebalk mag de timer niet starten terwijl iemand in een formulier
 * typt of een modal openstaat. Zonder deze controle start de timer midden in
 * het invullen van bijvoorbeeld het meldformulier.
 */
function shouldIgnoreTimerInput(target) {
    if (UI.isAnyModalOpen()) return true;
    if (editModal?.classList.contains('visible')) return true;
    if (settingsModal?.classList.contains('visible')) return true;
    if (!target || typeof target.closest !== 'function') return false;
    return Boolean(target.closest('input, textarea, select, button, a, [role="button"], [contenteditable="true"]'));
}

/** Indrukken: afhankelijk van de stand stoppen, inspectie starten of vasthouden. */
function handlePressStart() {
    if (running) {
        stopTimer();
        return;
    }

    if (!getSetting('inspection')) {
        beginHoldSequence();
        return;
    }

    if (inspectionState === 'idle') {
        startInspectionTimer();
        return;
    }

    finishInspection();
    beginHoldSequence();
}

/** Loslaten: starten als het licht groen was. */
function handlePressEnd() {
    clearTimeout(holdTimeout);
    resetLights();

    if (ready && !running) {
        startTimer();
    } else if (!running && holdActive && inspectionState === 'finished') {
        // Na de inspectie loslaten zonder groen licht telt als een DNF.
        registerDNF();
    }

    ready = false;
    holdActive = false;
}

document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat) return;
    if (shouldIgnoreTimerInput(e.target)) return;
    e.preventDefault();
    handlePressStart();
});

document.addEventListener('keyup', e => {
    if (e.code !== 'Space') return;
    if (shouldIgnoreTimerInput(e.target)) return;
    e.preventDefault();
    handlePressEnd();
});

/**
 * Op aanraakschermen is alleen het timervlak (.stage) gevoelig. Zo blijft de
 * rest van de pagina gewoon scrollbaar; met de oude aanpak ving het hele
 * document elke tik af.
 */
function isTimerTouchTarget(target) {
    if (!target || typeof target.closest !== 'function') return false;
    if (target.closest('.time-modal, .topbar, .sidebar, .ScrambleBox')) return false;
    return Boolean(target.closest('.stage')) || running;
}

document.addEventListener('touchstart', e => {
    if (e.touches.length > 1) return;
    if (UI.isAnyModalOpen()) return;
    if (!isTimerTouchTarget(e.target)) return;
    e.preventDefault();
    handlePressStart();
}, { passive: false });

document.addEventListener('touchend', e => {
    if (UI.isAnyModalOpen()) return;
    if (!isTimerTouchTarget(e.target) && !holdActive && !ready) return;
    handlePressEnd();
});

const themeToggle = document.getElementById('theme-toggle');

/** De schakelaar in de topbar zet het thema altijd expliciet (niet op 'system'). */
function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    updateSetting('theme', isDark ? 'light' : 'dark');
    window.dispatchEvent(new CustomEvent('cubetimer:settings-change', {
        detail: { key: 'theme', value: settings.theme }
    }));
}

if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
    themeToggle.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        toggleTheme();
    });
}

// Volgt het systeemthema zolang de instelling op 'system' staat.
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (settings.theme === 'system') applyTheme();
});

function resetLights() {
    light1.classList.remove('active');
    light2.classList.remove('active');
    light1.classList.remove('green');
    light2.classList.remove('green');
}

function showReadyLights() {
    resetLights();
    setTimeout(() => light1.classList.add('active'), 100);
    setTimeout(() => light2.classList.add('active'), 300);
}

function turnLightsGreen() {
    light1.classList.remove('active');
    light2.classList.remove('active');
    light1.classList.add('green');
    light2.classList.add('green');
}

function beginHoldSequence() {
    readyLightsContainer.classList.remove('lights-hidden');
    showReadyLights();
    holdActive = true;
    const holdTime = getSetting('holdTime');
    holdTimeout = setTimeout(() => {
        ready = true;
        turnLightsGreen();
    }, holdTime);
}

function openEditModal(index) {
    if (!editModal || !modalCurrentTime) return;
    editIndex = index;
    const entry = times[index];
    if (!entry) return;
    modalCurrentTime.textContent = `#${index + 1} - ${getDisplayLabel(entry)}`;
    if (modalDateField) {
        modalDateField.textContent = entry.timestamp
            ? new Date(entry.timestamp).toLocaleString('nl-NL')
            : 'Datum onbekend';
    }
    if (modalScrambleField) {
        modalScrambleField.textContent = entry.scramble || 'Scramble niet bewaard';
    }
    UI.openModal(editModal);
}

function closeEditModal() {
    UI.closeModal(editModal);
    editIndex = null;
}

function openSettingsModal() {
    if (!settingsModal) return;
    activateSettingsTab('general');
    UI.openModal(settingsModal);
}

function closeSettingsModal() {
    UI.closeModal(settingsModal);
}

function activateSettingsTab(tabId) {
    settingsTabBtns.forEach(btn => {
        const isActive = btn.dataset.settingsTab === tabId;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    settingsPanels.forEach(panel => {
        panel.hidden = panel.dataset.settingsPanel !== tabId;
    });
}

function applyPenaltyToEntry(penalty) {
    if (editIndex === null) return;
    const entry = times[editIndex];
    if (!entry) return;
    if (penalty === 'plus2') {
        if (entry.raw === null) return;
        entry.penalty = entry.penalty === 'plus2' ? null : 'plus2';
    } else if (penalty === 'dnf') {
        entry.penalty = 'dnf';
    } else {
        if (entry.raw !== null) entry.penalty = null;
    }
    renderTimes();
    persistSessions();
    closeEditModal();
}

function deleteEntryAtIndex() {
    if (editIndex === null) return;
    times.splice(editIndex, 1);
    renderTimes();
    persistSessions();
    closeEditModal();
}

function getLastEntryIndex() {
    return times.length ? times.length - 1 : null;
}

function togglePlusTwoOnLastSolve() {
    const index = getLastEntryIndex();
    if (index === null) return;
    const entry = times[index];
    if (!entry || entry.raw === null) return;
    entry.penalty = entry.penalty === 'plus2' ? null : 'plus2';
    renderTimes();
    persistSessions();
}

function markLastSolveDNF() {
    const index = getLastEntryIndex();
    if (index === null) return;
    const entry = times[index];
    if (!entry) return;
    entry.penalty = 'dnf';
    renderTimes();
    persistSessions();
}

function deleteLastSolve() {
    const index = getLastEntryIndex();
    if (index === null) return;
    times.splice(index, 1);
    renderTimes();
    persistSessions();
}

/** Zet de canvasgrootte gelijk aan de CSS-grootte, zodat de lijn scherp blijft. */
function resizeGraphCanvas() {
    if (!sessionGraphCanvas || !sessionGraphCtx) return { width: 0, height: 0 };

    const ratio = window.devicePixelRatio || 1;
    const cssWidth = sessionGraphCanvas.clientWidth || 260;
    const cssHeight = Math.round(cssWidth * 0.54);

    sessionGraphCanvas.width = Math.round(cssWidth * ratio);
    sessionGraphCanvas.height = Math.round(cssHeight * ratio);
    sessionGraphCanvas.style.height = cssHeight + 'px';

    sessionGraphCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { width: cssWidth, height: cssHeight };
}

function renderGraph() {
    if (!sessionGraphCtx || !sessionGraphCanvas) return;
    const ctx = sessionGraphCtx;
    const { width, height } = resizeGraphCanvas();
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);
    const data = times
        .map(entry => getEffectiveTime(entry))
        .map((value, index) => ({ value, index }))
        .filter(point => point.value !== null);
    if (!data.length) {
        const emptyColor = document.documentElement.getAttribute('data-theme') === 'light'
            ? 'rgba(0,0,0,0.6)'
            : 'rgba(255,255,255,0.6)';
        ctx.fillStyle = emptyColor;
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No solves yet', width / 2, height / 2);
        return;
    }
    const minValue = Math.min(...data.map(d => d.value));
    const maxValue = Math.max(...data.map(d => d.value));
    const range = Math.max(maxValue - minValue, 1000);
    const padding = 10;
    const usableWidth = width - padding * 2;
    const usableHeight = height - padding * 2;
    const isLightTheme = document.documentElement.getAttribute('data-theme') === 'light';
    const gridColor = isLightTheme ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)';
    const textColor = isLightTheme ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.85)';

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    const labelValues = [maxValue, minValue + range / 2, minValue];
    ctx.font = '10px monospace';
    ctx.fillStyle = textColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    labelValues.forEach(val => {
        const clampedVal = Math.min(Math.max(val, minValue), maxValue);
        const normalized = (clampedVal - minValue) / range;
        const y = height - padding - usableHeight * normalized;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
        ctx.fillText(formatTime(Math.round(clampedVal)), padding + 4, y - 1);
    });
    ctx.setLineDash([]);

    ctx.lineWidth = 2;
    const gradient = ctx.createLinearGradient(0, padding, 0, height - padding);
    gradient.addColorStop(0, '#8ae4ff');
    gradient.addColorStop(1, '#0077ff');
    ctx.strokeStyle = gradient;

    // Lichte vulling onder de lijn, zodat de grafiek ook bij weinig punten leest.
    const fill = ctx.createLinearGradient(0, padding, 0, height - padding);
    fill.addColorStop(0, 'rgba(75, 211, 255, 0.28)');
    fill.addColorStop(1, 'rgba(75, 211, 255, 0)');
    ctx.fillStyle = fill;
    ctx.beginPath();
    data.forEach((point, idx) => {
        const x = padding + (usableWidth * idx) / Math.max(data.length - 1, 1);
        const normalized = (point.value - minValue) / range;
        const y = height - padding - usableHeight * normalized;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.lineTo(padding + usableWidth, height - padding);
    ctx.lineTo(padding, height - padding);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    data.forEach((point, idx) => {
        const x = padding + (usableWidth * idx) / Math.max(data.length - 1, 1);
        const normalized = (point.value - minValue) / range;
        const y = height - padding - usableHeight * normalized;
        if (idx === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    ctx.stroke();

    ctx.fillStyle = '#4bd3ff';
    if (data.length <= 40) data.forEach((point, idx) => {
        const x = padding + (usableWidth * idx) / Math.max(data.length - 1, 1);
        const normalized = (point.value - minValue) / range;
        const y = height - padding - usableHeight * normalized;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
    });
}

function renderSessionPr() {
    if (!sessionPrDisplay) return;
    const previousBest = lastBestTime;
    const validTimes = times.map(getEffectiveTime).filter(v => v !== null);
    if (!validTimes.length) {
        sessionPrDisplay.textContent = '--';
        lastBestTime = null;
        return;
    }
    const best = Math.min(...validTimes);
    sessionPrDisplay.textContent = formatTime(best);
    if (previousBest !== null && best < previousBest) {
        triggerConfetti();
    }
    lastBestTime = best;
}

if (tableBody) {
    tableBody.addEventListener('click', e => {
        const row = e.target.closest('tr');
        if (!row || row.dataset.index === undefined) return;
        openEditModal(Number(row.dataset.index));
    });
}

if (sessionSelect) {
    sessionSelect.addEventListener('change', e => setActiveSession(e.target.value));
}

if (sessionNewBtn) {
    sessionNewBtn.addEventListener('click', createNewSession);
}

if (sessionRenameBtn) {
    sessionRenameBtn.addEventListener('click', renameActiveSession);
}

if (sessionResetBtn) {
    sessionResetBtn.addEventListener('click', resetActiveSession);
}

if (sessionDeleteBtn) {
    sessionDeleteBtn.addEventListener('click', deleteActiveSession);
}

/**
 * Zet het event van de actieve sessie. Ook gebruikt door de challenges, die
 * je kunnen vragen om over te schakelen naar het event van de scramble van de
 * dag.
 */
function setActiveSessionEvent(eventId) {
    const session = sessions[activeSessionId];
    if (!session) return false;

    session.event = eventId;
    ensureSessionEvent(session);
    if (cubeSelect) cubeSelect.value = session.event;

    updateCubeDisplay();
    persistSessions();
    generateScrambleForActiveEvent();

    window.dispatchEvent(new CustomEvent('cubetimer:event-change', {
        detail: {
            eventId: session.event,
            bluetoothSupported: isBluetoothCubeEventSupported(session.event)
        }
    }));
    return true;
}

if (cubeSelect) {
    populateCubeSelect();
    cubeSelect.addEventListener('change', e => setActiveSessionEvent(e.target.value));
}

document.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (running || inspectionState === 'running') return;
    if (shouldIgnoreTimerInput(e.target)) return;
    if (!times.length) return;
    if (e.code === 'Backspace') {
        e.preventDefault();
        deleteLastSolve();
    } else if (e.key.toLowerCase() === 'd') {
        markLastSolveDNF();
    } else if (e.key === '2') {
        togglePlusTwoOnLastSolve();
    }
});

if (modalPlusTwoBtn) {
    modalPlusTwoBtn.addEventListener('click', () => applyPenaltyToEntry('plus2'));
}

if (modalDnfBtn) {
    modalDnfBtn.addEventListener('click', () => applyPenaltyToEntry('dnf'));
}

if (modalNormalBtn) {
    modalNormalBtn.addEventListener('click', () => applyPenaltyToEntry('normal'));
}

if (modalDeleteBtn) {
    modalDeleteBtn.addEventListener('click', deleteEntryAtIndex);
}

if (settingsOpenBtn) {
    settingsOpenBtn.addEventListener('click', openSettingsModal);
}

modalCloseBtns.forEach(btn => {
    btn.addEventListener('click', closeEditModal);
});

settingsCloseBtns.forEach(btn => {
    btn.addEventListener('click', closeSettingsModal);
});

settingsTabBtns.forEach(btn => {
    btn.addEventListener('click', () => activateSettingsTab(btn.dataset.settingsTab));
});

UI.registerModal(editModal, closeEditModal);
UI.registerModal(settingsModal, closeSettingsModal);

// Na een klik op een knop de focus loslaten, anders slikt die knop de
// volgende spatiebalk op in plaats van de timer te starten.
document.addEventListener('click', e => {
    const button = e.target instanceof Element ? e.target.closest('button') : null;
    if (button && !button.closest('.time-modal')) {
        button.blur();
    }
});

window.addEventListener('resize', resizeConfettiCanvas);
window.addEventListener('resize', renderGraph);
resizeConfettiCanvas();
activateSettingsTab('general');

loadSettings();
applyTheme();
loadSessionsFromStorage();
syncActiveSessionTimes();
refreshSessionSelect();
refreshCubeControls();
renderTimes();
persistSessions();
generateScrambleForActiveEvent();

/**
 * Alles wat de andere scripts (statistieken, account, instellingen, Bluetooth)
 * van de timerkern nodig hebben. Bewust een kleine, expliciete lijst.
 */
window.cubeTimerApi = {
    formatTime,
    averageOf,
    getEffectiveTime,
    getEventLabel,
    getEventOptions: () => EVENT_OPTIONS.map(option => ({ ...option })),
    getActiveSessionEvent,
    getActiveSessionId: () => activeSessionId,

    /** Alle sessies, als array. Een kopie: aanpassen doet hier niets. */
    getSessions: () => Object.values(sessions).map(session => ({
        id: session.id,
        name: session.name,
        event: session.event,
        times: (session.times || []).map(entry => ({ ...entry }))
    })),

    /** Vervangt alle lokale sessies, gebruikt na het synchroniseren met de server. */
    replaceSessions(incoming, preferredActiveId) {
        if (!Array.isArray(incoming) || !incoming.length) return false;

        const next = {};
        incoming.forEach(session => {
            if (!session || !session.id) return;
            next[session.id] = {
                id: session.id,
                name: session.name || 'Sessie',
                event: session.event || DEFAULT_EVENT,
                times: Array.isArray(session.times) ? session.times : []
            };
            ensureSessionEvent(next[session.id]);
            ensureSolveIds(next[session.id]);
        });
        if (!Object.keys(next).length) return false;

        sessions = next;
        activeSessionId = next[preferredActiveId] ? preferredActiveId : Object.keys(next)[0];

        syncActiveSessionTimes();
        refreshSessionSelect();
        refreshCubeControls();
        renderTimes();
        persistSessions();
        return true;
    },

    getSetting,
    updateSetting,
    getAllSettings: () => ({ ...settings }),

    /** Zet de scramble vast (scramble van de dag), of geef null om weer los te laten. */
    setScrambleOverride,

    /** Wisselt het event van de actieve sessie. */
    setActiveSessionEvent,

    /** Laat de laatste solve uit de actieve sessie weer verdwijnen. */
    removeLastSolve: deleteLastSolve,

    getState() {
        return {
            running,
            ready,
            holdActive,
            inspectionState,
            activeEvent: getActiveSessionEvent(),
            currentScramble: window.currentScramble || '',
            bluetoothSupported: isBluetoothCubeEventSupported()
        };
    },
    startInspectionFromBluetooth,
    startTimerFromBluetooth,
    stopTimerFromBluetooth,
    registerDNF,
    isBluetoothCubeEventSupported
};
