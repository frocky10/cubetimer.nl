let startTime = null;
let running = false;
let times = [];
let lastDisplayTime = 0;

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
    startTime = performance.now();
    running = true;
    updateTimer();
}

function stopTimer() {
    running = false;
    saveTime(lastDisplayTime);
}

document.addEventListener('keydown', e => {
    if (e.code === 'Space') {
    e.preventDefault();
    running ? stopTimer() : startTimer();
    }
});

const toggle = document.getElementById('theme-toggle');
const html = document.documentElement;
const moonIcon = document.querySelector('.moon');
const sunIcon = document.querySelector('.sun');

toggle.addEventListener('click', () => {
    const isDark = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    moonIcon.classList.toggle('active', !isDark);
    sunIcon.classList.toggle('active', isDark);
});