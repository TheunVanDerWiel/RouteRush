<?php
declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use RouteRush\App;
use RouteRush\Request;

session_start();

$app = new App(__DIR__ . '/../config/config.php');
$app->router()->dispatch(Request::fromGlobals())->send();
