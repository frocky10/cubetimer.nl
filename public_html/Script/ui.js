/**
 * CubeTimer - gedeelde UI-bouwstenen
 * ---------------------------------------------------------------------------
 * Wordt als eerste geladen, zodat de rest van de scripts erop kan rekenen:
 *
 *   CubeTimerUI.toast(...)     kort bericht rechtsonder
 *   CubeTimerUI.ask(...)       vervangt prompt() en confirm(), geeft een Promise
 *   CubeTimerUI.openModal()    modal openen/sluiten met Escape en klik-buiten
 *   CubeTimerUI.api(...)       fetch naar /api met nette foutafhandeling
 *   CubeTimerUI.protectedApi() idem, voor formulieren met botbescherming
 *   CubeTimerUI.formatTime()   milliseconden -> mm:ss:mmm
 */
(function () {
    'use strict';

    /* ---------------------------------------------------------------------
     * Taal
     *
     * De Nederlandse tekst is de sleutel: UI.t('Opslaan') geeft op een
     * Engelse pagina "Save" en op een Nederlandse gewoon "Opslaan". De
     * vertalingen staan in taal/en/js.json; tools/vertalen.php maakt er
     * Script/taal-en.js van, dat alleen de Engelse pagina's laden (vóór dit
     * bestand). Plaatshouders: UI.t('Nog {n} solves', { n: 3 }).
     * ------------------------------------------------------------------ */

    const TAAL = document.documentElement.lang === 'en' ? 'en' : 'nl';
    const LOCALE = TAAL === 'en' ? 'en-GB' : 'nl-NL';
    const vertaling = window.CubeTimerVertaling || {};
    const ontbrekend = new Set();

    function t(tekst, waarden) {
        let uit = String(tekst);
        if (TAAL === 'en') {
            if (Object.prototype.hasOwnProperty.call(vertaling, uit)) {
                uit = vertaling[uit];
            } else if (!ontbrekend.has(uit)) {
                // Voor het testen: wat nog geen vertaling heeft, staat hier.
                ontbrekend.add(uit);
                console.warn('[cubetimer] geen vertaling:', uit);
            }
        }
        if (waarden) {
            uit = uit.replace(/\{(\w+)\}/g, (heel, naam) =>
                Object.prototype.hasOwnProperty.call(waarden, naam) ? String(waarden[naam]) : heel);
        }
        return uit;
    }

    /** Nederlandse pagina => Engelse pagina. Gelijk aan PAGINAS in tools/vertalen.php. */
    const PAGINAS = {
        '/': '/en/',
        '/index.html': '/en/',
        '/leren.html': '/en/learn.html',
        '/privacy.html': '/en/privacy.html',
        '/voorwaarden.html': '/en/terms.html',
        '/uitleg.html': '/en/faq.html'
    };

    /**
     * Het adres van een pagina in de huidige taal: UI.pad('leren.html') is
     * op een Engelse pagina /en/learn.html. Querystring en hekje gaan mee.
     */
    function pad(adres) {
        const m = /^\/?([^?#]*)(.*)$/.exec(String(adres));
        const basis = '/' + m[1];
        if (TAAL !== 'en') return basis + m[2];
        return (PAGINAS[basis] || basis) + m[2];
    }

    /** De link naar een openbaar profiel, in de huidige taal. */
    function profielUrl(naam) {
        return (TAAL === 'en' ? '/en/u/' : '/profiel.php?u=') + encodeURIComponent(naam);
    }

    function getal(n, opties) {
        return Number(n).toLocaleString(LOCALE, opties);
    }

    /** Een plek als rangtelwoord: 3e in het Nederlands, 3rd in het Engels. */
    function plek(n) {
        if (TAAL !== 'en') return n + 'e';
        const achter = ['th', 'st', 'nd', 'rd'];
        const rest = n % 100;
        return n + (achter[(rest - 20) % 10] || achter[rest] || achter[0]);
    }

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
            if (!settings.link.sameTab) {
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
            }
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

        promptTitle.textContent = settings.title || t('Weet je het zeker?');
        promptMessage.textContent = settings.message || '';
        promptMessage.hidden = !settings.message;
        promptConfirm.textContent = settings.confirmLabel || t('Oké');
        promptCancel.textContent = settings.cancelLabel || t('Annuleren');
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
            promptLabel.textContent = settings.input.label || t('Naam');
            promptInput.value = settings.input.value || '';
            promptInput.placeholder = settings.input.placeholder || '';
            // type: 'password' voor een wachtwoord (bijvoorbeeld bij account verwijderen).
            promptInput.type = settings.input.type || 'text';
            promptInput.autocomplete = settings.input.type === 'password' ? 'current-password' : 'off';
        } else {
            promptField.hidden = true;
            promptInput.value = '';
            promptInput.type = 'text';
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

        // X-Taal: de server antwoordt (meldingen, achievements, mails) in de
        // taal van de pagina.
        const headers = { 'X-Requested-With': 'XMLHttpRequest', 'X-Taal': TAAL };
        if (settings.body) headers['Content-Type'] = 'application/json';

        let response;
        try {
            // Absoluut: de Engelse pagina's staan in /en/.
            response = await fetch('/api/' + path, {
                method,
                headers,
                credentials: 'same-origin',
                signal: settings.signal,
                body: settings.body ? JSON.stringify(settings.body) : undefined
            });
        } catch (err) {
            if (err && err.name === 'AbortError') throw err;
            const networkError = new Error(t('Geen verbinding met de server.'));
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
            const error = new Error((payload && payload.message) || t('Er ging iets mis op de server.'));
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
    const COUNTRY_CODES = 'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW'.split(' ') // niet vertalen

    let countryCache = null;

    function countries() {
        if (countryCache) return countryCache;

        let namen = null;
        try {
            namen = new Intl.DisplayNames([TAAL], { type: 'region' });
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
            .sort((a, b) => a.name.localeCompare(b.name, TAAL));

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

    /**
     * Een formulier versturen dat tegen bots beschermd is (zie BotGuard.php):
     * het honeypotveld `website` uit het formulier gaat mee, plus het token
     * uit status.php dat bewijst hoe lang geleden de pagina laadde.
     *
     * Is het token verlopen (tabblad langer dan een dag open, of status.php
     * mislukte bij het laden), dan halen we een nieuw en proberen het na een
     * paar tellen nog één keer: de server wil een minimale tijd zien tussen
     * token en versturen.
     */
    async function protectedApi(path, body, form) {
        const honeypot = form ? form.querySelector('[name="website"]') : null;
        const verstuur = async () => {
            const info = await status();
            return api(path, {
                body: Object.assign({}, body, {
                    website: honeypot ? honeypot.value : '',
                    formToken: (info && info.formToken) || ''
                })
            });
        };
        try {
            return await verstuur();
        } catch (err) {
            if (err.code !== 'form_expired') throw err;
            await refreshStatus();
            await new Promise(klaar => setTimeout(klaar, 3200));
            return verstuur();
        }
    }

    window.CubeTimerUI = {
        openModal,
        closeModal,
        registerModal,
        isAnyModalOpen,
        toast,
        ask,
        api,
        protectedApi,
        t,
        lang: TAAL,
        locale: LOCALE,
        pad,
        profielUrl,
        getal,
        plek,
        ontbrekendeVertalingen: () => Array.from(ontbrekend),
        formatTime,
        uniqueId,
        status,
        refreshStatus,
        countries,
        countryName,
        storage
    };

    /* ---------------------------------------------------------------------
     * Taalknop en taalsuggestie
     * ------------------------------------------------------------------ */

    // De taalknop onthoudt de keuze (het inline script in de <head> doet dat
    // ook via #taal=..., voor als dit script nog niet geladen is) en neemt een
    // querystring mee, zoals ?oefen=OLL-27.
    document.addEventListener('click', event => {
        const knop = event.target.closest && event.target.closest('[data-taalwissel]');
        if (!knop) return;
        try { localStorage.setItem('cubetimer_taal', knop.getAttribute('data-taalwissel')); } catch (err) { /* privémodus */ }
        if (location.search) {
            event.preventDefault();
            const doel = new URL(knop.href, location.href);
            location.href = doel.pathname + location.search + doel.hash;
        }
    });

    // Een bezoeker wiens browser geen Nederlands spreekt, krijgt één keer de
    // Engelse versie aangeboden. Nooit automatisch omleiden: dan ziet Google
    // (die vanuit de VS kijkt) de Nederlandse pagina nooit.
    if (TAAL === 'nl') {
        window.addEventListener('load', () => {
            let gevraagd = true;
            try {
                gevraagd = localStorage.getItem('cubetimer_taal') !== null || localStorage.getItem('cubetimer_taal_gevraagd') !== null;
            } catch (err) { /* geen opslag: niet elke keer vragen */ }
            const talen = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'nl'];
            if (gevraagd || talen.some(taal => /^nl\b/i.test(taal))) return;
            const naarEngels = document.querySelector('[data-taalwissel="en"]');
            if (!naarEngels) return;
            try { localStorage.setItem('cubetimer_taal_gevraagd', '1'); } catch (err) { /* idem */ }
            toast('This site is also available in English.', { // niet vertalen: altijd Engels
                type: 'info',
                duration: 10000,
                link: { href: naarEngels.href, label: 'Switch to English', sameTab: true } // niet vertalen
            });
        });
    }
})();
