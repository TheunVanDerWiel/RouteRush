<?php
declare(strict_types=1);

namespace RouteRush\Controllers;

use PDO;
use RouteRush\Response;
use RouteRush\View;

final class HomeController
{
    public function __construct(private readonly PDO $pdo) {}

    public function index(): Response
    {
        // Only the latest version per name is offered for new games; older
        // versions remain referenced by games.map_id and are unaffected.
        $maps = $this->pdo->query(
            'SELECT id, name, min_teams, max_teams
               FROM maps m
              WHERE version = (SELECT MAX(version) FROM maps WHERE name = m.name)
           ORDER BY name'
        )->fetchAll();

        return Response::html(View::render('home', ['maps' => $maps]));
    }

    public function lobby(string $code): Response
    {
        $stmt = $this->pdo->prepare('SELECT id, status FROM games WHERE room_code = ?');
        $stmt->execute([strtoupper($code)]);
        $game = $stmt->fetch();

        if ($game === false) {
            return Response::html(View::render('not_found', ['code' => $code]), 404);
        }

        return Response::html(View::render('lobby', [
            'code' => strtoupper($code),
            'player_id' => $_SESSION['player_id'] ?? null,
        ]));
    }

    public function game(string $code): Response
    {
        $stmt = $this->pdo->prepare('SELECT id FROM games WHERE room_code = ?');
        $stmt->execute([strtoupper($code)]);
        $game = $stmt->fetch();

        if ($game === false) {
            return Response::html(View::render('not_found', ['code' => $code]), 404);
        }

        return Response::html(View::render('game', [
            'code' => strtoupper($code),
            'player_id' => $_SESSION['player_id'] ?? null,
        ]));
    }

    public function editor(): Response
    {
        return Response::html(View::render('editor', []));
    }
}
