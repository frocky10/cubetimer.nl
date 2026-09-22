/**
 * CubeTimer - bug- en ideeënknop
 * ---------------------------------------------------------------------------
 * Stuurt een melding naar /api/feedback/report.php, dat er een GitHub-issue van
 * maakt. Het GitHub-token staat op de server; de browser krijgt het nooit te
 * zien.
 *
 * Is de server niet ingesteld (geen token), dan verdwijnt de knop uit de
 * topbar in plaats van een foutmelding te geven.
 */
(function () {
    'use strict';

    const UI = window.CubeTimerUI;

    const openButton = document.getElementById('feedback-open');
    const modal = document.getElementById('feedback-modal');
    const form = document.getElementById('feedback-form');
    const successPanel = document.getElementById('feedback-success');
    const successText = document.getElementById('feedback-success-text');
    const issueLink = document.getElementById('feedback-issue-link');
    const errorField = document.getElementById('feedback-error');
    const submitButton = document.getElementById('feedback-submit');
    const typeButtons = Array.from(document.querySelectorAll('[data-feedback-type]'));

    const titleField = document.getElementById('feedback-title');
    const descriptionField = document.getElementById('feedback-description');
    const descriptionLabel = document.getElementById('feedback-description-label');
    const stepsField = document.getElementById('feedback-steps-field');
    const expectedFieldWrap = document.getElementById('feedback-expected-field');

    if (!openButton || !modal || !form) return;

    let currentType = 'bug';
    let sending = false;

    /* ---------------------------------------------------------------------
     * Soort melding
     * ------------------------------------------------------------------ */

    function setType(type) {
        currentType = type === 'feature' ? 'feature' : 'bug';

        typeButtons.forEach(button => {
            const isActive = button.dataset.feedbackType === currentType;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        const isBug = currentType === 'bug';
        descriptionLabel.textContent = isBug ? 'Wat gaat er mis?' : 'Wat zou je graag willen?';
        descriptionField.placeholder = isBug
            ? 'Beschrijf zo precies mogelijk wat je ziet.'
            : 'Beschrijf je idee. Wat zou het je opleveren?';
        titleField.placeholder = isBug ? 'Korte samenvatting van de bug' : 'Korte samenvatting van je idee';

        // Reproductiestappen zijn alleen zinnig bij een bug.
        stepsField.hidden = !isBug;
        expectedFieldWrap.hidden = !isBug;
    }

    typeButtons.forEach(button => {
        button.addEventListener('click', () => setType(button.dataset.feedbackType));
    });

    /* ---------------------------------------------------------------------
     * Technische context, zodat een melding te reproduceren is
     * ------------------------------------------------------------------ */

    function collectContext() {
        const state = window.cubeTimerApi?.getState?.() || {};
        let timezone = '';
        try {
            timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        } catch (err) {
            timezone = '';
        }

        return {
            url: window.location.href,
            userAgent: navigator.userAgent,
            screen: `${window.innerWidth}x${window.innerHeight} (scherm ${window.screen?.width || '?'}x${window.screen?.height || '?'}, dpr ${window.devicePixelRatio || 1})`,
            language: navigator.language || '',
            timezone,
            theme: document.documentElement.getAttribute('data-theme') || '',
            event: state.activeEvent || '',
            solveCount: String(window.cubeTimerApi?.getSessions?.()
                .find(session => session.id === window.cubeTimerApi.getActiveSessionId())?.times.length ?? 0),
            bluetooth: state.bluetoothSupported ? 'ondersteund voor dit event' : 'niet van toepassing'
        };
    }

    /* ---------------------------------------------------------------------
     * Openen en sluiten
     * ------------------------------------------------------------------ */

    function open() {
        errorField.textContent = '';
        form.hidden = false;
        successPanel.hidden = true;
        UI.openModal(modal);
    }

    function close() {
        UI.closeModal(modal);
    }

    function reset() {
        form.reset();
        setType('bug');
        errorField.textContent = '';
        form.hidden = false;
        successPanel.hidden = true;
    }

    openButton.addEventListener('click', open);
    document.querySelectorAll('[data-close-feedback]').forEach(button => {
        button.addEventListener('click', close);
    });
    UI.registerModal(modal, close);

    // Pas legen als de modal echt dicht is, anders ziet de bezoeker het veld
    // leegspringen tijdens de animatie.
    modal.addEventListener('transitionend', () => {
        if (!modal.classList.contains('visible')) reset();
    });

    /* ---------------------------------------------------------------------
     * Versturen
     * ------------------------------------------------------------------ */

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (sending) return;

        const title = titleField.value.trim();
        const description = descriptionField.value.trim();

        if (title.length < 5) {
            errorField.textContent = 'Geef je melding een titel van minstens 5 tekens.';
            titleField.focus();
            return;
        }
        if (description.length < 10) {
            errorField.textContent = 'Vertel iets meer, zodat we het kunnen nabootsen.';
            descriptionField.focus();
            return;
        }

        sending = true;
        errorField.textContent = '';
        submitButton.disabled = true;
        submitButton.textContent = 'Versturen…';

        try {
            const response = await UI.api('feedback/report.php', {
                body: {
                    type: currentType,
                    title,
                    description,
                    steps: document.getElementById('feedback-steps').value.trim(),
                    expected: document.getElementById('feedback-expected').value.trim(),
                    email: document.getElementById('feedback-email').value.trim(),
                    website: document.getElementById('feedback-website').value,
                    context: collectContext()
                }
            });

            form.hidden = true;
            successPanel.hidden = false;
            successText.textContent = response.message || 'Je melding is doorgestuurd.';

            if (response.issue && response.issue.url) {
                issueLink.hidden = false;
                issueLink.href = response.issue.url;
            } else {
                issueLink.hidden = true;
            }
        } catch (err) {
            errorField.textContent = err.message || 'Versturen is niet gelukt. Probeer het later nog eens.';
        } finally {
            sending = false;
            submitButton.disabled = false;
            submitButton.textContent = 'Versturen';
        }
    });

    setType('bug');

    /* ---------------------------------------------------------------------
     * Alleen tonen als de server het aankan
     * ------------------------------------------------------------------ */

    UI.status().then(status => {
        // Geen token op de server of geen API bereikbaar: knop weghalen in
        // plaats van de bezoeker in een foutmelding laten lopen.
        openButton.hidden = !status.features?.feedback;
    });
})();
