import { loadSession, clearSession } from './session.js';

const createForm = document.getElementById('create-game-form');
const createError = document.getElementById('create-error');
const joinForm = document.getElementById('join-form');
const joinError = document.getElementById('join-error');

// On page load, if we still have a saved session, try to silently rejoin
// the user's last game. Lobby → /lobby, in_progress (not yet expired) →
// /game, otherwise drop the saved session.
(async function tryAutoRejoin() {
    const sess = loadSession();
    if (!sess) return;

    let stateRes;
    try {
        stateRes = await fetch(`/api/games/${encodeURIComponent(sess.code)}`, {
            headers: { Accept: 'application/json' },
        });
    } catch {
        return;
    }
    if (!stateRes.ok) {
        if (stateRes.status === 404) clearSession();
        return;
    }

    let state = null;
    try { state = await stateRes.json(); } catch { /* ignore */ }
    if (!state) return;

    if (state.status === 'ended') {
        clearSession();
        return;
    }
    if (state.status === 'in_progress' && state.ends_at) {
        const endsAtMs = Date.parse(state.ends_at);
        if (!isNaN(endsAtMs) && Date.now() >= endsAtMs) {
            clearSession();
            return;
        }
    }

    // Re-establish the server-side session by hitting the join endpoint.
    let joinRes;
    try {
        joinRes = await fetch(
            `/api/games/${encodeURIComponent(sess.code)}/teams/${sess.team_id}/join`,
            {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ player_name: sess.player_name, pin: sess.pin }),
            },
        );
    } catch {
        return;
    }
    if (!joinRes.ok) {
        // Wrong PIN, missing team, ended game — saved data is stale.
        if (joinRes.status === 401 || joinRes.status === 404 || joinRes.status === 409) {
            clearSession();
        }
        return;
    }

    const target = state.status === 'lobby'
        ? `/lobby/${encodeURIComponent(sess.code)}`
        : `/game/${encodeURIComponent(sess.code)}`;
    window.location.href = target;
})();

createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    createError.textContent = '';
    const submit = createForm.querySelector('button[type="submit"]');
    submit.disabled = true;

    const fd = new FormData(createForm);
    const mapId = parseInt(fd.get('map_id'), 10);
    const minutes = parseInt(fd.get('duration_minutes'), 10);

    if (!Number.isInteger(mapId) || !Number.isInteger(minutes) || minutes <= 0 || minutes % 15 !== 0) {
        createError.textContent = 'Please pick a map and a duration in 15-minute steps.';
        submit.disabled = false;
        return;
    }

    try {
        const res = await fetch('/api/games', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ map_id: mapId, duration_seconds: minutes * 60 }),
        });
        const data = await res.json();
        if (!res.ok) {
            createError.textContent = data.message || 'Could not create the game.';
            submit.disabled = false;
            return;
        }
        window.location.href = `/lobby/${data.room_code}`;
    } catch {
        createError.textContent = 'Network error. Please try again.';
        submit.disabled = false;
    }
});

joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    joinError.textContent = '';
    const code = (new FormData(joinForm).get('code') || '').toString().toUpperCase().trim();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
        joinError.textContent = 'Room codes are 6 letters/digits.';
        return;
    }
    window.location.href = `/lobby/${code}`;
});
