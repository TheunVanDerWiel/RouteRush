# Route Rush — API Contract

All endpoints live under `/api`. All bodies are JSON.

## Conventions

### Authentication
- Sessions are PHP cookies (`PHPSESSID`) bound to a `(game, team, player)`
  tuple via `game_players.session_token`.
- Endpoints that require auth check the cookie's bound player against
  the URL's `{code}`. Mismatch → `403 forbidden`.
- The host is just a player whose `id` matches `games.host_player_id`.
  Host-only endpoints check this and return `403 not_host` otherwise.

### CSRF
- All POST/PUT/DELETE endpoints require `Content-Type: application/json`.
- The server rejects other content types with `415 unsupported_media_type`.
- This blocks form-based CSRF attacks (forms can't set this header
  without a CORS preflight, which is not granted).

### Errors
All errors return JSON of the form:

```json
{ "error": "snake_case_code", "message": "Human-readable explanation" }
```

with an appropriate HTTP status. Common codes:

| Status | `error` examples                              |
| ------ | --------------------------------------------- |
| 400    | `bad_request`, `invalid_payload`              |
| 401    | `not_authenticated`                           |
| 403    | `forbidden`, `not_host`, `wrong_game`         |
| 404    | `not_found`                                   |
| 409    | `pending_tickets`, `already_claimed`, `lobby_full`, `game_not_started`, `game_ended` |
| 415    | `unsupported_media_type`                      |
| 422    | `insufficient_cards`, `no_draw_window`, `not_at_station` |
| 429    | `rate_limited` (with `Retry-After` header)    |
| 500    | `internal_error`                              |

### Timestamps
ISO 8601 UTC, millisecond precision: `"2026-04-26T14:30:00.123Z"`.

### IDs
All entity IDs are JSON numbers (integers).

### Cursor
`game_events.id` is monotonically increasing per game. Clients send the
highest id they've seen as `?cursor=N` and the server returns events
with `id > N`.

---

## Game lifecycle

### `POST /api/games`
Create a new game session. No auth required.

**Request**
```json
{ "map_id": 1, "duration_seconds": 7200 }
```

**Response 201**
```json
{
  "game_id": 42,
  "room_code": "K7XQ9P",
  "join_url": "https://example.com/join/K7XQ9P"
}
```

The caller becomes a "session holder" but isn't yet a player; they
must POST to `/teams` to create a team. The first player created is
recorded as `games.host_player_id`.

**Errors**: `400 invalid_payload`, `404 not_found` (bad `map_id`).

---

### `GET /api/games/{code}`
Get current lobby/game info. No auth required (anyone with the code
can see public state to decide whether to join).

**Response 200**
```json
{
  "code": "K7XQ9P",
  "status": "lobby",
  "map": { "id": 1, "name": "Utrecht Buslines" },
  "duration_seconds": 7200,
  "started_at": null,
  "ends_at": null,
  "teams": [
    { "id": 11, "name": "Trams", "color_index": 0, "player_count": 2 },
    { "id": 12, "name": "Bussen", "color_index": 1, "player_count": 1 }
  ]
}
```

When `status` ≠ `"lobby"`, `started_at` and `ends_at` are populated.

---

### `POST /api/games/{code}/start`
Host starts the game. Requires auth + host.

**Request**: empty body (`{}`).

**Response 200**
```json
{
  "status": "in_progress",
  "started_at": "2026-04-26T14:30:00.000Z",
  "ends_at":    "2026-04-26T16:30:00.000Z"
}
```

Side effects:
- Deal `map.starting_train_cards` colored cards from the pool to each
  team's hand.
- Deal 1 long-route + 3 regular tickets per team in `status=pending`.
- Emit `start` event.

**Errors**: `403 not_host`, `409 already_started`, `409 lobby_empty`
(no teams).

---

## Lobby — teams and players

### `POST /api/games/{code}/teams`
Create a new team in the lobby. Caller becomes the team's first player.
Sets the session cookie. No prior auth required.

**Request**
```json
{ "team_name": "Trams", "player_name": "Alice" }
```

