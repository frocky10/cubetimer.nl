@../docs/ontwikkelen.md

## Extra afspraken

- Overleg eerst als er een keuze te maken valt die het werk wezenlijk
  verandert; bouw daarna pas.
- Wat in het handboek als **besloten** staat (landcodes in plaats van vlaggen,
  de tijdweergave `mm:ss:mmm`, geen scramble van de dag voor Megaminx, Square-1
  en Clock, losse tijden alleen als aantal), stel je niet opnieuw voor.
- De repository is openbaar. Geen `Co-Authored-By`-regels, sessielinks of
  andere verwijzingen naar AI-hulpmiddelen in commits, pull requests, issues of
  code.
- Test de meldknop nooit met een echt token. In sommige ontwikkelomgevingen
  voegt een uitgaande proxy zelf geldige GitHub-inloggegevens toe aan verzoeken
  naar `api.github.com`; een testmelding wordt dan een echt, openbaar issue.
- `tools/vertalen.php` vraagt PHP 8.4. Staat die er niet, gebruik dan
  `PHP=8.4 npx -y -p @php-wasm/cli php-wasm-cli tools/vertalen.php`.
