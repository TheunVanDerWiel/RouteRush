<?php
declare(strict_types=1);

namespace RouteRush;

use PDO;
use RouteRush\Controllers\GameController;
use RouteRush\Controllers\HomeController;
use RouteRush\Controllers\MapController;
use RouteRush\Controllers\TeamController;

final class App
{
    private readonly Config $config;
    private readonly PDO $pdo;
    private readonly Router $router;

    public function __construct(string $configPath)
    {
        $this->config = Config::load($configPath);

        if ($this->config->get('app')['debug'] ?? false) {
            ini_set('display_errors', '1');
            error_reporting(E_ALL);
        }

        $this->pdo = Database::connect($this->config->get('db'));
        $this->router = new Router();
        $this->registerRoutes();
    }

    public function router(): Router
    {
        return $this->router;
    }

    private function registerRoutes(): void
    {
        $pdo = $this->pdo;

        $this->router->get('/',                 fn() => (new HomeController($pdo))->index());
        $this->router->get('/lobby/{code}',     fn(Request $r, array $p) => (new HomeController($pdo))->lobby($p['code']));
        $this->router->get('/game/{code}',      fn(Request $r, array $p) => (new HomeController($pdo))->game($p['code']));

        $this->router->get('/api/maps',                              fn() => (new MapController($pdo))->index());
        $this->router->post('/api/games',                            fn(Request $r) => (new GameController($pdo))->create($r));
        $this->router->get('/api/games/{code}',                      fn(Request $r, array $p) => (new GameController($pdo))->show($p['code']));
        $this->router->get('/api/games/{code}/map',                  fn(Request $r, array $p) => (new GameController($pdo))->map($p['code']));
        $this->router->get('/api/games/{code}/state',                fn(Request $r, array $p) => (new GameController($pdo))->state($p['code']));
        $this->router->post('/api/games/{code}/start',               fn(Request $r, array $p) => (new GameController($pdo))->start($r, $p['code']));
        $this->router->post('/api/games/{code}/claim',               fn(Request $r, array $p) => (new GameController($pdo))->claim($r, $p['code']));
        $this->router->post('/api/games/{code}/draw/cards',          fn(Request $r, array $p) => (new GameController($pdo))->drawCards($p['code']));
        $this->router->post('/api/games/{code}/draw/tickets',        fn(Request $r, array $p) => (new GameController($pdo))->drawTickets($p['code']));
        $this->router->post('/api/games/{code}/trade',               fn(Request $r, array $p) => (new GameController($pdo))->trade($r, $p['code']));
        $this->router->post('/api/games/{code}/tickets/decide',      fn(Request $r, array $p) => (new GameController($pdo))->decideTickets($r, $p['code']));
        $this->router->post('/api/games/{code}/teams',               fn(Request $r, array $p) => (new TeamController($pdo))->create($r, $p['code']));
        $this->router->post('/api/games/{code}/teams/{teamId}/join', fn(Request $r, array $p) => (new TeamController($pdo))->join($r, $p['code'], $p['teamId']));
    }
}
