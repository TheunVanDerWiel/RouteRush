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

<main class="container game-container">

    <section class="card map-card">
        <div class="placeholder map-placeholder" id="game-map" role="img" aria-label="Map placeholder">
            <span class="placeholder-label">Map</span>
            <span class="placeholder-hint">Pinch-zoom &amp; pan SVG. Stops, routes, and team claims will render here.</span>
        </div>
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
            <button type="button" disabled>Draw 2 cards</button>
            <button type="button" disabled>Draw tickets</button>
            <button type="button" disabled>Trade 3 → 2</button>
            <button type="button" disabled>Trade 3 → loco</button>
        </div>
        <p class="hint">Tap a route on the map to claim it.</p>
    </section>

    <section class="card tickets-card">
        <h2>Your tickets</h2>
        <ul class="tickets-list">
            <li class="ticket-row placeholder-row">
                <span class="ticket-route">Centraal → Uithof</span>
                <span class="ticket-points mono">8 pts</span>
            </li>
            <li class="ticket-row placeholder-row">
                <span class="ticket-route">Overvecht → Lunetten</span>
                <span class="ticket-points mono">6 pts</span>
            </li>
            <li class="ticket-row placeholder-row long">
                <span class="ticket-route">Vleuten → Nieuwegein <span class="badge">long</span></span>
                <span class="ticket-points mono">12 pts</span>
            </li>
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
<script src="/assets/js/game.js" type="module"></script>
</body>
</html>
