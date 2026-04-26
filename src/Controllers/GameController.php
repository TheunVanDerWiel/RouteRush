<?php
declare(strict_types=1);

namespace RouteRush\Controllers;

use PDO;
use PDOException;
use RouteRush\Request;
use RouteRush\Response;
use RouteRush\RoomCode;

final class GameController
{
    private const ROOM_CODE_RETRIES = 5;

    public function __construct(private readonly PDO $pdo) {}

    public function create(Request $r): Response
    {
        $ct = $r->headers['Content-Type'] ?? $r->headers['content-type'] ?? '';
        if (!str_contains((string) $ct, 'application/json')) {
            return Response::json([
                'error'   => 'unsupported_media_type',
                'message' => 'Content-Type must be application/json',
            ], 415);
        }

        $mapId    = filter_var($r->body['map_id']           ?? null, FILTER_VALIDATE_INT);
        $duration = filter_var($r->body['duration_seconds'] ?? null, FILTER_VALIDATE_INT);

        if ($mapId === false || $mapId <= 0 || $duration === false || $duration <= 0 || $duration % 900 !== 0) {
            return Response::json([
                'error'   => 'invalid_payload',
                'message' => 'map_id must be a positive integer; duration_seconds must be a positive multiple of 900',
            ], 400);
        }

        $stmt = $this->pdo->prepare('SELECT locomotives_count FROM maps WHERE id = ?');
        $stmt->execute([$mapId]);
        $map = $stmt->fetch();
        if ($map === false) {
            return Response::json(['error' => 'not_found', 'message' => 'Map not found'], 404);
        }

        $stmt = $this->pdo->prepare('SELECT COALESCE(SUM(deck_count), 0) AS total FROM map_colors WHERE map_id = ?');
        $stmt->execute([$mapId]);
        $coloredDeckTotal = (int) $stmt->fetch()['total'];
        $deckCounter      = $coloredDeckTotal + (int) $map['locomotives_count'];

        $insert = $this->pdo->prepare(
            'INSERT INTO games (room_code, map_id, duration_seconds, status, locomotives_remaining, deck_counter)
             VALUES (?, ?, ?, ?, ?, ?)'
        );

        $code   = null;
        $gameId = null;
        for ($i = 0; $i < self::ROOM_CODE_RETRIES; $i++) {
            $candidate = RoomCode::generate();
            try {
                $insert->execute([
                    $candidate,
                    $mapId,
                    $duration,
                    'lobby',
                    (int) $map['locomotives_count'],
                    $deckCounter,
                ]);
                $code   = $candidate;
                $gameId = (int) $this->pdo->lastInsertId();
                break;
            } catch (PDOException $e) {
                // 23000 = integrity constraint violation; retry on UNIQUE room_code collision.
                if ($e->getCode() !== '23000') {
                    throw $e;
                }
            }
        }

        if ($code === null) {
            return Response::json([
                'error'   => 'internal_error',
                'message' => 'Could not allocate a unique room code',
            ], 500);
        }

        $scheme  = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $host    = $_SERVER['HTTP_HOST'] ?? 'localhost';
        $joinUrl = "$scheme://$host/lobby/$code";

        return Response::json([
            'game_id'   => $gameId,
            'room_code' => $code,
            'join_url'  => $joinUrl,
        ], 201);
    }

    public function show(string $code): Response
    {
        $code = strtoupper($code);

        $stmt = $this->pdo->prepare(
            'SELECT g.id, g.room_code, g.status, g.duration_seconds, g.started_at, g.ended_at,
                    m.id AS map_id, m.name AS map_name
               FROM games g
               JOIN maps  m ON m.id = g.map_id
              WHERE g.room_code = ?'
        );
        $stmt->execute([$code]);
        $game = $stmt->fetch();
        if ($game === false) {
            return Response::json(['error' => 'not_found', 'message' => 'Game not found'], 404);
        }

        $stmt = $this->pdo->prepare(
            'SELECT t.id, t.name, t.color_index, COUNT(p.id) AS player_count
               FROM game_teams t
          LEFT JOIN game_players p ON p.team_id = t.id
              WHERE t.game_id = ?
           GROUP BY t.id, t.name, t.color_index
           ORDER BY t.joined_at'
        );
        $stmt->execute([(int) $game['id']]);
        $teamRows = $stmt->fetchAll();

        $teams = array_map(static fn(array $t) => [
            'id'           => (int) $t['id'],
            'name'         => $t['name'],
            'color_index'  => (int) $t['color_index'],
            'player_count' => (int) $t['player_count'],
        ], $teamRows);

        $endsAt = null;
        if ($game['started_at'] !== null && $game['status'] !== 'lobby') {
            $startedAtMs = strtotime($game['started_at']) * 1000;
            $endsAt      = gmdate('Y-m-d\TH:i:s', (int) ($startedAtMs / 1000) + (int) $game['duration_seconds']) . '.000Z';
        }

        $you = null;
        $playerId = $_SESSION['player_id'] ?? null;
        if ($playerId !== null) {
            $stmt = $this->pdo->prepare(
                'SELECT p.id AS player_id, t.id AS team_id, p.id = g.host_player_id AS is_host
                   FROM game_players p
                   JOIN game_teams t ON t.id = p.team_id
                   JOIN games g      ON g.id = t.game_id
                  WHERE p.id = ? AND g.id = ?'
            );
            $stmt->execute([(int) $playerId, (int) $game['id']]);
            $row = $stmt->fetch();
            if ($row !== false) {
                $you = [
                    'player_id' => (int) $row['player_id'],
                    'team_id'   => (int) $row['team_id'],
                    'is_host'   => (bool) $row['is_host'],
                ];
            }
        }

        return Response::json([
            'code'             => $game['room_code'],
            'status'           => $game['status'],
            'map'              => [
                'id'   => (int) $game['map_id'],
                'name' => $game['map_name'],
            ],
            'duration_seconds' => (int) $game['duration_seconds'],
            'started_at'       => $game['started_at'],
            'ends_at'          => $endsAt,
            'teams'            => $teams,
            'you'              => $you,
        ]);
    }
}
