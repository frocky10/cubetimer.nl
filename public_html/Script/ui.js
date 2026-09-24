/**
 * CubeTimer - gedeelde UI-bouwstenen
 * ---------------------------------------------------------------------------
 * Wordt als eerste geladen, zodat de rest van de scripts erop kan rekenen:
 *
 *   CubeTimerUI.toast(...)     kort bericht rechtsonder
 *   CubeTimerUI.ask(...)       vervangt prompt() en confirm(), geeft een Promise
 *   CubeTimerUI.openModal()    modal openen/sluiten met Escape en klik-buiten
 *   CubeTimerUI.api(...)       fetch naar /api met nette foutafhandeling
 *   CubeTimerUI.formatTime()   milliseconden -> mm:ss:mmm
 */
(function () {
    'use strict';

    /* ---------------------------------------------------------------------
     * Modals
     * ------------------------------------------------------------------ */

    // Stapel van open modals, zodat Escape alleen de bovenste sluit.
    const openModals = [];

    function openModal(modal) {
        if (!modal || modal.classList.contains('visible')) return;
        modal.classList.add('visible');
        modal.setAttribute('aria-hidden', 'false');
        openModals.push(modal);

        // Focus naar het eerste bruikbare element, anders blijft de focus
        // achter op de knop onder de modal.
        const focusable = modal.querySelector(
            'input:not([type="hidden"]):not([tabindex="-1"]), textarea, select, button:not([data-close-modal])'
        );
        window.requestAnimationFrame(() => focusable?.focus?.());
    }

    function closeModal(modal) {
        if (!modal || !modal.classList.contains('visible')) return;
        // Stond de focus op een knop in de modal, dan blijft die daar ook als
        // de modal weg is; de timer ziet de spatiebalk dan als een klik op een
        // knop en negeert hem. Dus de focus eraf.
        if (modal.contains(document.activeElement)) document.activeElement.blur();
        modal.classList.remove('visible');
        modal.setAttribute('aria-hidden', 'true');
        const index = openModals.indexOf(modal);
        if (index !== -1) openModals.splice(index, 1);
    }

    function isAnyModalOpen() {
        return openModals.length > 0;
    }

    /** Sluit bij een klik op de achtergrond en bij Escape. */
    function registerModal(modal, onClose) {
        if (!modal) return;
        modal.addEventListener('click', event => {
            if (event.target === modal) {
                (onClose || closeModal)(modal);
            }
        });
        modal.dataset.closeRegistered = 'true';
        modal._onClose = onClose || closeModal;
    }

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || openModals.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const top = openModals[openModals.length - 1];
        (top._onClose || closeModal)(top);
    }, true);

    /* ---------------------------------------------------------------------
     * Toasts
     * ------------------------------------------------------------------ */

    const toastHost = document.getElementById('toast-host');

    /**
     * @param {string} message
     * @param {{type?: 'info'|'success'|'error'|'warning', duration?: number,
     *          link?: {href: string, label: string}}} [options]
     */
    function toast(message, options) {
        const settings = options || {};
        if (!toastHost) {
            console.info('[cubetimer]', message);
            return;
        }

        const element = document.createElement('div');
        element.className = 'toast toast--' + (settings.type || 'info');

        const body = document.createElement('div');
        body.className = 'toast__body';
        body.textContent = message;

        if (settings.link && settings.link.href) {
            const anchor = document.createElement('a');
            anchor.className = 'toast__link';
            anchor.href = settings.link.href;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            anchor.textContent = settings.link.label || 'Bekijken';
            body.appendChild(document.createElement('br'));
            body.appendChild(anchor);
        }

        element.appendChild(body);
        toastHost.appendChild(element);

        const duration = settings.duration || 4500;
        const remove = () => {
            element.classList.add('is-leaving');
            element.addEventListener('animationend', () => element.remove(), { once: true });
            // Vangnet voor het geval animaties uitstaan.
            window.setTimeout(() => element.remove(), 600);
        };
        window.setTimeout(remove, duration);
        element.addEventListener('click', remove);
    }

    /* ---------------------------------------------------------------------
     * ask() - vervanger voor prompt() en confirm()
     * ------------------------------------------------------------------ */

    const promptModal = document.getElementById('prompt-modal');
    const promptForm = document.getElementById('prompt-modal-form');
    const promptTitle = document.getElementById('prompt-modal-title');
    const promptMessage = document.getElementById('prompt-modal-message');
    const promptField = document.getElementById('prompt-modal-field');
    const promptLabel = document.getElementById('prompt-modal-label');
    const promptInput = document.getElementById('prompt-modal-input');
    const promptConfirm = document.getElementById('prompt-modal-confirm');
    const promptCancel = document.getElementById('prompt-modal-cancel');
    const promptExtra = document.getElementById('prompt-modal-extra');

    let resolveAsk = null;

    function settleAsk(value) {
        const resolve = resolveAsk;
        resolveAsk = null;
        closeModal(promptModal);
        if (resolve) resolve(value);
    }

    /**
     * Toont een vraag. Zonder `input` gedraagt het zich als confirm() en is het
     * antwoord true/false; met `input` als prompt() en is het antwoord de
     * ingevulde tekst of null bij annuleren.
     *
     * Met `extraLabel` komt er een derde knop bij, voor een vraag met twee
     * verschillende "ja"s. Die knop geeft de tekst 'extra' terug. Dat is precies
     * wat verwijderen nodig heeft: uit de sessie halen is iets anders dan van je
     * account wissen, en dat verschil hoort in de knop te zitten en niet in een
     * vinkje dat je over het hoofd ziet.
     *
     * @param {{title: string, message?: string, confirmLabel?: string,
     *          cancelLabel?: string, extraLabel?: string, danger?: boolean,
     *          extraDanger?: boolean,
     *          input?: {label?: string, value?: string, placeholder?: string}}} options
     * @returns {Promise<string|boolean|null>}
     */
    function ask(options) {
        const settings = options || {};

        // Zonder modal in de DOM terugvallen op de browserdialogen.
        if (!promptModal || !promptForm) {
            if (settings.input) {
                return Promise.resolve(window.prompt(settings.title, settings.input.value || ''));
            }
            return Promise.resolve(window.confirm(settings.title));
        }

        // Een openstaande vraag eerst netjes afronden.
        if (resolveAsk) settleAsk(settings.input ? null : false);

        promptTitle.textContent = settings.title || 'Weet je het zeker?';
        promptMessage.textContent = settings.message || '';
        promptMessage.hidden = !settings.message;
        promptConfirm.textContent = settings.confirmLabel || 'Oké';
        promptCancel.textContent = settings.cancelLabel || 'Annuleren';
        promptConfirm.classList.toggle('btn--danger', settings.danger === true);
        promptConfirm.classList.toggle('btn--primary', settings.danger !== true);

        if (promptExtra) {
            const heeftExtra = typeof settings.extraLabel === 'string' && settings.extraLabel !== '';
            promptExtra.hidden = !heeftExtra;
            if (heeftExtra) {
                promptExtra.textContent = settings.extraLabel;
                promptExtra.classList.toggle('btn--danger', settings.extraDanger !== false);
            }
        }

        if (settings.input) {
            promptField.hidden = false;
            promptLabel.textContent = settings.input.label || 'Naam';
            promptInput.value = settings.input.value || '';
            promptInput.placeholder = settings.input.placeholder || '';
        } else {
            promptField.hidden = true;
            promptInput.value = '';
        }

        openModal(promptModal);
        if (settings.input) {
            window.requestAnimationFrame(() => {
                promptInput.focus();
                promptInput.select();
            });
        }

        return new Promise(resolve => {
            resolveAsk = resolve;
        });
    }

    if (promptForm) {
        promptForm.addEventListener('submit', event => {
            event.preventDefault();
            if (!promptField.hidden) {
                const value = promptInput.value.trim();
                settleAsk(value === '' ? null : value);
            } else {
                settleAsk(true);
            }
        });
    }

    promptCancel?.addEventListener('click', () => {
        settleAsk(promptField && !promptField.hidden ? null : false);
    });

    promptExtra?.addEventListener('click', () => settleAsk('extra'));

    registerModal(promptModal, () => {
        settleAsk(promptField && !promptField.hidden ? null : false);
    });

    /* ---------------------------------------------------------------------
     * Menu in de topbar
     *
     * Op een breed scherm staan de knoppen gewoon naast elkaar en doet deze
     * code niets. Op een smal scherm staat dezelfde groep in een uitklapmenu;
     * alleen de plaatsing verschilt, de knoppen zijn dezelfde.
     * ------------------------------------------------------------------ */

    const menuButton = document.getElementById('topbar-menu');
    const menuGroup = document.getElementById('topbar-group');

    function closeTopbarMenu() {
        if (!menuGroup) return;
        menuGroup.classList.remove('is-open');
        menuButton?.setAttribute('aria-expanded', 'false');
    }

    if (menuButton && menuGroup) {
        menuButton.addEventListener('click', event => {
            event.stopPropagation();
            const open = menuGroup.classList.toggle('is-open');
            menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
        });

        // Een keuze uit het menu sluit het menu. Ook een link, want niet elke
        // knop in de balk is een <button>.
        menuGroup.addEventListener('click', event => {
            if (event.target.closest('button, a')) closeTopbarMenu();
        });

        document.addEventListener('click', event => {
            if (!menuGroup.contains(event.target) && event.target !== menuButton) {
                closeTopbarMenu();
            }
        });

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeTopbarMenu();
        });

        // Bij het draaien van een telefoon kan het menu ineens irrelevant zijn.
        window.addEventListener('resize', closeTopbarMenu);
    }

    /* ---------------------------------------------------------------------
     * API-helper
     * ------------------------------------------------------------------ */

    /**
     * Roept een endpoint onder /api aan. Gooit een Error met een `code` en een
     * `status` als de server een fout teruggeeft, zodat de aanroeper daar zelf
     * op kan reageren.
     *
     * @param {string} path bijv. 'auth/login.php'
     * @param {{method?: string, body?: object, signal?: AbortSignal}} [options]
     */
    async function api(path, options) {
        const settings = options || {};
        const method = settings.method || (settings.body ? 'POST' : 'GET');

        const headers = { 'X-Requested-With': 'XMLHttpRequest' };
        if (settings.body) headers['Content-Type'] = 'application/json';

        let response;
        try {
            response = await fetch('api/' + path, {
                method,
                headers,
                credentials: 'same-origin',
                signal: settings.signal,
                body: settings.body ? JSON.stringify(settings.body) : undefined
            });
        } catch (err) {
            if (err && err.name === 'AbortError') throw err;
            const networkError = new Error('Geen verbinding met de server.');
            networkError.code = 'network_error';
            networkError.status = 0;
            throw networkError;
        }

        let payload = null;
        try {
            payload = await response.json();
        } catch (err) {
            payload = null;
        }

        if (!response.ok || !payload || payload.ok !== true) {
            const error = new Error((payload && payload.message) || 'Er ging iets mis op de server.');
            error.code = (payload && payload.error) || 'server_error';
            error.status = response.status;
            error.payload = payload;
            throw error;
        }

        return payload;
    }

    /* ---------------------------------------------------------------------
     * Formattering
     * ------------------------------------------------------------------ */

    /** Milliseconden naar mm:ss:mmm, hetzelfde formaat als de timer. */
    function formatTime(ms) {
        if (ms === null || ms === undefined || Number.isNaN(ms)) return '--';
        const total = Math.floor(ms);
        const minutes = Math.floor(total / 60000);
        const seconds = Math.floor((total % 60000) / 1000);
        const milliseconds = total % 1000;
        return String(minutes).padStart(2, '0') + ':' +
               String(seconds).padStart(2, '0') + ':' +
               String(milliseconds).padStart(3, '0');
    }

    /** Uniek id voor een solve of sessie, ook zonder crypto.randomUUID. */
    function uniqueId(prefix) {
        const random = (window.crypto && typeof window.crypto.randomUUID === 'function')
            ? window.crypto.randomUUID().slice(0, 12)
            : Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
        return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + random;
    }

    /**
     * De landen voor de keuzelijst. De codes staan hier; de namen komen uit de
     * browser zelf (Intl.DisplayNames), zodat we geen vertaallijst hoeven bij
     * te houden. Kent een browser dat niet, dan valt hij terug op de code.
     */
    const COUNTRY_CODES = 'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW'.split(' ');

    let countryCache = null;

    function countries() {
        if (countryCache) return countryCache;

        let namen = null;
        try {
            namen = new Intl.DisplayNames(['nl'], { type: 'region' });
        } catch (err) {
            namen = null;
        }

        countryCache = COUNTRY_CODES
            .map(code => {
                let naam = code;
                try {
                    naam = namen ? (namen.of(code) || code) : code;
                } catch (err) {
                    naam = code;
                }
                return { code, name: naam };
            })
            .sort((a, b) => a.name.localeCompare(b.name, 'nl'));

        return countryCache;
    }

    /** De naam bij een landcode, of de code als we hem niet kennen. */
    function countryName(code) {
        if (!code) return '';
        const gevonden = countries().find(land => land.code === code);
        return gevonden ? gevonden.name : code;
    }

    /** Leest of schrijft JSON in localStorage zonder te klappen in privémodus. */
    const storage = {
        get(key, fallback) {
            try {
                const raw = window.localStorage.getItem(key);
                return raw === null ? fallback : JSON.parse(raw);
            } catch (err) {
                return fallback;
            }
        },
        set(key, value) {
            try {
                window.localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (err) {
                return false;
            }
        },
        remove(key) {
            try {
                window.localStorage.removeItem(key);
            } catch (err) {
                /* niets aan te doen */
            }
        }
    };

    /**
     * Vertelt welke serveronderdelen beschikbaar zijn. Het antwoord wordt
     * gedeeld, zodat niet elk script een eigen verzoek doet.
     */
    let statusPromise = null;

    /**
     * Haalt de status opnieuw op. Nodig na in- of uitloggen: of je beheerder
     * bent staat erin, en dat verandert met wie er ingelogd is.
     */
    function refreshStatus() {
        statusPromise = null;
        return status();
    }

    function status() {
        if (statusPromise === null) {
            statusPromise = api('status.php').catch(() => ({
                ok: false,
                features: { accounts: false, sync: false, feedback: false },
                authenticated: false
            }));
        }
        return statusPromise;
    }

    window.CubeTimerUI = {
        openModal,
        closeModal,
        registerModal,
        isAnyModalOpen,
        toast,
        ask,
        api,
        formatTime,
        uniqueId,
        status,
        refreshStatus,
        countries,
        countryName,
        storage
    };
})();
