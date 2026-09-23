/**
 * CubeTimer - accounts en synchronisatie
 * ---------------------------------------------------------------------------
 * Inloggen, registreren en het bewaren van je tijden op de server.
 *
 * Hoe de synchronisatie werkt:
 *   - Bij het inloggen wint de server. Wat er op je account staat komt in deze
 *     browser te staan, punt. Alleen als je account nog helemaal leeg is neemt
 *     hij over wat hier al lag; zo raak je bij je eerste login niets kwijt.
 *   - Daarna is de browser de bron van waarheid: bij elke wijziging wordt de
 *     volledige staat naar de server geduwd.
 *   - localStorage blijft altijd gevuld, ook als je ingelogd bent. Zonder
 *     internet blijft de timer dus gewoon werken.
 *
 * Waarom de server wint en er niet meer samengevoegd wordt: dat samenvoegen
 * duwde bij elke login terug wat er toevallig in díe browser stond. Wie op zijn
 * telefoon had opgeruimd, kreeg op zijn laptop alles weer terug - inclusief
 * sessies van voor hij een account had. Een browser is een werkkopie, geen
 * tweede administratie.
 *
 * Kwijtraken doe je er niets mee: de server gooit solves die niet meekomen niet
 * weg maar bewaart ze als losse tijd. Zie api/sync/push.php.
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
    const statSessions = document.getElementById('account-stat-sessions');
    const statSolves = document.getElementById('account-stat-solves');
    const looseBox = document.getElementById('account-loose');
    const looseText = document.getElementById('account-loose-text');
    const looseRestore = document.getElementById('account-loose-restore');
    const looseClear = document.getElementById('account-loose-clear');
    const syncStatus = document.getElementById('account-sync-status');
    const flagNotice = document.getElementById('account-flag-notice');

    const chipBadge = document.getElementById('account-badge');
    const chipBadgeValue = document.getElementById('account-badge-value');

    const summaryBadge = document.getElementById('account-summary-badge');
    const summaryRank = document.getElementById('account-summary-rank');
    const summaryLevel = document.getElementById('account-summary-level');
    const summaryRankLine = document.getElementById('account-summary-rankline');

    const xpLevelLabel = document.getElementById('xp-level-label');
    const xpProgressLabel = document.getElementById('xp-progress-label');
    const xpTotalLabel = document.getElementById('xp-total-label');
    const xpFill = document.getElementById('xp-bar-fill');
    const xpLog = document.getElementById('account-xp-log');

    const statStreak = document.getElementById('account-stat-streak');
    const statAchievements = document.getElementById('account-stat-achievements');
    const statLongest = document.getElementById('account-stat-longest');
    const recordsHost = document.getElementById('account-records');
    const mainEventSelect = document.getElementById('account-main-event');
    const countrySelect = document.getElementById('account-country');
    const showOnLeaderboard = document.getElementById('account-show-leaderboard');
    const profileLink = document.getElementById('account-profile-link');
    const copyProfileButton = document.getElementById('account-copy-profile');

    const SYNC_DEBOUNCE_MS = 2500;

    let currentUser = null;
    let profile = null;
    let accountsAvailable = false;
    let syncTimer = null;
    let syncing = false;
    let pendingChanges = false;
    // Tijden die wel op het account staan maar niet meer in een sessie.
    let looseSolves = 0;

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

        // Zodra we een positie kennen, komt de rangbadge in de plaats van de
        // initiaal; die zegt meer.
        const heeftRang = loggedIn && profile && profile.rank;
        chipBadge.hidden = !heeftRang;
        chipAvatar.hidden = Boolean(heeftRang);
        if (heeftRang) {
            chipBadge.dataset.tier = profile.xp.tier.slug;
            chipBadgeValue.textContent = profile.rank.label;
        }

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
            renderCounts();
        }
    }

    /* ---------------------------------------------------------------------
     * Profiel: XP, level, rang, streak en records
     * ------------------------------------------------------------------ */

    const CATEGORY_LABELS = {
        single: 'Beste', worst_single: 'Slechtste', mo3: 'Mo3',
        ao5: 'Ao5', ao12: 'Ao12', ao50: 'Ao50', ao100: 'Ao100'
    };
    const CATEGORY_ORDER = ['single', 'mo3', 'ao5', 'ao12', 'ao50', 'ao100', 'worst_single'];

    async function loadProfile() {
        if (!currentUser) return;
        try {
            profile = await UI.api('profile/overview.php');
            renderProfile();
            renderAccount();
        } catch (err) {
            // Niet erg: het accountscherm werkt ook zonder deze cijfers.
            console.warn('[cubetimer] profiel laden mislukt', err);
        }
    }

    function renderProfile() {
        if (!profile) return;

        const tier = profile.xp.tier;

        summaryBadge.dataset.tier = tier.slug;
        summaryRank.textContent = profile.rank ? profile.rank.label : '--';
        summaryLevel.textContent = 'Lv. ' + profile.xp.level;
        summaryRankLine.textContent = profile.rank
            ? `${profile.rank.label} van ${profile.rank.total} op ${profile.mainEvent.label} · ${UI.formatTime(profile.rank.valueMs)}`
            : `Nog geen positie op ${profile.mainEvent.label}. Synchroniseer een paar solves.`;

        xpLevelLabel.textContent = `Level ${profile.xp.level} · ${tier.name}`;
        xpProgressLabel.textContent = `${profile.xp.inLevel} / ${profile.xp.neededForNext} XP`;
        xpTotalLabel.textContent = `${profile.xp.total.toLocaleString('nl-NL')} XP verdiend`;
        xpFill.style.width = Math.min(100, Math.round(profile.xp.inLevel / profile.xp.neededForNext * 100)) + '%';

        statStreak.textContent = String(profile.streak.current);
        statLongest.textContent = String(profile.streak.longest);
        if (statAchievements && profile.achievements) {
            statAchievements.textContent =
                `${profile.achievements.unlocked}/${profile.achievements.total}`;
        }

        renderRecords();
        renderXpLog();

        if (mainEventSelect && !mainEventSelect.options.length) {
            fillMainEvents();
        }
        if (countrySelect && !countrySelect.options.length) {
            fillCountries();
        }
        if (mainEventSelect) mainEventSelect.value = profile.mainEvent.id;
        if (countrySelect) countrySelect.value = profile.country || '';
        if (showOnLeaderboard) showOnLeaderboard.checked = profile.onLeaderboard;

        // Je eigen profiel is alleen te delen als je meedoet aan de ranglijsten.
        const url = profileUrl(currentUser.username);
        if (profileLink) {
            profileLink.href = url;
            profileLink.hidden = !profile.onLeaderboard;
        }
        if (copyProfileButton) {
            copyProfileButton.hidden = !profile.onLeaderboard;
        }

        flagNotice.hidden = profile.pendingFlags === 0;
        if (profile.pendingFlags > 0) {
            flagNotice.textContent = profile.pendingFlags === 1
                ? 'Een van je tijden wordt nog nagekeken en telt zolang niet mee voor de ranglijsten.'
                : `${profile.pendingFlags} van je tijden worden nog nagekeken en tellen zolang niet mee voor de ranglijsten.`;
        }
    }

    function renderRecords() {
        recordsHost.innerHTML = '';

        if (!profile.events.length) {
            const leeg = document.createElement('p');
            leeg.className = 'table-empty';
            leeg.textContent = 'Nog geen records. Synchroniseer eerst je tijden.';
            recordsHost.appendChild(leeg);
            return;
        }

        profile.events.forEach(event => {
            const blok = document.createElement('div');
            blok.className = 'records-event';

            const naam = document.createElement('span');
            naam.className = 'records-event__name';
            naam.textContent = event.label;
            blok.appendChild(naam);

            const grid = document.createElement('div');
            grid.className = 'records-event__grid';

            CATEGORY_ORDER.forEach(category => {
                const record = event.records[category];
                if (!record) return;

                const cel = document.createElement('div');
                cel.className = 'records-cell' + (category === 'single' ? ' records-cell--best' : '');

                const label = document.createElement('span');
                label.className = 'records-cell__label';
                label.textContent = CATEGORY_LABELS[category] || category;

                const waarde = document.createElement('span');
                waarde.className = 'records-cell__value';
                waarde.textContent = UI.formatTime(record.valueMs);

                cel.appendChild(label);
                cel.appendChild(waarde);
                grid.appendChild(cel);
            });

            blok.appendChild(grid);
            recordsHost.appendChild(blok);
        });
    }

    function renderXpLog() {
        xpLog.innerHTML = '';
        profile.recentXp.forEach(entry => {
            const rij = document.createElement('li');
            rij.className = 'xp-log__row';

            const detail = document.createElement('span');
            detail.className = 'xp-log__detail';
            detail.textContent = entry.detail || entry.type;

            const bedrag = document.createElement('span');
            bedrag.className = 'xp-log__amount';
            bedrag.textContent = '+' + entry.amount;

            rij.appendChild(detail);
            rij.appendChild(bedrag);
            xpLog.appendChild(rij);
        });
    }

    /** De deelbare URL van een profiel. */
    function profileUrl(username) {
        return new URL('profiel.php?u=' + encodeURIComponent(username), window.location.href).href;
    }

    function fillCountries() {
        if (!countrySelect) return;

        const leeg = document.createElement('option');
        leeg.value = '';
        leeg.textContent = 'Niet ingesteld';
        countrySelect.appendChild(leeg);

        UI.countries().forEach(land => {
            const option = document.createElement('option');
            option.value = land.code;
            option.textContent = `${land.name} (${land.code})`;
            countrySelect.appendChild(option);
        });
    }

    function fillMainEvents() {
        if (!mainEventSelect) return;
        const events = window.cubeTimerApi.getEventOptions
            ? window.cubeTimerApi.getEventOptions()
            : [{ id: '333', label: '3x3x3' }];

        mainEventSelect.innerHTML = '';
        events.forEach(event => {
            const option = document.createElement('option');
            option.value = event.id;
            option.textContent = event.label;
            mainEventSelect.appendChild(option);
        });
    }

    async function saveProfileSetting(body, melding) {
        try {
            await UI.api('profile/settings.php', { body });
            await loadProfile();
            window.CubeTimerLeaderboard?.reload?.();
            if (melding) UI.toast(melding, { type: 'success' });
        } catch (err) {
            UI.toast(err.message || 'Opslaan is niet gelukt.', { type: 'error' });
        }
    }

    mainEventSelect?.addEventListener('change', () => {
        saveProfileSetting({ mainEvent: mainEventSelect.value }, 'Hoofd-event bijgewerkt.');
    });

    countrySelect?.addEventListener('change', () => {
        saveProfileSetting({ country: countrySelect.value }, 'Land bijgewerkt.');
    });

    copyProfileButton?.addEventListener('click', async () => {
        if (!currentUser) return;
        const url = profileUrl(currentUser.username);
        try {
            await navigator.clipboard.writeText(url);
            UI.toast('Profiellink gekopieerd.', { type: 'success' });
        } catch (err) {
            // Zonder toestemming voor het klembord: de link dan maar tonen.
            UI.toast(url, { type: 'info', duration: 9000, link: { href: url, label: 'Openen' } });
        }
    });

    showOnLeaderboard?.addEventListener('change', () => {
        saveProfileSetting(
            { showOnLeaderboard: showOnLeaderboard.checked },
            showOnLeaderboard.checked
                ? 'Je doet weer mee aan de ranglijsten.'
                : 'Je staat niet meer in de ranglijsten.'
        );
    });

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
     * Losse tijden
     *
     * Solves die op het account staan maar niet meer onder een sessie hangen.
     * Dat gebeurt als je een sessie opruimt: de tijden zelf blijven, want je
     * records en achievements staan erop. Hier kun je ze terughalen of alsnog
     * weggooien - en dat laatste is de enige plek op de site waar tijden echt
     * verdwijnen.
     * ================================================================== */

    function renderLooseSolves() {
        if (!looseBox) return;
        looseBox.hidden = !currentUser || looseSolves <= 0;
        if (looseBox.hidden || !looseText) return;

        looseText.textContent = looseSolves === 1
            ? 'Er staat 1 tijd op je account die niet in een sessie zit. Hij telt gewoon mee voor je '
                + 'records en ranglijsten.'
            : `Er staan ${looseSolves} tijden op je account die niet in een sessie zitten. Ze tellen `
                + 'gewoon mee voor je records en ranglijsten.';
    }

    /** Vraagt de server hoeveel losse tijden er zijn. */
    async function refreshLooseSolves() {
        if (!currentUser) {
            looseSolves = 0;
            renderLooseSolves();
            return;
        }
        try {
            const antwoord = await UI.api('archive/list.php');
            looseSolves = Number(antwoord.total) || 0;
        } catch (err) {
            looseSolves = 0;
        }
        renderLooseSolves();
    }

    looseRestore?.addEventListener('click', async () => {
        looseRestore.disabled = true;
        try {
            const antwoord = await UI.api('archive/restore.php', { body: {} });
            const aantal = Number(antwoord.restored) || 0;
            const sessies = Number(antwoord.sessions) || 0;
            if (!aantal) {
                UI.toast('Er was niets meer om terug te halen.', { type: 'info' });
            } else {
                // Opnieuw ophalen, want de server heeft er sessies omheen gezet.
                const verse = await UI.api('sync/pull.php');
                if (Array.isArray(verse.sessions) && verse.sessions.length) {
                    api.replaceSessions(verse.sessions, api.getActiveSessionId());
                }
                looseSolves = Number(verse.looseSolves) || 0;
                renderCounts();
                UI.toast(`${aantal} ${aantal === 1 ? 'tijd' : 'tijden'} teruggehaald in `
                    + `${sessies} ${sessies === 1 ? 'sessie' : 'sessies'}.`, { type: 'success' });
            }
            renderLooseSolves();
        } catch (err) {
            UI.toast('Terughalen is niet gelukt: ' + err.message, { type: 'error' });
        } finally {
            looseRestore.disabled = false;
        }
    });

    looseClear?.addEventListener('click', async () => {
        const aantal = looseSolves;
        const akkoord = await UI.ask({
            title: 'Losse tijden wissen?',
            message: `${aantal} ${aantal === 1 ? 'tijd verdwijnt' : 'tijden verdwijnen'} definitief van je `
                + 'account. Je records worden daarna opnieuw uitgerekend, dus een persoonlijk record kan '
                + 'hierdoor vervallen. Dit kun je niet ongedaan maken.',
            confirmLabel: 'Definitief wissen',
            danger: true
        });
        if (akkoord !== true) return;

        looseClear.disabled = true;
        try {
            const antwoord = await UI.api('archive/clear.php', { body: { confirm: true } });
            const weg = Number(antwoord.deleted) || 0;
            looseSolves = 0;
            renderLooseSolves();
            await loadProfile();
            UI.toast(`${weg} ${weg === 1 ? 'tijd' : 'tijden'} van je account verwijderd.`, { type: 'success' });
        } catch (err) {
            UI.toast('Wissen is niet gelukt: ' + err.message, { type: 'error' });
        } finally {
            looseClear.disabled = false;
        }
    });

    /* =====================================================================
     * Modal
     * ================================================================== */

    function openAccountModal() {
        renderAccount();
        loginError.textContent = '';
        registerError.textContent = '';
        UI.openModal(modal);
        // Op de achtergrond: staan er losse tijden op het account?
        refreshLooseSolves();
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

        // Tijden die de gebruiker ook van zijn account af wil. Pas opruimen als
        // de server ze heeft gehad; bij een mislukte push gaan ze dus gewoon mee
        // met de volgende poging.
        const teVerwijderen = api.getRemovedSolveIds ? api.getRemovedSolveIds() : [];

        try {
            const response = await UI.api('sync/push.php', {
                body: { sessions: api.getSessions(), removedSolveIds: teVerwijderen }
            });

            if (teVerwijderen.length && api.clearRemovedSolveIds) {
                api.clearRemovedSolveIds(teVerwijderen);
            }
            looseSolves = Number(response.looseSolves) || 0;
            renderLooseSolves();

            // De server meldt wat er onderweg ontgrendeld is.
            const nieuw = response.derived?.achievements;
            if (nieuw && nieuw.length) {
                window.dispatchEvent(new CustomEvent('cubetimer:achievements-unlocked', {
                    detail: { unlocked: nieuw }
                }));
            }

            setSyncState('synced', 'Je tijden staan op de server, bijgewerkt om ' +
                new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) + '.');
            renderCounts();

            // De server heeft net records, XP en challenges herberekend.
            await loadProfile();
            window.dispatchEvent(new CustomEvent('cubetimer:synced'));
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

    /**
     * Haalt op wat er op het account staat en zet dat in deze browser.
     *
     * Staat er al iets op het account, dan is dat wat je krijgt: de server
     * wint. Er wordt dan ook niet teruggeduwd, want anders zou deze browser
     * alsnog zijn eigen oude staat opleggen - precies wat we niet willen.
     *
     * Is het account nog leeg, dan is dit iemands eerste login en nemen we over
     * wat er in de browser ligt.
     */
    async function syncAfterLogin() {
        setSyncState('syncing', 'Je tijden ophalen…');
        try {
            const remote = await UI.api('sync/pull.php');
            const serverSessions = Array.isArray(remote.sessions) ? remote.sessions : [];
            looseSolves = Number(remote.looseSolves) || 0;

            if (serverSessions.length) {
                api.replaceSessions(serverSessions, api.getActiveSessionId());
                const solves = serverSessions.reduce((totaal, sessie) => totaal + sessie.times.length, 0);
                UI.toast(`Welkom terug! ${solves} ${solves === 1 ? 'solve' : 'solves'} opgehaald.`, { type: 'success' });
                setSyncState('synced', 'Je tijden komen van je account.');
                renderCounts();
                renderLooseSolves();
            } else {
                // Leeg account: dit is de eerste keer. Wat hier ligt gaat mee.
                const lokaal = api.getSessions();
                const solves = lokaal.reduce((totaal, sessie) => totaal + sessie.times.length, 0);
                await pushNow();
                UI.toast(solves
                    ? `Je ${solves} ${solves === 1 ? 'solve staat' : 'solves staan'} nu op je account.`
                    : 'Je account is klaar voor gebruik.', { type: 'success' });
            }

            await loadProfile();
            window.dispatchEvent(new CustomEvent('cubetimer:synced'));
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

    /**
     * Laat de rest van de app weten dat er iemand anders (of niemand) is
     * ingelogd. De statuscache wordt daarbij ververst, want daar staat onder
     * meer in of je beheerder bent.
     */
    async function announceAuthChange() {
        let status = null;
        try {
            status = await UI.refreshStatus();
        } catch (err) {
            status = null;
        }
        window.dispatchEvent(new CustomEvent('cubetimer:auth-change', {
            detail: { user: currentUser, status }
        }));
    }

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
            await announceAuthChange();
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
        profile = null;
        looseSolves = 0;
        setSyncState('idle', '');
        renderAccount();
        renderLooseSolves();
        UI.closeModal(modal);
        await announceAuthChange();
        UI.toast('Je bent uitgelogd.', { type: 'info' });
    });

    /* =====================================================================
     * Opstarten
     * ================================================================== */

    setAuthTab('login');

    window.CubeTimerAccount = {
        currentUsername: () => (currentUser ? currentUser.username : null),
        getProfile: () => profile,
        reloadProfile: loadProfile
    };

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
