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
    private const PIN_RATE_LIMIT_SECONDS = 5;

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

    public function join(Request $r, string $code, string $teamIdRaw): Response
    {
        if (($guard = self::requireJson($r)) !== null) {
            return $guard;
        }

        $playerName = is_string($r->body['player_name'] ?? null) ? trim($r->body['player_name']) : '';
        $pin        = is_string($r->body['pin']         ?? null) ? $r->body['pin']               : '';

        if ($playerName === '' || mb_strlen($playerName) > 50) {
            return self::error('invalid_payload', 'player_name is required (1-50 chars)', 400);
        }
        if (preg_match('/^\d{4}$/', $pin) !== 1) {
            return self::error('invalid_payload', 'pin must be exactly 4 digits', 400);
        }
        $teamId = filter_var($teamIdRaw, FILTER_VALIDATE_INT);
        if ($teamId === false || $teamId <= 0) {
            return self::error('not_found', 'Team not found', 404);
        }

        $ipBin = self::clientIpBinary();
        if ($ipBin !== null) {
            $stmt = $this->pdo->prepare(
                'SELECT TIMESTAMPDIFF(MICROSECOND, last_failed_at, UTC_TIMESTAMP(3)) AS micros_since
                   FROM pin_failed_attempts WHERE ip = ?'
            );
            $stmt->execute([$ipBin]);
            $row = $stmt->fetch();
            if ($row !== false && (int) $row['micros_since'] < self::PIN_RATE_LIMIT_SECONDS * 1_000_000) {
                return self::error('rate_limited', 'Too many failed attempts, slow down', 429)
                    ->withHeader('Retry-After', (string) self::PIN_RATE_LIMIT_SECONDS);
            }
        }

        $code = strtoupper($code);
        $stmt = $this->pdo->prepare(
            'SELECT g.id AS game_id, g.status, g.host_player_id,
                    t.id AS team_id, t.name AS team_name, t.color_index, t.pin_hash
               FROM games g
               JOIN game_teams t ON t.game_id = g.id
              WHERE g.room_code = ? AND t.id = ?'
        );
        $stmt->execute([$code, $teamId]);
        $row = $stmt->fetch();
        if ($row === false) {
            return self::error('not_found', 'Team not found in this game', 404);
        }
        if ($row['status'] === 'ended') {
            return self::error('game_ended', 'Game has ended', 409);
        }

        if (!password_verify($pin, $row['pin_hash'])) {
            if ($ipBin !== null) {
                $stmt = $this->pdo->prepare(
                    'INSERT INTO pin_failed_attempts (ip) VALUES (?)
                     ON DUPLICATE KEY UPDATE last_failed_at = UTC_TIMESTAMP(3)'
                );
                $stmt->execute([$ipBin]);
            }
            return self::error('wrong_pin', 'Incorrect PIN', 401);
        }

        $gameId       = (int) $row['game_id'];
        $colorIndex   = (int) $row['color_index'];
        $sessionToken = bin2hex(random_bytes(32));

        // Rejoin path: a player with this exact display_name already exists on
        // the team. PIN matched, so this is the same human reconnecting after
        // a session loss. Reissue the session token against their existing
        // player record instead of inserting a duplicate. Rejoin works during
        // both lobby and in_progress; new joins are gated to lobby below.
        $stmt = $this->pdo->prepare(
            'SELECT id FROM game_players WHERE team_id = ? AND display_name = ? LIMIT 1'
        );
        $stmt->execute([$teamId, $playerName]);
        $existing = $stmt->fetch();
        if ($existing !== false) {
            $playerId = (int) $existing['id'];
            $this->pdo->prepare('UPDATE game_players SET session_token = ? WHERE id = ?')
                ->execute([$sessionToken, $playerId]);

            $_SESSION['player_id']     = $playerId;
            $_SESSION['session_token'] = $sessionToken;

            return Response::json([
                'team_id'     => $teamId,
                'player_id'   => $playerId,
                'color_index' => $colorIndex,
            ]);
        }

        if ($row['status'] !== 'lobby') {
            return self::error('game_not_lobby', 'Game is no longer accepting new players', 409);
        }

        $stmt = $this->pdo->prepare('SELECT COUNT(*) AS n FROM game_players WHERE team_id = ?');
        $stmt->execute([$teamId]);
        $existingPlayers = (int) $stmt->fetch()['n'];

        $this->pdo->beginTransaction();
        try {
            $insertPlayer = $this->pdo->prepare(
                'INSERT INTO game_players (team_id, display_name, session_token) VALUES (?, ?, ?)'
            );
            $insertPlayer->execute([$teamId, $playerName, $sessionToken]);
            $playerId = (int) $this->pdo->lastInsertId();

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

        $response = Response::json([
            'team_id'     => $teamId,
            'player_id'   => $playerId,
            'color_index' => $colorIndex,
        ]);
        if ($existingPlayers >= 2) {
            $response = $response->withHeader('X-Warning', 'team_already_has_two_players');
        }
        return $response;
    }

    private static function clientIpBinary(): ?string
    {
        $ip = $_SERVER['REMOTE_ADDR'] ?? null;
        if (!is_string($ip) || $ip === '') {
            return null;
        }
        $packed = @inet_pton($ip);
        return $packed === false ? null : $packed;
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
