/**
 * CubeTimer - instellingen
 * ---------------------------------------------------------------------------
 * Koppelt de velden in de instellingen-modal aan window.cubeTimerApi. De
 * waardes zelf worden door script.js bewaard; dit bestand doet alleen de UI.
 */
(function () {
    'use strict';

    const api = window.cubeTimerApi;
    if (!api) return;

    /** @type {Array<{element: HTMLElement, key: string, type: 'switch'|'select'}>} */
    const controls = [
        { element: document.getElementById('setting-theme'), key: 'theme', type: 'select' },
        { element: document.getElementById('setting-focus-mode'), key: 'focusMode', type: 'switch' },
        { element: document.getElementById('setting-confetti'), key: 'confetti', type: 'switch' },
        { element: document.getElementById('setting-inspection'), key: 'inspection', type: 'switch' },
        { element: document.getElementById('setting-hold-time'), key: 'holdTime', type: 'select' },
        { element: document.getElementById('setting-confirm-destructive'), key: 'confirmDestructive', type: 'switch' }
    ].filter(control => control.element !== null);

    /** Zet de velden op de opgeslagen waardes. */
    function syncFromSettings() {
        controls.forEach(({ element, key, type }) => {
            const value = api.getSetting(key);
            if (type === 'switch') {
                element.checked = value !== false;
            } else {
                element.value = String(value);
            }
        });
    }

    controls.forEach(({ element, key, type }) => {
        element.addEventListener('change', () => {
            const value = type === 'switch'
                ? element.checked
                : (key === 'holdTime' ? Number(element.value) : element.value);

            api.updateSetting(key, value);
            window.dispatchEvent(new CustomEvent('cubetimer:settings-change', {
                detail: { key, value }
            }));
        });
    });

    window.addEventListener('cubetimer:settings-change', syncFromSettings);

    syncFromSettings();

    /*
     * Taal. Geen instelling in cubetimer_settings_v1 maar een eigen adres: de
     * keuze gaat naar cubetimer_taal (dat leest het inline script in de <head>
     * bij het volgende bezoek) en daarna naar de andere versie van deze pagina,
     * met de querystring erbij (?oefen=...). Het adres staat al in de
     * hreflang-link, dus hier hoeft geen lijst met pagina's.
     */
    const taalKeuze = document.getElementById('setting-taal');
    if (taalKeuze) {
        taalKeuze.value = document.documentElement.lang === 'en' ? 'en' : 'nl';
        taalKeuze.addEventListener('change', () => {
            const taal = taalKeuze.value;
            try { localStorage.setItem('cubetimer_taal', taal); } catch (err) { /* privémodus: dan alleen deze keer */ }
            const ander = document.querySelector(`link[rel="alternate"][hreflang="${taal}"]`);
            if (!ander || taal === document.documentElement.lang) return;
            const doel = new URL(ander.getAttribute('href'), location.href);
            location.href = doel.pathname + location.search;
        });
    }
})();
