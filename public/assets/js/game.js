import { clearSession } from './session.js';
import { renderMap as renderMapModule, applyClaims as applyClaimsModule } from './map-render.js';

const code = document.body.dataset.gameCode;
const countdownEl = document.getElementById('countdown');
const handEl = document.getElementById('hand');
const mapFrameEl = document.getElementById('map-frame');
const ticketsKeptEl = document.getElementById('tickets-kept');
const ticketsEmptyEl = document.getElementById('tickets-empty');
const ticketsPendingEl = document.getElementById('tickets-pending');
const ticketsPendingListEl = document.getElementById('tickets-pending-list');
const ticketsMinKeepEl = document.getElementById('tickets-min-keep');
const ticketsDecideBtn = document.getElementById('tickets-decide-btn');
const ticketsDecideErrorEl = document.getElementById('tickets-decide-error');
const windowsAvailableEl = document.getElementById('windows-available');
const nextWindowEl = document.getElementById('next-window');
const btnDrawCards = document.getElementById('btn-draw-cards');
const btnDrawTickets = document.getElementById('btn-draw-tickets');
const btnTrade32 = document.getElementById('btn-trade-3-2');
const btnTrade3Loco = document.getElementById('btn-trade-3-loco');
const gameContainerEl = document.getElementById('game-container');
const scoreboardEl = document.getElementById('scoreboard');
const scoreboardListEl = document.getElementById('scoreboard-list');
const activityListEl = document.getElementById('activity-list');

const POLL_INTERVAL_MS = 5000;

const TEAM_COLORS = (() => {
    const cs = getComputedStyle(document.documentElement);
    const out = [];
    for (let i = 0; i < 5; i++) {
        out.push((cs.getPropertyValue(`--team-color-${i}`) || '').trim() || '#888');
    }
    return out;
})();

let endsAtMs = null;
let nextWindowAtMs = null;
let mapData = null;
let lastState = null;
let pendingChoices = new Map();   // ticket_id -> 'keep' | 'discard'
let lastPendingKey = '';          // signature of last seen pending set; triggers reminder on change
let reminderOpen = false;
let selectedTicketId = null;      // currently highlighted kept ticket, or null

