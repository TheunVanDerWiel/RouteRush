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
    <title>Lobby <?= View::escape($code) ?> · Route Rush</title>
    <link rel="stylesheet" href="/assets/css/app.css">
</head>
<body data-game-code="<?= View::escape($code) ?>" data-player-id="<?= $player_id !== null ? (int) $player_id : '' ?>">
<main class="container">
    <header>
        <h1>Lobby</h1>
        <p class="room-code" aria-label="Room code"><?= View::escape($code) ?></p>
        <p class="hint">Share this code with the other teams.</p>
    </header>

    <section class="card" id="game-info" hidden>
        <h2 id="map-name"></h2>
        <p>Duration: <span id="duration"></span> minutes</p>
    </section>

    <section class="card">
        <h2>Teams</h2>
        <ul id="team-list" class="team-list">
            <li class="empty">Loading…</li>
        </ul>
    </section>

    <section class="card" id="create-team-section">
        <h2>Create your team</h2>
        <p class="hint">A 4-digit PIN will be assigned for your teammate to join.</p>
        <form id="create-team-form" novalidate>
            <label>
                Team name
                <input type="text" name="team_name" maxlength="50" required autocomplete="off">
            </label>
            <label>
                Your name
                <input type="text" name="player_name" maxlength="50" required autocomplete="off">
            </label>
            <button type="submit">Create team</button>
            <p class="error" id="create-team-error" role="alert"></p>
        </form>
    </section>

    <section class="card" id="joined-section" hidden>
        <h2>You're in</h2>
        <p id="joined-summary"></p>
        <div id="pin-display" hidden>
            <p class="hint">Share this PIN with your teammate so they can join:</p>
            <p class="team-pin" aria-label="Team PIN"><span id="team-pin"></span></p>
        </div>
        <p class="hint">Waiting for other teams. The host can start the game when everyone is ready.</p>
    </section>
</main>
<script src="/assets/js/lobby.js" type="module"></script>
</body>
</html>
