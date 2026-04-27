<?php
/** @var string $code */
/** @var int|null $player_id */
use RouteRush\View;
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Game <?= View::escape($code) ?> · Route Rush</title>
    <link rel="stylesheet" href="/assets/css/app.css">
</head>
<body class="game-body" data-game-code="<?= View::escape($code) ?>" data-player-id="<?= $player_id !== null ? (int) $player_id : '' ?>">

<header class="game-header">
    <div class="game-header-cell">
        <span class="game-header-label">Room</span>
        <span class="game-header-value mono"><?= View::escape($code) ?></span>
    </div>
    <div class="game-header-cell">
        <span class="game-header-label">Time left</span>
        <span class="game-header-value mono" id="countdown">--:--</span>
    </div>
    <div class="game-header-cell">
        <span class="game-header-label">Deck</span>
        <span class="game-header-value mono" id="deck-remaining">--</span>
    </div>
</header>

<main class="container game-container" id="game-container">

    <section class="card map-card">
        <div class="map-frame" id="map-frame" role="img" aria-label="Game map"></div>
    </section>

    <section class="card hand-card">
        <h2>Your hand</h2>
        <ul class="hand-list" id="hand"></ul>
    </section>

    <section class="card actions-card">
        <h2>Actions</h2>
        <p class="hint">
            <span class="mono" id="windows-available">—</span> draw windows available
            · next window in <span class="mono" id="next-window">--:--</span>
        </p>
        <div class="action-grid">
            <button type="button" id="btn-draw-cards" disabled>Draw 2 cards</button>
            <button type="button" id="btn-draw-tickets" disabled>Draw tickets</button>
            <button type="button" id="btn-trade-3-2" disabled>Trade 3 → 2</button>
            <button type="button" id="btn-trade-3-loco" disabled>Trade 3 → loco</button>
        </div>
        <p class="hint">Tap a route on the map to claim it.</p>
    </section>

    <section class="card tickets-card">
        <h2>Your tickets</h2>
        <div class="tickets-pending" id="tickets-pending" hidden>
            <p class="hint">
                Pick which to keep
                (at least <span id="tickets-min-keep" class="mono">1</span>),
                then confirm:
            </p>
            <ul class="tickets-list" id="tickets-pending-list"></ul>
            <p class="error" id="tickets-decide-error"></p>
            <button type="button" id="tickets-decide-btn">Confirm choices</button>
        </div>
        <ul class="tickets-list" id="tickets-kept">
            <li class="ticket-row placeholder-row empty" id="tickets-empty">No tickets yet.</li>
        </ul>
    </section>

    <section class="card teams-card">
        <h2>Other teams</h2>
        <ul class="team-list" id="other-teams">
            <li data-color-index="1" class="placeholder-row">
                <span class="swatch" aria-hidden="true"></span>
                <span class="name">Bussen</span>
                <span class="meta mono">5 cards · 2 routes</span>
            </li>
            <li data-color-index="2" class="placeholder-row">
                <span class="swatch" aria-hidden="true"></span>
                <span class="name">Trams</span>
                <span class="meta mono">7 cards · 1 route</span>
            </li>
        </ul>
    </section>

    <section class="card log-card">
        <h2>Recent activity</h2>
        <ul class="log-list">
            <li class="log-row placeholder-row"><span class="log-time mono">14:32</span> Bussen claimed a route</li>
            <li class="log-row placeholder-row"><span class="log-time mono">14:30</span> Trams drew 2 cards</li>
            <li class="log-row placeholder-row"><span class="log-time mono">14:28</span> Game started</li>
        </ul>
    </section>

</main>

<main class="container scoreboard-container" id="scoreboard" hidden>
    <section class="card">
        <h1 class="scoreboard-title">Game over</h1>
        <p class="hint">Final standings</p>
    </section>
    <ol class="scoreboard-list" id="scoreboard-list"></ol>
    <section class="card scoreboard-actions">
        <a class="home-link" href="/">Back to home</a>
    </section>
</main>
<script src="/assets/js/game.js" type="module"></script>
</body>
</html>
