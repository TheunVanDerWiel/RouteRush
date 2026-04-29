<?php
declare(strict_types=1);

namespace RouteRush\Controllers;

use PDO;
use RouteRush\Mailer;
use RouteRush\Request;
use RouteRush\Response;

/**
 * Editor-side endpoints. Currently hosts the OTP-based authorisation for
 * saving maps to the database; map listing / fetching for the editor's
 * "Load from DB" picker still lives in MapController.
 */
final class EditorController
{
    private const OTP_TTL_SECONDS = 300;

    public function __construct(
        private readonly PDO $pdo,
        private readonly array $editorConfig,
        private readonly Mailer $mailer,
    ) {}

    /**
     * Generates a 6-digit one-time password, stores its hash with a
     * 5-minute expiry, and emails the plaintext code to the configured
     * notification address. Any previously unused OTPs are invalidated
     * so only one is ever live at a time.
     */
    public function requestOtp(): Response
    {
        $to = $this->editorConfig['notification_email'] ?? null;
        if (!is_string($to) || $to === '') {
            return self::error(
                'mail_not_configured',
                'editor.notification_email is not configured',
                500,
            );
        }

        $otp  = sprintf('%06d', random_int(0, 999999));
        $hash = hash('sha256', $otp);

        // Mark any existing unused OTP as used so only one is live.
        $this->pdo->prepare(
            'UPDATE editor_otps SET used_at = UTC_TIMESTAMP(3) WHERE used_at IS NULL'
        )->execute();

        $this->pdo->prepare(
            'INSERT INTO editor_otps (otp_hash, expires_at)
             VALUES (?, UTC_TIMESTAMP(3) + INTERVAL ' . self::OTP_TTL_SECONDS . ' SECOND)'
        )->execute([$hash]);

        $body = "Your one-time password for the Route Rush map editor is:\n\n"
              . $otp . "\n\nIt expires in 5 minutes.\n";
        $sent = $this->mailer->send(
            $to,
            'Route Rush map editor — one-time password',
            $body,
        );
        if (!$sent) {
            return self::error(
                'mail_failed',
                'Could not send email; check server logs.',
                500,
            );
        }

        return Response::json([
            'ok'                 => true,
            'expires_in_seconds' => self::OTP_TTL_SECONDS,
        ]);
    }

