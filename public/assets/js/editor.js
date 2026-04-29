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
    editingTicket: null, // draft when editing/adding a ticket; { id?, ... } | null
    dirty: false,
};

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const els = {
    btnNew:        document.getElementById('btn-new'),
    btnLoadJson:   document.getElementById('btn-load-json'),
    btnLoadDb:     document.getElementById('btn-load-db'),
    btnLoadImage:  document.getElementById('btn-load-image'),
    btnClearImage: document.getElementById('btn-clear-image'),
    btnSave:       document.getElementById('btn-save'),
    btnSaveDb:     document.getElementById('btn-save-db'),
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
    ticketsList:   document.getElementById('tickets-list'),

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

let bannerClearTimer = null;

function setBanner(message, kind = 'info') {
    if (bannerClearTimer) {
        clearTimeout(bannerClearTimer);
        bannerClearTimer = null;
    }
    const empty = !message || (Array.isArray(message) && message.length === 0);
    if (empty) {
        els.banner.hidden = true;
        els.banner.replaceChildren();
        els.banner.classList.remove('error', 'success');
        return;
    }
    els.banner.classList.toggle('error',   kind === 'error');
    els.banner.classList.toggle('success', kind === 'success');
    els.banner.hidden = false;
    els.banner.replaceChildren();
    if (Array.isArray(message)) {
        const heading = document.createElement('strong');
        heading.textContent = `${message.length} validation error${message.length === 1 ? '' : 's'}:`;
        els.banner.appendChild(heading);
        const ul = document.createElement('ul');
        ul.className = 'editor-banner-list';
        for (const m of message) {
            const li = document.createElement('li');
            li.textContent = m;
            ul.appendChild(li);
        }
        els.banner.appendChild(ul);
    } else {
        els.banner.textContent = message;
    }
    if (kind === 'success') {
        bannerClearTimer = setTimeout(() => setBanner(null), 5000);
    }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render() {
    renderMeta();
    renderCanvas();
    renderColors();
    renderProperties();
    renderTickets();
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

// ---------------------------------------------------------------------------
// Tickets panel
// ---------------------------------------------------------------------------

function renderTickets() {
    const list = els.ticketsList;
    list.replaceChildren();

    if (state.editingTicket !== null) {
        list.appendChild(renderTicketEditor());
    } else {
	    const addBtn = document.createElement('button');
	    addBtn.type = 'button';
	    addBtn.className = 'add-ticket-btn';
	    addBtn.textContent = '+ Add ticket';
	    if (state.data.stops.length < 2) {
	        addBtn.disabled = true;
	        addBtn.title = 'Add at least 2 stops first.';
	    }
	    addBtn.addEventListener('click', beginNewTicket);
	    list.appendChild(addBtn);
	}

    const visible = state.editingTicket !== null && state.editingTicket.id !== undefined
        ? state.data.tickets.filter((t) => t.id !== state.editingTicket.id)
        : state.data.tickets;

    if (visible.length === 0 && state.editingTicket === null) {
        list.appendChild(hintP('No tickets yet.'));
    } else {
        for (const t of visible) {
            list.appendChild(renderTicketRow(t));
        }
    }
}

function renderTicketRow(ticket) {
    const card = document.createElement('div');
    card.className = 'ticket-card';

    const route = document.createElement('div');
    route.className = 'ticket-card-route';
    const from = state.data.stops.find((s) => s.id === ticket.from_stop_id);
    const to   = state.data.stops.find((s) => s.id === ticket.to_stop_id);
    const fromName = from ? from.display_name : `#${ticket.from_stop_id}`;
    const toName   = to   ? to.display_name   : `#${ticket.to_stop_id}`;

    const text = document.createElement('span');
    text.textContent = `${fromName} → ${toName}`;
    route.appendChild(text);

    if (ticket.is_long_route) {
        const badge = document.createElement('span');
        badge.className = 'ticket-long-badge';
        badge.textContent = 'long';
        route.append(' ', badge);
    }
    card.appendChild(route);

    const meta = document.createElement('div');
    meta.className = 'ticket-card-meta';

    const pts = document.createElement('span');
    pts.className = 'ticket-card-pts';
    pts.textContent = `${ticket.points} pt${ticket.points === 1 ? '' : 's'}`;
    meta.appendChild(pts);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'ticket-edit-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => beginEditTicket(ticket.id));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'ticket-delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Delete ticket';
    deleteBtn.addEventListener('click', () => deleteTicket(ticket.id));

    meta.append(editBtn, deleteBtn);
    card.appendChild(meta);

    return card;
}

function renderTicketEditor() {
    const draft = state.editingTicket;
    const card = document.createElement('div');
    card.className = 'ticket-editor';

    const title = document.createElement('h3');
    title.className = 'ticket-editor-title';
    title.textContent = draft.id === undefined
        ? 'New ticket'
        : `Edit ticket #${draft.id}`;
    card.appendChild(title);

    const stopOptions = [...state.data.stops]
        .sort((a, b) => a.display_name.localeCompare(b.display_name))
        .map((s) => ({ value: String(s.id), label: s.display_name }));

    // Refs filled below; updateValidation reads them via closure.
    let errorEl, saveBtn;
    const updateValidation = () => {
        const error = validateTicketDraft(draft);
        errorEl.textContent = error || '';
        errorEl.hidden = !error;
        saveBtn.disabled = error !== null;
    };

    card.appendChild(ticketField('From', stopSelect(stopOptions, draft.from_stop_id, (v) => {
        draft.from_stop_id = v;
        updateValidation();
    })));
    card.appendChild(ticketField('To', stopSelect(stopOptions, draft.to_stop_id, (v) => {
        draft.to_stop_id = v;
        updateValidation();
    })));

    const ptsInput = document.createElement('input');
    ptsInput.type = 'number';
    ptsInput.min = '1';
    ptsInput.step = '1';
    ptsInput.value = String(draft.points);
    ptsInput.className = 'ticket-pts-input';
    ptsInput.addEventListener('input', () => {
        const n = parseInt(ptsInput.value, 10);
        draft.points = isNaN(n) ? 0 : n;
        updateValidation();
    });
    ptsInput.addEventListener('blur', () => {
        if (!Number.isFinite(draft.points) || draft.points < 1) {
            draft.points = 1;
            ptsInput.value = '1';
            updateValidation();
        }
    });
    card.appendChild(ticketField('Points', ptsInput));

    const longRow = document.createElement('label');
    longRow.className = 'ticket-long-row';
    const longInput = document.createElement('input');
    longInput.type = 'checkbox';
    longInput.checked = draft.is_long_route;
    longInput.addEventListener('change', () => {
        draft.is_long_route = longInput.checked;
    });
    const longSpan = document.createElement('span');
    longSpan.textContent = 'Long route';
    longRow.append(longInput, longSpan);
    card.appendChild(longRow);

    errorEl = document.createElement('p');
    errorEl.className = 'ticket-editor-error';
    card.appendChild(errorEl);

    const actions = document.createElement('div');
    actions.className = 'ticket-editor-actions';

    saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'ticket-save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', saveTicketDraft);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ticket-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', cancelTicketDraft);

    actions.append(saveBtn, cancelBtn);
    card.appendChild(actions);

    updateValidation();
    return card;
}

function ticketField(labelText, control) {
    const row = document.createElement('label');
    row.className = 'ticket-field';
    const l = document.createElement('span');
    l.className = 'ticket-field-label';
    l.textContent = labelText;
    row.append(l, control);
    return row;
}

function stopSelect(options, currentValue, onChange) {
    const sel = document.createElement('select');
    sel.className = 'ticket-stop-select';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select…';
    placeholder.disabled = true;
    sel.appendChild(placeholder);

    for (const opt of options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        sel.appendChild(o);
    }
    sel.value = currentValue !== null ? String(currentValue) : '';
    sel.addEventListener('change', () => {
        const val = sel.value === '' ? null : parseInt(sel.value, 10);
        onChange(val);
    });
    return sel;
}

function validateTicketDraft(draft) {
    if (draft.from_stop_id === null) return 'Pick a from-stop.';
    if (draft.to_stop_id === null)   return 'Pick a to-stop.';
    if (draft.from_stop_id === draft.to_stop_id) {
        return 'From and to must be different stops.';
    }
    if (!Number.isFinite(draft.points) || draft.points < 1) {
        return 'Points must be at least 1.';
    }
    const a = Math.min(draft.from_stop_id, draft.to_stop_id);
    const b = Math.max(draft.from_stop_id, draft.to_stop_id);
    for (const t of state.data.tickets) {
        if (draft.id !== undefined && t.id === draft.id) continue;
        const ta = Math.min(t.from_stop_id, t.to_stop_id);
        const tb = Math.max(t.from_stop_id, t.to_stop_id);
        if (ta === a && tb === b) {
            return 'A ticket between these stops already exists.';
        }
    }
    return null;
}

function beginNewTicket() {
    state.editingTicket = {
        from_stop_id: null,
        to_stop_id: null,
        points: 5,
        is_long_route: false,
    };
    renderTickets();
}

function beginEditTicket(id) {
    const t = state.data.tickets.find((x) => x.id === id);
    if (!t) return;
    state.editingTicket = {
        id: t.id,
        from_stop_id: t.from_stop_id,
        to_stop_id: t.to_stop_id,
        points: t.points,
        is_long_route: t.is_long_route,
    };
    renderTickets();
}

function cancelTicketDraft() {
    state.editingTicket = null;
    renderTickets();
}

function saveTicketDraft() {
    const draft = state.editingTicket;
    if (validateTicketDraft(draft) !== null) return;

    if (draft.id === undefined) {
        const id = nextId(state.data.tickets);
        state.data.tickets.push({
            id,
            from_stop_id: draft.from_stop_id,
            to_stop_id: draft.to_stop_id,
            points: draft.points,
            is_long_route: draft.is_long_route,
        });
    } else {
        const t = state.data.tickets.find((x) => x.id === draft.id);
        if (t) {
            t.from_stop_id  = draft.from_stop_id;
            t.to_stop_id    = draft.to_stop_id;
            t.points        = draft.points;
            t.is_long_route = draft.is_long_route;
        }
    }
    state.editingTicket = null;
    markDirty();
    renderTickets();
}

function deleteTicket(id) {
    const idx = state.data.tickets.findIndex((t) => t.id === id);
    if (idx === -1) return;
    state.data.tickets.splice(idx, 1);
    markDirty();
    renderTickets();
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
    const x = Math.round(pt.x);
    const y = Math.round(pt.y);

    if (!state.selection) {
        moveAllRelativeToCentroid(x, y);
        return;
    }
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

function moveAllRelativeToCentroid(targetX, targetY) {
    const stops = state.data.stops;
    if (stops.length === 0) return;

    let sumX = 0;
    let sumY = 0;
    for (const s of stops) {
        sumX += s.x;
        sumY += s.y;
    }
    const cx = sumX / stops.length;
    const cy = sumY / stops.length;

    const dx = Math.round(targetX - cx);
    const dy = Math.round(targetY - cy);
    if (dx === 0 && dy === 0) return;

    for (const s of stops) {
        s.x += dx;
        s.y += dy;
    }
    for (const r of state.data.routes) {
        if (r.via_x !== null && r.via_y !== null) {
            r.via_x += dx;
            r.via_y += dy;
        }
    }
    markDirty();
    render();
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
    state.editingTicket = null;
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
    state.editingTicket = null;
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
    const errors = validateMap(state.data);
    if (errors.length > 0) {
        setBanner(errors, 'error');
        return;
    }
    setBanner(null);

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

function validateMap(d) {
    const errors = [];

    // Map-level scalars
    if (typeof d.name !== 'string' || d.name.trim() === '') {
        errors.push('Name is required.');
    }
    if (!(d.viewbox_w > 0))            errors.push('Width must be greater than 0.');
    if (!(d.viewbox_h > 0))            errors.push('Height must be greater than 0.');
    if (!(d.starting_train_cards >= 0)) errors.push('Starting cards must be ≥ 0.');
    if (!(d.locomotives_count >= 0))   errors.push('Locomotives must be ≥ 0.');
    if (!(d.min_teams >= 2))           errors.push('Min teams must be ≥ 2.');
    if (!(d.max_teams >= d.min_teams)) errors.push('Max teams must be ≥ min teams.');
    if (!(d.max_teams <= 5))           errors.push('Max teams must be ≤ 5.');
    if (!(d.starting_tickets_keep_min >= 1)) {
        errors.push('Tickets keep min must be ≥ 1.');
    }
    if (!(d.starting_tickets_count >= d.starting_tickets_keep_min)) {
        errors.push('Tickets initial must be ≥ keep min.');
    }

    // Stops
    const stopIds   = new Set();
    const stopNames = new Map();
    for (const s of d.stops) {
        stopIds.add(s.id);
        if (typeof s.display_name !== 'string' || s.display_name.trim() === '') {
            errors.push(`Stop #${s.id}: name is required.`);
            continue;
        }
        const n = s.display_name.trim();
        if (stopNames.has(n)) {
            errors.push(`Duplicate stop name "${n}" (stops #${stopNames.get(n)} and #${s.id}).`);
        } else {
            stopNames.set(n, s.id);
        }
    }

    // Colors
    const colorIds = new Set(d.colors.map((c) => c.id));
    if (d.routes.length > 0 && d.colors.length === 0) {
        errors.push('At least one color is required when routes exist.');
    }

    // Routes
    const routeKeys = new Map();
    for (const r of d.routes) {
        if (!stopIds.has(r.from_stop_id)) {
            errors.push(`Route #${r.id}: from-stop #${r.from_stop_id} does not exist.`);
        }
        if (!stopIds.has(r.to_stop_id)) {
            errors.push(`Route #${r.id}: to-stop #${r.to_stop_id} does not exist.`);
        }
        if (r.from_stop_id === r.to_stop_id) {
            errors.push(`Route #${r.id}: from-stop and to-stop must differ.`);
        }
        if (!(r.length >= 1 && r.length <= 6)) {
            errors.push(`Route #${r.id}: length must be between 1 and 6.`);
        }
        if (!colorIds.has(r.color_id)) {
            errors.push(`Route #${r.id}: color #${r.color_id} does not exist.`);
        }
        if ((r.via_x === null) !== (r.via_y === null)) {
            errors.push(`Route #${r.id}: via_x and via_y must both be set or both null.`);
        }
        const a = Math.min(r.from_stop_id, r.to_stop_id);
        const b = Math.max(r.from_stop_id, r.to_stop_id);
        const key = `${a}-${b}-${r.parallel_index}`;
        if (routeKeys.has(key)) {
            errors.push(
                `Routes #${routeKeys.get(key)} and #${r.id} share the same stop pair `
                + `with parallel index ${r.parallel_index}.`,
            );
        } else {
            routeKeys.set(key, r.id);
        }
    }

    // Tickets
    const ticketKeys = new Map();
    let regularTickets = 0;
    let longTickets    = 0;
    for (const t of d.tickets) {
        if (!stopIds.has(t.from_stop_id)) {
            errors.push(`Ticket #${t.id}: from-stop #${t.from_stop_id} does not exist.`);
        }
        if (!stopIds.has(t.to_stop_id)) {
            errors.push(`Ticket #${t.id}: to-stop #${t.to_stop_id} does not exist.`);
        }
        if (t.from_stop_id === t.to_stop_id) {
            errors.push(`Ticket #${t.id}: from-stop and to-stop must differ.`);
        }
        if (!(t.points >= 1)) {
            errors.push(`Ticket #${t.id}: points must be ≥ 1.`);
        }
        const a = Math.min(t.from_stop_id, t.to_stop_id);
        const b = Math.max(t.from_stop_id, t.to_stop_id);
        const key = `${a}-${b}`;
        if (ticketKeys.has(key)) {
            errors.push(
                `Tickets #${ticketKeys.get(key)} and #${t.id} have the same endpoints `
                + `(direction does not matter).`,
            );
        } else {
            ticketKeys.set(key, t.id);
        }
        if (t.is_long_route) longTickets++;
        else                 regularTickets++;
    }

    // Ticket pool sized for a full table
    const needRegular = (d.starting_tickets_count || 0) * (d.max_teams || 0);
    if (regularTickets < needRegular) {
        errors.push(
            `Need at least ${needRegular} regular tickets for a full ${d.max_teams}-team game `
            + `(have ${regularTickets}).`,
        );
    }
    if (longTickets < (d.max_teams || 0)) {
        errors.push(
            `Need at least ${d.max_teams} long-route tickets for a full ${d.max_teams}-team game `
            + `(have ${longTickets}).`,
        );
    }

    return errors;
}

function filenameFor(name) {
    const slug = String(name || 'map')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'map';
    return `${slug}.json`;
}

function onSaveToDb() {
    const errors = validateMap(state.data);
    if (errors.length > 0) {
        setBanner(errors, 'error');
        return;
    }
    setBanner(null);
    showSaveToDbDialog();
}

function showSaveToDbDialog() {
    const dlg = document.createElement('dialog');
    dlg.className = 'save-db-dialog';
    document.body.appendChild(dlg);

    let countdownTimer = null;
    const cleanup = () => {
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
    };
    dlg.addEventListener('close', () => {
        cleanup();
        dlg.remove();
    });

    showRequestPhase();
    dlg.showModal();

    function showRequestPhase(errorText) {
        cleanup();
        dlg.replaceChildren();
        appendTitle('Save map to database');

        const p = document.createElement('p');
        p.className = 'save-db-text';
        p.textContent = `A one-time password will be emailed to the configured admin address. `
            + `Enter it once received to authorise saving "${state.data.name}".`;
        dlg.appendChild(p);

        if (errorText) appendError(errorText);

        const actions = document.createElement('div');
        actions.className = 'save-db-actions';
        actions.append(
            btn('Cancel', () => dlg.close('cancel')),
            btn('Send password', sendOtp, 'primary'),
        );
        dlg.appendChild(actions);
    }

    async function sendOtp() {
        showSendingPhase();
        let resp;
        try {
            resp = await fetch('/api/editor/maps/request-otp', { method: 'POST' });
        } catch (e) {
            showRequestPhase(`Could not contact server: ${e.message}`);
            return;
        }
        let data = null;
        try { data = await resp.json(); } catch { /* ignore */ }
        if (!resp.ok) {
            const msg = (data && data.message) || `Server error (HTTP ${resp.status}).`;
            showRequestPhase(msg);
            return;
        }
        const ttl = (data && data.expires_in_seconds) || 300;
        showEnterPhase(Date.now() + ttl * 1000);
    }

    function showSendingPhase() {
        cleanup();
        dlg.replaceChildren();
        appendTitle('Save map to database');
        const p = document.createElement('p');
        p.className = 'save-db-text';
        p.textContent = 'Sending password…';
        dlg.appendChild(p);
    }

    function showEnterPhase(expiresAtMs, errorText) {
        cleanup();
        dlg.replaceChildren();
        appendTitle('Enter one-time password');

        const p = document.createElement('p');
        p.className = 'save-db-text';
        p.textContent = 'Enter the password from your email to save the map.';
        dlg.appendChild(p);

        const countdown = document.createElement('p');
        countdown.className = 'save-db-countdown';
        dlg.appendChild(countdown);

        const otpInput = document.createElement('input');
        otpInput.type = 'text';
        otpInput.inputMode = 'numeric';
        otpInput.autocomplete = 'one-time-code';
        otpInput.pattern = '\\d{6}';
        otpInput.maxLength = 6;
        otpInput.placeholder = '6-digit code';
        otpInput.className = 'save-db-otp-input';
        dlg.appendChild(otpInput);

        if (errorText) appendError(errorText);

        const actions = document.createElement('div');
        actions.className = 'save-db-actions';
        const cancel = btn('Cancel', () => dlg.close('cancel'));
        const save = btn('Save', () => doSave(otpInput.value, expiresAtMs), 'primary');
        save.disabled = true;
        actions.append(cancel, save);
        dlg.appendChild(actions);

        otpInput.addEventListener('input', () => {
            // Strip non-digits to make pasting easier.
            const cleaned = otpInput.value.replace(/\D+/g, '').slice(0, 6);
            if (cleaned !== otpInput.value) otpInput.value = cleaned;
            save.disabled = !/^\d{6}$/.test(otpInput.value) || Date.now() >= expiresAtMs;
        });
        otpInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !save.disabled) {
                e.preventDefault();
                doSave(otpInput.value, expiresAtMs);
            }
        });
        otpInput.focus();

        const tick = () => {
            const ms = Math.max(0, expiresAtMs - Date.now());
            if (ms <= 0) {
                countdown.textContent = 'Password expired — cancel and start over.';
                countdown.classList.add('expired');
                save.disabled = true;
                if (countdownTimer) {
                    clearInterval(countdownTimer);
                    countdownTimer = null;
                }
                return;
            }
            const totalSec = Math.ceil(ms / 1000);
            const m = Math.floor(totalSec / 60);
            const s = totalSec % 60;
            countdown.textContent = `Valid for ${m}:${String(s).padStart(2, '0')}.`;
        };
        tick();
        countdownTimer = setInterval(tick, 1000);
    }

    async function doSave(otp, expiresAtMs) {
        showSavingPhase();
        let resp;
        try {
            resp = await fetch('/api/editor/maps', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ otp, map: state.data }),
            });
        } catch (e) {
            showEnterPhase(expiresAtMs, `Could not contact server: ${e.message}`);
            return;
        }
        let data = null;
        try { data = await resp.json(); } catch { /* ignore */ }
        if (!resp.ok) {
            const msg = (data && data.message) || `Server error (HTTP ${resp.status}).`;
            // OTP-related failures: send back to phase 1 so a new code is requested.
            if (data && data.error === 'otp_invalid') {
                showRequestPhase(msg);
            } else {
                showEnterPhase(expiresAtMs, msg);
            }
            return;
        }
        markClean();
        const name    = (data && data.name)    || state.data.name;
        const version = (data && data.version) || '?';
        setBanner(`Saved as "${name}" v${version}.`, 'success');
        dlg.close('saved');
    }

    function showSavingPhase() {
        cleanup();
        dlg.replaceChildren();
        appendTitle('Saving…');
        const p = document.createElement('p');
        p.className = 'save-db-text';
        p.textContent = 'Submitting map to database…';
        dlg.appendChild(p);
    }

    function appendTitle(text) {
        const h = document.createElement('h2');
        h.className = 'save-db-title';
        h.textContent = text;
        dlg.appendChild(h);
    }

    function appendError(text) {
        const e = document.createElement('p');
        e.className = 'save-db-error';
        e.textContent = text;
        dlg.appendChild(e);
    }

    function btn(label, onClick, cls) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        if (cls) b.className = cls;
        b.addEventListener('click', onClick);
        return b;
    }
}

