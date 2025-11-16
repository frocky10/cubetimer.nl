let startTime = null;
let running = false;
let times = [];
let lastDisplayTime = 0;
let holdTimeout = null;
let ready = false;
let holdActive = false;

const light1 = document.getElementById('light1');
const light2 = document.getElementById('light2');
const timerDisplay = document.getElementById('timer');
const readyLightsContainer = document.getElementById('ready-lights');

let inspectionState = 'idle';
let inspectionStartTime = null;
let inspectionAnimationFrame = null;
const inspectionColorClasses = ['inspection-orange', 'inspection-red'];

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

function calculateAverage(list, count) {
    if (list.length < count) return "-";
    const recent = list.slice(-count);
    if (recent.some(t => t.raw === null)) return "-";
    const arr = recent.map(t => t.raw).sort((a,b)=>a-b);
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

function saveTime(ms) {
    const entry = {
        raw: ms,
        formatted: ms === null ? 'DNF' : formatTime(ms)
    };
    times.push(entry);
    const row = document.createElement('tr');
    row.innerHTML = `<td>${times.length}</td><td>${entry.formatted}</td><td>${calculateAverage(times,5)}</td><td>${calculateAverage(times,12)}</td>`;
    document.getElementById('table-body').appendChild(row);
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
