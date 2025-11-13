import { randomScrambleForEvent } from "https://cdn.cubing.net/v0/js/cubing/scramble";

const scrambleBox = document.getElementById("Scrambles");

async function generateScramble() {
    const scramble = await randomScrambleForEvent("333");
    scrambleBox.textContent = scramble;
}

generateScramble();
window.generateScramble = generateScramble;