async function fetchMap() {
    const res = await fetch(`/api/games/${encodeURIComponent(code)}/map`, {
        headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return res.json();
}

async function fetchState() {
    const res = await fetch(`/api/games/${encodeURIComponent(code)}/state`, {
        headers: { Accept: 'application/json' },
    });
    if (res.status === 403) {
        window.location.href = `/lobby/${encodeURIComponent(code)}`;
        return null;
    }
    if (!res.ok) return null;
    return res.json();
}

function renderHand(state) {
    if (!mapData) return;
    handEl.innerHTML = '';
    const hand = state.team.hand || {};
    for (const color of mapData.colors) {
        const count = hand[String(color.id)] || 0;
        handEl.appendChild(makePill({
            label: color.display_name,
            count,
            swatchStyle: `background: ${color.hex};`,
        }));
    }
    handEl.appendChild(makePill({
        label: 'Loco',
        count: state.team.locomotives_in_hand || 0,
        loco: true,
    }));
}

function makePill({ label, count, swatchStyle, loco = false }) {
    const li = document.createElement('li');
    li.className = 'hand-card-pill';

    const swatch = document.createElement('span');
    swatch.className = 'card-color-swatch' + (loco ? ' loco-swatch' : '');
    swatch.setAttribute('aria-hidden', 'true');
    if (swatchStyle) swatch.style.cssText = swatchStyle;

    const name = document.createElement('span');
    name.className = 'card-color-name';
    name.textContent = label;

    const countEl = document.createElement('span');
    countEl.className = 'card-count mono';
    countEl.textContent = String(count);

    li.append(swatch, name, countEl);
    return li;
}

function renderMap(map) {
    renderMapModule(mapFrameEl, map, { onRouteClick });
}

// Map rendering helpers now live in map-render.js. See renderMap() above
// and the applyClaims() call inside renderState().

function renderState(state) {
    lastState = state;
    if (state.game.ends_at) {
        endsAtMs = Date.parse(state.game.ends_at);
    }
    renderHand(state);
    renderTickets(state);
    renderWindows(state);
    applyClaims(state.claims || []);
    renderActivity(state);
    if (state.game.status === 'ended') {
        showScoreboard(state);
    }
}

function renderActivity(state) {
    const claims = state.claims || [];
    const startedAt = state.game && state.game.started_at;
    const status    = state.game && state.game.status;

    const items = [];
    for (const c of claims) {
        items.push({ kind: 'claim', ts: c.claimed_at, claim: c });
    }
    if (startedAt && status !== 'lobby') {
        items.push({ kind: 'start', ts: startedAt });
    }
    // Newest first.
    items.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

    activityListEl.replaceChildren();
    for (const it of items) {
        activityListEl.appendChild(renderActivityRow(it));
    }
}

function renderActivityRow(item) {
    const li = document.createElement('li');
    li.className = 'log-row';

    const time = document.createElement('span');
    time.className = 'log-time mono';
    time.textContent = formatActivityTime(item.ts);
    li.appendChild(time);

    const body = document.createElement('span');
    body.className = 'log-body';
    if (item.kind === 'start') {
        body.textContent = 'Game started';
    } else {
        const c = item.claim;
        const teamBg = TEAM_COLORS[c.team_color_index] || '#888';
        body.appendChild(makeActivityBadge(c.team_name || `Team ${c.team_color_index + 1}`, teamBg));
        body.appendChild(document.createTextNode(' claimed '));

        const route = mapData ? mapData.routes.find((r) => r.id === c.route_id) : null;
        if (route) {
            const routeColor = mapData.colors.find((cc) => cc.id === route.color_id);
            const text = `${stopName(route.from_stop_id)} → ${stopName(route.to_stop_id)}`;
            const bg = routeColor ? routeColor.hex : '#888';
            body.appendChild(makeActivityBadge(text, bg));
        }
    }
    li.appendChild(body);
    return li;
}

function makeActivityBadge(text, bgHex) {
    const span = document.createElement('span');
    span.className = 'activity-badge';
    span.textContent = text;
    span.style.background = bgHex;
    span.style.color = pickTextColor(bgHex);
    return span;
}

function pickTextColor(hex) {
    const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
    if (!m) return '#ffffff';
    const r = parseInt(m[1].slice(0, 2), 16);
    const g = parseInt(m[1].slice(2, 4), 16);
    const b = parseInt(m[1].slice(4, 6), 16);
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    return l > 150 ? '#111111' : '#ffffff';
}

function formatActivityTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function showScoreboard(state) {
    if (!state.final) return;
    document.body.classList.add('game-over');
    scoreboardEl.hidden = false;
    scoreboardListEl.replaceChildren();
    state.final.teams.forEach((team, idx) => {
        scoreboardListEl.appendChild(renderScoreboardTeam(team, idx + 1));
    });
}

function renderScoreboardTeam(team, rank) {
    const li = document.createElement('li');
    li.className = `scoreboard-team rank-${rank}`;

    const head = document.createElement('div');
    head.className = 'scoreboard-head';
    const rankEl = document.createElement('span');
    rankEl.className = 'scoreboard-rank';
    rankEl.textContent = `#${rank}`;
    const swatch = document.createElement('span');
    swatch.className = 'scoreboard-swatch';
    swatch.style.background = TEAM_COLORS[team.color_index] || '#888';
    const name = document.createElement('span');
    name.className = 'scoreboard-name';
    name.textContent = team.name;
    const total = document.createElement('span');
    total.className = 'scoreboard-total';
    total.textContent = String(team.total);
    head.append(rankEl, swatch, name, total);
    li.appendChild(head);

    const dl = document.createElement('dl');
    dl.className = 'scoreboard-breakdown';
    addBreakdownRow(dl, 'Route points', `+${team.route_points}`);
    addBreakdownRow(dl, 'Ticket points', `+${team.ticket_points}`);
    if (team.ticket_penalties > 0) {
        addBreakdownRow(dl, 'Ticket penalties', `−${team.ticket_penalties}`);
    }
    const longestLabel = team.longest_bonus > 0
        ? `Longest route (${team.longest_route_length})`
        : `Longest route (${team.longest_route_length})`;
    addBreakdownRow(dl, longestLabel, team.longest_bonus > 0 ? `+${team.longest_bonus}` : '—');
    li.appendChild(dl);

    if (team.tickets && team.tickets.length > 0) {
        const ul = document.createElement('ul');
        ul.className = 'scoreboard-tickets';
        for (const t of team.tickets) {
            const tli = document.createElement('li');
            tli.className = 'scoreboard-ticket' + (t.completed ? ' completed' : ' failed');
            const route = document.createElement('span');
            route.textContent = `${stopName(t.from_stop_id)} → ${stopName(t.to_stop_id)}`;
            if (t.is_long_route) {
                const badge = document.createElement('span');
                badge.className = 'badge';
                badge.textContent = 'long';
                route.append(' ', badge);
            }
            const pts = document.createElement('span');
            pts.className = 'scoreboard-ticket-points';
            pts.textContent = t.completed ? `+${t.points}` : `−${t.points}`;
            tli.append(route, pts);
            ul.appendChild(tli);
        }
        li.appendChild(ul);
    }

    return li;
}

function addBreakdownRow(dl, label, value) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
}

function renderWindows(state) {
    const team = state.team || {};
    const available = team.windows_available;
    windowsAvailableEl.textContent = (typeof available === 'number') ? String(available) : '—';
    if (typeof team.next_window_in_seconds === 'number') {
        nextWindowAtMs = Date.now() + team.next_window_in_seconds * 1000;
    } else {
        nextWindowAtMs = null;
        nextWindowEl.textContent = '--:--';
    }
    updateActionButtons(state);
}

function updateActionButtons(state) {
    const inProgress = state.game && state.game.status === 'in_progress';
    const blocked    = !inProgress || hasPendingTickets(state);
    const team       = state.team || {};
    const windows    = team.windows_available || 0;
    const deck       = (state.game && state.game.deck_remaining) || 0;
    const totalHand  = totalHandCards(team);
    const maxColor   = maxColorInHand(team);
    btnDrawCards.disabled   = blocked || windows <= 0 || deck <= 0;
    btnDrawTickets.disabled = blocked || windows <= 0;
    btnTrade32.disabled     = blocked || totalHand < 3;
    btnTrade3Loco.disabled  = blocked || maxColor < 3 || (state.game.locomotives_remaining || 0) <= 0;
}

function totalHandCards(team) {
    const hand = team.hand || {};
    let n = team.locomotives_in_hand || 0;
    for (const k of Object.keys(hand)) n += hand[k] || 0;
    return n;
}

function maxColorInHand(team) {
    const hand = team.hand || {};
    let m = 0;
    for (const k of Object.keys(hand)) m = Math.max(m, hand[k] || 0);
    return m;
}

function hasPendingTickets(state) {
    return !!(state && state.team && (state.team.pending_tickets || []).length > 0);
}

function stopName(stopId) {
    if (!mapData) return `#${stopId}`;
    const s = mapData.stops.find((x) => x.id === stopId);
    return s ? s.display_name : `#${stopId}`;
}

function renderTickets(state) {
    const team = state.team || {};
    const kept = team.tickets || [];
    const pending = team.pending_tickets || [];

    // Drop a stale selection if the ticket is no longer kept.
    if (selectedTicketId !== null && !kept.find((t) => t.id === selectedTicketId)) {
        selectedTicketId = null;
    }

    ticketsKeptEl.replaceChildren();
    if (kept.length === 0) {
        ticketsKeptEl.appendChild(ticketsEmptyEl);
    } else {
        for (const t of kept) {
            ticketsKeptEl.appendChild(renderTicketRow(t, false));
        }
    }
    applyStopHighlight();

    const pendingKey = pending.map((t) => t.id).sort((a, b) => a - b).join(',');
    if (pendingKey !== lastPendingKey) {
        // New batch (or none): reset choices; default to discard.
        pendingChoices = new Map();
        for (const t of pending) pendingChoices.set(t.id, 'discard');
        lastPendingKey = pendingKey;
        if (pending.length > 0 && !reminderOpen) {
            showTicketsReminder('You have new tickets to decide. Pick which to keep, then confirm.');
        }
    }

    if (pending.length === 0) {
        ticketsPendingEl.hidden = true;
        ticketsDecideErrorEl.textContent = '';
        return;
    }

    ticketsPendingEl.hidden = false;
    const minKeep = (typeof team.tickets_min_keep === 'number' && team.tickets_min_keep > 0)
        ? team.tickets_min_keep
        : (kept.length === 0 ? 2 : 1);
    ticketsMinKeepEl.textContent = String(minKeep);

    ticketsPendingListEl.replaceChildren();
    for (const t of pending) {
        ticketsPendingListEl.appendChild(renderTicketRow(t, true));
    }
    updateDecideButton(minKeep);
}

function renderTicketRow(t, isPending) {
    const li = document.createElement('li');
    li.className = 'ticket-row' + (t.is_long_route ? ' long' : '');
    if (!isPending && t.id === selectedTicketId) {
        li.classList.add('selected');
    }

    const info = document.createElement('div');
    info.className = 'ticket-info';
    const route = document.createElement('span');
    route.className = 'ticket-route';
    route.textContent = `${stopName(t.from_stop_id)} → ${stopName(t.to_stop_id)}`;
    if (t.is_long_route) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'long';
        route.append(' ', badge);
    }
    const points = document.createElement('span');
    points.className = 'ticket-points mono';
    points.textContent = `${t.points} pts`;
    info.append(route, points);
    li.appendChild(info);

    if (!isPending) {
        li.classList.add('selectable');
        li.addEventListener('click', () => toggleTicketSelection(t.id));
    }

    if (isPending) {
        const toggle = document.createElement('div');
        toggle.className = 'ticket-toggle';
        const keepBtn = document.createElement('button');
        keepBtn.type = 'button';
        keepBtn.textContent = 'Keep';
        const discardBtn = document.createElement('button');
        discardBtn.type = 'button';
        discardBtn.textContent = 'Discard';
        const sync = () => {
            const choice = pendingChoices.get(t.id) || 'discard';
            keepBtn.classList.toggle('active', choice === 'keep');
            discardBtn.classList.toggle('active', choice === 'discard');
        };
        keepBtn.addEventListener('click', () => {
            pendingChoices.set(t.id, 'keep');
            sync();
            updateDecideButton();
        });
        discardBtn.addEventListener('click', () => {
            pendingChoices.set(t.id, 'discard');
            sync();
            updateDecideButton();
        });
        toggle.append(keepBtn, discardBtn);
        li.appendChild(toggle);
        sync();
    }
    return li;
}

