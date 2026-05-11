/* Shared SVG map renderer.
 *
 * Renders a map (colors + stops + routes, with optional via points) into a
 * container element. Used by the in-game view, the lobby preview, and the
 * home page preview.
 *
 * Public API:
 *   renderMap(container, map, options?) -> { svg, controls }
 *   applyClaims(container, claims, teamColors)
 *
 * Options for renderMap:
 *   onRouteClick      callback(route)  called when a route is clicked
 *   enableZoomControls  boolean (default true) — adds +/- buttons
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const STOP_RADIUS = 10;
export const STOP_LABEL_OFFSET = 14;
export const STOP_LABEL_FONT_SIZE = 22;
export const ROUTE_STOP_MARGIN = 10;
export const SLOT_H = 12;
export const SLOT_GAP = 3;
export const SLOT_RADIUS = 1.5;
export const PARALLEL_GAP = 14;

export function renderMap(container, map, options = {}) {
    const onRouteClick      = options.onRouteClick      || null;
    const enableZoomControls = options.enableZoomControls !== false;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${map.viewbox_w} ${map.viewbox_h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.classList.add('game-map');

    const colorsById = new Map(map.colors.map((c) => [c.id, c]));
    const stopsById  = new Map(map.stops.map((s)  => [s.id, s]));

    const routeLayer = document.createElementNS(SVG_NS, 'g');
    routeLayer.setAttribute('class', 'routes');

    // Group by unordered stop pair so parallel routes share a centerline.
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
            const node = renderRoute(list[i], stopsById, colorsById, offset, onRouteClick);
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

    container.replaceChildren(svg);
    const controls = setupPanZoom(svg, map.viewbox_w, map.viewbox_h);
    if (enableZoomControls) {
        container.appendChild(buildZoomControls(svg, controls));
    }
    return { svg, controls };
}

export function applyClaims(container, claims, teamColors) {
    const claimedBy = new Map();
    for (const c of claims) {
        claimedBy.set(c.route_id, c.team_color_index);
    }
    for (const g of container.querySelectorAll('.route')) {
        const routeId = parseInt(g.dataset.routeId, 10);
        const teamIdx = claimedBy.get(routeId);
        const claimed = teamIdx !== undefined;
        const fill = claimed
            ? (teamColors[teamIdx] || '#888')
            : g.dataset.originalFill;
        for (const slot of g.querySelectorAll('.route-slot')) {
            slot.style.fill = fill;
        }
        g.classList.toggle('claimed', claimed);
    }
}

function buildZoomControls(svg, controls) {
    const wrap = document.createElement('div');
    wrap.className = 'map-zoom-controls';
    wrap.appendChild(makeZoomButton('+',      'Zoom in',  () => controls.zoomBy(1 / 1.4, svg)));
    wrap.appendChild(makeZoomButton('−', 'Zoom out', () => controls.zoomBy(1.4,     svg)));
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

    // Counter-scale stop labels so their on-screen size stays constant
    // regardless of zoom. Larger maps scale labels via the map-size factor.
    const mapSizeFactor = Math.max(baseW, baseH) / 1000;
    const stopLabels = svg.querySelectorAll('.stop-label');
    const updateStopLabels = () => {
        const k = vb.w / baseW;
        const fs = STOP_LABEL_FONT_SIZE * mapSizeFactor * k;
        const oy = STOP_RADIUS + STOP_LABEL_OFFSET * mapSizeFactor * k;
        for (const t of stopLabels) {
            t.style.fontSize = `${fs}px`;
            t.setAttribute('y', String(oy));
        }
    };

    const apply = () => {
        svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
        updateStopLabels();
    };

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
            y: (clientY - f.rect.top  - f.offsetY) / f.scale + vb.y,
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

    const anchorAt = (anchor, clientX, clientY) => {
        const f = fit();
        vb.x = anchor.x - (clientX - f.rect.left - f.offsetX) / f.scale;
        vb.y = anchor.y - (clientY - f.rect.top  - f.offsetY) / f.scale;
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
    svg.addEventListener('touchend',    endTouch);
    svg.addEventListener('touchcancel', endTouch);

    apply();

    return {
        zoomBy: (factor, target) => {
            const rect = (target || svg).getBoundingClientRect();
            zoomAround(rect.left + rect.width / 2, rect.top + rect.height / 2, vb.w * factor);
        },
    };
}

function renderRoute(route, stopsById, colorsById, perpOffset, onRouteClick) {
    const a = stopsById.get(route.from_stop_id);
    const b = stopsById.get(route.to_stop_id);
    if (!a || !b) return null;

    const color = colorsById.get(route.color_id);
    const fill = color ? color.hex : '#888';
    const labelText = color ? color.symbol : '';

    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'route');
    g.dataset.routeId = String(route.id);
    g.dataset.colorId = String(route.color_id);
    g.dataset.length  = String(route.length);
    g.dataset.originalFill = fill;
    if (typeof onRouteClick === 'function') {
        g.addEventListener('click', () => onRouteClick(route));
    }

    const segments = splitRouteSegments(route, a, b);
    if (segments.length === 0) return null;
    for (const seg of segments) {
        appendRouteSegment(g, seg, perpOffset, fill, labelText);
    }
    return g;
}

function splitRouteSegments(route, a, b) {
    const hasVia = route.via_x !== null && route.via_x !== undefined
                && route.via_y !== null && route.via_y !== undefined
                && route.length >= 2;
    if (!hasVia) {
        return [{ from: a, to: b, slots: route.length, insetFrom: true, insetTo: true }];
    }
    const v = { x: route.via_x, y: route.via_y };
    const d1 = Math.hypot(v.x - a.x, v.y - a.y);
    const d2 = Math.hypot(b.x - v.x, b.y - v.y);
    const total = d1 + d2;
    let n1 = total > 0
        ? Math.round((route.length * d1) / total)
        : Math.floor(route.length / 2);
    n1 = Math.max(1, Math.min(route.length - 1, n1));
    const n2 = route.length - n1;
    return [
        { from: a, to: v, slots: n1, insetFrom: true,  insetTo: false },
        { from: v, to: b, slots: n2, insetFrom: false, insetTo: true  },
    ];
}

function appendRouteSegment(g, seg, perpOffset, fill, labelText) {
    const { from, to, slots, insetFrom, insetTo } = seg;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len === 0 || slots <= 0) return;

    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;

    const inset = STOP_RADIUS + ROUTE_STOP_MARGIN;
    const insFrom = insetFrom ? inset : 0;
    const insTo   = insetTo   ? inset : 0;
    const ax = from.x + ux * insFrom + px * perpOffset;
    const ay = from.y + uy * insFrom + py * perpOffset;
    const bx = to.x   - ux * insTo   + px * perpOffset;
    const by = to.y   - uy * insTo   + py * perpOffset;

    const segLen = Math.hypot(bx - ax, by - ay);
    if (segLen <= 0) return;
    const slotW = (segLen - (slots - 1) * SLOT_GAP) / slots;
    const angleDeg = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
    // Keep slot labels right-side-up regardless of route direction.
    const labelFlip = angleDeg > 90 || angleDeg < -90;

    for (let i = 0; i < slots; i++) {
        const along = i * (slotW + SLOT_GAP) + slotW / 2;
        const cx = ax + ux * along;
        const cy = ay + uy * along;
        const slot = document.createElementNS(SVG_NS, 'g');
        slot.setAttribute('transform', `translate(${cx} ${cy}) rotate(${angleDeg})`);

        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', String(-slotW / 2));
        rect.setAttribute('y', String(-SLOT_H / 2));
        rect.setAttribute('width',  String(slotW));
        rect.setAttribute('height', String(SLOT_H));
        rect.setAttribute('rx',     String(SLOT_RADIUS));
        rect.setAttribute('class', 'route-slot');
        rect.setAttribute('vector-effect', 'non-scaling-stroke');
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
