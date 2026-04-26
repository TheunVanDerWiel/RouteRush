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
        ];

        return new PDO($dsn, $config['user'], $config['pass'], $options);
    }
}