function toggleTicketSelection(id) {
    selectedTicketId = (selectedTicketId === id) ? null : id;
    if (lastState) renderTickets(lastState);
}

function applyStopHighlight() {
    if (!mapData) return;
    let fromId = null;
    let toId = null;
    if (selectedTicketId !== null && lastState && lastState.team) {
        const t = (lastState.team.tickets || []).find((x) => x.id === selectedTicketId);
        if (t) {
            fromId = t.from_stop_id;
            toId   = t.to_stop_id;
        }
    }
    for (const g of mapFrameEl.querySelectorAll('.stop')) {
        const sid = parseInt(g.dataset.stopId, 10);
        g.classList.toggle('highlighted', sid === fromId || sid === toId);
    }
}

function updateDecideButton(minKeepArg) {
    const minKeep = minKeepArg !== undefined
        ? minKeepArg
        : parseInt(ticketsMinKeepEl.textContent, 10) || 1;
    let kept = 0;
    for (const v of pendingChoices.values()) if (v === 'keep') kept++;
    ticketsDecideBtn.disabled = kept < minKeep;
    if (kept < minKeep) {
        ticketsDecideErrorEl.textContent = `Keep at least ${minKeep} ticket${minKeep > 1 ? 's' : ''}.`;
    } else {
        ticketsDecideErrorEl.textContent = '';
    }
}

