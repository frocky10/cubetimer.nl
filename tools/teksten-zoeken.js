/**
 * Zoekt Nederlandse tekst in de scripts die (nog) niet door UI.t() gaat.
 *
 *   node tools/teksten-zoeken.js            per bestand de verdachte regels
 *   node tools/teksten-zoeken.js --sleutels alle UI.t('...')-sleutels als JSON
 *
 * Een hulpmiddel, geen wet: hij kijkt naar strings met Nederlandse woorden
 * erin. Wat er echt niet vertaald hoeft te worden (een console.log, een
 * selector) markeer je met het commentaar  // niet vertalen  op die regel.
 * tools/vertalen.php --controleer gebruikt --sleutels om te zien of elke
 * sleutel een vertaling heeft.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MAP = path.join(__dirname, '..', 'public_html', 'Script');
const BESTANDEN = fs.readdirSync(MAP)
    .filter(naam => naam.endsWith('.js') && !naam.startsWith('taal-'))
    .map(naam => path.join(MAP, naam));

// Woorden die in Engelse tekst of code vrijwel nooit voorkomen.
const NEDERLANDS = /\b(de|het|een|je|jij|jouw|niet|geen|van|voor|met|naar|ook|nog|maar|dan|als|wat|wie|waar|kun|kan|moet|wordt|zijn|staat|staan|deze|dit|dat|hier|daar|meer|alle|alles|nieuwe?|opslaan|verwijderen|laden|bezig|gelukt|mislukt|fout|klaar|probeer|opnieuw|sessie|tijden?|solves? van|dagen?|seconden?|minuten?|uur|vandaag|gisteren|week|ronde|toernooi|ranglijst|inloggen|uitloggen|wachtwoord|gebruikersnaam|verbinden|verbonden|verbinding|stoppen|starten|kies|keuze|gemiddelde|beste|snelste|laatste|eerste|volgende|vorige|goed|gehaald|behaald|poging|pogingen|over|onder|sneller|langzamer|zet|zetten|draai|opgelost|scramblen|oefenen|leren|geleerd|volgen|vrienden?|uitdagen|duels? met|alleen|allebei|hoeken?|randen?|liggen|zitten|bij|om|te|tot|uit|aan|er|zo|al|wel|heb|hebt|heeft|gaat|komt|kunt|wil|wilt|zou|mag|zal|onze|ons|iets|niets|iemand|niemand|keer|weer|eerst|daarna|nu|bent|ben|waren|worden|gedaan|kijk|klik|druk|houd|gebruik|lukt|lukte|verloren|gewonnen|gelijk|punt|haak|lijn|kruis|uitgelogd|ingelogd|bewaard|gewist|teruggezet|aangemaakt|verstuurd|gekopieerd|synchroniseren|gesynchroniseerd|bevestig|bevestigd|verlopen|afgelopen|begonnen|bezig|wacht|wachten|jij|zelf|samen|tegen|elke?|enkel|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|seconde|limiet|doel|doeltijd|record|records|beurt|speler|spelers|deelnemers?|veld|plek|plaats)\b/i;

function isCode(tekst) {
    return /^[#.\[]?[a-z0-9_-]+([.#\[][^ ]*)?$/i.test(tekst)       // selector, id, klasse
        || /^(\/|https?:|api\/|Script\/|data:|mailto:)/.test(tekst)  // pad of url
        || /^[a-z]+:[a-z-]+$/.test(tekst)                            // cubetimer:event
        || /^\[cubetimer\]|^\[smartcube\]/.test(tekst);               // logregel
}

function strings(regel) {
    const uit = [];
    const patroon = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
    let m;
    while ((m = patroon.exec(regel)) !== null) {
        uit.push({ tekst: m[1] ?? m[2] ?? m[3], begin: m.index });
    }
    return uit;
}

if (process.argv.includes('--sleutels')) {
    const sleutels = new Set();
    // UI.t('...'), t('...'), UI.t("...") en ook over meerdere regels gesplitst met +.
    const patroon = /\b(?:UI\.)?t\(\s*((?:'(?:[^'\\]|\\.)*'\s*\+?\s*)+|"(?:[^"\\]|\\.)*")/g;
    for (const bestand of BESTANDEN) {
        const code = fs.readFileSync(bestand, 'utf8');
        let m;
        while ((m = patroon.exec(code)) !== null) {
            const delen = m[1].match(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g) || [];
            const tekst = delen.map(deel => deel.slice(1, -1).replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n')).join('');
            if (tekst) sleutels.add(tekst);
        }
    }
    process.stdout.write(JSON.stringify([...sleutels], null, 2) + '\n');
    process.exit(0);
}

let totaal = 0;
for (const bestand of BESTANDEN) {
    const regels = fs.readFileSync(bestand, 'utf8').split('\n');
    const gevonden = [];
    regels.forEach((regel, i) => {
        const kaal = regel.trim();
        if (kaal.startsWith('//') || kaal.startsWith('*') || kaal.startsWith('/*')) return;
        if (/niet vertalen/.test(regel) || /console\.(log|warn|error|info|debug)\(/.test(regel)) return;
        for (const { tekst, begin } of strings(regel)) {
            if (!tekst || isCode(tekst) || !/[a-z]{2}/i.test(tekst)) continue;
            if (!NEDERLANDS.test(tekst.replace(/\$\{[^}]*\}/g, ' '))) continue;
            // Al vertaald: t( of UI.t( vlak voor de string.
            const ervoor = regel.slice(0, begin);
            if (/\bt\(\s*$/.test(ervoor) || /\bt\(\s*(['"][^'"]*['"]\s*\+\s*)+$/.test(ervoor)) continue;
            gevonden.push(`${String(i + 1).padStart(5)}  ${kaal.slice(0, 150)}`);
            break;
        }
    });
    if (gevonden.length) {
        console.log(`\n${path.basename(bestand)} (${gevonden.length})`);
        gevonden.forEach(regel => console.log(regel));
        totaal += gevonden.length;
    }
}
console.log(`\n${totaal} regels met Nederlandse tekst buiten UI.t()`);
