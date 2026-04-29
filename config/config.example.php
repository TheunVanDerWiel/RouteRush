<?php
// Copy this file to config.php and fill in real values.
// config.php is gitignored.

return [
    'db' => [
        'host' => 'localhost',
        'port' => 3306,
        'name' => 'route_rush',
        'user' => 'route_rush',
        'pass' => '',
    ],
    'app' => [
        'env'   => 'dev',
        'debug' => true,
    ],
    // Map editor "Save to DB" flow. The server emails a one-time password
    // to notification_email; the editor posts that code along with the
    // map JSON to authorise the save.
    'editor' => [
        'notification_email' => 'admin@example.com',
        'from_email'         => 'noreply@example.com',
        'from_name'          => 'Route Rush',
    ],
];