async function submitDecision() {
    const keepIds = [];
    for (const [id, choice] of pendingChoices) {
        if (choice === 'keep') keepIds.push(id);
    }
    ticketsDecideBtn.disabled = true;
    const res = await fetch(`/api/games/${encodeURIComponent(code)}/tickets/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep_ids: keepIds }),
    });
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
        ticketsDecideErrorEl.textContent = (data && data.message) || 'Could not save choice.';
        ticketsDecideBtn.disabled = false;
        return;
    }
    const next = await fetchState();
    if (next) renderState(next);
}

async function onTrade(kind) {
    if (hasPendingTickets(lastState)) {
        showTicketsReminder('Decide on your tickets before trading.');
        return;
    }
    const fresh = await fetchState();
    if (!fresh) return;
    renderState(fresh);
    if (fresh.game.status !== 'in_progress') {
        window.alert('Game is not in progress.');
        return;
    }
    if (hasPendingTickets(fresh)) {
        showTicketsReminder('Decide on your tickets before trading.');
        return;
    }
    const choice = await openTradeDialog(kind, fresh);
    if (!choice) return;
    const res = await fetch(`/api/games/${encodeURIComponent(code)}/trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            kind,
            spend: choice.spend,
            spend_locomotives: choice.spend_locomotives,
        }),
    });
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
        window.alert((data && data.message) || 'Could not trade.');
        const next = await fetchState();
        if (next) renderState(next);
        return;
    }
    const next = await fetchState();
    if (next) renderState(next);
    showDrewDialog(data.received_colors || [], data.received_locomotives || 0);
}

