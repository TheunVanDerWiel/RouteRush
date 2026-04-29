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
        // Only the latest version per name is offered for new games; older
        // versions remain referenced by games.map_id and are unaffected.
        $rows = $this->pdo->query(
            'SELECT id, name, min_teams, max_teams
               FROM maps m
              WHERE version = (SELECT MAX(version) FROM maps WHERE name = m.name)
           ORDER BY name'
        )->fetchAll();

        $maps = array_map(static fn(array $r) => [
            'id'        => (int) $r['id'],
            'name'      => $r['name'],
            'min_teams' => (int) $r['min_teams'],
            'max_teams' => (int) $r['max_teams'],
        ], $rows);

        return Response::json(['maps' => $maps]);
    }

    /**
     * Lists every map with its version. Used by the editor's
     * "Load from database" picker, which lets the user open any version.
     */
    public function listAll(): Response
    {
        $rows = $this->pdo->query(
            'SELECT id, name, version FROM maps ORDER BY name, version DESC'
        )->fetchAll();

        $maps = array_map(static fn(array $r) => [
            'id'      => (int) $r['id'],
            'name'    => $r['name'],
            'version' => (int) $r['version'],
        ], $rows);

        return Response::json(['maps' => $maps]);
    }

    /**
     * Returns a single map shaped like the editor's JSON file format,
     * so the editor can run it through its existing load-JSON path.
     */
    public function show(string $id): Response
    {
        $mapId = filter_var($id, FILTER_VALIDATE_INT);
        if ($mapId === false || $mapId <= 0) {
            return Response::json(
                ['error' => 'invalid_id', 'message' => 'Invalid map id'],
                400,
            );
        }

        $stmt = $this->pdo->prepare(
            'SELECT name, version, viewbox_w, viewbox_h, starting_train_cards,
                    starting_tickets_count, starting_tickets_keep_min,
                    min_teams, max_teams, locomotives_count
               FROM maps
              WHERE id = ?'
        );
        $stmt->execute([$mapId]);
        $map = $stmt->fetch();
        if ($map === false) {
            return Response::json(
                ['error' => 'not_found', 'message' => 'Map not found'],
                404,
            );
        }

        $stmt = $this->pdo->prepare(
            'SELECT id, display_name, hex, symbol, deck_count
               FROM map_colors WHERE map_id = ? ORDER BY id'
        );
        $stmt->execute([$mapId]);
        $colors = array_map(static fn(array $c) => [
            'id'           => (int) $c['id'],
            'display_name' => $c['display_name'],
            'hex'          => $c['hex'],
            'symbol'       => $c['symbol'],
            'deck_count'   => (int) $c['deck_count'],
        ], $stmt->fetchAll());

        $stmt = $this->pdo->prepare(
            'SELECT id, display_name, x, y FROM map_stops WHERE map_id = ? ORDER BY id'
        );
        $stmt->execute([$mapId]);
        $stops = array_map(static fn(array $s) => [
            'id'           => (int) $s['id'],
            'display_name' => $s['display_name'],
            'x'            => (int) $s['x'],
            'y'            => (int) $s['y'],
        ], $stmt->fetchAll());

        $stmt = $this->pdo->prepare(
            'SELECT id, from_stop_id, to_stop_id, via_x, via_y, length, color_id, parallel_index
               FROM map_routes WHERE map_id = ? ORDER BY id'
        );
        $stmt->execute([$mapId]);
        $routes = array_map(static fn(array $r) => [
            'id'             => (int) $r['id'],
            'from_stop_id'   => (int) $r['from_stop_id'],
            'to_stop_id'     => (int) $r['to_stop_id'],
            'via_x'          => $r['via_x'] !== null ? (int) $r['via_x'] : null,
            'via_y'          => $r['via_y'] !== null ? (int) $r['via_y'] : null,
            'length'         => (int) $r['length'],
            'color_id'       => (int) $r['color_id'],
            'parallel_index' => (int) $r['parallel_index'],
        ], $stmt->fetchAll());

        $stmt = $this->pdo->prepare(
            'SELECT id, from_stop_id, to_stop_id, points, is_long_route
               FROM map_tickets WHERE map_id = ? ORDER BY id'
        );
        $stmt->execute([$mapId]);
        $tickets = array_map(static fn(array $t) => [
            'id'            => (int) $t['id'],
            'from_stop_id'  => (int) $t['from_stop_id'],
            'to_stop_id'    => (int) $t['to_stop_id'],
            'points'        => (int) $t['points'],
            'is_long_route' => (bool) $t['is_long_route'],
        ], $stmt->fetchAll());

        return Response::json([
            'name'                      => $map['name'],
            'version'                   => (int) $map['version'],
            'viewbox_w'                 => (int) $map['viewbox_w'],
            'viewbox_h'                 => (int) $map['viewbox_h'],
            'starting_train_cards'      => (int) $map['starting_train_cards'],
            'starting_tickets_count'    => (int) $map['starting_tickets_count'],
            'starting_tickets_keep_min' => (int) $map['starting_tickets_keep_min'],
            'min_teams'                 => (int) $map['min_teams'],
            'max_teams'                 => (int) $map['max_teams'],
            'locomotives_count'         => (int) $map['locomotives_count'],
            'colors'                    => $colors,
            'stops'                     => $stops,
            'routes'                    => $routes,
            'tickets'                   => $tickets,
        ]);
    }
}
