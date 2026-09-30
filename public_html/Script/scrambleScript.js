/**
 * CubeTimer - scrambles
 * ---------------------------------------------------------------------------
 * Haalt officiële WCA-scrambles op via cubing.js. Dat gebeurt in een worker,
 * dus de eerste scramble van een event kan even duren; zolang staat het vakje
 * op "laden".
 */
// cubing.js staat op onze eigen server (zie tools/cubing-bouwen.sh), niet op
// een CDN: geen verzoek naar een derde partij, en geen afhankelijkheid ervan.
import { randomScrambleForEvent } from "./vendor/cubing/scramble.js";

const scrambleBox = document.getElementById("Scrambles");

// Loopt er al een aanvraag, dan telt alleen het laatst gekozen event. Zonder
// dit kan een oude, trage scramble een nieuwere overschrijven.
let requestCounter = 0;

async function generateScramble(eventType) {
    if (!scrambleBox) return;

    const requestId = ++requestCounter;
    scrambleBox.classList.add("is-loading");
    scrambleBox.textContent = "";

    try {
        const scramble = await randomScrambleForEvent(eventType);
        if (requestId !== requestCounter) return; // er kwam alweer een nieuwer verzoek

        const scrambleText = typeof scramble === "string"
            ? scramble
            : scramble?.toString?.() || "";

        scrambleBox.classList.remove("is-loading");
        scrambleBox.textContent = scrambleText;
        window.currentScramble = scrambleText;

        window.dispatchEvent(new CustomEvent("cubetimer:scramble-change", {
            detail: { eventType, scramble: scrambleText }
        }));
    } catch (error) {
        if (requestId !== requestCounter) return;
        console.error("[cubetimer] scramble genereren mislukt", error);
        scrambleBox.classList.remove("is-loading");
        scrambleBox.textContent = "Scramble genereren is niet gelukt. Ververs de pagina om het opnieuw te proberen.";
        window.currentScramble = "";
    }
}

window.generateScramble = generateScramble;

/**
 * Meerdere scrambles tegelijk, zonder het scramblevak aan te raken. Voor de
 * speedrun (alle cubes vooraf scramblen) en voor een duel (dezelfde scrambles
 * voor allebei).
 */
async function generateScrambles(eventType, aantal) {
    const lijst = [];
    for (let i = 0; i < aantal; i++) {
        const scramble = await randomScrambleForEvent(eventType);
        lijst.push(typeof scramble === "string" ? scramble : scramble?.toString?.() || "");
    }
    return lijst;
}

window.generateScrambles = generateScrambles;
window.dispatchEvent(new Event("cubetimer:scrambler-ready"));

const initialEvent = window.pendingScrambleEvent || "333";
generateScramble(initialEvent);
window.pendingScrambleEvent = null;