function openTradeDialog(kind, state) {
    return new Promise((resolve) => {
        const team = state.team || {};
        const hand = team.hand || {};
        const haveLoco = team.locomotives_in_hand || 0;
        const colors = (mapData ? mapData.colors : []).map((c) => ({
            id: c.id,
            name: c.display_name,
            hex: /^#[0-9a-fA-F]{6}$/.test(c.hex) ? c.hex : '#888',
            have: hand[String(c.id)] || 0,
        }));

        // chosen[color_id] = count, plus '_loco' for locomotives
        const chosen = {};
        for (const c of colors) chosen[c.id] = 0;
        let chosenLoco = 0;

        const dlg = document.createElement('dialog');
        dlg.className = 'claim-dialog';

        const form = document.createElement('form');
        form.method = 'dialog';

        const title = document.createElement('h3');
        title.className = 'claim-title';
        title.textContent = kind === 'any3for2'
            ? 'Trade 3 cards for 2 random'
            : 'Trade 3 same-color cards for 1 locomotive';
        form.appendChild(title);

        const hint = document.createElement('p');
        hint.className = 'claim-totals';
        hint.textContent = kind === 'any3for2'
            ? 'Pick any 3 cards (locomotives allowed).'
            : 'Pick 3 cards of the same color (no locomotives).';
        form.appendChild(hint);

        const list = document.createElement('div');
        list.className = 'trade-list';
        form.appendChild(list);

        const totals = document.createElement('p');
        totals.className = 'claim-totals';
        form.appendChild(totals);

        const error = document.createElement('p');
        error.className = 'error';
        form.appendChild(error);

        const menu = document.createElement('div');
        menu.className = 'claim-menu';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'claim-cancel';
        cancel.textContent = 'Cancel';
        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = 'claim-confirm';
        confirm.textContent = 'Trade';
        menu.append(cancel, confirm);
        form.appendChild(menu);

        const renderRows = () => {
            list.replaceChildren();
            for (const c of colors) {
                if (c.have <= 0) continue;
                list.appendChild(stepperRow(c.name, c.hex, c.have, () => chosen[c.id], (delta) => {
                    chosen[c.id] = clamp(chosen[c.id] + delta, 0, c.have);
                    update();
                }));
            }
            if (kind === 'any3for2' && haveLoco > 0) {
                list.appendChild(stepperRow('Locomotive', null, haveLoco, () => chosenLoco, (delta) => {
                    chosenLoco = clamp(chosenLoco + delta, 0, haveLoco);
                    update();
                }));
            }
        };

        const update = () => {
            for (const child of list.children) {
                const sync = child._sync;
                if (sync) sync();
            }
            const colorsPicked = Object.keys(chosen).reduce((s, k) => s + chosen[k], 0);
            const total = colorsPicked + chosenLoco;
            totals.textContent = `Picked ${total} of 3.`;
            let ok = total === 3;
            if (kind === 'same3forLoco') {
                const distinct = Object.values(chosen).filter((v) => v > 0).length;
                if (chosenLoco > 0 || distinct !== 1 || colorsPicked !== 3) ok = false;
                error.textContent = (chosenLoco > 0)
                    ? 'No locomotives in this trade.'
                    : (total === 3 && distinct !== 1)
                        ? 'All 3 must be the same color.'
                        : '';
            } else {
                error.textContent = '';
            }
            confirm.disabled = !ok;
        };

        renderRows();
        update();

        cancel.addEventListener('click', () => dlg.close('cancel'));
        confirm.addEventListener('click', () => dlg.close('confirm'));

        dlg.appendChild(form);
        document.body.appendChild(dlg);

        dlg.addEventListener('close', () => {
            const value = dlg.returnValue;
            dlg.remove();
            if (value !== 'confirm') {
                resolve(null);
                return;
            }
            const spend = {};
            for (const k of Object.keys(chosen)) {
                if (chosen[k] > 0) spend[k] = chosen[k];
            }
            resolve({ spend, spend_locomotives: chosenLoco });
        });

        dlg.showModal();
    });
}

