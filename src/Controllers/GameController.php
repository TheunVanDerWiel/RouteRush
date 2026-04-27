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

        $startedAtIso = null;
        $endsAtIso    = null;
        if ($game['started_at'] !== null && $game['status'] !== 'lobby') {
            $started      = new \DateTimeImmutable($game['started_at'], new \DateTimeZone('UTC'));
            $startedAtIso = $started->format('Y-m-d\TH:i:s.v\Z');
            $endsAtIso    = $started->modify('+' . (int) $game['duration_seconds'] . ' seconds')
                                    ->format('Y-m-d\TH:i:s.v\Z');
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
            'started_at'       => $startedAtIso,
            'ends_at'          => $endsAtIso,
            'teams'            => $teams,
            'you'              => $you,
        ]);
    }

    public function start(Request $r, string $code): Response
    {
        $ct = $r->headers['Content-Type'] ?? $r->headers['content-type'] ?? '';
        if (!str_contains((string) $ct, 'application/json')) {
            return self::error('unsupported_media_type', 'Content-Type must be application/json', 415);
        }

        $playerId = $_SESSION['player_id'] ?? null;
        if ($playerId === null) {
            return self::error('not_authenticated', 'Sign in by creating or joining a team first', 401);
        }

        $code = strtoupper($code);
        $stmt = $this->pdo->prepare(
            'SELECT g.id, g.status, g.host_player_id, g.duration_seconds, g.map_id,
                    m.starting_train_cards, m.min_teams
               FROM games g
               JOIN maps  m ON m.id = g.map_id
              WHERE g.room_code = ?'
        );
        $stmt->execute([$code]);
        $game = $stmt->fetch();
        if ($game === false) {
            return self::error('not_found', 'Game not found', 404);
        }
        if ((int) $game['host_player_id'] !== (int) $playerId) {
            return self::error('not_host', 'Only the host can start the game', 403);
        }
        if ($game['status'] !== 'lobby') {
            return self::error('already_started', 'Game has already started', 409);
        }

        $gameId        = (int) $game['id'];
        $mapId         = (int) $game['map_id'];
        $startingCards = (int) $game['starting_train_cards'];
        $minTeams      = (int) $game['min_teams'];
        $duration      = (int) $game['duration_seconds'];

        $stmt = $this->pdo->prepare('SELECT id FROM game_teams WHERE game_id = ? ORDER BY joined_at');
        $stmt->execute([$gameId]);
        $teamIds = array_map('intval', array_column($stmt->fetchAll(), 'id'));
        if (count($teamIds) === 0) {
            return self::error('lobby_empty', 'Cannot start a game with no teams', 409);
        }
        if (count($teamIds) < $minTeams) {
            return self::error(
                'not_enough_teams',
                "This map requires at least $minTeams teams (you have " . count($teamIds) . ')',
                409
            );
        }

        $this->pdo->beginTransaction();
        try {
            // Initialize the card pool from map_colors. Locomotive count is
            // already set on games.locomotives_remaining when the game was created.
            $this->pdo->prepare(
                'INSERT INTO game_card_pool (game_id, color_id, count)
                 SELECT ?, id, deck_count FROM map_colors WHERE map_id = ?'
            )->execute([$gameId, $mapId]);

            // Build an in-memory deck: list of color_ids, with `null` for locomotives.
            $stmt = $this->pdo->prepare('SELECT color_id, count FROM game_card_pool WHERE game_id = ?');
            $stmt->execute([$gameId]);
            $deck = [];
            foreach ($stmt->fetchAll() as $row) {
                for ($i = 0; $i < (int) $row['count']; $i++) {
                    $deck[] = (int) $row['color_id'];
                }
            }
            $stmt = $this->pdo->prepare('SELECT locomotives_remaining FROM games WHERE id = ?');
            $stmt->execute([$gameId]);
            $locomotives = (int) $stmt->fetch()['locomotives_remaining'];
            for ($i = 0; $i < $locomotives; $i++) {
                $deck[] = null;
            }

            $totalCardsNeeded = count($teamIds) * $startingCards;
            if (count($deck) < $totalCardsNeeded) {
                $this->pdo->rollBack();
                return self::error('deck_too_small', 'Map deck cannot cover starting hands', 500);
            }

            shuffle($deck);

            // Hand out cards. hands[teamId] = [color_id => count, '_loco' => N]
            $hands = [];
            foreach ($teamIds as $tid) {
                $hands[$tid] = ['_loco' => 0];
            }
            $idx = 0;
            foreach ($teamIds as $tid) {
                for ($i = 0; $i < $startingCards; $i++) {
                    $card = $deck[$idx++];
                    if ($card === null) {
                        $hands[$tid]['_loco']++;
                    } else {
                        $hands[$tid][$card] = ($hands[$tid][$card] ?? 0) + 1;
                    }
                }
            }

            $insertHand = $this->pdo->prepare(
                'INSERT INTO game_team_hands (team_id, color_id, count) VALUES (?, ?, ?)'
            );
            $updateLoco = $this->pdo->prepare(
                'UPDATE game_teams SET locomotives_in_hand = ? WHERE id = ?'
            );
            $totalLoco       = 0;
            $dealtPerColor   = [];
            foreach ($hands as $tid => $hand) {
                foreach ($hand as $colorId => $count) {
                    if ($colorId === '_loco' || $count <= 0) {
                        continue;
                    }
                    $insertHand->execute([$tid, $colorId, $count]);
                    $dealtPerColor[$colorId] = ($dealtPerColor[$colorId] ?? 0) + $count;
                }
                $updateLoco->execute([$hand['_loco'], $tid]);
                $totalLoco += $hand['_loco'];
            }

            $updatePool = $this->pdo->prepare(
                'UPDATE game_card_pool SET count = count - ? WHERE game_id = ? AND color_id = ?'
            );
            foreach ($dealtPerColor as $colorId => $dealt) {
                $updatePool->execute([$dealt, $gameId, $colorId]);
            }

            $this->pdo->prepare(
                'UPDATE games
                    SET locomotives_remaining = locomotives_remaining - ?,
                        deck_counter          = deck_counter - ?
                  WHERE id = ?'
            )->execute([$totalLoco, $totalCardsNeeded, $gameId]);

            // Deal tickets: 1 long + 3 regular per team, no duplicates across teams.
            $stmt = $this->pdo->prepare('SELECT id FROM map_tickets WHERE map_id = ? AND is_long_route = TRUE');
            $stmt->execute([$mapId]);
            $longIds = array_map('intval', array_column($stmt->fetchAll(), 'id'));

            $stmt = $this->pdo->prepare('SELECT id FROM map_tickets WHERE map_id = ? AND is_long_route = FALSE');
            $stmt->execute([$mapId]);
            $regularIds = array_map('intval', array_column($stmt->fetchAll(), 'id'));

            $teamCount = count($teamIds);
            if (count($longIds) < $teamCount || count($regularIds) < $teamCount * 3) {
                $this->pdo->rollBack();
                return self::error('ticket_pool_too_small', 'Map does not have enough tickets for this many teams', 500);
            }

            shuffle($longIds);
            shuffle($regularIds);

            $insertTicket = $this->pdo->prepare(
                "INSERT INTO game_team_tickets (team_id, ticket_id, status) VALUES (?, ?, 'pending')"
            );
            foreach ($teamIds as $tid) {
                $insertTicket->execute([$tid, array_pop($longIds)]);
                for ($i = 0; $i < 3; $i++) {
                    $insertTicket->execute([$tid, array_pop($regularIds)]);
                }
            }

            $this->pdo->prepare(
                "UPDATE games SET status = 'in_progress', started_at = UTC_TIMESTAMP(3) WHERE id = ?"
            )->execute([$gameId]);

            $stmt = $this->pdo->prepare('SELECT started_at FROM games WHERE id = ?');
            $stmt->execute([$gameId]);
            $startedAtRaw = $stmt->fetch()['started_at'];

            $this->pdo->prepare(
                "INSERT INTO game_events (game_id, kind, payload_json) VALUES (?, 'start', ?)"
            )->execute([$gameId, json_encode(['team_count' => $teamCount], JSON_THROW_ON_ERROR)]);

            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }

        $started      = new \DateTimeImmutable($startedAtRaw, new \DateTimeZone('UTC'));
        $startedAtIso = $started->format('Y-m-d\TH:i:s.v\Z');
        $endsAtIso    = $started->modify("+{$duration} seconds")->format('Y-m-d\TH:i:s.v\Z');

        return Response::json([
            'status'     => 'in_progress',
            'started_at' => $startedAtIso,
            'ends_at'    => $endsAtIso,
        ]);
    }

    public function map(string $code): Response
    {
        $code = strtoupper($code);

        $stmt = $this->pdo->prepare(
            'SELECT m.id, m.name, m.viewbox_w, m.viewbox_h, m.starting_train_cards,
                    m.min_teams, m.max_teams, m.locomotives_count
               FROM games g
               JOIN maps  m ON m.id = g.map_id
              WHERE g.room_code = ?'
        );
        $stmt->execute([$code]);
        $map = $stmt->fetch();
        if ($map === false) {
            return self::error('not_found', 'Game not found', 404);
        }

        $stmt = $this->pdo->prepare(
            'SELECT id, display_name, hex, symbol, deck_count
               FROM map_colors
              WHERE map_id = ?
           ORDER BY id'
        );
        $stmt->execute([(int) $map['id']]);
        $colors = array_map(static fn(array $c) => [
            'id'           => (int) $c['id'],
            'display_name' => $c['display_name'],
            'hex'          => $c['hex'],
            'symbol'       => $c['symbol'],
            'deck_count'   => (int) $c['deck_count'],
        ], $stmt->fetchAll());

        return Response::json([
            'id'                   => (int) $map['id'],
            'name'                 => $map['name'],
            'viewbox_w'            => (int) $map['viewbox_w'],
            'viewbox_h'            => (int) $map['viewbox_h'],
            'starting_train_cards' => (int) $map['starting_train_cards'],
            'min_teams'            => (int) $map['min_teams'],
            'max_teams'            => (int) $map['max_teams'],
            'locomotives_count'    => (int) $map['locomotives_count'],
            'colors'               => $colors,
        ]);
    }

    public function state(string $code): Response
    {
        $code = strtoupper($code);

        $playerId = $_SESSION['player_id'] ?? null;
        if ($playerId === null) {
            return self::error('not_authenticated', 'Sign in by creating or joining a team first', 401);
        }

        $stmt = $this->pdo->prepare(
            'SELECT g.id, g.status, g.duration_seconds, g.started_at, g.deck_counter, g.locomotives_remaining,
                    p.team_id
               FROM games g
               JOIN game_players p ON p.team_id IN (SELECT id FROM game_teams WHERE game_id = g.id)
              WHERE g.room_code = ? AND p.id = ?'
        );
        $stmt->execute([$code, (int) $playerId]);
        $row = $stmt->fetch();
        if ($row === false) {
            return self::error('wrong_game', 'You are not part of this game', 403);
        }

        $teamId = (int) $row['team_id'];

        $endsAtIso = null;
        if ($row['started_at'] !== null && $row['status'] !== 'lobby') {
            $started   = new \DateTimeImmutable($row['started_at'], new \DateTimeZone('UTC'));
            $endsAtIso = $started->modify('+' . (int) $row['duration_seconds'] . ' seconds')
                                 ->format('Y-m-d\TH:i:s.v\Z');
        }

        $stmt = $this->pdo->prepare(
            'SELECT color_id, count FROM game_team_hands WHERE team_id = ? AND count > 0'
        );
        $stmt->execute([$teamId]);
        $hand = [];
        foreach ($stmt->fetchAll() as $h) {
            $hand[(string) (int) $h['color_id']] = (int) $h['count'];
        }

        $stmt = $this->pdo->prepare('SELECT locomotives_in_hand FROM game_teams WHERE id = ?');
        $stmt->execute([$teamId]);
        $locoInHand = (int) $stmt->fetch()['locomotives_in_hand'];

        return Response::json([
            'mode' => 'snapshot',
            'game' => [
                'status'                => $row['status'],
                'ends_at'               => $endsAtIso,
                'deck_remaining'        => (int) $row['deck_counter'],
                'locomotives_remaining' => (int) $row['locomotives_remaining'],
            ],
            'team' => [
                'id'                  => $teamId,
                'hand'                => (object) $hand,
                'locomotives_in_hand' => $locoInHand,
            ],
        ]);
    }

    private static function error(string $code, string $message, int $status): Response
    {
        return Response::json(['error' => $code, 'message' => $message], $status);
    }
}
