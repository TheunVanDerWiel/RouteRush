<?php
declare(strict_types=1);

namespace RouteRush\Controllers;

use PDO;
use PDOException;
use RouteRush\Request;
use RouteRush\Response;

final class TeamController
{
    private const PIN_ALLOCATION_RETRIES = 10;

    public function __construct(private readonly PDO $pdo) {}

    public function create(Request $r, string $code): Response
    {
        if (($guard = self::requireJson($r)) !== null) {
            return $guard;
        }

        $teamName   = is_string($r->body['team_name']   ?? null) ? trim($r->body['team_name'])   : '';
        $playerName = is_string($r->body['player_name'] ?? null) ? trim($r->body['player_name']) : '';

        if ($teamName === '' || mb_strlen($teamName) > 50 || $playerName === '' || mb_strlen($playerName) > 50) {
            return self::error('invalid_payload', 'team_name and player_name are required (1-50 chars)', 400);
        }

        $code = strtoupper($code);
        $stmt = $this->pdo->prepare(
            'SELECT g.id, g.status, g.host_player_id, m.max_teams
               FROM games g
               JOIN maps  m ON m.id = g.map_id
              WHERE g.room_code = ?'
        );
        $stmt->execute([$code]);
        $game = $stmt->fetch();
        if ($game === false) {
            return self::error('not_found', 'Game not found', 404);
        }
        if ($game['status'] !== 'lobby') {
            return self::error('game_not_lobby', 'Game is no longer accepting new teams', 409);
        }

        $gameId   = (int) $game['id'];
        $maxTeams = (int) $game['max_teams'];

        $stmt = $this->pdo->prepare('SELECT color_index FROM game_teams WHERE game_id = ?');
        $stmt->execute([$gameId]);
        $usedColors = array_map(static fn(array $r) => (int) $r['color_index'], $stmt->fetchAll());

        if (count($usedColors) >= $maxTeams) {
            return self::error('lobby_full', 'No more teams can join this game', 409);
        }

        $colorIndex = null;
        for ($i = 0; $i < $maxTeams; $i++) {
            if (!in_array($i, $usedColors, true)) {
                $colorIndex = $i;
                break;
            }
        }

        $sessionToken = bin2hex(random_bytes(32));

        $this->pdo->beginTransaction();
        try {
            $stmt = $this->pdo->prepare('SELECT pin_hash FROM game_teams WHERE game_id = ? FOR UPDATE');
            $stmt->execute([$gameId]);
            $existingHashes = array_column($stmt->fetchAll(), 'pin_hash');

            $pin = null;
            for ($attempt = 0; $attempt < self::PIN_ALLOCATION_RETRIES; $attempt++) {
                $candidate = str_pad((string) random_int(0, 9999), 4, '0', STR_PAD_LEFT);
                $collision = false;
                foreach ($existingHashes as $hash) {
                    if (password_verify($candidate, $hash)) {
                        $collision = true;
                        break;
                    }
                }
                if (!$collision) {
                    $pin = $candidate;
                    break;
                }
            }
            if ($pin === null) {
                $this->pdo->rollBack();
                return self::error('pin_allocation_failed', 'Could not allocate a unique PIN for this team', 500);
            }
            $pinHash = password_hash($pin, PASSWORD_BCRYPT);

            $insertTeam = $this->pdo->prepare(
                'INSERT INTO game_teams (game_id, name, color_index, pin_hash) VALUES (?, ?, ?, ?)'
            );
            try {
                $insertTeam->execute([$gameId, $teamName, $colorIndex, $pinHash]);
            } catch (PDOException $e) {
                $this->pdo->rollBack();
                if ($e->getCode() === '23000') {
                    if (str_contains($e->getMessage(), 'uk_game_teams_name')) {
                        return self::error('name_taken', 'A team with that name already exists', 400);
                    }
                    if (str_contains($e->getMessage(), 'uk_game_teams_color')) {
                        return self::error('lobby_full', 'No color slots available, please retry', 409);
                    }
                }
                throw $e;
            }
            $teamId = (int) $this->pdo->lastInsertId();

            $insertPlayer = $this->pdo->prepare(
                'INSERT INTO game_players (team_id, display_name, session_token) VALUES (?, ?, ?)'
            );
            $insertPlayer->execute([$teamId, $playerName, $sessionToken]);
            $playerId = (int) $this->pdo->lastInsertId();

            $isHost = $game['host_player_id'] === null;
            if ($isHost) {
                $stmt = $this->pdo->prepare('UPDATE games SET host_player_id = ? WHERE id = ? AND host_player_id IS NULL');
                $stmt->execute([$playerId, $gameId]);
            }

            $event = $this->pdo->prepare(
                'INSERT INTO game_events (game_id, team_id, player_id, kind, payload_json) VALUES (?, ?, ?, ?, ?)'
            );
            $event->execute([
                $gameId,
                $teamId,
                $playerId,
                'join',
                json_encode(['team_id' => $teamId, 'player_name' => $playerName], JSON_THROW_ON_ERROR),
            ]);

            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }

        $_SESSION['player_id']     = $playerId;
        $_SESSION['session_token'] = $sessionToken;

        return Response::json([
            'team_id'     => $teamId,
            'player_id'   => $playerId,
            'color_index' => $colorIndex,
            'is_host'     => $isHost,
            'pin'         => $pin,
        ], 201);
    }

    private static function requireJson(Request $r): ?Response
    {
        $ct = $r->headers['Content-Type'] ?? $r->headers['content-type'] ?? '';
        if (!str_contains((string) $ct, 'application/json')) {
            return self::error('unsupported_media_type', 'Content-Type must be application/json', 415);
        }
        return null;
    }

    private static function error(string $code, string $message, int $status): Response
    {
        return Response::json(['error' => $code, 'message' => $message], $status);
    }
}
