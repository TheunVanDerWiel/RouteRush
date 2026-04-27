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

const TEAM_COLORS = (() => {
    const cs = getComputedStyle(document.documentElement);
    const out = [];
    for (let i = 0; i < 5; i++) {
        out.push((cs.getPropertyValue(`--team-color-${i}`) || '').trim() || '#888');
    }
    return out;
})();

let endsAtMs = null;
let mapData = null;
let lastState = null;

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
    const controls = setupPanZoom(svg, map.viewbox_w, map.viewbox_h);
    mapFrameEl.appendChild(buildZoomControls(svg, controls));
}

function buildZoomControls(svg, controls) {
    const wrap = document.createElement('div');
    wrap.className = 'map-zoom-controls';
    wrap.appendChild(makeZoomButton('+', 'Zoom in', () => controls.zoomBy(1 / 1.4, svg)));
    wrap.appendChild(makeZoomButton('\u2212', 'Zoom out', () => controls.zoomBy(1.4, svg)));
    return wrap;
}

function makeZoomButton(label, ariaLabel, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'map-zoom-btn';
    btn.setAttribute('aria-label', ariaLabel);
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
}

function setupPanZoom(svg, baseW, baseH) {
    const MAX_ZOOM = 10;
    const ratio = baseH / baseW;
    const vb = { x: 0, y: 0, w: baseW, h: baseH };

    const apply = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);

    // Compute the displayed scale (px per SVG unit) honouring
    // preserveAspectRatio="meet" letterboxing.
    const fit = () => {
        const rect = svg.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
            return { rect, scale: 1, offsetX: 0, offsetY: 0 };
        }
        const scale = Math.min(rect.width / vb.w, rect.height / vb.h);
        return {
            rect,
            scale,
            offsetX: (rect.width - vb.w * scale) / 2,
            offsetY: (rect.height - vb.h * scale) / 2,
        };
    };

    const screenToSvg = (clientX, clientY) => {
        const f = fit();
        return {
            x: (clientX - f.rect.left - f.offsetX) / f.scale + vb.x,
            y: (clientY - f.rect.top - f.offsetY) / f.scale + vb.y,
        };
    };

    const clampPan = () => {
        if (vb.w >= baseW) {
            vb.x = (baseW - vb.w) / 2;
        } else {
            if (vb.x < 0) vb.x = 0;
            if (vb.x + vb.w > baseW) vb.x = baseW - vb.w;
        }
        if (vb.h >= baseH) {
            vb.y = (baseH - vb.h) / 2;
        } else {
            if (vb.y < 0) vb.y = 0;
            if (vb.y + vb.h > baseH) vb.y = baseH - vb.h;
        }
    };

    const clampW = (w) => {
        const minW = baseW / MAX_ZOOM;
        return Math.min(baseW, Math.max(minW, w));
    };

    // Keep `anchor` (in SVG coords) under the screen point (clientX, clientY)
    // after vb.w/vb.h have already been updated.
    const anchorAt = (anchor, clientX, clientY) => {
        const f = fit();
        vb.x = anchor.x - (clientX - f.rect.left - f.offsetX) / f.scale;
        vb.y = anchor.y - (clientY - f.rect.top - f.offsetY) / f.scale;
    };

    const zoomAround = (clientX, clientY, newW) => {
        const anchor = screenToSvg(clientX, clientY);
        vb.w = clampW(newW);
        vb.h = vb.w * ratio;
        anchorAt(anchor, clientX, clientY);
        clampPan();
        apply();
    };

    svg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        zoomAround(e.clientX, e.clientY, vb.w * factor);
    }, { passive: false });

    const TAP_MAX_MOVE = 8;
    let dragMoved = false;
    let suppressNextClick = false;

    let mousePan = null;
    svg.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        mousePan = { lastX: e.clientX, lastY: e.clientY, startX: e.clientX, startY: e.clientY };
        dragMoved = false;
    });
    window.addEventListener('mousemove', (e) => {
        if (!mousePan) return;
        if (Math.hypot(e.clientX - mousePan.startX, e.clientY - mousePan.startY) > TAP_MAX_MOVE) {
            dragMoved = true;
        }
        const k = 1 / fit().scale;
        vb.x -= (e.clientX - mousePan.lastX) * k;
        vb.y -= (e.clientY - mousePan.lastY) * k;
        mousePan.lastX = e.clientX;
        mousePan.lastY = e.clientY;
        clampPan();
        apply();
    });
    window.addEventListener('mouseup', () => { mousePan = null; });

    svg.addEventListener('click', (e) => {
        if (dragMoved || suppressNextClick) {
            e.stopPropagation();
            e.preventDefault();
        }
        dragMoved = false;
        suppressNextClick = false;
    }, true);

    const touches = new Map();
    let pinch = null;
    let touchPan = null;
    let tapStart = null;

    const refreshTouchMode = () => {
        if (touches.size >= 2) {
            const [t1, t2] = [...touches.values()];
            const cx = (t1.x + t2.x) / 2;
            const cy = (t1.y + t2.y) / 2;
            pinch = {
                dist: Math.hypot(t2.x - t1.x, t2.y - t1.y) || 1,
                vbW: vb.w,
                anchor: screenToSvg(cx, cy),
            };
            touchPan = null;
        } else if (touches.size === 1) {
            const [t] = touches.values();
            touchPan = { lastX: t.x, lastY: t.y };
            pinch = null;
        } else {
            pinch = null;
            touchPan = null;
        }
    };

    svg.addEventListener('touchstart', (e) => {
        for (const t of e.changedTouches) {
            touches.set(t.identifier, { x: t.clientX, y: t.clientY });
        }
        if (touches.size === 1) {
            const [t] = touches.values();
            tapStart = { x: t.x, y: t.y };
        } else {
            tapStart = null;
            suppressNextClick = true;
        }
        refreshTouchMode();
    }, { passive: true });

    svg.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) {
            if (touches.has(t.identifier)) {
                touches.set(t.identifier, { x: t.clientX, y: t.clientY });
            }
        }
        if (tapStart && touches.size === 1) {
            const [t] = touches.values();
            if (Math.hypot(t.x - tapStart.x, t.y - tapStart.y) > TAP_MAX_MOVE) {
                tapStart = null;
                suppressNextClick = true;
            }
        }
        if (pinch && touches.size >= 2) {
            const [t1, t2] = [...touches.values()];
            const cx = (t1.x + t2.x) / 2;
            const cy = (t1.y + t2.y) / 2;
            const dist = Math.hypot(t2.x - t1.x, t2.y - t1.y) || 1;
            vb.w = clampW(pinch.vbW * (pinch.dist / dist));
            vb.h = vb.w * ratio;
            anchorAt(pinch.anchor, cx, cy);
            clampPan();
            apply();
        } else if (touchPan && touches.size === 1) {
            const [t] = touches.values();
            const k = 1 / fit().scale;
            vb.x -= (t.x - touchPan.lastX) * k;
            vb.y -= (t.y - touchPan.lastY) * k;
            touchPan.lastX = t.x;
            touchPan.lastY = t.y;
            clampPan();
            apply();
        }
    }, { passive: false });

    const endTouch = (e) => {
        for (const t of e.changedTouches) {
            touches.delete(t.identifier);
        }
        refreshTouchMode();
    };
    svg.addEventListener('touchend', endTouch);
    svg.addEventListener('touchcancel', endTouch);

    apply();

    return {
        zoomBy: (factor, target) => {
            const rect = (target || svg).getBoundingClientRect();
            zoomAround(rect.left + rect.width / 2, rect.top + rect.height / 2, vb.w * factor);
        },
    };
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
    g.dataset.colorId = String(route.color_id);
    g.dataset.length = String(route.length);
    g.dataset.originalFill = fill;
    g.addEventListener('click', () => onRouteClick(route));

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
    lastState = state;
    if (state.game.ends_at) {
        endsAtMs = Date.parse(state.game.ends_at);
    }
    deckRemainingEl.textContent = String(state.game.deck_remaining);
    renderHand(state);
    applyClaims(state.claims || []);
}

function applyClaims(claims) {
    if (!mapData) return;
    const claimedBy = new Map();
    for (const c of claims) {
        claimedBy.set(c.route_id, c.team_color_index);
    }
    for (const g of mapFrameEl.querySelectorAll('.route')) {
        const routeId = parseInt(g.dataset.routeId, 10);
        const teamIdx = claimedBy.get(routeId);
        const claimed = teamIdx !== undefined;
        const fill = claimed ? (TEAM_COLORS[teamIdx] || '#888') : g.dataset.originalFill;
        for (const slot of g.querySelectorAll('.route-slot')) {
            slot.style.fill = fill;
        }
        g.classList.toggle('claimed', claimed);
    }
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

async function onRouteClick(route) {
    if (!mapData) return;
    const fresh = await fetchState();
    if (!fresh) return;
    renderState(fresh);
    if (fresh.game.status !== 'in_progress') {
        window.alert('Game is not in progress.');
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
    mapData = await fetchMap();
    if (mapData) renderMap(mapData);
    await pollState();
    setInterval(tickCountdown, 1000);
}

bootstrap();
