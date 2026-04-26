<?php
/** @var string $code */
use RouteRush\View;
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Not found · Route Rush</title>
    <link rel="stylesheet" href="/assets/css/app.css">
</head>
<body>
<main class="container">
    <header>
        <h1>No game found</h1>
        <p>We couldn't find a game with code <strong><?= View::escape(strtoupper($code)) ?></strong>.</p>
    </header>
    <p><a href="/">← Back to home</a></p>
</main>
</body>
</html>
