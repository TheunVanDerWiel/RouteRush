<?php
/** @var array $maps */
use RouteRush\View;
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Route Rush</title>
    <link rel="stylesheet" href="/assets/css/app.css">
</head>
<body>
<main class="container">
    <header>
        <h1>Route Rush</h1>
        <p class="tagline">Ticket to Ride, played on real public transport.</p>
        <p><a href="/rules" target="_blank" rel="noopener" class="rules-button">Rules</a></p>
    </header>

    <section class="card">
        <h2>Start a new game</h2>
        <form id="create-game-form" novalidate>
            <label>
                Map
                <select name="map_id" required>
                    <?php foreach ($maps as $m): ?>
                        <option
                            value="<?= (int) $m['id'] ?>"
                            data-min="<?= (int) $m['min_teams'] ?>"
                            data-max="<?= (int) $m['max_teams'] ?>"
                        >
                            <?= View::escape($m['name']) ?>
                            (<?= (int) $m['min_teams'] ?>–<?= (int) $m['max_teams'] ?> teams)
                        </option>
                    <?php endforeach; ?>
                </select>
            </label>
            <label>
                Duration (minutes)
                <input type="number" name="duration_minutes" min="15" max="240" step="15" value="120" required>
            </label>
            <button type="submit">Create game</button>
            <p class="error" id="create-error" role="alert"></p>
        </form>
    </section>

    <section class="card">
        <h2>Join an existing game</h2>
        <form id="join-form" novalidate>
            <label>
                Room code
                <input
                    type="text" name="code" maxlength="6" required
                    pattern="[A-Za-z0-9]{6}" autocapitalize="characters" autocomplete="off"
                    placeholder="ABCDEF"
                >
            </label>
            <button type="submit">Go to lobby</button>
            <p class="error" id="join-error" role="alert"></p>
        </form>
    </section>
</main>
<script src="/assets/js/home.js" type="module"></script>
</body>
</html>
