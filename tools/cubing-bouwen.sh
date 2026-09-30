#!/usr/bin/env bash
# =============================================================================
# cubing.js zelf hosten: bouwt public_html/Script/vendor/cubing/ opnieuw.
#
#   bash tools/cubing-bouwen.sh            # de versie hieronder
#   bash tools/cubing-bouwen.sh 0.64.0     # een andere versie
#
# Waarom: de scrambles kwamen van cdn.cubing.net. Dat is een verzoek naar een
# derde partij bij elke bezoeker (met zijn IP-adres), en als die CDN plat ligt
# of iets verandert, heeft de timer geen scrambles. Nu staat alles op onze
# eigen server.
#
# Het npm-pakket `cubing` is niet direct bruikbaar in de browser: het verwijst
# naar andere pakketten met kale namen ("cubing/alg", "random-uint-below").
# esbuild bundelt daarom alleen wat randomScrambleForEvent nodig heeft, met
# code splitting, zodat de zoekcode per puzzel pas geladen wordt als hij nodig
# is. De worker (search-worker-entry.js) is een eigen ingang: cubing.js zoekt
# hem op met new URL("./search-worker-entry.js", import.meta.url), dus hij moet
# in dezelfde map staan als de stukken die hem aanroepen.
#
# Licentie: cubing.js is MPL-2.0 OR GPL-3.0-or-later. Wij gebruiken het onder
# MPL-2.0: ongewijzigd meeleveren met de licentie erbij mag, en de rest van de
# site hoeft daardoor niet onder die licentie. Pas de bestanden in
# vendor/cubing dus nooit met de hand aan; bouw ze opnieuw.
#
# Nodig: node en npm, en internet naar registry.npmjs.org.
# =============================================================================
set -euo pipefail

VERSIE="${1:-0.63.8}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOEL="$ROOT/public_html/Script/vendor/cubing"
WERK="$(mktemp -d)"
trap 'rm -rf "$WERK"' EXIT

cd "$WERK"
npm init -y >/dev/null
npm install --no-audit --no-fund --loglevel=error "cubing@$VERSIE" esbuild@0.25 >/dev/null

cat > scramble.js <<'JS'
export { randomScrambleForEvent } from "cubing/scramble";
JS

rm -rf "$DOEL"
mkdir -p "$DOEL"

npx esbuild scramble.js node_modules/cubing/dist/lib/cubing/chunks/search-worker-entry.js \
    --bundle --format=esm --splitting --minify \
    --target=es2020 \
    --outdir="$DOEL" \
    --entry-names='[name]' --chunk-names='stuk-[hash]' \
    --log-level=warning

# De worker moet onder precies deze naam naast de stukken staan.
test -f "$DOEL/search-worker-entry.js"
grep -q 'search-worker-entry.js' "$DOEL"/*.js

# Licentie en herkomst erbij. Het npm-pakket bevat zelf geen licentiebestand;
# de officiële tekst van de MPL-2.0 staat daarom in tools/licenties/.
cp "$ROOT/tools/licenties/MPL-2.0.txt" "$DOEL/LICENSE-MPL-2.0.txt"
# De stukken hebben een hash in hun naam en veranderen dus nooit: die mogen
# een jaar in de cache. scramble.js en de worker hebben een vaste naam en
# vallen onder de gewone regel (steeds even navragen).
cat > "$DOEL/.htaccess" <<'HTA'
<IfModule mod_headers.c>
    <FilesMatch "^stuk-[A-Z0-9]+\.js$">
        Header set Cache-Control "public, max-age=31536000, immutable"
    </FilesMatch>
</IfModule>
HTA
cat > "$DOEL/HERKOMST.txt" <<TXT
cubing.js $VERSIE (https://github.com/cubing/cubing.js)
Licentie: MPL-2.0 OR GPL-3.0-or-later; hier gebruikt onder MPL-2.0.
De broncode staat op https://github.com/cubing/cubing.js en in het npm-pakket
"cubing" versie $VERSIE.

Gebundeld met esbuild door tools/cubing-bouwen.sh (alleen het scramble-deel).
Niet met de hand aanpassen: bouw opnieuw met dat script.
TXT

echo "cubing.js $VERSIE staat in ${DOEL#$ROOT/}:"
du -sh "$DOEL" | cut -f1
ls "$DOEL" | wc -l | xargs echo "bestanden:"
