import { randomScrambleForEvent } from "https://cdn.cubing.net/v0/js/cubing/scramble";

const scrambleBox = document.getElementById("Scrambles");

async function generateScramble(eventType) {
    const scramble = await randomScrambleForEvent(eventType);
    const scrambleText = typeof scramble === 'string' ? scramble : scramble?.toString?.() || '';
    scrambleBox.textContent = scrambleText;
    window.currentScramble = scrambleText;
}

generateScramble("333");
window.generateScramble = generateScramble;
