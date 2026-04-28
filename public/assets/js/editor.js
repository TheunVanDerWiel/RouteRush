/* Route Rush · Map Editor — slice 1
 *
 * Scope: layout shell + toolbar + metadata bar + empty SVG canvas + load/save
 * round-trip + background-image overlay. No editing features yet.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

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
        colors: [],
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

    // Future slices append routes / stops / overlays here.

    els.canvas.replaceChildren(svg);
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
            state.mode = target.value;
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

    render();
}

bootstrap();
