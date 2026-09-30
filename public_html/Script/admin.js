/**
 * CubeTimer - beheer
 * ---------------------------------------------------------------------------
 * De wachtrij met tijden die niet lijken te kloppen. Alleen zichtbaar voor een
 * account met de rol `admin`:
 *
 *   UPDATE users SET role = 'admin' WHERE username = 'jouwnaam';
 *
 * Zolang een tijd in de wachtrij staat telt hij niet mee voor records en
 * ranglijsten. De gebruiker zelf ziet zijn tijd gewoon in zijn sessie staan;
 * alleen de ranglijst wacht op een oordeel.
 */
(function () {
    'use strict';

    const UI = window.CubeTimerUI;

    const tabButton = document.getElementById('settings-tab-admin');
    const listElement = document.getElementById('admin-flag-list');
    const statusButtons = Array.from(document.querySelectorAll('[data-flag-status]'));
    if (!tabButton || !listElement) return;

    let status = 'pending';
    let isAdmin = false;

    const REASONS = {
        below_world_record: UI.t('Sneller dan het wereldrecord'),
        impossible: UI.t('Onmogelijk kort'),
        too_fast_for_user: UI.t('Sprong te groot'),
        burst: UI.t('Te veel solves achter elkaar')
    };

    function setStatus(next) {
        status = next;
        statusButtons.forEach(button => {
            const isActive = button.dataset.flagStatus === status;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        load();
    }

    async function load() {
        if (!isAdmin) return;

        listElement.innerHTML = '';
        const laden = document.createElement('p');
        laden.className = 'table-empty';
        laden.textContent = UI.t('Laden…');
        listElement.appendChild(laden);

        try {
            const data = await UI.api('admin/flags.php?status=' + encodeURIComponent(status));
            render(data);
        } catch (err) {
            listElement.innerHTML = '';
            const fout = document.createElement('p');
            fout.className = 'table-empty';
            fout.textContent = err.message || UI.t('De wachtrij kon niet geladen worden.');
            listElement.appendChild(fout);
        }
    }

    function render(data) {
        listElement.innerHTML = '';

        tabButton.textContent = data.pending > 0 ? UI.t('Beheer ({n})', { n: data.pending }) : UI.t('Beheer');

        if (!data.flags.length) {
            const leeg = document.createElement('p');
            leeg.className = 'table-empty';
            leeg.textContent = status === 'pending'
                ? UI.t('Niets te beoordelen. Alles ziet er goed uit.')
                : UI.t('Hier staat nog niets.');
            listElement.appendChild(leeg);
            return;
        }

        data.flags.forEach(flag => listElement.appendChild(renderCard(flag)));
    }

    function renderCard(flag) {
        const card = document.createElement('article');
        card.className = 'flag-card';

        const body = document.createElement('div');
        body.className = 'flag-card__body';

        const titel = document.createElement('p');
        titel.className = 'flag-card__title';
        titel.textContent = `${flag.user} · ${flag.eventLabel} · ` +
            (flag.valueMs === null ? 'DNF' : UI.formatTime(flag.valueMs));

        const detail = document.createElement('p');
        detail.className = 'flag-card__detail';
        detail.textContent = `${REASONS[flag.reason] || flag.reason}: ${flag.detail || ''}`;

        body.appendChild(titel);
        body.appendChild(detail);
        card.appendChild(body);

        if (flag.status === 'pending') {
            const acties = document.createElement('div');
            acties.className = 'flag-card__actions';

            const goedkeuren = document.createElement('button');
            goedkeuren.className = 'btn btn--sm';
            goedkeuren.type = 'button';
            goedkeuren.textContent = UI.t('Toch goed');
            goedkeuren.addEventListener('click', () => decide(flag.id, 'approve', goedkeuren));

            const afkeuren = document.createElement('button');
            afkeuren.className = 'btn btn--sm btn--danger';
            afkeuren.type = 'button';
            afkeuren.textContent = UI.t('Afkeuren');
            afkeuren.addEventListener('click', () => decide(flag.id, 'reject', afkeuren));

            acties.appendChild(goedkeuren);
            acties.appendChild(afkeuren);
            card.appendChild(acties);
        } else {
            const label = document.createElement('span');
            label.className = 'field__hint';
            label.textContent = flag.status === 'approved' ? UI.t('Goedgekeurd') : UI.t('Afgekeurd');
            card.appendChild(label);
        }

        return card;
    }

    async function decide(id, decision, button) {
        button.disabled = true;
        try {
            const response = await UI.api('admin/flags.php', { body: { id, decision } });
            UI.toast(response.message, { type: 'success' });
            load();
            window.CubeTimerLeaderboard?.reload?.();
        } catch (err) {
            UI.toast(err.message || UI.t('Dat is niet gelukt.'), { type: 'error' });
            button.disabled = false;
        }
    }

    statusButtons.forEach(button => {
        button.addEventListener('click', () => setStatus(button.dataset.flagStatus));
    });

    // De wachtrij pas ophalen als het tabblad geopend wordt.
    document.querySelector('[data-settings-tab="admin"]')?.addEventListener('click', load);

    function applyStatus(state) {
        isAdmin = state?.admin === true;
        tabButton.hidden = !isAdmin;
        if (isAdmin) {
            load();
        } else {
            tabButton.textContent = 'Beheer';
        }
    }

    UI.status().then(applyStatus);
    window.addEventListener('cubetimer:auth-change', event => applyStatus(event.detail.status));
})();