function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
}

function stepperRow(label, hex, have, getValue, onDelta) {
    const row = document.createElement('div');
    row.className = 'claim-stepper-row';

    const left = document.createElement('span');
    left.style.display = 'inline-flex';
    left.style.alignItems = 'center';
    left.style.gap = '8px';
    if (hex !== null) {
        const swatch = document.createElement('span');
        swatch.className = 'claim-swatch';
        swatch.style.background = hex;
        left.appendChild(swatch);
    }
    const name = document.createElement('span');
    name.textContent = `${label} (have ${have})`;
    left.appendChild(name);
    row.appendChild(left);

    const stepper = document.createElement('div');
    stepper.className = 'claim-stepper';
    const dec = document.createElement('button');
    dec.type = 'button';
    dec.className = 'step-btn';
    dec.textContent = '\u2212';
    const out = document.createElement('output');
    out.className = 'step-out mono';
    const inc = document.createElement('button');
    inc.type = 'button';
    inc.className = 'step-btn';
    inc.textContent = '+';
    stepper.append(dec, out, inc);
    row.appendChild(stepper);

    dec.addEventListener('click', () => onDelta(-1));
    inc.addEventListener('click', () => onDelta(+1));

    row._sync = () => {
        const v = getValue();
        out.textContent = String(v);
        dec.disabled = v <= 0;
        inc.disabled = v >= have;
    };
    return row;
}

async function onDrawTickets() {
    if (hasPendingTickets(lastState)) {
        showTicketsReminder('Decide on your tickets before drawing more.');
        return;
    }
    btnDrawTickets.disabled = true;
    const res = await fetch(`/api/games/${encodeURIComponent(code)}/draw/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    });
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
        window.alert((data && data.message) || 'Could not draw tickets.');
        const next = await fetchState();
        if (next) renderState(next);
        return;
    }
    const next = await fetchState();
    if (next) renderState(next);
    // Reminder modal is auto-shown by renderTickets when new pending arrive.
}

async function onDrawCards() {
    if (hasPendingTickets(lastState)) {
        showTicketsReminder('Decide on your tickets before drawing cards.');
        return;
    }
    btnDrawCards.disabled = true;
    const res = await fetch(`/api/games/${encodeURIComponent(code)}/draw/cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    });
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
        window.alert((data && data.message) || 'Could not draw cards.');
        const next = await fetchState();
        if (next) renderState(next);
        return;
    }
    const next = await fetchState();
    if (next) renderState(next);
    showDrewDialog(data.drawn || [], data.locomotives_drawn || 0);
}

function showDrewDialog(colors, locos) {
    const dlg = document.createElement('dialog');
    dlg.className = 'tickets-reminder-dialog';

    const h = document.createElement('h3');
    h.textContent = 'Cards drawn';

    const list = document.createElement('ul');
    list.className = 'hand-list';
    list.style.gridTemplateColumns = 'repeat(2, 1fr)';
    list.style.margin = '0 0 16px';
    list.style.padding = '0';
    list.style.listStyle = 'none';

    const counts = new Map();
    for (const cid of colors) counts.set(cid, (counts.get(cid) || 0) + 1);
    for (const [cid, cnt] of counts) {
        const color = mapData && mapData.colors.find((c) => c.id === cid);
        list.appendChild(makePill({
            label: color ? color.display_name : `#${cid}`,
            count: cnt,
            swatchStyle: color ? `background: ${color.hex};` : '',
        }));
    }
    if (locos > 0) {
        list.appendChild(makePill({ label: 'Loco', count: locos, loco: true }));
    }
    if (colors.length === 0 && locos === 0) {
        const p = document.createElement('p');
        p.textContent = 'No cards drawn (deck exhausted).';
        list.replaceWith(p);
    }

    const menu = document.createElement('div');
    menu.className = 'menu';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = 'OK';
    ok.addEventListener('click', () => dlg.close());
    menu.appendChild(ok);

    dlg.append(h, list, menu);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
}

