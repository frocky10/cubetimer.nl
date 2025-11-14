let startTime = null;
let running = false;
let times = [];
let lastDisplayTime = 0;
let holdTimeout = null;
let ready = false;

const light1 = document.getElementById('light1');
const light2 = document.getElementById('light2');

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
    document.getElementById("timer").textContent = formatTime(lastDisplayTime);
    requestAnimationFrame(updateTimer);
}

function calculateAverage(list, count) {
    if (list.length < count) return "-";
    const arr = list.slice(-count).map(t => t.raw).sort((a,b)=>a-b);
    const trimmed = arr.slice(1, arr.length-1);
    return formatTime(trimmed.reduce((a,b)=>a+b,0) / trimmed.length);
}

function saveTime(ms) {
    times.push({ raw: ms, formatted: formatTime(ms) });
    const row = document.createElement('tr');
    row.innerHTML = `<td>${times.length}</td><td>${formatTime(ms)}</td><td>${calculateAverage(times,5)}</td><td>${calculateAverage(times,12)}</td>`;
    document.getElementById('table-body').appendChild(row);
}

function startTimer() {
    resetLights();
    startTime = performance.now();
    running = true;
    updateTimer();
}

function stopTimer() {
    resetLights()
    ready = false;
    running = false;
    clearTimeout(holdTimeout);
    saveTime(lastDisplayTime);
    generateScramble();
}

document.addEventListener('keydown', e => {
    if (e.code === 'Space') {
        if(e.repeat)return;
        e.preventDefault();
        if (running) {
            stopTimer();
            return;
    }

    showReadyLights();
        // WCA HOLD
    holdTimeout = setTimeout(() => {
            ready = true;
            turnLightsGreen();
        }, 500); // hold 0.5s
    }
});

document.addEventListener('keyup', e => {
    if (e.code === 'Space') {
        e.preventDefault();
        clearTimeout(holdTimeout);

        if (ready && !running) startTimer();

        ready = false;
    }
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
    
    showReadyLights();
    // WCA HOLD
    holdTimeout = setTimeout(() => {
        ready = true;
        turnLightsGreen();
    }, 500);
});

document.addEventListener("touchend", (e) => {
    if (window.innerWidth > 900) return;

    clearTimeout(holdTimeout);

    if (ready && !running) startTimer();

    ready = false;
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