**Response 201**
```json
{
  "team_id": 11,
  "player_id": 101,
  "color_index": 0,
  "is_host": true,
  "pin": "1234"
}
```

The server generates a random 4-digit PIN, guaranteed unique among
the teams currently in the same game. The PIN is returned **only on
this response** — the team's first player must share it with their
teammate (verbally / out-of-band) so the teammate can join.

`is_host` is `true` for the very first team's first player; that
player becomes `games.host_player_id`.

**Errors**: `409 lobby_full` (max_teams reached), `409 game_not_lobby`,
`400 name_taken`, `500 pin_allocation_failed` (could not find a
unique PIN after several attempts — only possible when the game has
many teams; not expected in practice with `max_teams` ≤ 5).

---

### `POST /api/games/{code}/teams/{teamId}/join`
Join an existing team. Sets the session cookie.

**Request**
```json
{ "player_name": "Bob", "pin": "1234" }
```

**Response 200**
```json
{ "team_id": 11, "player_id": 102, "color_index": 0 }
```

**Errors**: `429 rate_limited` (per-IP failed-PIN limit, 1/5s),
`401 wrong_pin`, `409 game_not_lobby`. A warning flag may be returned
in headers when the team already has 2+ players (still allowed per §4).

---

### `POST /api/games/{code}/rejoin`
Rejoin after a disconnect. Same shape as `/teams/{teamId}/join` but
also accepts `team_name` instead of `teamId` for convenience.

**Request**
```json
{ "team_name": "Trams", "player_name": "Alice", "pin": "1234" }
```

Reissues the session cookie bound to the existing player record (or
creates a new player record if `player_name` is new on this team).

**Errors**: same as join, plus `404 team_not_found`.

---

## Map

### `GET /api/games/{code}/map`
Returns the immutable map JSON for the game. Cacheable indefinitely
client-side (server sends `Cache-Control: public, max-age=31536000,
immutable` plus an ETag).

**Response 200**
```json
{
  "id": 1,
  "name": "Utrecht Buslines",
  "viewbox_w": 1200,
  "viewbox_h": 800,
  "starting_train_cards": 4,
  "min_teams": 2,
  "max_teams": 5,
  "locomotives_count": 14,
  "colors": [
    { "id": 21, "display_name": "Red",    "hex": "#E63946", "symbol": "circle",   "deck_count": 12 },
    { "id": 22, "display_name": "Blue",   "hex": "#1D3557", "symbol": "square",   "deck_count": 12 }
  ],
  "stops": [
    { "id": 301, "display_name": "Centraal", "x": 600, "y": 400 },
    { "id": 302, "display_name": "Uithof",   "x": 900, "y": 350 }
  ],
  "routes": [
    { "id": 401, "from_stop_id": 301, "to_stop_id": 302, "length": 3, "color_id": 21, "parallel_index": 0 }
  ],
  "tickets_count": 30,
  "long_tickets_count": 6
}
```

Tickets themselves are **not** in the map response — they're secret.
Counts are exposed for UI display.

---

## State polling

### `GET /api/games/{code}/state[?cursor=N]`
The polling endpoint. Behaves in two modes.

**Snapshot mode** (no `cursor`): returns the team's current view.

**Response 200**
```json
{
  "cursor": 1024,
  "mode": "snapshot",
  "game": {
    "status": "in_progress",
    "ends_at": "2026-04-26T16:30:00.000Z",
    "deck_remaining": 86,
    "locomotives_remaining": 12
  },
  "team": {
    "id": 11,
    "windows_available": 3,
    "hand": { "21": 2, "22": 1 },
    "locomotives_in_hand": 1,
    "tickets": [
      { "id": 501, "from_stop_id": 301, "to_stop_id": 305, "points": 8,  "is_long_route": false, "status": "kept" },
      { "id": 502, "from_stop_id": 308, "to_stop_id": 312, "points": 12, "is_long_route": true,  "status": "kept" }
    ],
    "pending_tickets": []
  },
  "claims": [
    { "route_id": 401, "team_id": 11, "claimed_at": "2026-04-26T14:35:00.000Z" },
    { "route_id": 405, "team_id": 12, "claimed_at": "2026-04-26T14:40:00.000Z" }
  ]
}
```