function showTicketsReminder(message) {
    if (reminderOpen) return;
    reminderOpen = true;
    const dlg = document.createElement('dialog');
    dlg.className = 'tickets-reminder-dialog';

    const h = document.createElement('h3');
    h.textContent = 'Decide on your tickets';
    const p = document.createElement('p');
    p.textContent = message;
    const menu = document.createElement('div');
    menu.className = 'menu';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = 'OK';
    ok.addEventListener('click', () => dlg.close());
    menu.appendChild(ok);

    dlg.append(h, p, menu);
    dlg.addEventListener('close', () => {
        dlg.remove();
        reminderOpen = false;
    });
    document.body.appendChild(dlg);
    dlg.showModal();
}

function applyClaims(claims) {
    if (!mapData) return;
    applyClaimsModule(mapFrameEl, claims, TEAM_COLORS);
}

function tickCountdown() {
    if (endsAtMs !== null) {
        const remainingMs = Math.max(0, endsAtMs - Date.now());
        const totalSec = Math.floor(remainingMs / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        countdownEl.textContent = h > 0
            ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
            : `${m}:${String(s).padStart(2, '0')}`;
    }
    if (nextWindowAtMs !== null) {
        const remainingMs = Math.max(0, nextWindowAtMs - Date.now());
        const totalSec = Math.floor(remainingMs / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        nextWindowEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
    }
}

async function pollState() {
    const state = await fetchState();
    if (state) renderState(state);
    if (state && state.game && state.game.status === 'ended') return;
    setTimeout(pollState, POLL_INTERVAL_MS);
}

async function onRouteClick(route) {
    if (!mapData) return;
    if (hasPendingTickets(lastState)) {
        showTicketsReminder('Decide on your tickets before claiming a route.');
        return;
    }
    const fresh = await fetchState();
    if (!fresh) return;
    renderState(fresh);
    if (fresh.game.status !== 'in_progress') {
        window.alert('Game is not in progress.');
        return;
    }
    if (hasPendingTickets(fresh)) {
        showTicketsReminder('Decide on your tickets before claiming a route.');
        return;
    }
    if ((fresh.claims || []).some((c) => c.route_id === route.id)) {
        window.alert('This route was just claimed.');
        return;
    }
    const color = mapData.colors.find((c) => c.id === route.color_id);
    const haveColor = (fresh.team.hand && fresh.team.hand[String(route.color_id)]) || 0;
    const haveLoco = fresh.team.locomotives_in_hand || 0;
    if (haveColor + haveLoco < route.length) {
        window.alert(`Not enough cards. Need ${route.length}, you have ${haveColor} ${color ? color.display_name : ''} + ${haveLoco} loco.`);
        return;
    }

    const choice = await openClaimDialog({ route, color, haveColor, haveLoco });
    if (!choice) return;

    const res = await fetch(`/api/games/${encodeURIComponent(code)}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            route_id: route.id,
            spend: choice.spend,
            spend_locomotives: choice.spend_locomotives,
        }),
    });
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
        window.alert((data && data.message) || 'Could not claim route.');
        const next = await fetchState();
        if (next) renderState(next);
        return;
    }
    const next = await fetchState();
    if (next) renderState(next);
}

function openClaimDialog({ route, color, haveColor, haveLoco }) {
    return new Promise((resolve) => {
        const length = route.length;
        const colorName = color ? color.display_name : 'Unknown';
        const safeHex = color && /^#[0-9a-fA-F]{6}$/.test(color.hex) ? color.hex : '#888';

        // Default: use color cards first, top up with locos.
        let loco = Math.max(0, length - haveColor);
        if (loco > haveLoco) loco = haveLoco;

        const dlg = document.createElement('dialog');
        dlg.className = 'claim-dialog';

        const form = document.createElement('form');
        form.method = 'dialog';

        const title = document.createElement('h3');
        title.className = 'claim-title';
        title.textContent = `Claim ${colorName} route`;
        form.appendChild(title);

        const lengthRow = document.createElement('p');
        lengthRow.className = 'claim-row';
        lengthRow.append(document.createTextNode('Length: '));
        const lengthStrong = document.createElement('strong');
        lengthStrong.textContent = String(length);
        lengthRow.appendChild(lengthStrong);
        form.appendChild(lengthRow);

        const colorRow = document.createElement('p');
        colorRow.className = 'claim-row';
        colorRow.append(document.createTextNode('Color: '));
        const swatch = document.createElement('span');
        swatch.className = 'claim-swatch';
        swatch.style.background = safeHex;
        colorRow.appendChild(swatch);
        const colorLabel = document.createElement('span');
        colorLabel.textContent = colorName;
        colorRow.appendChild(colorLabel);
        form.appendChild(colorRow);

        const stepperRow = document.createElement('div');
        stepperRow.className = 'claim-stepper-row';
        const stepperLabel = document.createElement('span');
        stepperLabel.textContent = 'Locomotives:';
        stepperRow.appendChild(stepperLabel);
        const stepper = document.createElement('div');
        stepper.className = 'claim-stepper';
        const dec = document.createElement('button');
        dec.type = 'button';
        dec.className = 'step-btn';
        dec.setAttribute('aria-label', 'Fewer locomotives');
        dec.textContent = '\u2212';
        const out = document.createElement('output');
        out.className = 'step-out mono';
        const inc = document.createElement('button');
        inc.type = 'button';
        inc.className = 'step-btn';
        inc.setAttribute('aria-label', 'More locomotives');
        inc.textContent = '+';
        stepper.append(dec, out, inc);
        stepperRow.appendChild(stepper);
        form.appendChild(stepperRow);

        const totals = document.createElement('p');
        totals.className = 'claim-totals';
        form.appendChild(totals);

        const menu = document.createElement('div');
        menu.className = 'claim-menu';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'claim-cancel';
        cancel.textContent = 'Cancel';
        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = 'claim-confirm';
        confirm.textContent = 'Claim';
        menu.append(cancel, confirm);
        form.appendChild(menu);

        dlg.appendChild(form);
        document.body.appendChild(dlg);

        const update = () => {
            const colorNeeded = length - loco;
            out.textContent = String(loco);
            const ok = colorNeeded >= 0 && colorNeeded <= haveColor && loco <= haveLoco && loco >= 0;
            totals.textContent = `${colorNeeded} ${colorName} (have ${haveColor})  +  ${loco} loco (have ${haveLoco})`;
            confirm.disabled = !ok;
            dec.disabled = loco <= 0;
            inc.disabled = loco >= length || loco >= haveLoco;
        };
        dec.addEventListener('click', () => { if (loco > 0) { loco--; update(); } });
        inc.addEventListener('click', () => { if (loco < length && loco < haveLoco) { loco++; update(); } });
        cancel.addEventListener('click', () => dlg.close('cancel'));
        confirm.addEventListener('click', () => dlg.close('confirm'));

        dlg.addEventListener('close', () => {
            const value = dlg.returnValue;
            dlg.remove();
            if (value !== 'confirm') {
                resolve(null);
                return;
            }
            const colorNeeded = length - loco;
            const spend = colorNeeded > 0 ? { [String(route.color_id)]: colorNeeded } : {};
            resolve({ spend, spend_locomotives: loco });
        });

        update();
        dlg.showModal();
    });
}

async function bootstrap() {
    ticketsDecideBtn.addEventListener('click', submitDecision);
    btnDrawCards.addEventListener('click', onDrawCards);
    btnDrawTickets.addEventListener('click', onDrawTickets);
    btnTrade32.addEventListener('click', () => onTrade('any3for2'));
    btnTrade3Loco.addEventListener('click', () => onTrade('same3forLoco'));

    // The "Back to home" link in the scoreboard ends the session.
    const homeLink = scoreboardEl.querySelector('.home-link');
    if (homeLink) {
        homeLink.addEventListener('click', () => clearSession());
    }

    mapData = await fetchMap();
    if (mapData) renderMap(mapData);
    await pollState();
    setInterval(tickCountdown, 1000);
}

bootstrap();
