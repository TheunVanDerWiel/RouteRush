<?php
declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use RouteRush\Config;
use RouteRush\Database;

$config = Config::load(__DIR__ . '/../config/config.php');
$pdo    = Database::connect(
    $config->get('db'),
    [PDO::MYSQL_ATTR_MULTI_STATEMENTS => true],   // let MySQL parse statement boundaries
);

$pdo->exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations ('
    . ' version VARCHAR(255) NOT NULL PRIMARY KEY,'
    . ' applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP'
    . ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
);

$applied = array_flip(
    $pdo->query('SELECT version FROM schema_migrations')->fetchAll(PDO::FETCH_COLUMN)
);

$files = glob(__DIR__ . '/../db/migrations/*.sql') ?: [];
sort($files);

foreach ($files as $file) {
    $version = basename($file, '.sql');
    if (isset($applied[$version])) {
        echo "skip  $version\n";
        continue;
    }

    echo "apply $version ... ";
    $sql = file_get_contents($file) ?: '';

    try {
        $pdo->exec($sql);
        $insert = $pdo->prepare('INSERT INTO schema_migrations (version) VALUES (?)');
        $insert->execute([$version]);
        echo "ok\n";
    } catch (\PDOException $e) {
        echo "FAIL\n  " . $e->getMessage() . "\n";
        exit(1);
    }
}

echo "done.\n";