`team.hand` is a map of `color_id` (string keys, JSON convention) →
count. `pending_tickets` is non-empty when the team has drawn tickets
they haven't decided on yet.

**Delta mode** (`?cursor=N`): returns events since cursor.

**Response 200**
```json
{
  "cursor": 1031,
  "mode": "delta",
  "events": [
    { "id": 1025, "ts": "...", "kind": "claim_success", "team_id": 12, "payload": { "route_id": 407 } },
    { "id": 1031, "ts": "...", "kind": "draw_train",    "team_id": 11, "payload": { "count": 2, "colors": [21, 22] } }
  ]
}
```

The client applies events to its local state. Events affecting other
teams' private state (e.g., their hand or tickets) carry only public
data in the payload (e.g., `draw_train` for another team has
`{ "count": 2 }` only — no colors).

If `cursor` is far behind (e.g., > 100 events), the server may instead
return a snapshot with `mode: "snapshot"` to keep payloads bounded.

**Errors**: `403 wrong_game`, `404 not_found`.

---

## Player actions

All require auth. All return the new state cursor so the client can
fast-forward without an extra poll:

```json
{ "ok": true, "cursor": 1032, "...": "endpoint-specific fields" }
```

### `POST /api/games/{code}/draw/cards`
Consume one draw window for **2 train cards**.

**Request**: empty body.

**Response 200**
```json
{ "ok": true, "cursor": 1032, "drawn": [21, 22], "locomotives_drawn": 0, "windows_remaining": 2 }
```

