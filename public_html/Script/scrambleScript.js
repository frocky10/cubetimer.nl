import { randomScrambleForEvent } from "https://cdn.cubing.net/v0/js/cubing/scramble";

const scrambleBox = document.getElementById("Scrambles");

async function generateScramble(eventType) {
    const scramble = await randomScrambleForEvent(eventType);
    scrambleBox.textContent = scramble;
    window.currentScramble = scramble;
}

generateScramble("333");
window.generateScramble = generateScramble;
