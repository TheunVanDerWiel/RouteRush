# Requirements — Real-World Ticket to Ride

Working title: Route Rush.

## 1. Concept

A mobile-first web app that supports a real-life game of Ticket to Ride
played on actual public transport (bus and/or train) routes. Players
physically travel between stops in the real world; the app maintains all
shared game state: claimed routes, hand contents, destination tickets,
score, and a fair-play log.

The "board" is a stylized SVG representation of the real transit network
used for the game.

## 2. Goals & non-goals

### Goals (v1)
- Run a single game session per room code.
- Support 2–5 teams of 2 players each. Both team members see the same
  shared team view.
- Faithful adaptation of TtR mechanics to a real-time, real-world
  setting.
- Honor-system play with a tamper-evident game log so the host can
  audit fair play after the fact.
- Mobile-first, works well on phones, low data usage.
- Run on cheap shared PHP hosting.
- Multiple concurrent games on the same install.

### Non-goals (v1)
- User accounts, login, persistent player profiles.
- Real-time push (WebSockets/SSE) — short polling only.
- GPS/location verification of claims (designed for, but not
  implemented).
- An in-app map editor — maps are authored by the site admin.
- Tunnels, ferries, stations and other Europe/expansion-specific
  mechanics.

## 3. Roles

| Role          | Description                                                                 |
| ------------- | --------------------------------------------------------------------------- |
| **Site admin** | Authors maps in JSON/SQL, deploys them. Not in-app for v1.                 |
| **Host**      | Anonymous player who creates a session. Also plays on a team. Has limited admin powers (start game, see all teams' event-log for after-the-fact arbitration). |
| **Player**    | Anonymous user who joins a session via room code and team PIN. Two players per team share one team's state. |

No persistent accounts. Identity is `(session, team name)` and
is recoverable via room code + team PIN (rejoin after a phone dies).

### Reconnection & PIN security
- Each team is **assigned a random 4-digit PIN** by the server when
  created in the lobby. PINs are unique per game (collision-checked at
  insert time) so no two teams in the same room can ever share one.
- The PIN is shown once to the team's first player on creation; they
  share it verbally with their teammate. Server never stores plaintext.
- PIN stored bcrypt-hashed (never plaintext).
- Rejoin endpoint is **rate-limited to one *failed* attempt per 5
  seconds per IP**, tracked in `pin_failed_attempts(ip, last_failed_at)`.
  - Before processing: if a row exists for the request IP and
    `now − last_failed_at < 5s`, reject with `429` +
    `Retry-After: 5`.
  - On a wrong PIN: upsert the row (insert or update `last_failed_at`).
  - On a correct PIN: no-op against the table.
- A successful rejoin reissues the PHP session cookie and binds it to
  the existing player record (so the team's hand and tickets are
  preserved).

## 4. Game lifecycle

1. **Session creation** — host picks an available map and configures:
   game duration in 15 minute intervals. Server generates a link containing
   the room code that can be shared with other players (for example via WhatsApp).
2. **Lobby** — players join via link with room code, create a team
   (the server assigns a random 4-digit PIN to share with their
   teammate), or join an existing team with that PIN and a player name.
   Show a warning if a team already has 2 players upon joining, but don't disallow it
   in case a disabled team member needs an extra support on their team.
   **Team colors** are auto-assigned by team-creation order from a fixed
   high-contrast palette (e.g., red, blue, yellow, green, purple) — no
   user choice. Host sees all teams. No late joins after start.
3. **Start** — host clicks Start. Server timestamps `game_started_at`,
   deals starting hands, deals starting destination tickets, begins the
   draw-window clock.
4. **In play** — see §5–§9.
5. **End** — when `now >= game_started_at + duration`, server marks the
   game `ended`. No more claims accepted. Final scoring computed.
6. **Post-game** — final scoreboard visible to all. Game log visible
   to host for fair-play review.

## 5. Map / board

- Each map is a JSON document (also stored relationally in MySQL):
  - **Stops**: `{ id, display_name, x, y }` — coordinates are SVG
    canvas coords, not lat/lng.
  - **Colors**: `{ id, display_name, hex }` — hex contains a hexadecimal
    color code used for display
  - **Routes** (edges): `{ id, from_stop, to_stop, length, color,
    parallel_index }`. `parallel_index` distinguishes double
    routes between the same pair of stops.
  - **Map metadata**: `{ id, name, viewbox_w, viewbox_h,
    starting_train_cards, ticket_pool_id }`.
- Maps are seeded by the site admin via SQL migration / JSON file.
- A map editor UI is **future work**. The host's only choice is which
  existing map to use.

### Rendering
- The map SVG is **rendered client-side** from the map JSON. On entering
  a game, the client fetches the map JSON once (cacheable, immutable
  per game) and renders the SVG itself.
- The polling endpoint returns only the **claim delta** since the
  client's last cursor: `{ cursor, claims: [{route_id, team_id, ts}, ...] }`.
- Client JS finds the affected `<path data-route-id="...">` elements
  and updates their stroke to the claiming team's color.
- Trade-off accepted: brief blank-map flash on slow first paint; site
  is unusable without JS (acceptable since the whole gameplay loop
  requires JS anyway).

## 6. Cards & draw mechanic

### Train cards
- 6-12 colors + locomotive (wild). The number of colors differs per map
  but should be roughly comparable to the amount of colors in classic TtR (8).
- **Default deck composition**: 12 cards per defined color + 14 locomotives.
  Total deck size therefore scales with color count (6 colors = 86 cards;
  8 colors = 110 cards (classic TtR); 12 colors = 158 cards). Per-map
  override is allowed but not required.
- Stored per-game so the deck shrinks as it's drawn from.
- Keep track of the number of cards in the deck. Used cards will be added to the bottom
  but the deck should be reshuffled when the counter reaches 0. After that reset the counter
  to the number of cards currently in the deck.
- **Blind draw only** — no face-up market.
- Locomotive cards work as any color when claiming a route.
- If the deck 

### Draw windows (real-time)
- Each team accumulates one **draw window** every 5 minutes since game
  start, starting at 1 **draw window** immediately.
- A draw window is consumed by either:
  - **Drawing 2 train cards** (random from deck), OR
  - **Drawing 2 destination tickets, keeping ≥ 1**.
- Windows **stack indefinitely** — a team that's been en-route for an
  hour can spend 12 stacked windows in one sitting.
- Drawing is honor-system gated: "I am at a station" — UI gives a
  single confirm step before consuming the window. The fact that a
  team drew while supposedly en-route is implicit in the log
  (timestamp of draw vs. time of last claim) and can be reviewed by
  the host. In a later implementation we may also log location data.

### Trades (no draw window consumed)
- At a station only (honor-system).
- **3 cards → 2 new cards** (random from deck). Locomotives **may** be
  used as input here.
- **3 cards of the same color → 1 locomotive**. Locomotives may **not**
  be used as input here (they aren't a color).
- Trades are free — not gated by draw windows, not rate-limited beyond
  the at-station rule.

### Starting hand
- **Train cards**: number defined per map (`map.starting_train_cards`,
  e.g. 4).
- **Destination tickets**: 1 long-route ticket + 3 regular tickets,
  keep at least 2 of the 4. Keep choices made privately by each team
  in the lobby's last step (or first action after Start).
- **Map validation**: a map's long-route ticket count must be ≥ its
  declared `max_teams`. Maps that violate this are refused at load
  (admin-side validation, not a runtime surprise).

## 7. Destination tickets

- Each map has its own ticket pool (`{ id, from_stop, to_stop, points,
  is_long_route }`). Pool sizing is the map author's responsibility.
  If the pool is exhausted, in-play ticket draws are disallowed for the
  remainder of the game (the UI tells the team "no tickets remaining"
  and the draw window is **not** consumed — they can spend it on train
  cards instead).
- Tickets are kept secret from other teams.
- A team **completes** a ticket if there is a chain of routes they
  have claimed connecting `from_stop` to `to_stop` at game end.
- Locomotive cards in routes don't matter for ticket completion; only
  the connectivity graph of claimed routes matters.
- **Scoring**:
  - Completed: `+points`.
  - Failed: `−points`.
- Penalty applies only to tickets the team chose to keep.

## 8. Claiming a route

1. Team taps a route on the map view.
2. App **forces a fresh server fetch** of route state (don't rely on
   the polling cache here).
3. If route is unclaimed and team has the cards: team picks which
   cards to spend (matching color + locomotives, count = route
   length).
4. App POSTs the claim. Server validates atomically and writes.
5. **First DB write wins**. If the team's cards no longer cover the
   route (e.g., they spent some elsewhere via another device tab) or
   the route was just claimed by someone else, return a clear error
   and leave the cards in hand.
6. On success: cards are returned to the bottom of the deck,
   route is marked claimed by team, event written to game log.

### Parallel (double) routes
- Two parallel routes between the same stops may exist on a map.
- In games with **2–3 teams**, only one of the parallel pair can be
  claimed (the other is locked when the first is taken).
- In games with **4–5 teams**, both parallels can be claimed but not
  by the same team.

## 9. Scoring

Per-route points (classic TtR defaults — overridable per map):

| Route length | Points |
| ------------ | ------ |
| 1            | 1      |
| 2            | 2      |
| 3            | 4      |
| 4            | 7      |
| 5            | 10     |
| 6            | 15     |

Plus:
- Destination ticket points (completed: +, failed: −).
- **Longest continuous path** bonus: +10 to the team with the longest
  single chain of connected claimed routes (ties: all tied teams get
  the bonus).

### Score visibility during play
- **No live scoreboard**. During play, no team (including the host)
  sees any team's point totals.
- Teams can see *which routes have been claimed by whom* on the map
  view (claims are public events) — they just can't see the points
  that translates to.
- Final scoreboard (route points + ticket points + longest-path bonus)
  is revealed to everyone simultaneously when the game ends.

## 10. Game log & fair play

- Every state-changing event is appended to a per-game log:
  `{ ts, team_id, kind, payload, server_ip_hash? }` where `kind ∈
  {join, leave, start, draw_train, draw_tickets, keep_tickets, trade,
  claim_attempt, claim_success, claim_reject, end}`.
- **Host can view the full log after the game** to spot cheating afterwards.
- Players cannot see the log.
- Log is immutable from the app — no edit/delete UI even for the host.
- Timestamps stored as UTC on the server, formatted to the **host's
  browser local time** by client-side JS when displayed.

## 11. Real-time behavior

- **Foreground polling only** to preserve mobile data.
  - When the page is visible: poll game-state delta endpoint every
    30 seconds.
  - When the page is hidden (visibility API): stop polling. Restart on
    visibility change, starting a poll immediately if the previous was more
    than 30 seconds ago.
- Force a fresh fetch on user-initiated actions that depend on
  current state (claim, trade, draw).
- Polling endpoint returns a small delta keyed by a server cursor /
  monotonic version, not the full game state, to keep responses tiny.

## 12. UI / UX

- Mobile-first. Designed for one-handed use on a phone.
- English UI.
- Colorblind-friendly: every card and route color is also distinguished
  by the color display_name (usually the real-life line number).
- Map view: pinch-zoom & pan SVG. Claimed routes recolored / outlined
  with the claiming team's color.
- Team view: hand of cards, destination tickets, draw
  windows available, trade UI, current score, remaining game duration.
  Information of other teams is never visible.
- **PWA**: nice-to-have if it's cheap (manifest + simple service
  worker for app icon and offline shell). Drop if it adds significant
  complexity.

## 13. Tech stack (recommendation)

**Vanilla PHP + MySQL + server-rendered HTML with light JS**, because:

- Shared PHP hosting constrains us: no long-running processes (rules
  out WebSocket servers and queue workers), MySQL is the path of
  least resistance.
- The interactive surface is moderate (claim flow, polling, trade UI,
  map render) — but still doesn't need a full SPA framework.
- The map view is rendered client-side from cached map JSON, so PHP
  produces HTML page shells + small JSON endpoints — no SVG generation
  on the server.
- One codebase, one deploy artifact, easy to debug.

Specifics:
- **PHP 8.2+**, PSR-4 autoload, vendored via Composer.
- A tiny custom front-controller (no framework) or a micro-framework
  like Slim if we want HTTP routing sugar. Not Laravel — too much
  weight for shared hosting and this scope.
- **MySQL 8** via PDO. Schema migrations via simple `*.sql` files in
  `db/migrations/` applied by a CLI script.
- **Frontend**: server-rendered HTML page shells, plain CSS (or Tailwind
  precompiled — no Node toolchain on the server), vanilla JS modules.
  Map SVG generated in the browser from map JSON.
- **API**: full request/response contract in
  [`docs/API.md`](docs/API.md). All endpoints are JSON under `/api`.
  Notable design choices documented there: dual-mode `state` endpoint
  (snapshot vs. cursor-delta), CSRF defense via required JSON
  Content-Type, pending-ticket gating on action endpoints.
- **Sessions**: PHP sessions for the (room, team, player) tuple
  cookie. Rejoin via room-code + team-PIN reissues the cookie.

## 14. Data model

Full schema lives in [`db/migrations/001_initial_schema.sql`](db/migrations/001_initial_schema.sql).
This section explains the structure and the non-obvious design choices.

### Static map data (admin-managed)
- **`maps`** — `name`, `viewbox_w/h`, `starting_train_cards`,
  `min_teams`, `max_teams`, `locomotives_count`.
- **`map_colors`** — per-map color palette: `display_name`, `hex`,
  `symbol` (for colorblind support), `deck_count` (default 12).
- **`map_stops`** — `display_name`, `x`, `y` (SVG canvas coords).
- **`map_routes`** — `from_stop_id`, `to_stop_id`, `length` (1-6),
  `color_id`, `parallel_index`. Unique on
  `(map_id, from_stop_id, to_stop_id, parallel_index)`.
- **`map_tickets`** — `from_stop_id`, `to_stop_id`, `points`,
  `is_long_route`.

### Per-game runtime data
- **`games`** — `room_code` (globally unique), `map_id`,
  `host_player_id` (nullable, set after lobby init),
  `duration_seconds` (must be a multiple of 900 = 15 min),
  `status ∈ {lobby, in_progress, ended}`, `locomotives_remaining`,
  `deck_counter`, `started_at`, `ended_at`.
- **`game_teams`** — `name`, `color_index` (0-4, fixed JS palette),
  `pin_hash` (bcrypt), `locomotives_in_hand`, `windows_consumed`,
  `final_score` (populated at end-game).
- **`game_players`** — `display_name`, `session_token`,
  `last_seen_at` (auto-updated for "online" indication).

### Card economy
- **`game_card_pool`** — `(game_id, color_id) → count` for the deck.
- **`game_team_hands`** — `(team_id, color_id) → count` for hands.
- Locomotive counts live as scalar columns on `games` and `game_teams`
  (rather than as a synthetic "locomotive" color), so the colored-card
  tables can have clean FKs to `map_colors`.

### Tickets, claims, events
- **`game_team_tickets`** — `status ∈ {pending, kept, discarded}`,
  `completed` (NULL until end-game evaluation).
- **`game_claims`** — `UNIQUE (game_id, route_id)` enforces the
  "first DB write wins" rule on race conditions; the second concurrent
  insert fails with a duplicate-key error and the app returns
  "already claimed" without spending the team's cards.
- **`game_events`** — append-only log. Doubles as the **polling cursor
  source**: clients send the highest event id they've seen, server
  returns events with `id > cursor`. The `kind` enum covers everything
  state-changing (join/leave/start/draw/keep/trade/claim_*/reshuffle/end).
  `payload_json` carries kind-specific data. No separate `state_version`
  table is needed.

### Auxiliary
- **`pin_failed_attempts`** — one row per IP that has ever submitted a
  wrong PIN, with `last_failed_at`. Used to enforce the 5s/IP failed-
  attempt rate limit. Naturally bounded; no cleanup job needed.

### Notable design choices
- **Locomotives modeled separately**: scalar counts on `games` and
  `game_teams`, not a synthetic color row.
- **Cursor = `game_events.id`**: the event log is authoritative; no
  redundant version counter.
- **Room code globally unique**: simpler than a partial index on
  active games. With a sufficient code length (6+ chars from a 32-char
  alphabet), accidental collision is negligible.
- **Deferred host FK**: `games.host_player_id` is nullable to break the
  cycle `games → players → teams → games`.
- **Reshuffle is bookkeeping**: blind draws are uniform over current
  pool counts, so a "reshuffle" doesn't change any draw probabilities.
  `deck_counter` is purely so we can emit a `reshuffle` event for the
  game log when it hits 0.

## 15. Out of scope / future

- In-app map editor.
- GPS-verified claims (data model already accommodates a `lat/lng/ts`
  attached to a claim event).
- Player accounts, history across games, ELO/leaderboards.
- Tunnels, ferries, stations (Europe edition).
- WebSocket / SSE push.
- Spectator mode.
- I18n beyond English.