`drawn` is a list of `color_id`. `locomotives_drawn` counts how many
of the 2 cards were locomotives (since they're not in `drawn`).

**Errors**: `422 no_draw_window`, `409 pending_tickets`,
`409 game_not_in_progress`, `422 deck_empty` (rare — entire pool +
locomotives are 0).

### `POST /api/games/{code}/draw/tickets`
Consume one draw window. Server picks 2 tickets, sets them
`status=pending`, returns them. Team must follow up with
`/tickets/decide` before any other action.

**Response 200**
```json
{
  "ok": true,
  "cursor": 1033,
  "windows_remaining": 1,
  "drawn_tickets": [
    { "id": 503, "from_stop_id": 301, "to_stop_id": 320, "points": 9,  "is_long_route": false },
    { "id": 504, "from_stop_id": 305, "to_stop_id": 318, "points": 6,  "is_long_route": false }
  ]
}
```

**Errors**: `422 no_draw_window`, `409 pending_tickets` (already have
pending tickets to decide), `409 ticket_pool_empty` (does NOT consume
the window — see §7 of REQUIREMENTS.md), `409 game_not_in_progress`.

### `POST /api/games/{code}/tickets/decide`
Decide which pending tickets to keep. Must keep ≥ 1 (or ≥ 2 for the
starting-hand decision — server enforces based on context).

**Request**
```json
{ "keep_ids": [503] }
```

**Response 200**
```json
{ "ok": true, "cursor": 1034 }
```

**Errors**: `422 must_keep_one` (or `must_keep_two`), `400 unknown_ticket`,
`409 no_pending_tickets`.

### `POST /api/games/{code}/trade`
Trade cards. Two kinds.

**Request — 3 for 2**
```json
{ "kind": "any3for2", "spend": { "21": 1, "22": 1 }, "spend_locomotives": 1 }
```
Total spent must equal 3. Locomotives may be part of input.

**Request — 3 same color for locomotive**
```json
{ "kind": "same3forLoco", "spend": { "21": 3 } }
```
Exactly one color, exactly 3 cards. Locomotives may NOT be part of input.

**Response 200**
```json
{ "ok": true, "cursor": 1035, "received_colors": [22, 22], "received_locomotives": 0 }
```

For `same3forLoco`, the response is `{ "received_colors": [], "received_locomotives": 1 }`.

**Errors**: `422 invalid_trade_input`, `422 insufficient_cards`,
`409 pending_tickets`, `409 game_not_in_progress`.

### `POST /api/games/{code}/claim`
Claim a route by spending matching cards.

**Request**
```json
{ "route_id": 407, "spend": { "21": 2 }, "spend_locomotives": 1 }
```

Total spent must equal `route.length`. All non-locomotive cards must
match `route.color`. The client MUST first call `GET /state` to
confirm the route is still unclaimed (per §8 of REQUIREMENTS.md).

**Response 200**
```json
{ "ok": true, "cursor": 1036, "claim": { "route_id": 407, "team_id": 11, "claimed_at": "..." } }
```

**Errors**:
- `409 already_claimed` (race lost — cards stay in hand)
- `409 parallel_locked` (parallel-route rule for 2-3 team games)
- `422 wrong_color` (non-locomotive cards don't match route color)
- `422 wrong_count` (total spent ≠ route length)
- `422 insufficient_cards` (team doesn't hold what it tried to spend)
- `409 pending_tickets`, `409 game_not_in_progress`

---

## Host-only

### `GET /api/games/{code}/log`
Full event log, post-game only. Requires auth + host.

**Response 200**
```json
{
  "events": [
    { "id": 1, "ts": "...", "team_id": 11, "player_id": 101, "kind": "join",         "payload": { ... } },
    { "id": 2, "ts": "...", "team_id": null, "player_id": null, "kind": "start",     "payload": { ... } },
    { "id": 3, "ts": "...", "team_id": 11, "player_id": null, "kind": "claim_success", "payload": { "route_id": 401, "spend": { "21": 3 }, "spend_locomotives": 0 } }
  ]
}
```

Unlike the state endpoint, the log shows full payloads for all teams
(including private info like exact draws).

**Errors**: `403 not_host`, `409 game_not_ended`.

### `GET /api/games/{code}/scoreboard`
Final scores, post-game only. Available to everyone (not host-only).

**Response 200**
```json
{
  "teams": [
    {
      "id": 11, "name": "Trams", "color_index": 0,
      "score_breakdown": {
        "routes": 47,
        "tickets_completed": 24,
        "tickets_failed": -8,
        "longest_path_bonus": 10
      },
      "final_score": 73,
      "longest_path_length": 12,
      "completed_tickets": [
        { "id": 501, "from_stop_id": 301, "to_stop_id": 305, "points": 8 }
      ],
      "failed_tickets": [
        { "id": 502, "from_stop_id": 308, "to_stop_id": 312, "points": 12 }
      ]
    }
  ]
}
```

**Errors**: `409 game_not_ended`.

---

## Event payload reference

The `payload` field of `game_events` has a kind-specific shape.

| `kind`           | Payload                                                                 | Visible to other teams as |
| ---------------- | ----------------------------------------------------------------------- | ------------------------- |
| `join`           | `{ "team_id": N, "player_name": "..." }`                                | same                      |
| `leave`          | `{ "player_id": N }`                                                    | same                      |
| `start`          | `{ "team_count": N }`                                                   | same                      |
| `draw_train`     | `{ "count": 2, "colors": [N, N], "locomotives_drawn": M }`              | `{ "count": 2 }`          |
| `draw_tickets`   | `{ "ticket_ids": [N, N] }`                                              | `{ "count": 2 }`          |
| `keep_tickets`   | `{ "kept": [N], "discarded": [N] }`                                     | `{ "kept_count": N, "discarded_count": N }` |
| `trade`          | `{ "kind": "any3for2"|"same3forLoco", "spend": {...}, "spend_locomotives": N, "received_colors": [...], "received_locomotives": N }` | `{ "kind": "..." }` |
| `claim_attempt`  | `{ "route_id": N, "spend": {...}, "spend_locomotives": N }`             | _not surfaced to others_  |
| `claim_success`  | `{ "route_id": N, "spend": {...}, "spend_locomotives": N }`             | `{ "route_id": N }`       |
| `claim_reject`   | `{ "route_id": N, "reason": "..." }`                                    | _not surfaced to others_  |
| `reshuffle`      | `{ "deck_size_after": N }`                                              | same                      |
| `end`            | `{ "ended_at": "..." }`                                                 | same                      |

The state endpoint redacts payloads per the rightmost column when
returning events that belong to other teams. The host log endpoint
returns the full payload for everything.