async function onLoadFromDb() {
    let listResp;
    try {
        listResp = await fetch('/api/editor/maps');
    } catch (e) {
        setBanner(`Could not contact server: ${e.message}`, 'error');
        return;
    }
    if (!listResp.ok) {
        setBanner(`Could not load map list (HTTP ${listResp.status}).`, 'error');
        return;
    }
    let listData;
    try {
        listData = await listResp.json();
    } catch (e) {
        setBanner(`Map list: ${e.message}`, 'error');
        return;
    }
    const maps = (listData && Array.isArray(listData.maps)) ? listData.maps : [];
    if (maps.length === 0) {
        setBanner('No maps in the database yet.', 'error');
        return;
    }

    const chosenId = await showDbLoadDialog(maps);
    if (chosenId === null) return;

    let mapResp;
    try {
        mapResp = await fetch(`/api/editor/maps/${encodeURIComponent(chosenId)}`);
    } catch (e) {
        setBanner(`Could not contact server: ${e.message}`, 'error');
        return;
    }
    if (!mapResp.ok) {
        setBanner(`Could not load map (HTTP ${mapResp.status}).`, 'error');
        return;
    }
    let mapData;
    try {
        mapData = await mapResp.json();
    } catch (e) {
        setBanner(`Map data: ${e.message}`, 'error');
        return;
    }

    const merged = mergeWithDefaults(mapData);
    if (!merged) return;
    state.data = merged;
    state.selection = null;
    state.activeColorId = null;
    state.editingTicket = null;
    syncActiveColor();
    setBanner(null);
    markClean();
    render();
}

