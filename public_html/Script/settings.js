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

    // De themaschakelaar in de topbar wijzigt dezelfde instelling; het
    // keuzemenu hier moet dan meebewegen.
    window.addEventListener('cubetimer:settings-change', syncFromSettings);

    syncFromSettings();
})();
