import { randomScrambleForEvent } from "https://cdn.cubing.net/v0/js/cubing/scramble";

const scrambleBox = document.getElementById("Scrambles");

async function generateScramble(eventType) {
    const scramble = await randomScrambleForEvent(eventType);
    const scrambleText = typeof scramble === 'string' ? scramble : scramble?.toString?.() || '';
    scrambleBox.textContent = scrambleText;
    window.currentScramble = scrambleText;
    window.dispatchEvent(new CustomEvent('cubetimer:scramble-change', {
        detail: {
            eventType,
            scramble: scrambleText
        }
    }));
}

window.generateScramble = generateScramble;
const initialEvent = window.pendingScrambleEvent || "333";
generateScramble(initialEvent);
window.pendingScrambleEvent = null;
