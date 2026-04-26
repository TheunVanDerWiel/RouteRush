<?php
declare(strict_types=1);

namespace RouteRush\Controllers;

use PDO;
use RouteRush\Response;

final class MapController
{
    public function __construct(private readonly PDO $pdo) {}

    public function index(): Response
    {
        $rows = $this->pdo->query(
            'SELECT id, name, min_teams, max_teams FROM maps ORDER BY name'
        )->fetchAll();

        $maps = array_map(static fn(array $r) => [
            'id'        => (int) $r['id'],
            'name'      => $r['name'],
            'min_teams' => (int) $r['min_teams'],
            'max_teams' => (int) $r['max_teams'],
        ], $rows);

        return Response::json(['maps' => $maps]);
    }
}