    /**
     * Saves a new map (or new version of an existing map) when the request
     * body contains a valid, unused, unexpired OTP. The version is one
     * higher than the largest existing version for the same name; an
     * unused name starts at version 1.
     */
    public function saveMap(Request $r): Response
    {
        $ct = $r->headers['Content-Type'] ?? $r->headers['content-type'] ?? '';
        if (!str_contains((string) $ct, 'application/json')) {
            return self::error(
                'unsupported_media_type',
                'Content-Type must be application/json',
                415,
            );
        }

        $otp = $r->body['otp'] ?? null;
        if (!is_string($otp) || !preg_match('/^\d{6}$/', $otp)) {
            return self::error('invalid_otp', 'otp must be a 6-digit string', 400);
        }

        $map = $r->body['map'] ?? null;
        if (!is_array($map)) {
            return self::error('invalid_payload', 'map must be an object', 400);
        }

        $shapeError = self::validateMapShape($map);
        if ($shapeError !== null) {
            return self::error('invalid_map', $shapeError, 422);
        }

        $this->pdo->beginTransaction();
        try {
            // Lock the matching OTP row so a concurrent request can't reuse it.
            $stmt = $this->pdo->prepare(
                'SELECT id, otp_hash, expires_at
                   FROM editor_otps
                  WHERE used_at IS NULL
                    AND expires_at > UTC_TIMESTAMP(3)
               ORDER BY id DESC
                  LIMIT 1
                    FOR UPDATE'
            );
            $stmt->execute();
            $row = $stmt->fetch();

            $providedHash = hash('sha256', $otp);
            if ($row === false || !hash_equals($row['otp_hash'], $providedHash)) {
                $this->pdo->rollBack();
                return self::error('otp_invalid', 'OTP is invalid or expired', 401);
            }

            // Burn the OTP whether the rest succeeds or not (security).
            $this->pdo->prepare(
                'UPDATE editor_otps SET used_at = UTC_TIMESTAMP(3) WHERE id = ?'
            )->execute([(int) $row['id']]);

            // Determine the next version. Race-safe enough: the unique key
            // (name, version) catches concurrent inserts and the loser
            // gets a 409 below.
            $stmt = $this->pdo->prepare(
                'SELECT COALESCE(MAX(version), 0) AS v FROM maps WHERE name = ?'
            );
            $stmt->execute([(string) $map['name']]);
            $nextVersion = ((int) $stmt->fetch()['v']) + 1;

            // Insert the maps row.
            $stmt = $this->pdo->prepare(
                'INSERT INTO maps
                    (name, version, viewbox_w, viewbox_h, starting_train_cards,
                     starting_tickets_count, starting_tickets_keep_min,
                     min_teams, max_teams, locomotives_count)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            try {
                $stmt->execute([
                    (string) $map['name'],
                    $nextVersion,
                    (int) $map['viewbox_w'],
                    (int) $map['viewbox_h'],
                    (int) $map['starting_train_cards'],
                    (int) $map['starting_tickets_count'],
                    (int) $map['starting_tickets_keep_min'],
                    (int) $map['min_teams'],
                    (int) $map['max_teams'],
                    (int) $map['locomotives_count'],
                ]);
            } catch (\PDOException $e) {
                if (($e->errorInfo[1] ?? null) === 1062) {
                    $this->pdo->rollBack();
                    return self::error(
                        'version_conflict',
                        'Another save raced ahead. Please retry.',
                        409,
                    );
                }
                throw $e;
            }
            $newMapId = (int) $this->pdo->lastInsertId();

            $colorMap = $this->insertColors($newMapId, $map['colors']);
            $stopMap  = $this->insertStops($newMapId, $map['stops']);
            $this->insertRoutes($newMapId, $map['routes'], $colorMap, $stopMap);
            $this->insertTickets($newMapId, $map['tickets'], $stopMap);

            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }

        return Response::json([
            'ok'      => true,
            'id'      => $newMapId,
            'name'    => (string) $map['name'],
            'version' => $nextVersion,
        ]);
    }

    /**
     * @return array<int,int> map of submitted color id => new DB id
     */
    private function insertColors(int $mapId, array $colors): array
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO map_colors (map_id, display_name, hex, symbol, deck_count)
             VALUES (?, ?, ?, ?, ?)'
        );
        $idMap = [];
        foreach ($colors as $c) {
            $stmt->execute([
                $mapId,
                (string) $c['display_name'],
                (string) $c['hex'],
                (string) $c['symbol'],
                (int)    $c['deck_count'],
            ]);
            $idMap[(int) $c['id']] = (int) $this->pdo->lastInsertId();
        }
        return $idMap;
    }

    /**
     * @return array<int,int> map of submitted stop id => new DB id
     */
    private function insertStops(int $mapId, array $stops): array
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO map_stops (map_id, display_name, x, y) VALUES (?, ?, ?, ?)'
        );
        $idMap = [];
        foreach ($stops as $s) {
            $stmt->execute([
                $mapId,
                (string) $s['display_name'],
                (int)    $s['x'],
                (int)    $s['y'],
            ]);
            $idMap[(int) $s['id']] = (int) $this->pdo->lastInsertId();
        }
        return $idMap;
    }

    /**
     * @param array<int,int> $colorMap
     * @param array<int,int> $stopMap
     */
    private function insertRoutes(int $mapId, array $routes, array $colorMap, array $stopMap): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO map_routes
                (map_id, from_stop_id, to_stop_id, via_x, via_y,
                 length, color_id, parallel_index)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($routes as $r) {
            $fromId = $stopMap[(int) $r['from_stop_id']] ?? null;
            $toId   = $stopMap[(int) $r['to_stop_id']]   ?? null;
            $colorId = $colorMap[(int) $r['color_id']]   ?? null;
            if ($fromId === null || $toId === null || $colorId === null) {
                throw new \RuntimeException(
                    'Route #' . (int) $r['id'] . ' references unknown stop or color id'
                );
            }
            $stmt->execute([
                $mapId,
                $fromId,
                $toId,
                $r['via_x'] !== null ? (int) $r['via_x'] : null,
                $r['via_y'] !== null ? (int) $r['via_y'] : null,
                (int) $r['length'],
                $colorId,
                (int) $r['parallel_index'],
            ]);
        }
    }

    /**
     * @param array<int,int> $stopMap
     */
    private function insertTickets(int $mapId, array $tickets, array $stopMap): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO map_tickets
                (map_id, from_stop_id, to_stop_id, points, is_long_route)
             VALUES (?, ?, ?, ?, ?)'
        );
        foreach ($tickets as $t) {
            $fromId = $stopMap[(int) $t['from_stop_id']] ?? null;
            $toId   = $stopMap[(int) $t['to_stop_id']]   ?? null;
            if ($fromId === null || $toId === null) {
                throw new \RuntimeException(
                    'Ticket #' . (int) $t['id'] . ' references unknown stop id'
                );
            }
            $stmt->execute([
                $mapId,
                $fromId,
                $toId,
                (int)  $t['points'],
                (bool) $t['is_long_route'] ? 1 : 0,
            ]);
        }
    }

    /**
     * Quick structural sanity check on the map payload. Just enough to
     * give the user a clean error message instead of a raw DB failure;
     * the full editor validator runs client-side before sending.
     */
    private static function validateMapShape(array $m): ?string
    {
        if (!isset($m['name']) || !is_string($m['name']) || trim($m['name']) === '') {
            return 'name is required';
        }
        foreach ([
            'viewbox_w', 'viewbox_h',
            'starting_train_cards', 'starting_tickets_count', 'starting_tickets_keep_min',
            'min_teams', 'max_teams', 'locomotives_count',
        ] as $k) {
            if (!isset($m[$k]) || !is_int($m[$k])) {
                return "$k must be an integer";
            }
        }
        if ($m['viewbox_w'] <= 0 || $m['viewbox_h'] <= 0) {
            return 'viewbox dimensions must be > 0';
        }
        if ($m['min_teams'] < 2 || $m['max_teams'] > 5 || $m['min_teams'] > $m['max_teams']) {
            return 'min_teams/max_teams out of range (2..5, min ≤ max)';
        }
        if ($m['starting_tickets_keep_min'] < 1
            || $m['starting_tickets_count'] < $m['starting_tickets_keep_min']) {
            return 'starting_tickets_count must be ≥ starting_tickets_keep_min ≥ 1';
        }

        foreach (['colors', 'stops', 'routes', 'tickets'] as $k) {
            if (!isset($m[$k]) || !is_array($m[$k])) {
                return "$k must be an array";
            }
        }

        // Colors
        $colorIds = [];
        foreach ($m['colors'] as $i => $c) {
            if (!is_array($c)) return "colors[$i] must be an object";
            if (!isset($c['id']) || !is_int($c['id']) || $c['id'] <= 0) {
                return "colors[$i].id must be a positive integer";
            }
            if (isset($colorIds[$c['id']])) {
                return "colors: duplicate id {$c['id']}";
            }
            $colorIds[$c['id']] = true;
            if (!isset($c['display_name']) || !is_string($c['display_name'])
                || trim($c['display_name']) === '') {
                return "colors[$i].display_name required";
            }
            if (!isset($c['hex']) || !is_string($c['hex'])
                || !preg_match('/^#[0-9a-fA-F]{6}$/', $c['hex'])) {
                return "colors[$i].hex must be #RRGGBB";
            }
            if (!isset($c['symbol']) || !is_string($c['symbol'])) {
                return "colors[$i].symbol required";
            }
            if (!isset($c['deck_count']) || !is_int($c['deck_count']) || $c['deck_count'] < 0) {
                return "colors[$i].deck_count must be a non-negative integer";
            }
        }

        // Stops
        $stopIds = [];
        foreach ($m['stops'] as $i => $s) {
            if (!is_array($s)) return "stops[$i] must be an object";
            if (!isset($s['id']) || !is_int($s['id']) || $s['id'] <= 0) {
                return "stops[$i].id must be a positive integer";
            }
            if (isset($stopIds[$s['id']])) {
                return "stops: duplicate id {$s['id']}";
            }
            $stopIds[$s['id']] = true;
            if (!isset($s['display_name']) || !is_string($s['display_name'])
                || trim($s['display_name']) === '') {
                return "stops[$i].display_name required";
            }
            if (!isset($s['x']) || !is_int($s['x']) || !isset($s['y']) || !is_int($s['y'])) {
                return "stops[$i] x/y must be integers";
            }
        }

        // Routes
        foreach ($m['routes'] as $i => $r) {
            if (!is_array($r)) return "routes[$i] must be an object";
            if (!isset($r['from_stop_id'], $r['to_stop_id'], $r['length'],
                       $r['color_id'], $r['parallel_index'])) {
                return "routes[$i] missing required keys";
            }
            if (!isset($stopIds[(int) $r['from_stop_id']])) {
                return "routes[$i] from_stop_id does not match any stop";
            }
            if (!isset($stopIds[(int) $r['to_stop_id']])) {
                return "routes[$i] to_stop_id does not match any stop";
            }
            if ($r['from_stop_id'] === $r['to_stop_id']) {
                return "routes[$i] from and to must differ";
            }
            if (!is_int($r['length']) || $r['length'] < 1 || $r['length'] > 6) {
                return "routes[$i].length must be 1..6";
            }
            if (!isset($colorIds[(int) $r['color_id']])) {
                return "routes[$i].color_id does not match any color";
            }
            if (!is_int($r['parallel_index']) || $r['parallel_index'] < 0) {
                return "routes[$i].parallel_index must be a non-negative integer";
            }
            $hasViaX = array_key_exists('via_x', $r) && $r['via_x'] !== null;
            $hasViaY = array_key_exists('via_y', $r) && $r['via_y'] !== null;
            if ($hasViaX !== $hasViaY) {
                return "routes[$i] via_x and via_y must both be set or both null";
            }
        }

        // Tickets
        foreach ($m['tickets'] as $i => $t) {
            if (!is_array($t)) return "tickets[$i] must be an object";
            if (!isset($t['from_stop_id'], $t['to_stop_id'], $t['points'])) {
                return "tickets[$i] missing required keys";
            }
            if (!isset($stopIds[(int) $t['from_stop_id']])) {
                return "tickets[$i] from_stop_id does not match any stop";
            }
            if (!isset($stopIds[(int) $t['to_stop_id']])) {
                return "tickets[$i] to_stop_id does not match any stop";
            }
            if ($t['from_stop_id'] === $t['to_stop_id']) {
                return "tickets[$i] from and to must differ";
            }
            if (!is_int($t['points']) || $t['points'] < 1) {
                return "tickets[$i].points must be ≥ 1";
            }
        }

        return null;
    }

    private static function error(string $code, string $message, int $status): Response
    {
        return Response::json(
            ['error' => $code, 'message' => $message],
            $status,
        );
    }
}
