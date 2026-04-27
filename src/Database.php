<?php
declare(strict_types=1);

namespace RouteRush;

use PDO;

final class Database
{
    public static function connect(array $config, array $extraOptions = []): PDO
    {
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $config['host'],
            $config['port'],
            $config['name'],
        );

        $options = $extraOptions + [
            PDO::ATTR_ERRMODE                => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE     => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES       => false,
            PDO::MYSQL_ATTR_MULTI_STATEMENTS => false,    // safer default for app queries
            // Pin the session to UTC so TIMESTAMP round-trips without
            // local-tz drift. App code treats every DB datetime as UTC.
            PDO::MYSQL_ATTR_INIT_COMMAND     => "SET time_zone = '+00:00'",
        ];

        return new PDO($dsn, $config['user'], $config['pass'], $options);
    }
}