function showDbLoadDialog(maps) {
    return new Promise((resolve) => {
        const dlg = document.createElement('dialog');
        dlg.className = 'load-db-dialog';

        const title = document.createElement('h2');
        title.className = 'load-db-title';
        title.textContent = 'Load map from database';
        dlg.appendChild(title);

        const sel = document.createElement('select');
        sel.className = 'load-db-select';
        for (const m of maps) {
            const opt = document.createElement('option');
            opt.value = String(m.id);
            opt.textContent = `${m.name} (v${m.version})`;
            sel.appendChild(opt);
        }
        sel.value = String(maps[0].id);
        dlg.appendChild(sel);

        const actions = document.createElement('div');
        actions.className = 'load-db-actions';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => dlg.close('cancel'));

        const load = document.createElement('button');
        load.type = 'button';
        load.className = 'primary';
        load.textContent = 'Load';
        load.addEventListener('click', () => dlg.close('load'));

        sel.addEventListener('dblclick', () => dlg.close('load'));
        sel.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                dlg.close('load');
            }
        });

        actions.append(cancel, load);
        dlg.appendChild(actions);

        dlg.addEventListener('close', () => {
            const result = dlg.returnValue === 'load' ? parseInt(sel.value, 10) : null;
            dlg.remove();
            resolve(Number.isFinite(result) ? result : null);
        });

        document.body.appendChild(dlg);
        dlg.showModal();
    });
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
    els.btnLoadDb.addEventListener('click', onLoadFromDb);
    els.btnLoadImage.addEventListener('click', onLoadImageClick);
    els.btnClearImage.addEventListener('click', onClearImage);
    els.btnSave.addEventListener('click', onSave);
    els.btnSaveDb.addEventListener('click', onSaveToDb);

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
