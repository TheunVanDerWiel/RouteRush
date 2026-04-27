const code = document.body.dataset.gameCode;
const playerIdInitial = document.body.dataset.playerId
    ? parseInt(document.body.dataset.playerId, 10)
    : null;

const teamList = document.getElementById('team-list');
const gameInfo = document.getElementById('game-info');
const mapNameEl = document.getElementById('map-name');
const durationEl = document.getElementById('duration');

const createSection = document.getElementById('create-team-section');
const createForm = document.getElementById('create-team-form');
const createError = document.getElementById('create-team-error');

const joinSection = document.getElementById('join-team-section');
const joinForm = document.getElementById('join-team-form');
const joinError = document.getElementById('join-team-error');
const joinTeamSelect = joinForm.querySelector('select[name="team_id"]');

const joinedSection = document.getElementById('joined-section');
const joinedSummary = document.getElementById('joined-summary');
const pinDisplay = document.getElementById('pin-display');
const teamPinEl = document.getElementById('team-pin');
const hostControls = document.getElementById('host-controls');
const startBtn = document.getElementById('start-game-btn');
const startError = document.getElementById('start-error');
const waitingHint = document.getElementById('waiting-hint');

const inProgressSection = document.getElementById('in-progress-section');

let myPlayerId = playerIdInitial;
let myTeamId = null;

const POLL_INTERVAL_MS = 5000;
let pollTimer = null;

async function fetchState() {
    const res = await fetch(`/api/games/${encodeURIComponent(code)}`, {
        headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
        teamList.innerHTML = '<li class="empty">Could not load lobby.</li>';
        return null;
    }
    return res.json();
}

function renderTeamList(state) {
    if (!state.teams.length) {
        teamList.innerHTML = '<li class="empty">No teams yet — be the first.</li>';
        return;
    }
    teamList.innerHTML = '';
    for (const t of state.teams) {
        const li = document.createElement('li');
        li.dataset.colorIndex = String(t.color_index);
        if (myTeamId !== null && t.id === myTeamId) {
            li.classList.add('you');
        }
        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = t.name;
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = `${t.player_count} player${t.player_count === 1 ? '' : 's'}`;
        li.append(swatch, name, meta);
        teamList.appendChild(li);
    }
}

function syncJoinTeamSelect(state) {
    const previous = joinTeamSelect.value;
    joinTeamSelect.innerHTML = '<option value="">Select a team…</option>';
    for (const t of state.teams) {
        const opt = document.createElement('option');
        opt.value = String(t.id);
        opt.textContent = t.name;
        joinTeamSelect.appendChild(opt);
    }
    if (previous && state.teams.some((t) => String(t.id) === previous)) {
        joinTeamSelect.value = previous;
    }
}

function renderState(state) {
    mapNameEl.textContent = state.map.name;
    durationEl.textContent = Math.round(state.duration_seconds / 60);
    gameInfo.hidden = false;

    if (state.you) {
        myPlayerId = state.you.player_id;
        myTeamId = state.you.team_id;
    }

    renderTeamList(state);

    const inProgress = state.status !== 'lobby';
    const joined = myTeamId !== null;
    const isHost = state.you?.is_host === true;

    inProgressSection.hidden = !inProgress;
    createSection.hidden = inProgress || joined;
    joinSection.hidden = inProgress || joined;
    joinedSection.hidden = inProgress || !joined;

    if (joined && !inProgress) {
        const me = state.teams.find((t) => t.id === myTeamId);
        if (me) {
            joinedSummary.textContent = `You're on team "${me.name}"${isHost ? ' (host)' : ''}.`;
        }
        hostControls.hidden = !isHost;
        waitingHint.hidden = isHost;
    }

    if (!joined && !inProgress) {
        syncJoinTeamSelect(state);
    }
}

async function tick() {
    try {
        const state = await fetchState();
        if (state) renderState(state);
    } finally {
        pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    }
}

createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    createError.textContent = '';
    const submit = createForm.querySelector('button[type="submit"]');
    submit.disabled = true;

    const fd = new FormData(createForm);
    const teamName = (fd.get('team_name') || '').toString().trim();
    const playerName = (fd.get('player_name') || '').toString().trim();

    if (!teamName || !playerName) {
        createError.textContent = 'Please fill in both names.';
        submit.disabled = false;
        return;
    }

    try {
        const res = await fetch(`/api/games/${encodeURIComponent(code)}/teams`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ team_name: teamName, player_name: playerName }),
        });
        const data = await res.json();
        if (!res.ok) {
            createError.textContent = data.message || 'Could not create team.';
            submit.disabled = false;
            return;
        }
        myTeamId = data.team_id;
        myPlayerId = data.player_id;
        teamPinEl.textContent = data.pin;
        pinDisplay.hidden = false;
        const state = await fetchState();
        if (state) renderState(state);
    } catch {
        createError.textContent = 'Network error. Please try again.';
        submit.disabled = false;
    }
});

joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    joinError.textContent = '';
    const submit = joinForm.querySelector('button[type="submit"]');
    submit.disabled = true;

    const fd = new FormData(joinForm);
    const teamId = parseInt(fd.get('team_id'), 10);
    const playerName = (fd.get('player_name') || '').toString().trim();
    const pin = (fd.get('pin') || '').toString();

    if (!Number.isInteger(teamId)) {
        joinError.textContent = 'Pick a team.';
        submit.disabled = false;
        return;
    }
    if (!playerName) {
        joinError.textContent = 'Enter your name.';
        submit.disabled = false;
        return;
    }
    if (!/^\d{4}$/.test(pin)) {
        joinError.textContent = 'PIN must be exactly 4 digits.';
        submit.disabled = false;
        return;
    }

    try {
        const res = await fetch(
            `/api/games/${encodeURIComponent(code)}/teams/${teamId}/join`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ player_name: playerName, pin }),
            },
        );
        const data = await res.json();
        if (!res.ok) {
            if (res.status === 429) {
                joinError.textContent = 'Too many wrong attempts. Wait a few seconds.';
            } else if (res.status === 401) {
                joinError.textContent = 'Wrong PIN.';
            } else {
                joinError.textContent = data.message || 'Could not join.';
            }
            submit.disabled = false;
            return;
        }
        myTeamId = data.team_id;
        myPlayerId = data.player_id;
        const state = await fetchState();
        if (state) renderState(state);
    } catch {
        joinError.textContent = 'Network error. Please try again.';
        submit.disabled = false;
    }
});

startBtn.addEventListener('click', async () => {
    startError.textContent = '';
    startBtn.disabled = true;
    try {
        const res = await fetch(`/api/games/${encodeURIComponent(code)}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });
        const data = await res.json();
        if (!res.ok) {
            startError.textContent = data.message || 'Could not start game.';
            startBtn.disabled = false;
            return;
        }
        const state = await fetchState();
        if (state) renderState(state);
    } catch {
        startError.textContent = 'Network error. Please try again.';
        startBtn.disabled = false;
    }
});

tick();
