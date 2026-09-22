/**
 * CubeTimer - accounts en synchronisatie
 * ---------------------------------------------------------------------------
 * Inloggen, registreren en het bewaren van je tijden op de server.
 *
 * Hoe de synchronisatie werkt:
 *   - Bij het inloggen worden de sessies van de server opgehaald en met de
 *     lokale sessies samengevoegd (zie mergeSessions). Dat is het enige moment
 *     waarop er echt samengevoegd wordt.
 *   - Daarna is de browser de bron van waarheid: bij elke wijziging wordt de
 *     volledige staat naar de server geduwd. Dat is bewust simpel en maakt
 *     merge-conflicten onmogelijk.
 *   - localStorage blijft altijd gevuld, ook als je ingelogd bent. Zonder
 *     internet blijft de timer dus gewoon werken.
 *
 * Staat de accountfunctie niet aan op de server, dan verdwijnt de knop uit de
 * topbar en verandert er niets aan de timer.
 */
(function () {
    'use strict';

    const UI = window.CubeTimerUI;
    const api = window.cubeTimerApi;

    const chip = document.getElementById('account-open');
    const chipName = document.getElementById('account-name');
    const chipAvatar = document.getElementById('account-avatar');
    const modal = document.getElementById('account-modal');

    if (!chip || !modal || !api) return;

    const modalTitle = document.getElementById('account-modal-title');
    const modalSubtitle = document.getElementById('account-modal-subtitle');
    const guestPanel = document.getElementById('account-guest');
    const userPanel = document.getElementById('account-user');
    const unavailablePanel = document.getElementById('account-unavailable');

    const authTabs = Array.from(document.querySelectorAll('[data-auth-tab]'));
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const loginError = document.getElementById('login-error');
    const registerError = document.getElementById('register-error');

    const summaryName = document.getElementById('account-summary-name');
    const summaryEmail = document.getElementById('account-summary-email');
    const summaryAvatar = document.getElementById('account-summary-avatar');
    const statSessions = document.getElementById('account-stat-sessions');
    const statSolves = document.getElementById('account-stat-solves');
    const syncStatus = document.getElementById('account-sync-status');

    const SYNC_DEBOUNCE_MS = 2500;

    let currentUser = null;
    let accountsAvailable = false;
    let syncTimer = null;
    let syncing = false;
    let pendingChanges = false;

    /* =====================================================================
     * Weergave
     * ================================================================== */

    function initials(name) {
        return (name || '?').trim().slice(0, 1).toUpperCase() || '?';
    }

    function setSyncState(state, message) {
        chip.dataset.sync = state;
        if (syncStatus && message) syncStatus.textContent = message;
    }

    function renderAccount() {
        const loggedIn = currentUser !== null;

        chip.hidden = !accountsAvailable;
        chipName.textContent = loggedIn ? currentUser.displayName || currentUser.username : 'Inloggen';
        chipAvatar.textContent = loggedIn ? initials(currentUser.username) : '↪';

        guestPanel.hidden = loggedIn || !accountsAvailable;
        userPanel.hidden = !loggedIn;
        unavailablePanel.hidden = accountsAvailable;

        modalTitle.textContent = loggedIn ? 'Je account' : 'Inloggen';
        modalSubtitle.textContent = loggedIn
            ? 'Je tijden staan veilig op de server.'
            : 'Bewaar je tijden en neem ze mee naar elk apparaat.';

        if (loggedIn) {
            summaryName.textContent = currentUser.displayName || currentUser.username;
            summaryEmail.textContent = currentUser.email || '';
            summaryAvatar.textContent = initials(currentUser.username);
            renderCounts();
        }
    }

    function renderCounts() {
        const sessions = api.getSessions();
        if (statSessions) statSessions.textContent = String(sessions.length);
        if (statSolves) {
            statSolves.textContent = String(
                sessions.reduce((total, session) => total + session.times.length, 0)
            );
        }
    }

    /* =====================================================================
     * Modal
     * ================================================================== */

    function openAccountModal() {
        renderAccount();
        loginError.textContent = '';
        registerError.textContent = '';
        UI.openModal(modal);
    }

    chip.addEventListener('click', openAccountModal);
    document.querySelectorAll('[data-close-account]').forEach(button => {
        button.addEventListener('click', () => UI.closeModal(modal));
    });
    UI.registerModal(modal);

    function setAuthTab(tab) {
        authTabs.forEach(button => {
            const isActive = button.dataset.authTab === tab;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        loginForm.hidden = tab !== 'login';
        registerForm.hidden = tab !== 'register';
    }

    authTabs.forEach(button => {
        button.addEventListener('click', () => setAuthTab(button.dataset.authTab));
    });

    /* =====================================================================
     * Samenvoegen van lokale en serverdata
     * ================================================================== */

    /**
     * Voegt de sessies van de server en die uit de browser samen.
     * Sessies worden gekoppeld op hun id; binnen een sessie worden solves
     * gekoppeld op hun solve-id. Bestaat een solve aan beide kanten, dan wint
     * de versie van de browser (daar is hij net mogelijk nog bewerkt).
     */
    function mergeSessions(serverSessions, localSessions) {
        const merged = new Map();

        const put = (session, preferIncoming) => {
            if (!session || !session.id) return;
            const existing = merged.get(session.id);

            if (!existing) {
                merged.set(session.id, {
                    id: session.id,
                    name: session.name || 'Sessie',
                    event: session.event || '333',
                    times: (session.times || []).slice()
                });
                return;
            }

            if (preferIncoming) {
                existing.name = session.name || existing.name;
                existing.event = session.event || existing.event;
            }

            const byId = new Map(existing.times.map(entry => [entry.id, entry]));
            (session.times || []).forEach(entry => {
                if (!entry) return;
                if (!entry.id) {
                    // Geen id: kan niet ontdubbeld worden, dus altijd meenemen.
                    existing.times.push(entry);
                    return;
                }
                if (!byId.has(entry.id) || preferIncoming) {
                    byId.set(entry.id, entry);
                }
            });

            existing.times = Array.from(byId.values())
                .sort((a, b) => Date.parse(a.timestamp || 0) - Date.parse(b.timestamp || 0));
        };

        serverSessions.forEach(session => put(session, false));
        localSessions.forEach(session => put(session, true));

        return Array.from(merged.values());
    }

    /* =====================================================================
     * Synchroniseren
     * ================================================================== */

    async function pushNow() {
        if (!currentUser || syncing) {
            if (currentUser) pendingChanges = true;
            return;
        }

        syncing = true;
        pendingChanges = false;
        setSyncState('syncing', 'Bezig met opslaan…');

        try {
            await UI.api('sync/push.php', { body: { sessions: api.getSessions() } });
            setSyncState('synced', 'Je tijden staan op de server, bijgewerkt om ' +
                new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) + '.');
            renderCounts();
        } catch (err) {
            if (err.status === 401) {
                // Sessie verlopen: terug naar uitgelogd, zonder data te verliezen.
                currentUser = null;
                renderAccount();
                setSyncState('error', '');
                UI.toast('Je bent uitgelogd. Je tijden staan nog in deze browser.', { type: 'warning' });
                return;
            }
            setSyncState('error', 'Opslaan is niet gelukt: ' + err.message);
        } finally {
            syncing = false;
            if (pendingChanges) scheduleSync();
        }
    }

    function scheduleSync() {
        if (!currentUser) return;
        window.clearTimeout(syncTimer);
        syncTimer = window.setTimeout(pushNow, SYNC_DEBOUNCE_MS);
    }

    /** Haalt de server op, voegt samen en duwt het resultaat terug. */
    async function syncAfterLogin() {
        setSyncState('syncing', 'Je tijden ophalen…');
        try {
            const remote = await UI.api('sync/pull.php');
            const localSessions = api.getSessions();
            const serverSessions = Array.isArray(remote.sessions) ? remote.sessions : [];

            if (serverSessions.length) {
                const merged = mergeSessions(serverSessions, localSessions);
                api.replaceSessions(merged, api.getActiveSessionId());
            }

            await pushNow();

            const solves = api.getSessions().reduce((total, session) => total + session.times.length, 0);
            UI.toast(`Welkom terug! ${solves} solves gesynchroniseerd.`, { type: 'success' });
        } catch (err) {
            setSyncState('error', 'Synchroniseren is niet gelukt: ' + err.message);
            UI.toast('Synchroniseren is niet gelukt. Je tijden staan nog in deze browser.', { type: 'error' });
        }
    }

    window.addEventListener('cubetimer:data-change', () => {
        renderCounts();
        scheduleSync();
    });

    // Bij het wegklikken van het tabblad nog snel opslaan wat open staat.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && currentUser && syncTimer) {
            window.clearTimeout(syncTimer);
            syncTimer = null;
            pushNow();
        }
    });

    document.getElementById('account-sync-now')?.addEventListener('click', () => {
        window.clearTimeout(syncTimer);
        pushNow();
    });

    /* =====================================================================
     * Inloggen, registreren, uitloggen
     * ================================================================== */

    async function submitAuth(form, errorField, button, request) {
        errorField.textContent = '';
        const originalLabel = button.textContent;
        button.disabled = true;
        button.textContent = 'Even geduld…';

        try {
            const response = await request();
            currentUser = response.user;
            renderAccount();
            UI.closeModal(modal);
            form.reset();
            await syncAfterLogin();
        } catch (err) {
            if (err.code === 'database_unavailable') {
                accountsAvailable = false;
                renderAccount();
            }
            errorField.textContent = err.message;
        } finally {
            button.disabled = false;
            button.textContent = originalLabel;
        }
    }

    loginForm.addEventListener('submit', event => {
        event.preventDefault();
        const login = document.getElementById('login-identifier').value.trim();
        const password = document.getElementById('login-password').value;

        if (!login || !password) {
            loginError.textContent = 'Vul je gebruikersnaam en wachtwoord in.';
            return;
        }

        submitAuth(loginForm, loginError, document.getElementById('login-submit'),
            () => UI.api('auth/login.php', { body: { login, password } }));
    });

    registerForm.addEventListener('submit', event => {
        event.preventDefault();
        const username = document.getElementById('register-username').value.trim();
        const email = document.getElementById('register-email').value.trim();
        const password = document.getElementById('register-password').value;

        if (password.length < 8) {
            registerError.textContent = 'Je wachtwoord moet minstens 8 tekens lang zijn.';
            return;
        }

        submitAuth(registerForm, registerError, document.getElementById('register-submit'),
            () => UI.api('auth/register.php', { body: { username, email, password } }));
    });

    document.getElementById('account-logout')?.addEventListener('click', async () => {
        const confirmed = await UI.ask({
            title: 'Uitloggen?',
            message: 'Je tijden blijven in deze browser staan en worden bij de volgende login weer samengevoegd.',
            confirmLabel: 'Uitloggen',
            danger: true
        });
        if (!confirmed) return;

        // Nog even wegschrijven wat er open staat, anders gaat dat verloren.
        window.clearTimeout(syncTimer);
        await pushNow();

        try {
            await UI.api('auth/logout.php', { body: {} });
        } catch (err) {
            // Ook als de server niet reageert: lokaal uitloggen.
        }

        currentUser = null;
        setSyncState('idle', '');
        renderAccount();
        UI.closeModal(modal);
        UI.toast('Je bent uitgelogd.', { type: 'info' });
    });

    /* =====================================================================
     * Opstarten
     * ================================================================== */

    setAuthTab('login');

    UI.status().then(async status => {
        accountsAvailable = status.features?.accounts === true;
        renderAccount();
        if (!accountsAvailable) return;

        if (status.authenticated) {
            try {
                const me = await UI.api('auth/me.php');
                currentUser = me.user;
                renderAccount();
                if (currentUser) await syncAfterLogin();
            } catch (err) {
                currentUser = null;
                renderAccount();
            }
        }
    });
})();
