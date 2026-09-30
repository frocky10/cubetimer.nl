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

    const forgotOpen = document.getElementById('forgot-open');
    const forgotForm = document.getElementById('forgot-form');
    const forgotError = document.getElementById('forgot-error');
    const forgotDone = document.getElementById('forgot-done');
    const resetForm = document.getElementById('reset-form');
    const resetError = document.getElementById('reset-error');
    const verifyBox = document.getElementById('account-verify');
    const verifyText = document.getElementById('account-verify-text');
    const verifyResend = document.getElementById('account-verify-resend');

    let currentUser = null;
    let profile = null;
    let accountsAvailable = false;
    let mailAvailable = false;          // wachtwoord vergeten kan
    let verificationAvailable = false;  // adres bevestigen kan
    let resetToken = null;              // uit een #herstel=-link, zolang het formulier openstaat
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
        chipName.textContent = loggedIn ? currentUser.displayName || currentUser.username : UI.t('Inloggen');
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

        // Een herstellink uit de mail gaat voor: dan staat het formulier voor
        // een nieuw wachtwoord in beeld, ook als je al ingelogd bent.
        const herstellen = resetToken !== null && accountsAvailable;
        guestPanel.hidden = herstellen ? false : (loggedIn || !accountsAvailable);
        userPanel.hidden = herstellen || !loggedIn;
        unavailablePanel.hidden = accountsAvailable;
        if (forgotOpen) forgotOpen.hidden = !mailAvailable;

        modalTitle.textContent = herstellen ? UI.t('Nieuw wachtwoord') : (loggedIn ? UI.t('Je account') : UI.t('Inloggen'));
        modalSubtitle.textContent = herstellen
            ? UI.t('Kies een nieuw wachtwoord voor je account.')
            : loggedIn
                ? UI.t('Je tijden staan veilig op de server.')
                : UI.t('Bewaar je tijden en neem ze mee naar elk apparaat.');

        if (loggedIn) {
            summaryName.textContent = currentUser.displayName || currentUser.username;
            summaryEmail.textContent = currentUser.email || '';
            renderCounts();
        }

        // Adres nog niet bevestigd: vragen, niet eisen.
        const onbevestigd = loggedIn && verificationAvailable && currentUser.emailVerified === false;
        if (verifyBox) verifyBox.hidden = !onbevestigd;
        if (onbevestigd && verifyText) {
            verifyText.textContent = UI.t('Bevestig je e-mailadres ({email}); dan kunnen we je helpen als je ooit je wachtwoord vergeet.', { email: currentUser.email });
        }
    }

    /* ---------------------------------------------------------------------
     * Profiel: XP, level, rang, streak en records
     * ------------------------------------------------------------------ */

    const CATEGORY_LABELS = {
        single: UI.t('Beste'), worst_single: UI.t('Slechtste'), mo3: 'Mo3',
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
            ? UI.t('{plek} van {totaal} op {event}', { plek: profile.rank.label, totaal: UI.getal(profile.rank.total), event: profile.mainEvent.label }) + ' · ' + UI.formatTime(profile.rank.valueMs)
            : UI.t('Nog geen positie op {event}. Synchroniseer een paar solves.', { event: profile.mainEvent.label });

        xpLevelLabel.textContent = `Level ${profile.xp.level} · ${tier.name}`;
        xpProgressLabel.textContent = `${profile.xp.inLevel} / ${profile.xp.neededForNext} XP`;
        xpTotalLabel.textContent = UI.t('{xp} XP verdiend', { xp: UI.getal(profile.xp.total) });
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
                ? UI.t('Een van je tijden wordt nog nagekeken en telt zolang niet mee voor de ranglijsten.')
                : UI.t('{n} van je tijden worden nog nagekeken en tellen zolang niet mee voor de ranglijsten.', { n: profile.pendingFlags });
        }
    }

    function renderRecords() {
        recordsHost.innerHTML = '';

        if (!profile.events.length) {
            const leeg = document.createElement('p');
            leeg.className = 'table-empty';
            leeg.textContent = UI.t('Nog geen records. Synchroniseer eerst je tijden.');
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
                cel.className = 'records-cell' + (category === 'single' ? ' records-cell--best' : ''); // niet vertalen

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
        return new URL(UI.profielUrl(username), window.location.href).href;
    }

    function fillCountries() {
        if (!countrySelect) return;

        const leeg = document.createElement('option');
        leeg.value = '';
        leeg.textContent = UI.t('Niet ingesteld');
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
            UI.toast(err.message || UI.t('Opslaan is niet gelukt.'), { type: 'error' });
        }
    }

    mainEventSelect?.addEventListener('change', () => {
        saveProfileSetting({ mainEvent: mainEventSelect.value }, UI.t('Hoofd-event bijgewerkt.'));
    });

    countrySelect?.addEventListener('change', () => {
        saveProfileSetting({ country: countrySelect.value }, UI.t('Land bijgewerkt.'));
    });

    copyProfileButton?.addEventListener('click', async () => {
        if (!currentUser) return;
        const url = profileUrl(currentUser.username);
        try {
            await navigator.clipboard.writeText(url);
            UI.toast(UI.t('Profiellink gekopieerd.'), { type: 'success' });
        } catch (err) {
            // Zonder toestemming voor het klembord: de link dan maar tonen.
            UI.toast(url, { type: 'info', duration: 9000, link: { href: url, label: UI.t('Openen') } });
        }
    });

    showOnLeaderboard?.addEventListener('change', () => {
        saveProfileSetting(
            { showOnLeaderboard: showOnLeaderboard.checked },
            showOnLeaderboard.checked
                ? UI.t('Je doet weer mee aan de ranglijsten.')
                : UI.t('Je staat niet meer in de ranglijsten.')
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
            ? UI.t('Er staat 1 tijd op je account die niet in een sessie zit. Hij telt gewoon mee voor je records en ranglijsten.')
            : UI.t('Er staan {n} tijden op je account die niet in een sessie zitten. Ze tellen gewoon mee voor je records en ranglijsten.', { n: looseSolves });
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
                UI.toast(UI.t('Er was niets meer om terug te halen.'), { type: 'info' });
            } else {
                // Opnieuw ophalen, want de server heeft er sessies omheen gezet.
                const verse = await UI.api('sync/pull.php');
                if (Array.isArray(verse.sessions) && verse.sessions.length) {
                    api.replaceSessions(verse.sessions, api.getActiveSessionId());
                }
                looseSolves = Number(verse.looseSolves) || 0;
                renderCounts();
                const waar = { n: aantal, sessies: sessies === 1 ? UI.t('1 sessie') : UI.t('{n} sessies', { n: sessies }) };
                UI.toast(aantal === 1
                    ? UI.t('1 tijd teruggehaald in {sessies}.', waar)
                    : UI.t('{n} tijden teruggehaald in {sessies}.', waar), { type: 'success' });
            }
            renderLooseSolves();
        } catch (err) {
            UI.toast(UI.t('Terughalen is niet gelukt: {fout}', { fout: err.message }), { type: 'error' });
        } finally {
            looseRestore.disabled = false;
        }
    });

    looseClear?.addEventListener('click', async () => {
        const aantal = looseSolves;
        const akkoord = await UI.ask({
            title: UI.t('Losse tijden wissen?'),
            message: aantal === 1
                ? UI.t('1 tijd verdwijnt definitief van je account. Je records worden daarna opnieuw uitgerekend, dus een persoonlijk record kan hierdoor vervallen. Dit kun je niet ongedaan maken.')
                : UI.t('{n} tijden verdwijnen definitief van je account. Je records worden daarna opnieuw uitgerekend, dus een persoonlijk record kan hierdoor vervallen. Dit kun je niet ongedaan maken.', { n: aantal }),
            confirmLabel: UI.t('Definitief wissen'),
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
            UI.toast(weg === 1 ? UI.t('1 tijd van je account verwijderd.') : UI.t('{n} tijden van je account verwijderd.', { n: weg }), { type: 'success' });
        } catch (err) {
            UI.toast(UI.t('Wissen is niet gelukt: {fout}', { fout: err.message }), { type: 'error' });
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

    /** login | register | forgot | reset */
    function setAuthTab(tab) {
        authTabs.forEach(button => {
            const isActive = button.dataset.authTab === tab;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        const tabsBalk = authTabs[0]?.parentElement;
        if (tabsBalk) tabsBalk.hidden = tab === 'forgot' || tab === 'reset';
        loginForm.hidden = tab !== 'login';
        registerForm.hidden = tab !== 'register';
        if (forgotForm) forgotForm.hidden = tab !== 'forgot';
        if (resetForm) resetForm.hidden = tab !== 'reset';
    }

    authTabs.forEach(button => {
        button.addEventListener('click', () => setAuthTab(button.dataset.authTab));
    });

    /* =====================================================================
     * Wachtwoord vergeten, nieuw wachtwoord, adres bevestigen
     *
     * De links in de mails zetten het token achter een hekje (/#herstel=...,
     * /#bevestig=...). Dat stuurt de browser nooit naar een server of naar
     * Google Analytics; we lezen het hier uit en halen het meteen uit de
     * adresbalk.
     * ================================================================== */

    forgotOpen?.addEventListener('click', () => {
        const ingevuld = document.getElementById('login-identifier').value.trim();
        const veld = document.getElementById('forgot-identifier');
        if (ingevuld && !veld.value) veld.value = ingevuld;
        forgotError.textContent = '';
        forgotDone.hidden = true;
        setAuthTab('forgot');
        veld.focus();
    });

    document.querySelectorAll('[data-auth-back]').forEach(button => {
        button.addEventListener('click', () => setAuthTab('login'));
    });

    forgotForm?.addEventListener('submit', async event => {
        event.preventDefault();
        const identifier = document.getElementById('forgot-identifier').value.trim();
        const knop = document.getElementById('forgot-submit');
        forgotError.textContent = '';
        forgotDone.hidden = true;
        if (!identifier) {
            forgotError.textContent = UI.t('Vul je e-mailadres of gebruikersnaam in.');
            return;
        }
        knop.disabled = true;
        try {
            const antwoord = await UI.protectedApi('auth/forgot-password.php', { identifier }, forgotForm);
            forgotDone.textContent = antwoord.message;
            forgotDone.hidden = false;
        } catch (err) {
            forgotError.textContent = err.message;
        } finally {
            knop.disabled = false;
        }
    });

    resetForm?.addEventListener('submit', async event => {
        event.preventDefault();
        const password = document.getElementById('reset-password').value;
        const herhaling = document.getElementById('reset-password-repeat').value;
        resetError.textContent = '';
        if (password.length < 8) {
            resetError.textContent = UI.t('Je wachtwoord moet minstens 8 tekens lang zijn.');
            return;
        }
        if (password !== herhaling) {
            resetError.textContent = UI.t('De twee wachtwoorden zijn niet hetzelfde.');
            return;
        }

        const knop = document.getElementById('reset-submit');
        knop.disabled = true;
        try {
            const antwoord = await UI.api('auth/reset-password.php', { body: { token: resetToken, password } });
            resetToken = null;
            resetForm.reset();
            setAuthTab('login');
            currentUser = antwoord.user;
            renderAccount();
            UI.closeModal(modal);
            UI.toast(antwoord.message, { type: 'success' });
            await announceAuthChange();
            await syncAfterLogin();
        } catch (err) {
            resetError.textContent = err.message;
        } finally {
            knop.disabled = false;
        }
    });

    verifyResend?.addEventListener('click', async () => {
        verifyResend.disabled = true;
        try {
            const antwoord = await UI.api('auth/resend-verification.php', { body: {} });
            if (antwoord.alreadyVerified && currentUser) {
                currentUser.emailVerified = true;
                renderAccount();
            }
            UI.toast(antwoord.message, { type: 'success' });
        } catch (err) {
            UI.toast(err.message, { type: 'error' });
        } finally {
            verifyResend.disabled = false;
        }
    });

    /** Leest #bevestig= of #herstel= uit de adresbalk, en haalt het er meteen weer uit. */
    async function handleMailLink() {
        const match = window.location.hash.match(/^#(bevestig|herstel)=([a-f0-9]{64})$/);
        if (!match) return;
        if (window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        const [, soort, token] = match;

        if (soort === 'herstel') {
            resetToken = token;
            setAuthTab('reset');
            renderAccount();
            UI.openModal(modal);
            return;
        }

        try {
            const antwoord = await UI.api('auth/verify-email.php', { body: { token } });
            if (currentUser) {
                currentUser.emailVerified = true;
                renderAccount();
            }
            UI.toast(antwoord.message, { type: 'success' });
        } catch (err) {
            UI.toast(err.message || UI.t('Deze link werkt niet (meer).'), { type: 'error', duration: 8000 });
        }
    }

    // Sluit je het venster zonder een nieuw wachtwoord te kiezen, dan is de
    // herstellink voor deze keer klaar; het account zelf verandert niet.
    modal.addEventListener('transitionend', () => {
        if (!modal.classList.contains('visible') && resetToken !== null) {
            resetToken = null;
            setAuthTab('login');
            renderAccount();
        }
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
        setSyncState('syncing', UI.t('Bezig met opslaan…'));

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

            setSyncState('synced', UI.t('Je tijden staan op de server, bijgewerkt om {tijd}.', {
                tijd: new Date().toLocaleTimeString(UI.locale, { hour: '2-digit', minute: '2-digit' })
            }));
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
                UI.toast(UI.t('Je bent uitgelogd. Je tijden staan nog in deze browser.'), { type: 'warning' });
                return;
            }
            setSyncState('error', UI.t('Opslaan is niet gelukt: {fout}', { fout: err.message }));
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
        setSyncState('syncing', UI.t('Je tijden ophalen…'));
        try {
            const remote = await UI.api('sync/pull.php');
            const serverSessions = Array.isArray(remote.sessions) ? remote.sessions : [];
            looseSolves = Number(remote.looseSolves) || 0;

            if (serverSessions.length) {
                api.replaceSessions(serverSessions, api.getActiveSessionId());
                const solves = serverSessions.reduce((totaal, sessie) => totaal + sessie.times.length, 0);
                UI.toast(solves === 1 ? UI.t('Welkom terug! 1 solve opgehaald.') : UI.t('Welkom terug! {n} solves opgehaald.', { n: UI.getal(solves) }), { type: 'success' });
                setSyncState('synced', UI.t('Je tijden komen van je account.'));
                renderCounts();
                renderLooseSolves();
            } else {
                // Leeg account: dit is de eerste keer. Wat hier ligt gaat mee.
                const lokaal = api.getSessions();
                const solves = lokaal.reduce((totaal, sessie) => totaal + sessie.times.length, 0);
                await pushNow();
                UI.toast(solves
                    ? (solves === 1 ? UI.t('Je solve staat nu op je account.') : UI.t('Je {n} solves staan nu op je account.', { n: UI.getal(solves) }))
                    : UI.t('Je account is klaar voor gebruik.'), { type: 'success' });
            }

            await loadProfile();
            window.dispatchEvent(new CustomEvent('cubetimer:synced'));
        } catch (err) {
            setSyncState('error', UI.t('Synchroniseren is niet gelukt: {fout}', { fout: err.message }));
            UI.toast(UI.t('Synchroniseren is niet gelukt. Je tijden staan nog in deze browser.'), { type: 'error' });
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
        button.textContent = UI.t('Even geduld…');

        try {
            const response = await request();
            currentUser = response.user;
            renderAccount();
            UI.closeModal(modal);
            form.reset();
            if (response.verificationSent) {
                UI.toast(UI.t('We stuurden een mail naar {email} om je adres te bevestigen.', { email: currentUser.email }), { type: 'info', duration: 7000 });
            }
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
            loginError.textContent = UI.t('Vul je gebruikersnaam en wachtwoord in.');
            return;
        }

        submitAuth(loginForm, loginError, document.getElementById('login-submit'),
            () => UI.protectedApi('auth/login.php', { login, password }, loginForm));
    });

    registerForm.addEventListener('submit', event => {
        event.preventDefault();
        const username = document.getElementById('register-username').value.trim();
        const email = document.getElementById('register-email').value.trim();
        const password = document.getElementById('register-password').value;

        if (password.length < 8) {
            registerError.textContent = UI.t('Je wachtwoord moet minstens 8 tekens lang zijn.');
            return;
        }

        submitAuth(registerForm, registerError, document.getElementById('register-submit'),
            () => UI.protectedApi('auth/register.php', { username, email, password }, registerForm));
    });

    document.getElementById('account-logout')?.addEventListener('click', async () => {
        const confirmed = await UI.ask({
            title: UI.t('Uitloggen?'),
            message: UI.t('Je tijden blijven in deze browser staan. Bij de volgende login komen ze weer van je account.'),
            confirmLabel: UI.t('Uitloggen'),
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
        UI.toast(UI.t('Je bent uitgelogd.'), { type: 'info' });
    });

    /* =====================================================================
     * Je gegevens: downloaden en account verwijderen
     * ================================================================== */

    // Via fetch in plaats van een gewone link, zodat een fout een nette
    // melding wordt in plaats van een gedownload foutbestand.
    document.getElementById('account-export')?.addEventListener('click', async event => {
        const knop = event.currentTarget;
        knop.disabled = true;
        try {
            const antwoord = await fetch('/api/account/export.php', {
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-Taal': UI.lang }
            });
            if (!antwoord.ok) {
                const fout = await antwoord.json().catch(() => null);
                throw new Error((fout && fout.message) || UI.t('Downloaden lukte niet.'));
            }
            const naam = (/filename="([^"]+)"/.exec(antwoord.headers.get('Content-Disposition') || '') || [])[1]
                || 'cubetimer-gegevens.json';
            const url = URL.createObjectURL(await antwoord.blob());
            const link = document.createElement('a');
            link.href = url;
            link.download = naam;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (err) {
            UI.toast(err.message || UI.t('Downloaden lukte niet.'), { type: 'error' });
        } finally {
            knop.disabled = false;
        }
    });

    document.getElementById('account-delete')?.addEventListener('click', async () => {
        if (!currentUser) return;
        const zeker = await UI.ask({
            title: UI.t('Account verwijderen?'),
            message: UI.t('Je account {naam} wordt meteen verwijderd, met al je tijden op de server, records, XP, achievements, toernooien, duels en volgers. Dat kan niet ongedaan worden gemaakt. Wil je een kopie? Download dan eerst je gegevens. De tijden in deze browser blijven staan.', { naam: currentUser.username }),
            confirmLabel: UI.t('Verder'),
            danger: true
        });
        if (!zeker) return;

        const password = await UI.ask({
            title: UI.t('Bevestig met je wachtwoord'),
            message: UI.t('Vul je wachtwoord in om je account definitief te verwijderen.'),
            input: { label: UI.t('Wachtwoord'), type: 'password' },
            confirmLabel: UI.t('Account verwijderen'),
            danger: true
        });
        if (!password) return;

        // Geen synchronisatie meer op de achtergrond: het account is zo weg.
        window.clearTimeout(syncTimer);
        try {
            const antwoord = await UI.api('account/delete.php', { body: { password } });
            // Die tijden hoeven nergens meer vanaf: het account bestaat niet meer.
            if (api.clearRemovedSolveIds && api.getRemovedSolveIds) api.clearRemovedSolveIds(api.getRemovedSolveIds());
            currentUser = null;
            profile = null;
            looseSolves = 0;
            setSyncState('idle', '');
            renderAccount();
            renderLooseSolves();
            UI.closeModal(modal);
            await announceAuthChange();
            UI.toast(antwoord.message, { type: 'success', duration: 7000 });
        } catch (err) {
            UI.toast(err.message, { type: 'error' });
        }
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
        mailAvailable = status.features?.mail === true;
        verificationAvailable = status.features?.emailVerification === true;
        renderAccount();
        if (!accountsAvailable) return;
        handleMailLink();
        // Staat de site al open en plak je de link erin, dan verandert alleen
        // het stuk na het hekje en laadt de pagina niet opnieuw.
        window.addEventListener('hashchange', handleMailLink);

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
