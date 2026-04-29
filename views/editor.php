<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Map Editor · Route Rush</title>
    <link rel="stylesheet" href="/assets/css/editor.css">
</head>
<body class="editor-body">

<header class="editor-header">
    <h1 class="editor-title">Route Rush · Map Editor</h1>
    <div class="editor-actions">
        <button type="button" id="btn-new">New</button>
        <button type="button" id="btn-load-json">Load JSON…</button>
        <button type="button" id="btn-load-image">Load image…</button>
        <button type="button" id="btn-clear-image" hidden>Clear image</button>
        <button type="button" id="btn-save" class="primary">Save…</button>
        <span class="dirty-flag" id="dirty-flag" title="Unsaved changes" hidden>●</span>
    </div>
</header>

<section class="editor-meta">
    <label>Name <input id="meta-name" type="text" autocomplete="off"></label>
    <label>Width <input id="meta-w" type="number" min="1" step="1"></label>
    <label>Height <input id="meta-h" type="number" min="1" step="1"></label>
    <label>Starting cards <input id="meta-cards" type="number" min="0" step="1"></label>
    <label>Min teams <input id="meta-min-teams" type="number" min="2" max="5" step="1"></label>
    <label>Max teams <input id="meta-max-teams" type="number" min="2" max="5" step="1"></label>
    <label>Locomotives <input id="meta-locos" type="number" min="0" step="1"></label>
    <label>Tickets initial <input id="meta-tickets-count" type="number" min="1" step="1"></label>
    <label>Keep min <input id="meta-tickets-keep" type="number" min="1" step="1"></label>
    <label class="bg-opacity" id="bg-opacity-wrap" hidden>
        Image opacity
        <input id="meta-bg-opacity" type="range" min="0" max="100" value="50">
    </label>
</section>

<p class="editor-banner" id="editor-banner" hidden></p>

<main class="editor-main">

    <aside class="editor-rail editor-rail-left">
        <h2>Mode</h2>
        <div class="mode-list" id="mode-list">
            <label><input type="radio" name="mode" value="select" checked> Select</label>
            <label><input type="radio" name="mode" value="move"> Move</label>
            <label><input type="radio" name="mode" value="add-stop"> Add stop</label>
            <label><input type="radio" name="mode" value="add-route"> Add route</label>
            <label><input type="radio" name="mode" value="delete"> Delete</label>
        </div>

        <h2>Colors</h2>
        <div class="colors-panel" id="colors-list"></div>
    </aside>

    <section class="editor-canvas-wrap">
        <div class="editor-canvas" id="editor-canvas"></div>
    </section>

    <aside class="editor-rail editor-rail-right">
        <h2>Properties</h2>
        <div class="placeholder-panel" id="properties-panel">
            <p class="hint">Nothing selected.</p>
        </div>

        <h2>Tickets</h2>
        <div class="tickets-panel" id="tickets-list"></div>
    </aside>

</main>

<input type="file" id="file-input-json"  accept=".json,application/json" hidden>
<input type="file" id="file-input-image" accept="image/*"                hidden>

<script src="/assets/js/editor.js" type="module"></script>
</body>
</html>
