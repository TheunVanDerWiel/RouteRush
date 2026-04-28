/* Route Rush · Map Editor — slice 1
 *
 * Scope: layout shell + toolbar + metadata bar + empty SVG canvas + load/save
 * round-trip + background-image overlay. No editing features yet.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const STOP_RADIUS = 10;
const STOP_LABEL_OFFSET = 14;
const STOP_LABEL_FONT_SIZE = 22;

const ROUTE_STOP_MARGIN = 10;
const SLOT_H = 12;
const SLOT_GAP = 3;
const SLOT_RADIUS = 1.5;
const PARALLEL_GAP = 14;
const SLOT_LABEL_FONT_SIZE = 7;

const DEFAULT_ROUTE_LENGTH = 3;
const DEFAULT_COLOR_HEX = '#1d3557';

// Cycles for newly created colors; matches the team palette aesthetic.
const COLOR_PALETTE = [
    '#e63946', '#1d3557', '#2a9d8f', '#f4a261',
    '#6a4c93', '#264653', '#e9c46a', '#a8dadc',
];

// ---------------------------------------------------------------------------
// Default state
// ---------------------------------------------------------------------------

function defaultData() {
    return {
        name: 'Untitled',
        viewbox_w: 1600,
        viewbox_h: 900,
        starting_train_cards: 4,
        starting_tickets_count: 3,
        starting_tickets_keep_min: 2,
        min_teams: 2,
        max_teams: 5,
        locomotives_count: 14,
        colors: [
            { id: 1, display_name: 'Default', hex: DEFAULT_COLOR_HEX, symbol: 'X', deck_count: 12 },
        ],
        stops: [],
        routes: [],
        tickets: [],
    };
}

const state = {
    data: defaultData(),
    bg: null,            // { url, opacity (0..1) } | null
    mode: 'select',
    selection: null,
    addRouteFrom: null,  // stop id remembered as first click in Add route mode
    activeColorId: null, // color picked for newly created routes
    dirty: false,
};

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const els = {
    btnNew:        document.getElementById('btn-new'),
    btnLoadJson:   document.getElementById('btn-load-json'),
    btnLoadImage:  document.getElementById('btn-load-image'),
    btnClearImage: document.getElementById('btn-clear-image'),
    btnSave:       document.getElementById('btn-save'),
    dirtyFlag:     document.getElementById('dirty-flag'),

    name:          document.getElementById('meta-name'),
    w:             document.getElementById('meta-w'),
    h:             document.getElementById('meta-h'),
    cards:         document.getElementById('meta-cards'),
    minTeams:      document.getElementById('meta-min-teams'),
    maxTeams:      document.getElementById('meta-max-teams'),
    locos:         document.getElementById('meta-locos'),
    ticketsCount:  document.getElementById('meta-tickets-count'),
    ticketsKeep:   document.getElementById('meta-tickets-keep'),
    bgOpacityWrap: document.getElementById('bg-opacity-wrap'),
    bgOpacity:     document.getElementById('meta-bg-opacity'),

    banner:        document.getElementById('editor-banner'),
    canvas:        document.getElementById('editor-canvas'),
    properties:    document.getElementById('properties-panel'),
    colorsList:    document.getElementById('colors-list'),

    fileJson:      document.getElementById('file-input-json'),
    fileImage:     document.getElementById('file-input-image'),

    modeList:      document.getElementById('mode-list'),
};

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

function markDirty() {
    state.dirty = true;
    els.dirtyFlag.hidden = false;
}

function markClean() {
    state.dirty = false;
    els.dirtyFlag.hidden = true;
}

function setBanner(message, kind = 'info') {
    if (!message) {
        els.banner.hidden = true;
        els.banner.textContent = '';
        els.banner.classList.remove('error');
        return;
    }
    els.banner.textContent = message;
    els.banner.hidden = false;
    els.banner.classList.toggle('error', kind === 'error');
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render() {
    renderMeta();
    renderCanvas();
    renderColors();
    renderProperties();
}

function renderMeta() {
    const d = state.data;
    setIfChanged(els.name,         d.name);
    setIfChanged(els.w,            String(d.viewbox_w));
    setIfChanged(els.h,            String(d.viewbox_h));
    setIfChanged(els.cards,        String(d.starting_train_cards));
    setIfChanged(els.minTeams,     String(d.min_teams));
    setIfChanged(els.maxTeams,     String(d.max_teams));
    setIfChanged(els.locos,        String(d.locomotives_count));
    setIfChanged(els.ticketsCount, String(d.starting_tickets_count));
    setIfChanged(els.ticketsKeep,  String(d.starting_tickets_keep_min));

    els.bgOpacityWrap.hidden = state.bg === null;
    els.btnClearImage.hidden = state.bg === null;
    if (state.bg) {
        const pct = Math.round(state.bg.opacity * 100);
        if (String(pct) !== els.bgOpacity.value) {
            els.bgOpacity.value = String(pct);
        }
    }
}

function setIfChanged(input, value) {
    // Avoid clobbering the user's caret while they're typing.
    if (document.activeElement === input) return;
    if (input.value !== value) input.value = value;
}

function renderProperties() {
    const panel = els.properties;
    panel.replaceChildren();

    if (!state.selection) {
        panel.appendChild(hintP('Nothing selected.'));
        return;
    }

    if (state.selection.kind === 'stop') {
        const stop = state.data.stops.find((s) => s.id === state.selection.id);
        if (!stop) {
            state.selection = null;
            panel.appendChild(hintP('Nothing selected.'));
            return;
        }
        renderStopProps(panel, stop);
        return;
    }

    if (state.selection.kind === 'route') {
        const route = state.data.routes.find((r) => r.id === state.selection.id);
        if (!route) {
            state.selection = null;
            panel.appendChild(hintP('Nothing selected.'));
            return;
        }
        renderRouteProps(panel, route);
    }
}

function renderStopProps(panel, stop) {
    panel.appendChild(propsHeader(`Stop #${stop.id}`));
    panel.appendChild(propTextRow('Name', stop.display_name, (v) => {
        stop.display_name = v;
        markDirty();
        renderCanvas();
    }));
    panel.appendChild(propNumberRow('X', stop.x, (v) => {
        stop.x = v;
        markDirty();
        renderCanvas();
    }));
    panel.appendChild(propNumberRow('Y', stop.y, (v) => {
        stop.y = v;
        markDirty();
        renderCanvas();
    }));
    panel.appendChild(propActions([
        { label: 'Delete stop', danger: true, onClick: () => deleteStop(stop.id) },
    ]));
}

function renderRouteProps(panel, route) {
    const from = state.data.stops.find((s) => s.id === route.from_stop_id);
    const to   = state.data.stops.find((s) => s.id === route.to_stop_id);
    const fromName = from ? from.display_name : `#${route.from_stop_id}`;
    const toName   = to   ? to.display_name   : `#${route.to_stop_id}`;

    panel.appendChild(propsHeader(`Route #${route.id}`));
    panel.appendChild(propRow('From', fromName));
    panel.appendChild(propRow('To',   toName));
    panel.appendChild(propNumberRow('Length', route.length, (v) => {
        route.length = v;
        markDirty();
        renderCanvas();
    }, { min: 1, max: 6 }));

    const colorOpts = state.data.colors.map((c) => ({
        value: String(c.id),
        label: c.display_name,
    }));
    if (colorOpts.length === 0) {
        // Defensive: routes can't exist without a color, but guard anyway.
        panel.appendChild(propRow('Color', `#${route.color_id}`));
    } else {
        panel.appendChild(propSelectRow('Color', String(route.color_id), colorOpts, (v) => {
            const id = parseInt(v, 10);
            if (!isNaN(id)) {
                route.color_id = id;
                markDirty();
                renderCanvas();
            }
        }));
    }
    panel.appendChild(propRow('Parallel index', String(route.parallel_index)));
    panel.appendChild(propViaRow(route));
    panel.appendChild(propActions([
        { label: 'Delete route', danger: true, onClick: () => deleteRoute(route.id) },
    ]));
}

function hintP(text) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = text;
    return p;
}

function propsHeader(text) {
    const h = document.createElement('h3');
    h.className = 'props-header';
    h.textContent = text;
    return h;
}

function propRow(label, value) {
    const row = document.createElement('div');
    row.className = 'props-row';
    row.append(propLabel(label), propValueSpan(value));
    return row;
}

function propTextRow(label, value, onChange) {
    const row = document.createElement('div');
    row.className = 'props-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.className = 'props-input';
    input.addEventListener('input', () => onChange(input.value));
    row.append(propLabel(label), input);
    return row;
}

function propNumberRow(label, value, onChange, opts = {}) {
    const row = document.createElement('div');
    row.className = 'props-row';
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '1';
    input.value = String(value);
    input.className = 'props-input props-number';
    if (opts.min !== undefined) input.min = String(opts.min);
    if (opts.max !== undefined) input.max = String(opts.max);

    input.addEventListener('input', () => {
        let n = parseInt(input.value, 10);
        if (isNaN(n)) return;
        if (opts.min !== undefined && n < opts.min) n = opts.min;
        if (opts.max !== undefined && n > opts.max) n = opts.max;
        onChange(n);
    });
    input.addEventListener('blur', () => {
        let n = parseInt(input.value, 10);
        if (isNaN(n)) n = opts.min ?? 0;
        if (opts.min !== undefined && n < opts.min) n = opts.min;
        if (opts.max !== undefined && n > opts.max) n = opts.max;
        if (input.value !== String(n)) input.value = String(n);
        onChange(n);
    });

    row.append(propLabel(label), input);
    return row;
}

function propSelectRow(label, value, options, onChange) {
    const row = document.createElement('div');
    row.className = 'props-row';
    const sel = document.createElement('select');
    sel.className = 'props-input';
    for (const opt of options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        sel.appendChild(o);
    }
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    row.append(propLabel(label), sel);
    return row;
}

function propViaRow(route) {
    const row = document.createElement('div');
    row.className = 'props-row';
    const wrap = document.createElement('span');
    wrap.className = 'props-via';
    if (route.via_x !== null && route.via_y !== null) {
        const text = document.createElement('span');
        text.textContent = `(${route.via_x}, ${route.via_y})`;
        wrap.appendChild(text);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'props-mini-btn';
        btn.textContent = 'Clear';
        btn.addEventListener('click', () => {
            route.via_x = null;
            route.via_y = null;
            markDirty();
            renderCanvas();
            renderProperties();
        });
        wrap.appendChild(btn);
    } else {
        wrap.textContent = '—';
    }
    row.append(propLabel('Via'), wrap);
    return row;
}

function propActions(actions) {
    const row = document.createElement('div');
    row.className = 'props-actions';
    for (const a of actions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = a.label;
        btn.className = a.danger ? 'props-btn danger' : 'props-btn';
        btn.addEventListener('click', a.onClick);
        row.appendChild(btn);
    }
    return row;
}

function propLabel(text) {
    const l = document.createElement('span');
    l.className = 'props-label';
    l.textContent = text;
    return l;
}

function propValueSpan(text) {
    const v = document.createElement('span');
    v.className = 'props-value';
    v.textContent = text;
    return v;
}

// ---------------------------------------------------------------------------
// Colors panel
// ---------------------------------------------------------------------------

function syncActiveColor() {
    if (state.activeColorId !== null
        && state.data.colors.some((c) => c.id === state.activeColorId)) {
        return;
    }
    state.activeColorId = state.data.colors.length > 0
        ? state.data.colors[0].id
        : null;
}

function renderColors() {
    const list = els.colorsList;
    list.replaceChildren();

    const note = document.createElement('p');
    note.className = 'hint colors-hint';
    note.textContent = 'Click a swatch to use that color for new routes.';
    list.appendChild(note);

    for (const c of state.data.colors) {
        list.appendChild(renderColorCard(c));
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'add-color-btn';
    addBtn.textContent = '+ Add color';
    addBtn.addEventListener('click', addNewColor);
    list.appendChild(addBtn);
}

function renderColorCard(color) {
    const card = document.createElement('div');
    let cls = 'color-card';
    if (state.activeColorId === color.id) cls += ' active';
    card.className = cls;

    // Header row: swatch (active picker) + name + delete
    const head = document.createElement('div');
    head.className = 'color-card-head';

    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'color-swatch';
    swatch.style.background = color.hex;
    swatch.title = 'Use this color for new routes';
    swatch.addEventListener('click', () => {
        state.activeColorId = color.id;
        renderColors();
    });

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = color.display_name;
    nameInput.className = 'color-name-input';
    nameInput.addEventListener('input', () => {
        color.display_name = nameInput.value;
        markDirty();
        // Route properties panel may show this color in its dropdown.
        renderProperties();
    });

    const usedBy   = state.data.routes.filter((r) => r.color_id === color.id).length;
    const isLast   = state.data.colors.length <= 1;
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'color-delete-btn';
    deleteBtn.textContent = '×';
    if (usedBy > 0) {
        deleteBtn.title = `Cannot delete: used by ${usedBy} route${usedBy === 1 ? '' : 's'}`;
        deleteBtn.disabled = true;
    } else if (isLast) {
        deleteBtn.title = 'Cannot delete the last color';
        deleteBtn.disabled = true;
    } else {
        deleteBtn.title = 'Delete color';
    }
    deleteBtn.addEventListener('click', () => deleteColor(color.id));

    head.append(swatch, nameInput, deleteBtn);
    card.appendChild(head);

    // Hex
    const hexInput = document.createElement('input');
    hexInput.type = 'color';
    hexInput.value = color.hex;
    hexInput.className = 'color-hex-input';
    hexInput.addEventListener('input', () => {
        color.hex = hexInput.value;
        swatch.style.background = hexInput.value;
        markDirty();
        renderCanvas();
    });
    card.appendChild(colorFieldRow('Hex', hexInput));

    // Symbol
    const symInput = document.createElement('input');
    symInput.type = 'text';
    symInput.maxLength = 20;
    symInput.value = color.symbol;
    symInput.className = 'color-symbol-input';
    symInput.addEventListener('input', () => {
        color.symbol = symInput.value;
        markDirty();
        renderCanvas();
    });
    card.appendChild(colorFieldRow('Symbol', symInput));

    // Deck count
    const deckInput = document.createElement('input');
    deckInput.type = 'number';
    deckInput.min = '0';
    deckInput.step = '1';
    deckInput.value = String(color.deck_count);
    deckInput.className = 'color-deck-input';
    deckInput.addEventListener('input', () => {
        const n = parseInt(deckInput.value, 10);
        if (!isNaN(n) && n >= 0) {
            color.deck_count = n;
            markDirty();
        }
    });
    card.appendChild(colorFieldRow('Deck count', deckInput));

    return card;
}

function colorFieldRow(labelText, control) {
    const row = document.createElement('label');
    row.className = 'color-field';
    const l = document.createElement('span');
    l.className = 'color-field-label';
    l.textContent = labelText;
    row.append(l, control);
    return row;
}

function addNewColor() {
    const id = nextId(state.data.colors);
    const hex = COLOR_PALETTE[state.data.colors.length % COLOR_PALETTE.length];
    state.data.colors.push({
        id,
        display_name: `Color ${id}`,
        hex,
        symbol: 'X',
        deck_count: 12,
    });
    state.activeColorId = id;
    markDirty();
    renderColors();
    renderProperties();
}

function deleteColor(colorId) {
    const idx = state.data.colors.findIndex((c) => c.id === colorId);
    if (idx === -1) return;
    // Mirror the UI guards (button is already disabled in those cases).
    if (state.data.colors.length <= 1) return;
    if (state.data.routes.some((r) => r.color_id === colorId)) return;
    state.data.colors.splice(idx, 1);
    syncActiveColor();
    markDirty();
    renderColors();
    renderProperties();
}

function renderCanvas() {
    const d = state.data;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${d.viewbox_w} ${d.viewbox_h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    if (state.bg) {
        const img = document.createElementNS(SVG_NS, 'image');
        img.setAttribute('href', state.bg.url);
        img.setAttribute('x', '0');
        img.setAttribute('y', '0');
        img.setAttribute('width',  String(d.viewbox_w));
        img.setAttribute('height', String(d.viewbox_h));
        img.setAttribute('opacity', String(state.bg.opacity));
        img.setAttribute('preserveAspectRatio', 'none');
        img.setAttribute('class', 'editor-bg-image');
        svg.appendChild(img);
    }

    svg.appendChild(buildGrid(d.viewbox_w, d.viewbox_h));

    const routeLayer = buildRouteLayer();
    svg.appendChild(routeLayer);

    const stopLayer = document.createElementNS(SVG_NS, 'g');
    stopLayer.setAttribute('class', 'editor-stops');
    for (const s of d.stops) stopLayer.appendChild(renderStop(s));
    svg.appendChild(stopLayer);

    attachCanvasHandlers(svg);
    els.canvas.replaceChildren(svg);
}

function buildRouteLayer() {
    const layer = document.createElementNS(SVG_NS, 'g');
    layer.setAttribute('class', 'editor-routes');

    const stopsById  = new Map(state.data.stops.map((s) => [s.id, s]));
    const colorsById = new Map(state.data.colors.map((c) => [c.id, c]));

    // Group by unordered stop pair so parallel routes share a centerline
    // and offset symmetrically to either side.
    const groups = new Map();
    for (const r of state.data.routes) {
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
            if (node) layer.appendChild(node);
        }
    }
    return layer;
}

function renderRoute(route, stopsById, colorsById, perpOffset) {
    const a = stopsById.get(route.from_stop_id);
    const b = stopsById.get(route.to_stop_id);
    if (!a || !b) return null;

    const color = colorsById.get(route.color_id);
    const fill = color ? color.hex : '#888';
    const labelText = color ? color.symbol : '';

    const g = document.createElementNS(SVG_NS, 'g');
    let cls = 'editor-route';
    if (isSelected('route', route.id)) cls += ' selected';
    g.setAttribute('class', cls);
    g.dataset.routeId = String(route.id);
    g.dataset.colorId = String(route.color_id);

    const segments = splitRouteSegments(route, a, b);
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
        rect.setAttribute('width', String(slotW));
        rect.setAttribute('height', String(SLOT_H));
        rect.setAttribute('rx', String(SLOT_RADIUS));
        rect.setAttribute('class', 'editor-route-slot');
        rect.setAttribute('vector-effect', 'non-scaling-stroke');
        rect.style.fill = fill;
        slot.appendChild(rect);

        if (labelText) {
            const text = document.createElementNS(SVG_NS, 'text');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'central');
            text.setAttribute('class', 'editor-route-slot-label');
            if (labelFlip) text.setAttribute('transform', 'rotate(180)');
            text.style.fontSize = `${SLOT_LABEL_FONT_SIZE}px`;
            text.textContent = labelText;
            slot.appendChild(text);
        }

        g.appendChild(slot);
    }
}

function renderStop(stop) {
    const g = document.createElementNS(SVG_NS, 'g');
    let cls = 'editor-stop';
    if (state.addRouteFrom === stop.id) cls += ' route-from';
    if (isSelected('stop', stop.id))   cls += ' selected';
    g.setAttribute('class', cls);
    g.setAttribute('transform', `translate(${stop.x} ${stop.y})`);
    g.dataset.stopId = String(stop.id);

    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('r', String(STOP_RADIUS));
    c.setAttribute('class', 'editor-stop-circle');
    g.appendChild(c);

    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', '0');
    t.setAttribute('y', String(STOP_RADIUS + STOP_LABEL_OFFSET));
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('class', 'editor-stop-label');
    t.style.fontSize = `${STOP_LABEL_FONT_SIZE}px`;
    t.textContent = stop.display_name;
    g.appendChild(t);

    return g;
}

function attachCanvasHandlers(svg) {
    svg.addEventListener('click', (e) => onCanvasClick(e, svg));
}

function onCanvasClick(e, svg) {
    const target = findClickTarget(e.target);
    const pt = screenToSvg(svg, e.clientX, e.clientY);

    switch (state.mode) {
        case 'select':
            handleSelectClick(target);
            break;
        case 'add-stop':
            if (target.kind !== 'stop') {
                addStopAt(pt);
            }
            break;
        case 'add-route':
            handleAddRouteClick(target);
            break;
        case 'move':
            handleMoveClick(pt);
            break;
        case 'delete':
            handleDeleteClick(target);
            break;
    }
}

function handleDeleteClick(target) {
    if (target.kind === 'stop') {
        deleteStop(target.id);
    } else if (target.kind === 'route') {
        deleteRoute(target.id);
    }
}

function deleteStop(stopId) {
    const stop = state.data.stops.find((s) => s.id === stopId);
    if (!stop) return;
    const affectedRoutes  = state.data.routes.filter(
        (r) => r.from_stop_id === stopId || r.to_stop_id === stopId,
    );
    const affectedTickets = state.data.tickets.filter(
        (t) => t.from_stop_id === stopId || t.to_stop_id === stopId,
    );

    let msg = `Delete stop "${stop.display_name}"?`;
    const parts = [];
    if (affectedRoutes.length > 0) {
        const n = affectedRoutes.length;
        parts.push(`${n} connected route${n === 1 ? '' : 's'}`);
    }
    if (affectedTickets.length > 0) {
        const n = affectedTickets.length;
        parts.push(`${n} ticket${n === 1 ? '' : 's'}`);
    }
    if (parts.length > 0) {
        msg += `\n\nThis will also delete: ${parts.join(' and ')}.`;
    }
    if (!confirm(msg)) return;

    const removedRouteIds = new Set(affectedRoutes.map((r) => r.id));
    state.data.stops   = state.data.stops.filter((s) => s.id !== stopId);
    state.data.routes  = state.data.routes.filter((r) => !removedRouteIds.has(r.id));
    state.data.tickets = state.data.tickets.filter(
        (t) => t.from_stop_id !== stopId && t.to_stop_id !== stopId,
    );

    if (state.selection) {
        if (state.selection.kind === 'stop' && state.selection.id === stopId) {
            state.selection = null;
        } else if (state.selection.kind === 'route' && removedRouteIds.has(state.selection.id)) {
            state.selection = null;
        }
    }

    markDirty();
    render();
}

function deleteRoute(routeId) {
    if (!state.data.routes.some((r) => r.id === routeId)) return;
    state.data.routes = state.data.routes.filter((r) => r.id !== routeId);
    if (state.selection && state.selection.kind === 'route' && state.selection.id === routeId) {
        state.selection = null;
    }
    markDirty();
    render();
}

function handleMoveClick(pt) {
    if (!state.selection) return;
    const x = Math.round(pt.x);
    const y = Math.round(pt.y);
    if (state.selection.kind === 'stop') {
        const stop = state.data.stops.find((s) => s.id === state.selection.id);
        if (!stop) return;
        stop.x = x;
        stop.y = y;
        markDirty();
        render();
        return;
    }
    if (state.selection.kind === 'route') {
        const route = state.data.routes.find((r) => r.id === state.selection.id);
        if (!route) return;
        route.via_x = x;
        route.via_y = y;
        markDirty();
        render();
    }
}

function handleSelectClick(target) {
    if (target.kind === 'stop' || target.kind === 'route') {
        state.selection = { kind: target.kind, id: target.id };
    } else {
        state.selection = null;
    }
    render();
}

function isSelected(kind, id) {
    return state.selection !== null
        && state.selection.kind === kind
        && state.selection.id === id;
}

function handleAddRouteClick(target) {
    if (target.kind !== 'stop') {
        // Empty / non-stop click cancels any in-progress selection.
        if (state.addRouteFrom !== null) {
            state.addRouteFrom = null;
            render();
        }
        return;
    }
    if (state.addRouteFrom === null) {
        state.addRouteFrom = target.id;
        render();
        return;
    }
    if (state.addRouteFrom === target.id) {
        // Clicked the same stop again: cancel.
        state.addRouteFrom = null;
        render();
        return;
    }
    const newId = addRouteBetween(state.addRouteFrom, target.id);
    state.addRouteFrom = null;
    state.selection = { kind: 'route', id: newId };
    render();
}

function addRouteBetween(fromId, toId) {
    const colorId = state.activeColorId !== null
        ? state.activeColorId
        : ensureDefaultColor();
    const id = nextId(state.data.routes);
    state.data.routes.push({
        id,
        from_stop_id: fromId,
        to_stop_id: toId,
        via_x: null,
        via_y: null,
        length: DEFAULT_ROUTE_LENGTH,
        color_id: colorId,
        parallel_index: nextParallelIndex(fromId, toId),
    });
    markDirty();
    return id;
}

function ensureDefaultColor() {
    if (state.data.colors.length > 0) {
        const id = state.data.colors[0].id;
        if (state.activeColorId === null) state.activeColorId = id;
        return id;
    }
    const id = nextId(state.data.colors);
    state.data.colors.push({
        id,
        display_name: 'Default',
        hex: DEFAULT_COLOR_HEX,
        symbol: 'X',
        deck_count: 12,
    });
    state.activeColorId = id;
    return id;
}

function nextParallelIndex(fromId, toId) {
    const a = Math.min(fromId, toId);
    const b = Math.max(fromId, toId);
    let max = -1;
    for (const r of state.data.routes) {
        const ra = Math.min(r.from_stop_id, r.to_stop_id);
        const rb = Math.max(r.from_stop_id, r.to_stop_id);
        if (ra === a && rb === b && r.parallel_index > max) {
            max = r.parallel_index;
        }
    }
    return max + 1;
}

function findClickTarget(node) {
    let n = node;
    while (n && n.nodeType === 1) {
        if (n.dataset && n.dataset.stopId !== undefined) {
            return { kind: 'stop', id: parseInt(n.dataset.stopId, 10), node: n };
        }
        if (n.dataset && n.dataset.routeId !== undefined) {
            return { kind: 'route', id: parseInt(n.dataset.routeId, 10), node: n };
        }
        n = n.parentNode;
    }
    return { kind: 'empty' };
}

function screenToSvg(svg, clientX, clientY) {
    // Mirrors the game's pan-zoom math: preserveAspectRatio="xMidYMid meet"
    // letterboxes the viewBox inside the rendered rect, so the visible
    // origin is offset by half the leftover space on the constrained axis.
    const rect = svg.getBoundingClientRect();
    const d = state.data;
    if (rect.width === 0 || rect.height === 0) {
        return { x: 0, y: 0 };
    }
    const scale = Math.min(rect.width / d.viewbox_w, rect.height / d.viewbox_h);
    const offsetX = (rect.width  - d.viewbox_w * scale) / 2;
    const offsetY = (rect.height - d.viewbox_h * scale) / 2;
    return {
        x: (clientX - rect.left - offsetX) / scale,
        y: (clientY - rect.top  - offsetY) / scale,
    };
}

function nextId(items) {
    let max = 0;
    for (const it of items) {
        if (typeof it.id === 'number' && it.id > max) max = it.id;
    }
    return max + 1;
}

function addStopAt(pt) {
    const id = nextId(state.data.stops);
    state.data.stops.push({
        id,
        display_name: `Stop ${id}`,
        x: Math.round(pt.x),
        y: Math.round(pt.y),
    });
    markDirty();
    state.selection = { kind: 'stop', id };
    render();
}

function setMode(mode) {
    if (state.mode !== mode) {
        // Clear any mode-local state on transition.
        state.addRouteFrom = null;
    }
    state.mode = mode;
    const radio = els.modeList.querySelector(`input[name="mode"][value="${mode}"]`);
    if (radio) radio.checked = true;
    document.body.dataset.mode = mode;
}

function buildGrid(w, h) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'editor-grid');
    const minor = 50;
    const major = 250;
    for (let x = 0; x <= w; x += minor) {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', String(x));
        line.setAttribute('x2', String(x));
        line.setAttribute('y1', '0');
        line.setAttribute('y2', String(h));
        if (x % major === 0) line.classList.add('major');
        g.appendChild(line);
    }
    for (let y = 0; y <= h; y += minor) {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('y1', String(y));
        line.setAttribute('y2', String(y));
        line.setAttribute('x1', '0');
        line.setAttribute('x2', String(w));
        if (y % major === 0) line.classList.add('major');
        g.appendChild(line);
    }
    return g;
}

// ---------------------------------------------------------------------------
// Metadata bar input → state
// ---------------------------------------------------------------------------

function bindMetaInputs() {
    on(els.name,         'input', (v) => updateField('name', v));
    on(els.w,            'input', (v) => updateNumberField('viewbox_w', v, 1));
    on(els.h,            'input', (v) => updateNumberField('viewbox_h', v, 1));
    on(els.cards,        'input', (v) => updateNumberField('starting_train_cards', v, 0));
    on(els.minTeams,     'input', (v) => updateNumberField('min_teams', v, 2));
    on(els.maxTeams,     'input', (v) => updateNumberField('max_teams', v, 2));
    on(els.locos,        'input', (v) => updateNumberField('locomotives_count', v, 0));
    on(els.ticketsCount, 'input', (v) => updateNumberField('starting_tickets_count', v, 1));
    on(els.ticketsKeep,  'input', (v) => updateNumberField('starting_tickets_keep_min', v, 1));

    els.bgOpacity.addEventListener('input', () => {
        if (!state.bg) return;
        const pct = parseInt(els.bgOpacity.value, 10);
        state.bg.opacity = clamp(isNaN(pct) ? 50 : pct, 0, 100) / 100;
        renderCanvas();
    });
}

function on(input, event, fn) {
    input.addEventListener(event, () => fn(input.value));
}

function updateField(key, value) {
    state.data[key] = value;
    markDirty();
}

function updateNumberField(key, raw, min) {
    const n = parseInt(raw, 10);
    if (isNaN(n)) return;
    if (n < min) return;
    state.data[key] = n;
    markDirty();
    // Live-resize the canvas viewBox.
    if (key === 'viewbox_w' || key === 'viewbox_h') {
        renderCanvas();
    }
}

function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
}

// ---------------------------------------------------------------------------
// File actions
// ---------------------------------------------------------------------------

function onNew() {
    if (state.dirty && !confirm('Discard unsaved changes?')) return;
    state.data = defaultData();
    state.bg = null;
    state.selection = null;
    state.activeColorId = null;
    syncActiveColor();
    setBanner(null);
    markClean();
    render();
}

function onLoadJsonClick() {
    els.fileJson.value = '';
    els.fileJson.click();
}

async function onLoadJsonFile(file) {
    if (!file) return;
    let text;
    try {
        text = await file.text();
    } catch (e) {
        setBanner(`Could not read file: ${e.message}`, 'error');
        return;
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        setBanner(`Invalid JSON: ${e.message}`, 'error');
        return;
    }
    const merged = mergeWithDefaults(parsed);
    if (!merged) return;
    state.data = merged;
    state.selection = null;
    state.activeColorId = null;
    syncActiveColor();
    setBanner(null);
    markClean();
    render();
}

function mergeWithDefaults(parsed) {
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setBanner('JSON root must be an object.', 'error');
        return null;
    }
    const d = defaultData();
    // Scalars: copy when present and of the right primitive type.
    for (const k of [
        'name', 'viewbox_w', 'viewbox_h',
        'starting_train_cards', 'starting_tickets_count', 'starting_tickets_keep_min',
        'min_teams', 'max_teams', 'locomotives_count',
    ]) {
        if (k in parsed) d[k] = parsed[k];
    }
    // Arrays: only accept arrays; everything else falls back to [].
    for (const k of ['colors', 'stops', 'routes', 'tickets']) {
        if (Array.isArray(parsed[k])) d[k] = parsed[k];
    }
    return d;
}

function onSave() {
    const json = JSON.stringify(state.data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = filenameFor(state.data.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    markClean();
}

function filenameFor(name) {
    const slug = String(name || 'map')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'map';
    return `${slug}.json`;
}

function onLoadImageClick() {
    els.fileImage.value = '';
    els.fileImage.click();
}

function onLoadImageFile(file) {
    if (!file) return;
    // Replace any existing one.
    if (state.bg) URL.revokeObjectURL(state.bg.url);
    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => {
        state.bg = { url, opacity: 0.5 };
        if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
            state.data.viewbox_w = probe.naturalWidth;
            state.data.viewbox_h = probe.naturalHeight;
            markDirty();
        }
        render();
    };
    probe.onerror = () => {
        URL.revokeObjectURL(url);
        setBanner('Could not load image.', 'error');
    };
    probe.src = url;
}

function onClearImage() {
    if (state.bg) {
        URL.revokeObjectURL(state.bg.url);
        state.bg = null;
        render();
    }
}

// ---------------------------------------------------------------------------
// Mode selector — wired up but cosmetic in slice 1.
// ---------------------------------------------------------------------------

function bindModeRadios() {
    els.modeList.addEventListener('change', (e) => {
        const target = e.target;
        if (target instanceof HTMLInputElement && target.name === 'mode') {
            setMode(target.value);
        }
    });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function bootstrap() {
    bindMetaInputs();
    bindModeRadios();

    els.btnNew.addEventListener('click', onNew);
    els.btnLoadJson.addEventListener('click', onLoadJsonClick);
    els.btnLoadImage.addEventListener('click', onLoadImageClick);
    els.btnClearImage.addEventListener('click', onClearImage);
    els.btnSave.addEventListener('click', onSave);

    els.fileJson.addEventListener('change', () => {
        onLoadJsonFile(els.fileJson.files && els.fileJson.files[0]);
    });
    els.fileImage.addEventListener('change', () => {
        onLoadImageFile(els.fileImage.files && els.fileImage.files[0]);
    });

    // Warn before navigating away with unsaved changes.
    window.addEventListener('beforeunload', (e) => {
        if (!state.dirty) return;
        e.preventDefault();
        e.returnValue = '';
    });

    setMode(state.mode);
    syncActiveColor();
    render();
}

bootstrap();
