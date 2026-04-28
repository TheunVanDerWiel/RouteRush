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

        $mapId = (int) $map['id'];

        $stmt = $this->pdo->prepare(
            'SELECT id, display_name, hex, symbol, deck_count
               FROM map_colors
              WHERE map_id = ?
           ORDER BY id'
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

        return Response::json([
            'id'                   => $mapId,
            'name'                 => $map['name'],
            'viewbox_w'            => (int) $map['viewbox_w'],
            'viewbox_h'            => (int) $map['viewbox_h'],
            'starting_train_cards' => (int) $map['starting_train_cards'],
            'min_teams'            => (int) $map['min_teams'],
            'max_teams'            => (int) $map['max_teams'],
            'locomotives_count'    => (int) $map['locomotives_count'],
            'colors'               => $colors,
            'stops'                => $stops,
            'routes'               => $routes,
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

        // Lazy finalization: if the wall-clock duration has elapsed but the
        // game is still flagged in_progress, transition it now.
        if ($this->finalizeIfDue((int) $row['id'], $row['started_at'], $row['status'], (int) $row['duration_seconds'])) {
            $stmt->execute([$code, (int) $playerId]);
            $row = $stmt->fetch();
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

        $stmt = $this->pdo->prepare(
            'SELECT locomotives_in_hand, windows_consumed FROM game_teams WHERE id = ?'
        );
        $stmt->execute([$teamId]);
        $teamRow         = $stmt->fetch();
        $locoInHand      = (int) $teamRow['locomotives_in_hand'];
        $windowsConsumed = (int) $teamRow['windows_consumed'];

        $windowsAvailable     = 0;
        $nextWindowInSeconds  = null;
        if ($row['started_at'] !== null && $row['status'] === 'in_progress') {
            $startedAt = new \DateTimeImmutable($row['started_at'], new \DateTimeZone('UTC'));
            $now       = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
            $elapsed   = max(0, $now->getTimestamp() - $startedAt->getTimestamp());
            $accrued   = intdiv($elapsed, 300) + 1;
            $windowsAvailable    = max(0, $accrued - $windowsConsumed);
            $nextWindowInSeconds = 300 - ($elapsed % 300);
        }

        $stmt = $this->pdo->prepare(
            'SELECT c.route_id, c.claimed_at, t.color_index, t.name AS team_name
               FROM game_claims c
               JOIN game_teams  t ON t.id = c.team_id
              WHERE c.game_id = ?
           ORDER BY c.id'
        );
        $stmt->execute([(int) $row['id']]);
        $isoUtc = fn(?string $dt) => $this->isoUtc($dt);
        $claims = array_map(static fn(array $c) => [
            'route_id'         => (int) $c['route_id'],
            'team_color_index' => (int) $c['color_index'],
            'team_name'        => $c['team_name'],
            'claimed_at'       => $isoUtc($c['claimed_at']),
        ], $stmt->fetchAll());

        $stmt = $this->pdo->prepare(
            "SELECT mt.id, mt.from_stop_id, mt.to_stop_id, mt.points, mt.is_long_route, gtt.status
               FROM game_team_tickets gtt
               JOIN map_tickets       mt ON mt.id = gtt.ticket_id
              WHERE gtt.team_id = ? AND gtt.status IN ('pending', 'kept')
           ORDER BY gtt.id"
        );
        $stmt->execute([$teamId]);
        $tickets = [];
        $pending = [];
        foreach ($stmt->fetchAll() as $t) {
            $entry = [
                'id'            => (int) $t['id'],
                'from_stop_id'  => (int) $t['from_stop_id'],
                'to_stop_id'    => (int) $t['to_stop_id'],
                'points'        => (int) $t['points'],
                'is_long_route' => (bool) $t['is_long_route'],
            ];
            if ($t['status'] === 'pending') {
                $pending[] = $entry;
            } else {
                $entry['status'] = 'kept';
                $tickets[] = $entry;
            }
        }

        $response = [
            'mode' => 'snapshot',
            'game' => [
                'status'                => $row['status'],
                'started_at'            => $this->isoUtc($row['started_at']),
                'ends_at'               => $endsAtIso,
                'deck_remaining'        => (int) $row['deck_counter'],
                'locomotives_remaining' => (int) $row['locomotives_remaining'],
            ],
            'team' => [
                'id'                     => $teamId,
                'hand'                   => (object) $hand,
                'locomotives_in_hand'    => $locoInHand,
                'windows_available'      => $windowsAvailable,
                'next_window_in_seconds' => $nextWindowInSeconds,
                'tickets'                => $tickets,
                'pending_tickets'        => $pending,
            ],
            'claims' => $claims,
        ];
        if ($row['status'] === 'ended') {
            $response['final'] = $this->buildScoreboard((int) $row['id']);
        }
        return Response::json($response);
    }

    public function claim(Request $r, string $code): Response
    {
        $ct = $r->headers['Content-Type'] ?? $r->headers['content-type'] ?? '';
        if (!str_contains((string) $ct, 'application/json')) {
            return self::error('unsupported_media_type', 'Content-Type must be application/json', 415);
        }

        $playerId = $_SESSION['player_id'] ?? null;
        if ($playerId === null) {
            return self::error('not_authenticated', 'Sign in by creating or joining a team first', 401);
        }

        $routeId    = filter_var($r->body['route_id']          ?? null, FILTER_VALIDATE_INT);
        $spendRaw   = $r->body['spend']                        ?? null;
        $spendLoco  = filter_var($r->body['spend_locomotives'] ?? 0, FILTER_VALIDATE_INT);

        if ($routeId === false || $routeId <= 0 || !is_array($spendRaw) || $spendLoco === false || $spendLoco < 0) {
            return self::error('invalid_payload', 'route_id, spend (object), spend_locomotives required', 400);
        }

        $spend = [];
        foreach ($spendRaw as $key => $val) {
            $cid = filter_var($key, FILTER_VALIDATE_INT);
            $cnt = filter_var($val, FILTER_VALIDATE_INT);
            if ($cid === false || $cid <= 0 || $cnt === false || $cnt < 0) {
                return self::error('invalid_payload', 'spend keys must be color_ids; values non-negative ints', 400);
            }
            if ($cnt > 0) {
                $spend[$cid] = $cnt;
            }
        }

        $code = strtoupper($code);

        $this->pdo->beginTransaction();
        try {
            // Lock both the game row and the player's team row to serialize
            // concurrent claim/draw/trade attempts against this team's hand.
            $stmt = $this->pdo->prepare(
                'SELECT g.id  AS game_id, g.status, g.map_id,
                        t.id  AS team_id, t.locomotives_in_hand,
                        (SELECT COUNT(*) FROM game_teams        WHERE game_id = g.id)                            AS team_count,
                        (SELECT COUNT(*) FROM game_team_tickets WHERE team_id = t.id AND status = \'pending\')   AS pending_tickets
                   FROM games g
                   JOIN game_players p ON p.id = ?
                   JOIN game_teams   t ON t.id = p.team_id AND t.game_id = g.id
                  WHERE g.room_code = ?
                    FOR UPDATE'
            );
            $stmt->execute([(int) $playerId, $code]);
            $row = $stmt->fetch();
            if ($row === false) {
                $this->pdo->rollBack();
                return self::error('wrong_game', 'You are not part of this game', 403);
            }
            if ($row['status'] !== 'in_progress') {
                $this->pdo->rollBack();
                return self::error('game_not_in_progress', 'Game is not in progress', 409);
            }
            if ((int) $row['pending_tickets'] > 0) {
                $this->pdo->rollBack();
                return self::error('pending_tickets', 'Decide on pending tickets before claiming a route', 409);
            }

            $gameId    = (int) $row['game_id'];
            $teamId    = (int) $row['team_id'];
            $teamLoco  = (int) $row['locomotives_in_hand'];
            $teamCount = (int) $row['team_count'];
            $mapId     = (int) $row['map_id'];

            $stmt = $this->pdo->prepare(
                'SELECT id, length, color_id, from_stop_id, to_stop_id
                   FROM map_routes WHERE id = ? AND map_id = ?'
            );
            $stmt->execute([$routeId, $mapId]);
            $route = $stmt->fetch();
            if ($route === false) {
                $this->pdo->rollBack();
                return self::error('not_found', 'Route not on this map', 404);
            }

            $colorTotal = array_sum($spend);
            if ($colorTotal + $spendLoco !== (int) $route['length']) {
                $this->pdo->rollBack();
                return self::error('wrong_count', 'Total cards spent must equal route length', 422);
            }
            foreach (array_keys($spend) as $cid) {
                if ($cid !== (int) $route['color_id']) {
                    $this->pdo->rollBack();
                    return self::error('wrong_color', "Cards must match route color (id {$route['color_id']})", 422);
                }
            }
            if ($spendLoco > $teamLoco) {
                $this->pdo->rollBack();
                return self::error('insufficient_cards', 'Not enough locomotives in hand', 422);
            }
            foreach ($spend as $cid => $count) {
                $stmt = $this->pdo->prepare(
                    'SELECT count FROM game_team_hands WHERE team_id = ? AND color_id = ?'
                );
                $stmt->execute([$teamId, $cid]);
                $h = $stmt->fetch();
                if ($h === false || (int) $h['count'] < $count) {
                    $this->pdo->rollBack();
                    return self::error('insufficient_cards', "Not enough cards of color $cid in hand", 422);
                }
            }

            // Parallel-route rule.
            $stmt = $this->pdo->prepare(
                'SELECT id FROM map_routes
                  WHERE map_id = ? AND id <> ?
                    AND ((from_stop_id = ? AND to_stop_id = ?)
                      OR (from_stop_id = ? AND to_stop_id = ?))'
            );
            $stmt->execute([
                $mapId, $routeId,
                (int) $route['from_stop_id'], (int) $route['to_stop_id'],
                (int) $route['to_stop_id'],   (int) $route['from_stop_id'],
            ]);
            $parallelIds = array_map('intval', array_column($stmt->fetchAll(), 'id'));

            if (!empty($parallelIds)) {
                $placeholders = implode(',', array_fill(0, count($parallelIds), '?'));
                if ($teamCount <= 3) {
                    $stmt = $this->pdo->prepare(
                        "SELECT 1 FROM game_claims WHERE game_id = ? AND route_id IN ($placeholders) LIMIT 1"
                    );
                    $stmt->execute(array_merge([$gameId], $parallelIds));
                    if ($stmt->fetch() !== false) {
                        $this->pdo->rollBack();
                        return self::error('parallel_locked', 'Parallel route already claimed', 409);
                    }
                } else {
                    $stmt = $this->pdo->prepare(
                        "SELECT 1 FROM game_claims WHERE game_id = ? AND team_id = ? AND route_id IN ($placeholders) LIMIT 1"
                    );
                    $stmt->execute(array_merge([$gameId, $teamId], $parallelIds));
                    if ($stmt->fetch() !== false) {
                        $this->pdo->rollBack();
                        return self::error('parallel_locked', 'Your team already claimed the parallel route', 409);
                    }
                }
            }

            // Apply: deduct from hand, return cards to deck.
            if ($spendLoco > 0) {
                $this->pdo->prepare(
                    'UPDATE game_teams SET locomotives_in_hand = locomotives_in_hand - ? WHERE id = ?'
                )->execute([$spendLoco, $teamId]);
                $this->pdo->prepare(
                    'UPDATE games SET locomotives_remaining = locomotives_remaining + ?,
                                      deck_counter          = deck_counter + ?
                              WHERE id = ?'
                )->execute([$spendLoco, $spendLoco, $gameId]);
            }
            foreach ($spend as $cid => $count) {
                $this->pdo->prepare(
                    'UPDATE game_team_hands SET count = count - ? WHERE team_id = ? AND color_id = ?'
                )->execute([$count, $teamId, $cid]);
                $this->pdo->prepare(
                    'INSERT INTO game_card_pool (game_id, color_id, count) VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE count = count + VALUES(count)'
                )->execute([$gameId, $cid, $count]);
                $this->pdo->prepare(
                    'UPDATE games SET deck_counter = deck_counter + ? WHERE id = ?'
                )->execute([$count, $gameId]);
            }

            try {
                $this->pdo->prepare(
                    'INSERT INTO game_claims (game_id, team_id, route_id) VALUES (?, ?, ?)'
                )->execute([$gameId, $teamId, $routeId]);
            } catch (PDOException $e) {
                if ($e->getCode() === '23000') {
                    $this->pdo->rollBack();
                    return self::error('already_claimed', 'Route was just claimed by another team', 409);
                }
                throw $e;
            }

            $payload = json_encode([
                'route_id'          => $routeId,
                'spend'             => (object) $spend,
                'spend_locomotives' => $spendLoco,
            ], JSON_THROW_ON_ERROR);
            $this->pdo->prepare(
                "INSERT INTO game_events (game_id, team_id, kind, payload_json)
                 VALUES (?, ?, 'claim_success', ?)"
            )->execute([$gameId, $teamId, $payload]);

            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }

        return Response::json([
            'ok'    => true,
            'claim' => [
                'route_id' => $routeId,
                'team_id'  => $teamId,
            ],
        ]);
    }

    public function drawCards(string $code): Response
    {
        $playerId = $_SESSION['player_id'] ?? null;
        if ($playerId === null) {
            return self::error('not_authenticated', 'Sign in by creating or joining a team first', 401);
        }

        $code = strtoupper($code);

        $this->pdo->beginTransaction();
        try {
            $stmt = $this->pdo->prepare(
                'SELECT g.id AS game_id, g.status, g.started_at, g.deck_counter, g.locomotives_remaining,
                        t.id AS team_id, t.windows_consumed, t.locomotives_in_hand,
                        (SELECT COUNT(*) FROM game_team_tickets WHERE team_id = t.id AND status = \'pending\') AS pending_tickets
                   FROM games g
                   JOIN game_players p ON p.id = ?
                   JOIN game_teams   t ON t.id = p.team_id AND t.game_id = g.id
                  WHERE g.room_code = ?
                    FOR UPDATE'
            );
            $stmt->execute([(int) $playerId, $code]);
            $row = $stmt->fetch();
            if ($row === false) {
                $this->pdo->rollBack();
                return self::error('wrong_game', 'You are not part of this game', 403);
            }
            if ($row['status'] !== 'in_progress') {
                $this->pdo->rollBack();
                return self::error('game_not_in_progress', 'Game is not in progress', 409);
            }
            if ((int) $row['pending_tickets'] > 0) {
                $this->pdo->rollBack();
                return self::error('pending_tickets', 'Decide on pending tickets before drawing', 409);
            }

            $gameId      = (int) $row['game_id'];
            $teamId      = (int) $row['team_id'];
            $consumed    = (int) $row['windows_consumed'];
            $locoInHand  = (int) $row['locomotives_in_hand'];
            $locoInPool  = (int) $row['locomotives_remaining'];

            $startedAt = new \DateTimeImmutable($row['started_at'], new \DateTimeZone('UTC'));
            $now       = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
            $elapsed   = max(0, $now->getTimestamp() - $startedAt->getTimestamp());
            $accrued   = intdiv($elapsed, 300) + 1;
            $available = max(0, $accrued - $consumed);
            if ($available <= 0) {
                $this->pdo->rollBack();
                return self::error('no_draw_window', 'No draw windows available yet', 422);
            }

            // Build weighted pool: each color row + a locomotive entry.
            $stmt = $this->pdo->prepare(
                'SELECT color_id, count FROM game_card_pool WHERE game_id = ?'
            );
            $stmt->execute([$gameId]);
            $weights = [];   // list of ['type' => color_id|null, 'w' => count]
            foreach ($stmt->fetchAll() as $p) {
                $cnt = (int) $p['count'];
                if ($cnt > 0) {
                    $weights[] = ['type' => (int) $p['color_id'], 'w' => $cnt];
                }
            }
            if ($locoInPool > 0) {
                $weights[] = ['type' => null, 'w' => $locoInPool];
            }
            $total = array_sum(array_column($weights, 'w'));
            if ($total === 0) {
                $this->pdo->rollBack();
                return self::error('deck_empty', 'No cards left to draw', 422);
            }

            $drawn       = [];
            $locosDrawn  = 0;
            $colorCounts = [];   // color_id => drawn count
            for ($i = 0; $i < 2 && $total > 0; $i++) {
                $pick = random_int(1, $total);
                $cum  = 0;
                foreach ($weights as $idx => $w) {
                    $cum += $w['w'];
                    if ($cum >= $pick) {
                        if ($w['type'] === null) {
                            $locosDrawn++;
                        } else {
                            $drawn[] = $w['type'];
                            $colorCounts[$w['type']] = ($colorCounts[$w['type']] ?? 0) + 1;
                        }
                        $weights[$idx]['w']--;
                        $total--;
                        break;
                    }
                }
            }
            $totalDrawn = count($drawn) + $locosDrawn;

            // Apply: pool -, hand +, deck_counter -, windows_consumed +.
            foreach ($colorCounts as $cid => $cnt) {
                $this->pdo->prepare(
                    'UPDATE game_card_pool SET count = count - ? WHERE game_id = ? AND color_id = ?'
                )->execute([$cnt, $gameId, $cid]);
                $this->pdo->prepare(
                    'INSERT INTO game_team_hands (team_id, color_id, count) VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE count = count + VALUES(count)'
                )->execute([$teamId, $cid, $cnt]);
            }
            if ($locosDrawn > 0) {
                $this->pdo->prepare(
                    'UPDATE games SET locomotives_remaining = locomotives_remaining - ? WHERE id = ?'
                )->execute([$locosDrawn, $gameId]);
                $this->pdo->prepare(
                    'UPDATE game_teams SET locomotives_in_hand = locomotives_in_hand + ? WHERE id = ?'
                )->execute([$locosDrawn, $teamId]);
            }
            $this->pdo->prepare(
                'UPDATE games SET deck_counter = deck_counter - ? WHERE id = ?'
            )->execute([$totalDrawn, $gameId]);
            $this->pdo->prepare(
                'UPDATE game_teams SET windows_consumed = windows_consumed + 1 WHERE id = ?'
            )->execute([$teamId]);

            $payload = json_encode([
                'count'             => $totalDrawn,
                'colors'            => $drawn,
                'locomotives_drawn' => $locosDrawn,
            ], JSON_THROW_ON_ERROR);
            $this->pdo->prepare(
                "INSERT INTO game_events (game_id, team_id, kind, payload_json)
                 VALUES (?, ?, 'draw_train', ?)"
            )->execute([$gameId, $teamId, $payload]);

            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }

        return Response::json([
            'ok'                 => true,
            'drawn'              => $drawn,
            'locomotives_drawn'  => $locosDrawn,
            'windows_remaining'  => $available - 1,
        ]);
    }

    public function drawTickets(string $code): Response
    {
        $playerId = $_SESSION['player_id'] ?? null;
        if ($playerId === null) {
            return self::error('not_authenticated', 'Sign in by creating or joining a team first', 401);
        }

        $code = strtoupper($code);

        $this->pdo->beginTransaction();
        try {
            $stmt = $this->pdo->prepare(
                'SELECT g.id AS game_id, g.status, g.started_at, g.map_id,
                        t.id AS team_id, t.windows_consumed,
                        (SELECT COUNT(*) FROM game_team_tickets WHERE team_id = t.id AND status = \'pending\') AS pending_tickets
                   FROM games g
                   JOIN game_players p ON p.id = ?
                   JOIN game_teams   t ON t.id = p.team_id AND t.game_id = g.id
                  WHERE g.room_code = ?
                    FOR UPDATE'
            );
            $stmt->execute([(int) $playerId, $code]);
            $row = $stmt->fetch();
            if ($row === false) {
                $this->pdo->rollBack();
                return self::error('wrong_game', 'You are not part of this game', 403);
            }
            if ($row['status'] !== 'in_progress') {
                $this->pdo->rollBack();
                return self::error('game_not_in_progress', 'Game is not in progress', 409);
            }
            if ((int) $row['pending_tickets'] > 0) {
                $this->pdo->rollBack();
                return self::error('pending_tickets', 'Decide on pending tickets before drawing more', 409);
            }

            $gameId   = (int) $row['game_id'];
            $teamId   = (int) $row['team_id'];
            $mapId    = (int) $row['map_id'];
            $consumed = (int) $row['windows_consumed'];

            $startedAt = new \DateTimeImmutable($row['started_at'], new \DateTimeZone('UTC'));
            $now       = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
            $elapsed   = max(0, $now->getTimestamp() - $startedAt->getTimestamp());
            $accrued   = intdiv($elapsed, 300) + 1;
            $available = max(0, $accrued - $consumed);
            if ($available <= 0) {
                $this->pdo->rollBack();
                return self::error('no_draw_window', 'No draw windows available yet', 422);
            }

            // Pool = map tickets not already drawn by any team in this game.
            $stmt = $this->pdo->prepare(
                'SELECT mt.id, mt.from_stop_id, mt.to_stop_id, mt.points, mt.is_long_route
                   FROM map_tickets mt
                  WHERE mt.map_id = ?
                    AND mt.id NOT IN (
                        SELECT gtt.ticket_id
                          FROM game_team_tickets gtt
                          JOIN game_teams        gt ON gt.id = gtt.team_id
                         WHERE gt.game_id = ?
                    )'
            );
            $stmt->execute([$mapId, $gameId]);
            $pool = $stmt->fetchAll();
            if (count($pool) < 2) {
                // Per REQUIREMENTS §7: window is not consumed when pool is empty.
                $this->pdo->rollBack();
                return self::error('ticket_pool_empty', 'No tickets remaining to draw', 409);
            }

            // Pick 2 random distinct tickets.
            $keys = array_rand($pool, 2);
            $picked = [$pool[$keys[0]], $pool[$keys[1]]];

            $insert = $this->pdo->prepare(
                "INSERT INTO game_team_tickets (team_id, ticket_id, status) VALUES (?, ?, 'pending')"
            );
            $drawn = [];
            foreach ($picked as $p) {
                $insert->execute([$teamId, (int) $p['id']]);
                $drawn[] = [
                    'id'            => (int) $p['id'],
                    'from_stop_id'  => (int) $p['from_stop_id'],
                    'to_stop_id'    => (int) $p['to_stop_id'],
                    'points'        => (int) $p['points'],
                    'is_long_route' => (bool) $p['is_long_route'],
                ];
            }

            $this->pdo->prepare(
                'UPDATE game_teams SET windows_consumed = windows_consumed + 1 WHERE id = ?'
            )->execute([$teamId]);

            $payload = json_encode([
                'count'      => 2,
                'ticket_ids' => array_column($drawn, 'id'),
            ], JSON_THROW_ON_ERROR);
            $this->pdo->prepare(
                "INSERT INTO game_events (game_id, team_id, kind, payload_json)
                 VALUES (?, ?, 'draw_tickets', ?)"
            )->execute([$gameId, $teamId, $payload]);

            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }

        return Response::json([
            'ok'                => true,
            'windows_remaining' => $available - 1,
            'drawn_tickets'     => $drawn,
        ]);
    }

    public function trade(Request $r, string $code): Response
    {
        $ct = $r->headers['Content-Type'] ?? $r->headers['content-type'] ?? '';
        if (!str_contains((string) $ct, 'application/json')) {
            return self::error('unsupported_media_type', 'Content-Type must be application/json', 415);
        }

        $playerId = $_SESSION['player_id'] ?? null;
        if ($playerId === null) {
            return self::error('not_authenticated', 'Sign in by creating or joining a team first', 401);
        }

        $kind      = $r->body['kind']                          ?? null;
        $spendRaw  = $r->body['spend']                         ?? null;
        $spendLoco = filter_var($r->body['spend_locomotives'] ?? 0, FILTER_VALIDATE_INT);

        if ($kind !== 'any3for2' && $kind !== 'same3forLoco') {
            return self::error('invalid_trade_input', 'kind must be any3for2 or same3forLoco', 422);
        }
        if (!is_array($spendRaw) || $spendLoco === false || $spendLoco < 0) {
            return self::error('invalid_trade_input', 'spend object and spend_locomotives required', 422);
        }

        $spend = [];
        foreach ($spendRaw as $key => $val) {
            $cid = filter_var($key, FILTER_VALIDATE_INT);
            $cnt = filter_var($val, FILTER_VALIDATE_INT);
            if ($cid === false || $cid <= 0 || $cnt === false || $cnt < 0) {
                return self::error('invalid_trade_input', 'spend keys must be color_ids; values non-negative ints', 422);
            }
            if ($cnt > 0) {
                $spend[$cid] = $cnt;
            }
        }

        $colorTotal = array_sum($spend);
        if ($kind === 'any3for2') {
            if ($colorTotal + $spendLoco !== 3) {
                return self::error('invalid_trade_input', 'Must spend exactly 3 cards', 422);
            }
        } else {
            if ($spendLoco !== 0 || count($spend) !== 1 || $colorTotal !== 3) {
                return self::error('invalid_trade_input', 'Must spend exactly 3 cards of one color (no locomotives)', 422);
            }
        }

        $code = strtoupper($code);

        $this->pdo->beginTransaction();
        try {
            $stmt = $this->pdo->prepare(
                'SELECT g.id AS game_id, g.status, g.locomotives_remaining,
                        t.id AS team_id, t.locomotives_in_hand,
                        (SELECT COUNT(*) FROM game_team_tickets WHERE team_id = t.id AND status = \'pending\') AS pending_tickets
                   FROM games g
                   JOIN game_players p ON p.id = ?
                   JOIN game_teams   t ON t.id = p.team_id AND t.game_id = g.id
                  WHERE g.room_code = ?
                    FOR UPDATE'
            );
            $stmt->execute([(int) $playerId, $code]);
            $row = $stmt->fetch();
            if ($row === false) {
                $this->pdo->rollBack();
                return self::error('wrong_game', 'You are not part of this game', 403);
            }
            if ($row['status'] !== 'in_progress') {
                $this->pdo->rollBack();
                return self::error('game_not_in_progress', 'Game is not in progress', 409);
            }
            if ((int) $row['pending_tickets'] > 0) {
                $this->pdo->rollBack();
                return self::error('pending_tickets', 'Decide on pending tickets before trading', 409);
            }

            $gameId     = (int) $row['game_id'];
            $teamId     = (int) $row['team_id'];
            $teamLoco   = (int) $row['locomotives_in_hand'];
            $locoInPool = (int) $row['locomotives_remaining'];

            // Verify hand
            if ($spendLoco > $teamLoco) {
                $this->pdo->rollBack();
                return self::error('insufficient_cards', 'Not enough locomotives in hand', 422);
            }
            foreach ($spend as $cid => $cnt) {
                $stmt = $this->pdo->prepare(
                    'SELECT count FROM game_team_hands WHERE team_id = ? AND color_id = ?'
                );
                $stmt->execute([$teamId, $cid]);
                $h = $stmt->fetch();
                if ($h === false || (int) $h['count'] < $cnt) {
                    $this->pdo->rollBack();
                    return self::error('insufficient_cards', "Not enough cards of color $cid in hand", 422);
                }
            }

            // For same3forLoco we need a locomotive in pool BEFORE applying.
            if ($kind === 'same3forLoco' && $locoInPool <= 0) {
                $this->pdo->rollBack();
                return self::error('no_locomotives_left', 'No locomotives left in the pool', 422);
            }

            // Return spent cards to pool.
            if ($spendLoco > 0) {
                $this->pdo->prepare(
                    'UPDATE game_teams SET locomotives_in_hand = locomotives_in_hand - ? WHERE id = ?'
                )->execute([$spendLoco, $teamId]);
                $this->pdo->prepare(
                    'UPDATE games SET locomotives_remaining = locomotives_remaining + ?,
                                      deck_counter          = deck_counter + ?
                              WHERE id = ?'
                )->execute([$spendLoco, $spendLoco, $gameId]);
                $locoInPool += $spendLoco;
            }
            foreach ($spend as $cid => $cnt) {
                $this->pdo->prepare(
                    'UPDATE game_team_hands SET count = count - ? WHERE team_id = ? AND color_id = ?'
                )->execute([$cnt, $teamId, $cid]);
                $this->pdo->prepare(
                    'INSERT INTO game_card_pool (game_id, color_id, count) VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE count = count + VALUES(count)'
                )->execute([$gameId, $cid, $cnt]);
                $this->pdo->prepare(
                    'UPDATE games SET deck_counter = deck_counter + ? WHERE id = ?'
                )->execute([$cnt, $gameId]);
            }

            $receivedColors = [];
            $receivedLoco   = 0;

            if ($kind === 'any3for2') {
                // Draw 2 from current pool (which includes the 3 just returned).
                $stmt = $this->pdo->prepare(
                    'SELECT color_id, count FROM game_card_pool WHERE game_id = ?'
                );
                $stmt->execute([$gameId]);
                $weights = [];
                foreach ($stmt->fetchAll() as $p) {
                    $cnt = (int) $p['count'];
                    if ($cnt > 0) {
                        $weights[] = ['type' => (int) $p['color_id'], 'w' => $cnt];
                    }
                }
                if ($locoInPool > 0) {
                    $weights[] = ['type' => null, 'w' => $locoInPool];
                }
                $total = array_sum(array_column($weights, 'w'));

                $colorCounts = [];
                for ($i = 0; $i < 2 && $total > 0; $i++) {
                    $pick = random_int(1, $total);
                    $cum  = 0;
                    foreach ($weights as $idx => $w) {
                        $cum += $w['w'];
                        if ($cum >= $pick) {
                            if ($w['type'] === null) {
                                $receivedLoco++;
                            } else {
                                $receivedColors[] = $w['type'];
                                $colorCounts[$w['type']] = ($colorCounts[$w['type']] ?? 0) + 1;
                            }
                            $weights[$idx]['w']--;
                            $total--;
                            break;
                        }
                    }
                }
                $totalReceived = count($receivedColors) + $receivedLoco;

                foreach ($colorCounts as $cid => $cnt) {
                    $this->pdo->prepare(
                        'UPDATE game_card_pool SET count = count - ? WHERE game_id = ? AND color_id = ?'
                    )->execute([$cnt, $gameId, $cid]);
                    $this->pdo->prepare(
                        'INSERT INTO game_team_hands (team_id, color_id, count) VALUES (?, ?, ?)
                         ON DUPLICATE KEY UPDATE count = count + VALUES(count)'
                    )->execute([$teamId, $cid, $cnt]);
                }
                if ($receivedLoco > 0) {
                    $this->pdo->prepare(
                        'UPDATE games SET locomotives_remaining = locomotives_remaining - ? WHERE id = ?'
                    )->execute([$receivedLoco, $gameId]);
                    $this->pdo->prepare(
                        'UPDATE game_teams SET locomotives_in_hand = locomotives_in_hand + ? WHERE id = ?'
                    )->execute([$receivedLoco, $teamId]);
                }
                if ($totalReceived > 0) {
                    $this->pdo->prepare(
                        'UPDATE games SET deck_counter = deck_counter - ? WHERE id = ?'
                    )->execute([$totalReceived, $gameId]);
                }
            } else {
                // same3forLoco: hand out 1 locomotive.
                $receivedLoco = 1;
                $this->pdo->prepare(
                    'UPDATE games SET locomotives_remaining = locomotives_remaining - 1,
                                      deck_counter          = deck_counter - 1
                              WHERE id = ?'
                )->execute([$gameId]);
                $this->pdo->prepare(
                    'UPDATE game_teams SET locomotives_in_hand = locomotives_in_hand + 1 WHERE id = ?'
                )->execute([$teamId]);
            }

            $payload = json_encode([
                'kind'                 => $kind,
                'spend'                => (object) $spend,
                'spend_locomotives'    => $spendLoco,
                'received_colors'      => $receivedColors,
                'received_locomotives' => $receivedLoco,
            ], JSON_THROW_ON_ERROR);
            $this->pdo->prepare(
                "INSERT INTO game_events (game_id, team_id, kind, payload_json)
                 VALUES (?, ?, 'trade', ?)"
            )->execute([$gameId, $teamId, $payload]);

            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }

        return Response::json([
            'ok'                   => true,
            'received_colors'      => $receivedColors,
            'received_locomotives' => $receivedLoco,
        ]);
    }

    public function decideTickets(Request $r, string $code): Response
    {
        $ct = $r->headers['Content-Type'] ?? $r->headers['content-type'] ?? '';
        if (!str_contains((string) $ct, 'application/json')) {
            return self::error('unsupported_media_type', 'Content-Type must be application/json', 415);
        }

        $playerId = $_SESSION['player_id'] ?? null;
        if ($playerId === null) {
            return self::error('not_authenticated', 'Sign in by creating or joining a team first', 401);
        }

        $keepRaw = $r->body['keep_ids'] ?? null;
        if (!is_array($keepRaw)) {
            return self::error('invalid_payload', 'keep_ids must be an array of ticket ids', 400);
        }
        $keepIds = [];
        foreach ($keepRaw as $v) {
            $id = filter_var($v, FILTER_VALIDATE_INT);
            if ($id === false || $id <= 0) {
                return self::error('invalid_payload', 'keep_ids entries must be positive integers', 400);
            }
            $keepIds[$id] = true;
        }

        $code = strtoupper($code);

        $this->pdo->beginTransaction();
        try {
            $stmt = $this->pdo->prepare(
                'SELECT g.id AS game_id, g.status, t.id AS team_id
                   FROM games g
                   JOIN game_players p ON p.id = ?
                   JOIN game_teams   t ON t.id = p.team_id AND t.game_id = g.id
                  WHERE g.room_code = ?
                    FOR UPDATE'
            );
            $stmt->execute([(int) $playerId, $code]);
            $row = $stmt->fetch();
            if ($row === false) {
                $this->pdo->rollBack();
                return self::error('wrong_game', 'You are not part of this game', 403);
            }
            if ($row['status'] !== 'in_progress') {
                $this->pdo->rollBack();
                return self::error('game_not_in_progress', 'Game is not in progress', 409);
            }

            $gameId = (int) $row['game_id'];
            $teamId = (int) $row['team_id'];

            $stmt = $this->pdo->prepare(
                "SELECT ticket_id FROM game_team_tickets WHERE team_id = ? AND status = 'pending' FOR UPDATE"
            );
            $stmt->execute([$teamId]);
            $pendingIds = array_map('intval', array_column($stmt->fetchAll(), 'ticket_id'));
            if (empty($pendingIds)) {
                $this->pdo->rollBack();
                return self::error('no_pending_tickets', 'No pending tickets to decide', 409);
            }

            $pendingSet = array_flip($pendingIds);
            foreach (array_keys($keepIds) as $id) {
                if (!isset($pendingSet[$id])) {
                    $this->pdo->rollBack();
                    return self::error('unknown_ticket', "Ticket $id is not pending for your team", 400);
                }
            }

            $stmt = $this->pdo->prepare(
                "SELECT 1 FROM game_team_tickets WHERE team_id = ? AND status = 'kept' LIMIT 1"
            );
            $stmt->execute([$teamId]);
            $isStarting = $stmt->fetch() === false;
            $minKeep    = $isStarting ? 2 : 1;

            $keepCount = count($keepIds);
            if ($keepCount < $minKeep) {
                $this->pdo->rollBack();
                $errCode = $isStarting ? 'must_keep_two' : 'must_keep_one';
                return self::error($errCode, "Must keep at least $minKeep ticket(s)", 422);
            }

            $keepStmt = $this->pdo->prepare(
                "UPDATE game_team_tickets
                    SET status = 'kept', decided_at = UTC_TIMESTAMP(3)
                  WHERE ticket_id = ? AND team_id = ? AND status = 'pending'"
            );
            $discardStmt = $this->pdo->prepare(
                "UPDATE game_team_tickets
                    SET status = 'discarded', decided_at = UTC_TIMESTAMP(3)
                  WHERE ticket_id = ? AND team_id = ? AND status = 'pending'"
            );
            $keptList = [];
            $discardedList = [];
            foreach ($pendingIds as $id) {
                if (isset($keepIds[$id])) {
                    $keepStmt->execute([$id, $teamId]);
                    $keptList[] = $id;
                } else {
                    $discardStmt->execute([$id, $teamId]);
                    $discardedList[] = $id;
                }
            }

            $payload = json_encode([
                'kept'      => $keptList,
                'discarded' => $discardedList,
            ], JSON_THROW_ON_ERROR);
            $this->pdo->prepare(
                "INSERT INTO game_events (game_id, team_id, kind, payload_json)
                 VALUES (?, ?, 'keep_tickets', ?)"
            )->execute([$gameId, $teamId, $payload]);

            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }

        return Response::json(['ok' => true]);
    }

    private const ROUTE_POINTS = [1 => 1, 2 => 2, 3 => 4, 4 => 7, 5 => 10, 6 => 15];
    private const LONGEST_ROUTE_BONUS = 10;

    private function finalizeIfDue(int $gameId, ?string $startedAt, string $status, int $duration): bool
    {
        if ($status !== 'in_progress' || $startedAt === null) {
            return false;
        }
        $started = new \DateTimeImmutable($startedAt, new \DateTimeZone('UTC'));
        $now     = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        if ($now->getTimestamp() < $started->getTimestamp() + $duration) {
            return false;
        }
        $this->finalizeGame($gameId);
        return true;
    }

    private function finalizeGame(int $gameId): void
    {
        $this->pdo->beginTransaction();
        try {
            $stmt = $this->pdo->prepare('SELECT id, status FROM games WHERE id = ? FOR UPDATE');
            $stmt->execute([$gameId]);
            $g = $stmt->fetch();
            if ($g === false || $g['status'] !== 'in_progress') {
                $this->pdo->rollBack();
                return;
            }

            $scores = $this->computeScores($gameId);

            $updateTeam   = $this->pdo->prepare('UPDATE game_teams SET final_score = ? WHERE id = ?');
            $updateTicket = $this->pdo->prepare('UPDATE game_team_tickets SET completed = ? WHERE id = ?');
            foreach ($scores as $teamId => $s) {
                $updateTeam->execute([$s['total'], $teamId]);
                foreach ($s['tickets'] as $t) {
                    $updateTicket->execute([$t['completed'] ? 1 : 0, $t['id']]);
                }
            }

            $this->pdo->prepare(
                "UPDATE games SET status = 'ended', ended_at = UTC_TIMESTAMP(3) WHERE id = ?"
            )->execute([$gameId]);

            $this->pdo->prepare(
                "INSERT INTO game_events (game_id, kind, payload_json) VALUES (?, 'end', ?)"
            )->execute([$gameId, json_encode(['team_count' => count($scores)], JSON_THROW_ON_ERROR)]);

            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
    }

    /**
     * Returns: [team_id => [
     *   'route_points', 'ticket_points', 'ticket_penalties',
     *   'longest_route_length', 'longest_bonus', 'total',
     *   'tickets' => [['id', 'from_stop_id', 'to_stop_id', 'points', 'is_long_route', 'completed'], ...]
     * ]]
     */
    private function computeScores(int $gameId): array
    {
        $stmt = $this->pdo->prepare('SELECT id FROM game_teams WHERE game_id = ?');
        $stmt->execute([$gameId]);
        $teamIds = array_map('intval', array_column($stmt->fetchAll(), 'id'));

        $stmt = $this->pdo->prepare(
            'SELECT c.team_id, r.length, r.from_stop_id, r.to_stop_id
               FROM game_claims c
               JOIN map_routes  r ON r.id = c.route_id
              WHERE c.game_id = ?'
        );
        $stmt->execute([$gameId]);
        $claimsByTeam = [];
        foreach ($stmt->fetchAll() as $c) {
            $claimsByTeam[(int) $c['team_id']][] = [
                'length'  => (int) $c['length'],
                'from'    => (int) $c['from_stop_id'],
                'to'      => (int) $c['to_stop_id'],
            ];
        }

        $stmt = $this->pdo->prepare(
            "SELECT gtt.id, gtt.team_id, mt.from_stop_id, mt.to_stop_id, mt.points, mt.is_long_route
               FROM game_team_tickets gtt
               JOIN game_teams        gt ON gt.id = gtt.team_id
               JOIN map_tickets       mt ON mt.id = gtt.ticket_id
              WHERE gt.game_id = ? AND gtt.status = 'kept'"
        );
        $stmt->execute([$gameId]);
        $ticketsByTeam = [];
        foreach ($stmt->fetchAll() as $t) {
            $ticketsByTeam[(int) $t['team_id']][] = $t;
        }

        $perTeam = [];
        $longestPerTeam = [];
        foreach ($teamIds as $tid) {
            $teamClaims = $claimsByTeam[$tid] ?? [];

            $routePoints = 0;
            foreach ($teamClaims as $c) {
                $routePoints += self::ROUTE_POINTS[$c['length']] ?? 0;
            }

            // Connectivity for tickets via union-find.
            $parent = [];
            $find = function (int $x) use (&$parent, &$find): int {
                if (!isset($parent[$x])) $parent[$x] = $x;
                if ($parent[$x] === $x) return $x;
                return $parent[$x] = $find($parent[$x]);
            };
            $union = function (int $a, int $b) use (&$parent, $find) {
                $ra = $find($a); $rb = $find($b);
                if ($ra !== $rb) $parent[$ra] = $rb;
            };
            foreach ($teamClaims as $c) {
                $union($c['from'], $c['to']);
            }

            $ticketPoints = 0;
            $ticketPenalties = 0;
            $ticketResults = [];
            foreach ($ticketsByTeam[$tid] ?? [] as $t) {
                $a = (int) $t['from_stop_id'];
                $b = (int) $t['to_stop_id'];
                $completed = isset($parent[$a], $parent[$b]) && $find($a) === $find($b);
                if ($completed) {
                    $ticketPoints += (int) $t['points'];
                } else {
                    $ticketPenalties += (int) $t['points'];
                }
                $ticketResults[] = [
                    'id'            => (int) $t['id'],
                    'from_stop_id'  => $a,
                    'to_stop_id'    => $b,
                    'points'        => (int) $t['points'],
                    'is_long_route' => (bool) $t['is_long_route'],
                    'completed'     => $completed,
                ];
            }

            $longest = $this->longestSimplePath($teamClaims);
            $longestPerTeam[$tid] = $longest;

            $perTeam[$tid] = [
                'route_points'         => $routePoints,
                'ticket_points'        => $ticketPoints,
                'ticket_penalties'     => $ticketPenalties,
                'longest_route_length' => $longest,
                'longest_bonus'        => 0,
                'tickets'              => $ticketResults,
            ];
        }

        $maxLongest = !empty($longestPerTeam) ? max($longestPerTeam) : 0;
        if ($maxLongest > 0) {
            foreach ($longestPerTeam as $tid => $len) {
                if ($len === $maxLongest) {
                    $perTeam[$tid]['longest_bonus'] = self::LONGEST_ROUTE_BONUS;
                }
            }
        }

        foreach ($perTeam as $tid => &$s) {
            $s['total'] = $s['route_points'] + $s['ticket_points'] - $s['ticket_penalties'] + $s['longest_bonus'];
        }
        unset($s);

        return $perTeam;
    }

    /**
     * Longest sum of edge lengths in a walk that uses each edge at most once
     * (nodes may repeat — classic TtR longest-path rule). Brute-force DFS;
     * fine for the small route counts at play here.
     */
    private function longestSimplePath(array $edges): int
    {
        if (empty($edges)) return 0;
        $adj = [];   // node => [['to' => N, 'len' => L, 'idx' => i]]
        foreach ($edges as $i => $e) {
            $adj[$e['from']][] = ['to' => $e['to'],   'len' => $e['length'], 'idx' => $i];
            $adj[$e['to']][]   = ['to' => $e['from'], 'len' => $e['length'], 'idx' => $i];
        }
        $best = 0;
        $used = [];
        $dfs = function (int $node, int $acc) use (&$dfs, &$adj, &$used, &$best) {
            if ($acc > $best) $best = $acc;
            foreach ($adj[$node] as $e) {
                if (isset($used[$e['idx']])) continue;
                $used[$e['idx']] = true;
                $dfs($e['to'], $acc + $e['len']);
                unset($used[$e['idx']]);
            }
        };
        foreach (array_keys($adj) as $start) {
            $dfs($start, 0);
        }
        return $best;
    }

    private function buildScoreboard(int $gameId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, name, color_index, final_score
               FROM game_teams WHERE game_id = ?'
        );
        $stmt->execute([$gameId]);
        $teamMeta = [];
        foreach ($stmt->fetchAll() as $t) {
            $teamMeta[(int) $t['id']] = [
                'name'        => $t['name'],
                'color_index' => (int) $t['color_index'],
                'final_score' => $t['final_score'] !== null ? (int) $t['final_score'] : null,
            ];
        }

        $scores = $this->computeScores($gameId);
        $teams = [];
        foreach ($scores as $teamId => $s) {
            $meta = $teamMeta[$teamId] ?? ['name' => 'Team', 'color_index' => 0];
            $teams[] = [
                'id'                   => $teamId,
                'name'                 => $meta['name'],
                'color_index'          => $meta['color_index'],
                'route_points'         => $s['route_points'],
                'ticket_points'        => $s['ticket_points'],
                'ticket_penalties'     => $s['ticket_penalties'],
                'longest_route_length' => $s['longest_route_length'],
                'longest_bonus'        => $s['longest_bonus'],
                'total'                => $s['total'],
                'tickets'              => $s['tickets'],
            ];
        }

        usort($teams, fn(array $a, array $b) => $b['total'] <=> $a['total']);
        return ['teams' => $teams];
    }

    private static function error(string $code, string $message, int $status): Response
    {
        return Response::json(['error' => $code, 'message' => $message], $status);
    }

    private function isoUtc(?string $mysqlDateTime): ?string
    {
        if ($mysqlDateTime === null) {
            return null;
        }
        return (new \DateTimeImmutable($mysqlDateTime, new \DateTimeZone('UTC')))
            ->format('Y-m-d\TH:i:s.v\Z');
    }
}
