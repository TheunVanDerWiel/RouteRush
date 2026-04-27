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

    <section class="card" id="join-team-section">
        <h2>Join an existing team</h2>
        <p class="hint">Ask your teammate for the 4-digit PIN they were given.</p>
        <form id="join-team-form" novalidate>
            <label>
                Team
                <select name="team_id" required>
                    <option value="">Select a team…</option>
                </select>
            </label>
            <label>
                Your name
                <input type="text" name="player_name" maxlength="50" required autocomplete="off">
            </label>
            <label>
                4-digit PIN
                <input
                    type="text" name="pin" inputmode="numeric" pattern="\d{4}"
                    maxlength="4" minlength="4" required autocomplete="off"
                >
            </label>
            <button type="submit">Join team</button>
            <p class="error" id="join-team-error" role="alert"></p>
        </form>
    </section>

    <section class="card" id="joined-section" hidden>
        <h2>You're in</h2>
        <p id="joined-summary"></p>
        <div id="pin-display" hidden>
            <p class="hint">Share this PIN with your teammate so they can join:</p>
            <p class="team-pin" aria-label="Team PIN"><span id="team-pin"></span></p>
        </div>
        <div id="host-controls" hidden>
            <button id="start-game-btn" type="button">Start game</button>
            <p class="error" id="start-error" role="alert"></p>
        </div>
        <p class="hint" id="waiting-hint" hidden>Waiting for the host to start the game.</p>
    </section>

    <section class="card" id="in-progress-section" hidden>
        <h2>The game has started!</h2>
        <p class="hint">In-game UI is coming soon.</p>
    </section>
</main>
<script src="/assets/js/lobby.js" type="module"></script>
</body>
</html>
