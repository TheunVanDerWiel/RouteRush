const code = document.body.dataset.gameCode;
const countdownEl = document.getElementById('countdown');
const deckRemainingEl = document.getElementById('deck-remaining');
const handEl = document.getElementById('hand');
const mapFrameEl = document.getElementById('map-frame');

const POLL_INTERVAL_MS = 5000;

const SVG_NS = 'http://www.w3.org/2000/svg';
const STOP_RADIUS = 10;
const STOP_LABEL_OFFSET = 14;
const ROUTE_STOP_MARGIN = 10;
const SLOT_H = 12;
const SLOT_GAP = 3;
const SLOT_RADIUS = 1.5;
const PARALLEL_GAP = 14;

let endsAtMs = null;
let mapData = null;

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
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${map.viewbox_w} ${map.viewbox_h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.classList.add('game-map');

    const colorsById = new Map(map.colors.map((c) => [c.id, c]));
    const stopsById = new Map(map.stops.map((s) => [s.id, s]));

    const routeLayer = document.createElementNS(SVG_NS, 'g');
    routeLayer.setAttribute('class', 'routes');

    // Group by unordered stop pair so parallel routes can share a centerline
    // and offset symmetrically to either side.
    const groups = new Map();
    for (const r of map.routes) {
        const a = Math.min(r.from_stop_id, r.to_stop_id);
        const b = Math.max(r.from_stop_id, r.to_stop_id);
        const key = `${a}-${b}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    for (const list of groups.values()) {
        list.sort((x, y) => x.parallel_index - y.parallel_index);
        for (let i = 0; i < list.length; i++) {
            const offset = (i - (list.length - 1) / 2) * PARALLEL_GAP;
            const node = renderRoute(list[i], stopsById, colorsById, offset);
            if (node) routeLayer.appendChild(node);
        }
    }
    svg.appendChild(routeLayer);

    const stopLayer = document.createElementNS(SVG_NS, 'g');
    stopLayer.setAttribute('class', 'stops');
    for (const s of map.stops) {
        stopLayer.appendChild(renderStop(s));
    }
    svg.appendChild(stopLayer);

    mapFrameEl.replaceChildren(svg);
}

function renderRoute(route, stopsById, colorsById, perpOffset) {
    const a = stopsById.get(route.from_stop_id);
    const b = stopsById.get(route.to_stop_id);
    if (!a || !b) return null;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return null;

    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;

    const inset = STOP_RADIUS + ROUTE_STOP_MARGIN;
    const ax = a.x + ux * inset + px * perpOffset;
    const ay = a.y + uy * inset + py * perpOffset;
    const bx = b.x - ux * inset + px * perpOffset;
    const by = b.y - uy * inset + py * perpOffset;

    const segLen = Math.hypot(bx - ax, by - ay);
    const slotW = (segLen - (route.length - 1) * SLOT_GAP) / route.length;
    const angleDeg = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
    // Keep slot labels right-side-up regardless of route direction.
    const labelFlip = angleDeg > 90 || angleDeg < -90;
    const color = colorsById.get(route.color_id);
    const fill = color ? color.hex : '#888';
    const labelText = color ? color.display_name : '';

    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'route');
    g.dataset.routeId = String(route.id);

    for (let i = 0; i < route.length; i++) {
        const along = i * (slotW + SLOT_GAP) + slotW / 2;
        const cx = ax + ux * along;
        const cy = ay + uy * along;
        const slot = document.createElementNS(SVG_NS, 'g');
        slot.setAttribute('transform', `translate(${cx} ${cy}) rotate(${angleDeg})`);

        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', String(-slotW / 2));
        rect.setAttribute('y', String(-SLOT_H / 2));
        rect.setAttribute('width', String(slotW));
        rect.setAttribute('height', String(SLOT_H));
        rect.setAttribute('rx', String(SLOT_RADIUS));
        rect.setAttribute('class', 'route-slot');
        rect.style.fill = fill;
        slot.appendChild(rect);

        if (labelText) {
            const text = document.createElementNS(SVG_NS, 'text');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'central');
            text.setAttribute('class', 'route-slot-label');
            if (labelFlip) text.setAttribute('transform', 'rotate(180)');
            text.textContent = labelText;
            slot.appendChild(text);
        }

        g.appendChild(slot);
    }
    return g;
}

function renderStop(stop) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'stop');
    g.setAttribute('transform', `translate(${stop.x} ${stop.y})`);
    g.dataset.stopId = String(stop.id);

    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('r', String(STOP_RADIUS));
    c.setAttribute('class', 'stop-circle');
    g.appendChild(c);

    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', '0');
    t.setAttribute('y', String(STOP_RADIUS + STOP_LABEL_OFFSET));
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('class', 'stop-label');
    t.textContent = stop.display_name;
    g.appendChild(t);

    return g;
}

function renderState(state) {
    if (state.game.ends_at) {
        endsAtMs = Date.parse(state.game.ends_at);
    }
    deckRemainingEl.textContent = String(state.game.deck_remaining);
    renderHand(state);
}

function tickCountdown() {
    if (endsAtMs === null) return;
    const remainingMs = Math.max(0, endsAtMs - Date.now());
    const totalSec = Math.floor(remainingMs / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    countdownEl.textContent = h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
}

async function pollState() {
    const state = await fetchState();
    if (state) renderState(state);
    setTimeout(pollState, POLL_INTERVAL_MS);
}

async function bootstrap() {
    mapData = await fetchMap();
    if (mapData) renderMap(mapData);
    await pollState();
    setInterval(tickCountdown, 1000);
}

bootstrap();
