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

const light1 = document.getElementById('light1');
const light2 = document.getElementById('light2');
const timerDisplay = document.getElementById('timer');
const readyLightsContainer = document.getElementById('ready-lights');
const scrambleDisplay = document.getElementById('Scrambles');

let inspectionState = 'idle';
let inspectionStartTime = null;
let inspectionAnimationFrame = null;
const inspectionColorClasses = ['inspection-orange', 'inspection-red'];
const tableBody = document.getElementById('table-body');
const editModal = document.getElementById('time-modal');
const modalCurrentTime = document.getElementById('modal-current-time');
const modalNormalBtn = document.getElementById('modal-normalize');
const modalPlusTwoBtn = document.getElementById('modal-plus2');
const modalDnfBtn = document.getElementById('modal-dnf');
const modalDeleteBtn = document.getElementById('modal-delete');
const modalCloseBtns = document.querySelectorAll('[data-close-modal]');
const modalDateField = document.getElementById('modal-date');
const modalScrambleField = document.getElementById('modal-scramble');
const sessionSelect = document.getElementById('session-select');
const sessionNewBtn = document.getElementById('session-new');
const sessionRenameBtn = document.getElementById('session-rename');
const sessionResetBtn = document.getElementById('session-reset');
const sessionDeleteBtn = document.getElementById('session-delete');

let editIndex = null;

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

function calculateAverage(list, count) {
    if (list.length < count) return "-";
    const recent = list.slice(-count);
    const values = recent.map(getEffectiveTime);
    if (values.some(v => v === null)) return "-";
    const arr = values.slice().sort((a,b)=>a-b);
    const trimmed = arr.slice(1, arr.length-1);
    return formatTime(trimmed.reduce((a,b)=>a+b,0) / trimmed.length);
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
}

function generateSessionId() {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
        [id]: { id, name: 'Session 1', times: [] }
    };
    activeSessionId = id;
}

function syncActiveSessionTimes() {
    if (!sessions[activeSessionId]) {
        createDefaultSession();
    }
    times = sessions[activeSessionId].times || [];
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
    syncActiveSessionTimes();
    renderTimes();
    refreshSessionSelect();
    persistSessions();
}

function createNewSession() {
    const defaultName = `Session ${Object.keys(sessions).length + 1}`;
    const input = prompt('Name for the new session?', defaultName);
    const name = input && input.trim() ? input.trim() : defaultName;
    const id = generateSessionId();
    sessions[id] = { id, name, times: [] };
    setActiveSession(id);
}

function renameActiveSession() {
    const session = sessions[activeSessionId];
    if (!session) return;
    const input = prompt('Rename session:', session.name);
    if (!input || !input.trim()) return;
    session.name = input.trim();
    refreshSessionSelect();
    persistSessions();
}

function resetActiveSession() {
    const session = sessions[activeSessionId];
    if (!session) return;
    if (!confirm('Reset this session? All times will be removed.')) return;
    session.times = [];
    syncActiveSessionTimes();
    renderTimes();
    persistSessions();
}

function deleteActiveSession() {
    if (!confirm('Delete this session permanently?')) return;
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
}

function renderTimes() {
    if (!tableBody) return;
    tableBody.innerHTML = '';
    times.forEach((entry, index) => {
        const row = document.createElement('tr');
        row.dataset.index = index;
        const timeLabel = getDisplayLabel(entry);
        const timeClass = entry.penalty === 'dnf' || entry.raw === null ? 'time-dnf' : entry.penalty === 'plus2' ? 'time-plus2' : '';
        const upto = times.slice(0, index + 1);
        const ao5 = calculateAverage(upto, 5);
        const ao12 = calculateAverage(upto, 12);
        row.innerHTML = `
            <td>${index + 1}</td>
            <td class="time-cell ${timeClass}">${timeLabel}</td>
            <td>${ao5}</td>
            <td>${ao12}</td>
        `;
        tableBody.appendChild(row);
    });
}

function registerDNF() {
    resetLights();
    readyLightsContainer.classList.add('lights-hidden');
    ready = false;
    running = false;
    holdActive = false;
    clearTimeout(holdTimeout);
    clearInspectionDisplay(false);
    timerDisplay.textContent = "DNF";
    saveTime(null);
    resetInspectionCycle();
    generateScramble("333");
}

function saveTime(ms, penalty = null) {
    const timestamp = new Date().toISOString();
    const scramble = (window.currentScramble || scrambleDisplay?.textContent || '').trim();
    const entry = {
        raw: ms,
        penalty: ms === null ? 'dnf' : penalty,
        timestamp,
        scramble
    };
    times.push(entry);
    renderTimes();
    persistSessions();
}

function startTimer() {
    resetLights();
    startTime = performance.now();
    running = true;
    holdActive = false;
    updateTimer();
}

function stopTimer() {
    resetLights();
    readyLightsContainer.classList.remove('lights-hidden');
    ready = false;
    running = false;
    holdActive = false;
    clearTimeout(holdTimeout);
    saveTime(lastDisplayTime);
    resetInspectionCycle();
    generateScramble("333");
}

document.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    if (e.repeat) return;
    e.preventDefault();
    if (running) {
        stopTimer();
        return;
    }

    if (inspectionState === 'idle') {
        startInspectionTimer();
        return;
    }

    finishInspection();
    beginHoldSequence();
});

document.addEventListener('keyup', e => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    clearTimeout(holdTimeout);
    resetLights();
    if (ready && !running) {
        startTimer();
    } else if (!running && holdActive) {
        registerDNF();
    }
    ready = false;
    holdActive = false;
});

document.addEventListener("touchstart", (e) =>{
    if(window.innerWidth > 900) return;
    if(e.touches.length > 1) return;
    if(e.target.closest('#theme-toggle')) return;
    if(e.target.closest('#times-table')) return;
    e.preventDefault();
    if (running) {
        stopTimer();
        return;
    }

    if (inspectionState === 'idle') {
        startInspectionTimer();
        return;
    }

    finishInspection();
    beginHoldSequence();
});

document.addEventListener("touchend", (e) => {
    if (window.innerWidth > 900) return;

    clearTimeout(holdTimeout);
    resetLights();

    if (ready && !running) {
        startTimer();
    } else if (!running && holdActive) {
        registerDNF();
    }

    ready = false;
    holdActive = false;
});

const toggle = document.getElementById('theme-toggle');
const html = document.documentElement;
const moonIcon = document.querySelector('.moon');
const sunIcon = document.querySelector('.sun');

toggle.addEventListener('click', () => {
    const isDark = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    moonIcon.classList.toggle('active', isDark);
    sunIcon.classList.toggle('active', !isDark);
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
    holdTimeout = setTimeout(() => {
        ready = true;
        turnLightsGreen();
    }, 500);
}

function openEditModal(index) {
    if (!editModal || !modalCurrentTime) return;
    editIndex = index;
    const entry = times[index];
    if (!entry) return;
    modalCurrentTime.textContent = `Solve #${index + 1}: ${getDisplayLabel(entry)}`;
    if (modalDateField) {
        const dateLabel = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Unknown date';
        modalDateField.textContent = `Date: ${dateLabel}`;
    }
    if (modalScrambleField) {
        modalScrambleField.textContent = entry.scramble || 'Scramble unavailable';
    }
    editModal.classList.add('visible');
}

function closeEditModal() {
    if (!editModal) return;
    editModal.classList.remove('visible');
    editIndex = null;
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

document.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (running || inspectionState === 'running') return;
    if (editModal && editModal.classList.contains('visible')) return;
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

modalCloseBtns.forEach(btn => {
    btn.addEventListener('click', closeEditModal);
});

if (editModal) {
    editModal.addEventListener('click', e => {
        if (e.target === editModal) {
            closeEditModal();
        }
    });
}

loadSessionsFromStorage();
syncActiveSessionTimes();
refreshSessionSelect();
renderTimes();
persistSessions();
