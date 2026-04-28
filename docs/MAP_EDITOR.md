# Map Editor — Design Document

A standalone, client-only page for authoring Route Rush maps. The editor
runs entirely in the browser and reads/writes a JSON file. There is no
backend involvement: the JSON is downloaded by the user and later
imported into the database by some other (not yet defined) tool.

This is an admin tool, not a player feature. Desktop-first; we assume a
keyboard, a mouse, and a wide screen.

## 1. Page layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  Route Rush · Map Editor   [New] [Load JSON…] [Load image…] [Save…]  │
├──────────────────────────────────────────────────────────────────────┤
│  Name [__] Size [W][H] Cards [_] Teams [min][max] Locos [_]          │
│  Tickets: initial [_] keep min [_]                                   │
├──────────┬──────────────────────────────────────────┬────────────────┤
│ Mode     │                                          │  Properties    │
│ ○ Select │                                          │  (selection-   │
│ ○ Move   │                                          │   dependent)   │
│ ○ Stop   │            Map canvas (SVG)              ├────────────────┤
│ ○ Route  │                                          │  Colors        │
│ ○ Delete │                                          │   ··· list ··· │
│          │                                          │   [+ add]      │
│          │                                          ├────────────────┤
│          │                                          │  Tickets       │
│          │                                          │   ··· list ··· │
│          │                                          │   [+ add]      │
└──────────┴──────────────────────────────────────────┴────────────────┘
```

Three columns:

- **Left rail** (~220px): Mode selector. Color list lives here too
  because route creation needs a "current color" picker, and putting it
  next to the mode buttons keeps the click-flow short.
- **Center** (flex 1): SVG canvas, the workhorse of the page. Pan + zoom
  reuse the same logic as the game.
- **Right rail** (~320px): Properties panel (changes with selection)
  and Tickets list.

The top header carries the file actions plus map-level metadata. We
keep the metadata fields visible at all times so the user doesn't have
to chase them through a modal.

## 2. JSON file format

The on-disk format is a 1:1 mirror of the DB tables, minus surrogate
keys that mean nothing outside the database (`map_id` foreign keys,
`created_at`). IDs inside the file are synthetic integers — stable
within the file but reassigned on database import.

```json
{
  "name": "Utrecht — bus & tram",
  "viewbox_w": 1600,
  "viewbox_h": 900,
  "starting_train_cards": 4,
  "starting_tickets_count": 3,
  "starting_tickets_keep_min": 2,
  "min_teams": 2,
  "max_teams": 5,
  "locomotives_count": 14,

  "colors": [
    { "id": 1, "display_name": "Red",   "hex": "#e63946", "symbol": "circle",   "deck_count": 12 },
    { "id": 2, "display_name": "Blue",  "hex": "#1d3557", "symbol": "square",   "deck_count": 12 }
  ],

  "stops": [
    { "id": 1, "display_name": "Centraal",   "x": 400, "y": 200 },
    { "id": 2, "display_name": "Lunetten",   "x": 700, "y": 520 }
  ],

  "routes": [
    { "id": 1, "from_stop_id": 1, "to_stop_id": 2,
      "via_x": null, "via_y": null,
      "length": 3, "color_id": 1, "parallel_index": 0 }
  ],

  "tickets": [
    { "id": 1, "from_stop_id": 1, "to_stop_id": 2,
      "points": 6, "is_long_route": false }
  ]
}
```

Every numeric ID is a positive integer, unique within its array. When
the editor adds a new entity it picks `max(existing ids) + 1`.

### Validation on save

The editor refuses to save if any of these fail:

- `min_teams ≥ 2`, `5 ≥ max_teams ≥ min_teams`.
- `viewbox_w > 0`, `viewbox_h > 0`.
- `starting_train_cards ≥ 0`, `locomotives_count ≥ 0`.
- `starting_tickets_count ≥ starting_tickets_keep_min ≥ 1`.
- Enough tickets to deal at a full table: at least
  `starting_tickets_count × max_teams` regular tickets and at least
  `max_teams` long tickets.
- Every stop has a non-empty name unique within the map.
- Every route's `from_stop_id ≠ to_stop_id`, both exist in `stops`.
- Every route's `length ∈ [1, 6]`, `color_id` exists in `colors`.
- Every route's `(from, to, parallel_index)` triple is unique
  (orientation-insensitive — A→B and B→A with the same parallel_index
  collide, matching the DB unique key behavior the renderer assumes).
- Every route's `via_x` and `via_y` are both null or both set.
- Every ticket's stops exist; `points > 0`; `(from_stop_id, to_stop_id)`
  is unique (orientation-insensitive — a ticket from A to B is the same
  trip as B to A).
- At least one color exists if there is at least one route.

Validation errors are listed in a banner at the top of the page;
nothing is downloaded until they're resolved.

## 3. Modes

Exactly one mode is active at a time. Switching mode clears any
mode-local state (e.g., the "first stop" remembered in Add-route mode).

### Select
- Click a stop → select it. Click a route slot → select that route.
- Empty-space click clears selection.

### Move
- Inherits the current selection from Select mode (switching modes
  does not clear it).
- Click anywhere on the canvas → move the selected entity:
  - **Stop selected** — sets the stop's `(x, y)` to the click. Routes
    that reference it follow automatically because they look up their
    endpoints by ID.
  - **Route selected, has via** — sets `(via_x, via_y)` to the click.
  - **Route selected, no via** — sets `(via_x, via_y)` to the click,
    bending the route at that point.
- The selection stays on the moved entity so the user can chain edits
  without switching back to Select.
- Click without a selection → no-op.

### Add stop
- Click on empty canvas → create stop at click coords with auto-name
  ("Stop N", incrementing). The new stop becomes selected and the mode
  flips back to Select so the user can immediately rename it in the
  properties panel.
- Click on an existing stop in this mode is a no-op (avoid stacking).

### Add route
- First click on a stop → highlight it, remember as `from`.
- Second click on a different stop → create a route between them and
  flip back to Select with the new route selected.
- Second click on the same stop → cancel selection.
- Click on empty canvas → cancel selection.
- The route uses the currently-selected color (left rail) and length
  defaults to 3, both editable in the properties panel.
- If a route already exists between the chosen pair (any orientation),
  `parallel_index` is auto-incremented to the next free slot.

### Delete
- Click on a stop → confirm dialog → delete the stop and **all** routes
  that reference it. Tickets that referenced the stop are also deleted
  (with a count shown in the confirm dialog).
- Click on a route → delete just that route.

## 4. Properties panel

Selection-dependent. Empty when nothing is selected.

### Stop selected
- `display_name` (text)
- `x`, `y` (numeric, also editable by dragging)
- "Delete stop" button (same effect as Delete-mode click).

### Route selected
- `from_stop_id`, `to_stop_id` (read-only, with stop names — to change
  them, delete and recreate)
- `length` (1–6 stepper)
- `color_id` (dropdown of colors)
- `parallel_index` (read-only number; the editor manages this by
  picking the next free slot when routes are created or their endpoints
  change)
- `via_x`, `via_y` — two number inputs (read-only display preferred,
  edited via Move mode) plus a "Clear via" button that resets both to
  `null`.
- "Delete route" button.

## 5. Colors

Lives in the left rail. List of colors with a small swatch, name, hex,
symbol, deck count. Each entry has Edit and Delete buttons. The Delete
button is disabled if any route uses that color.

Adding a color opens a small inline editor. New colors auto-pick a
default hex from a fixed palette of 8 distinct hues, cycling.

The "current color" for the Add-route mode is whichever color is
clicked-to-highlight in this list. The first color is the default.

## 6. Tickets

Right rail. List of tickets showing `from → to`, points, and a "long"
badge if applicable. Each entry has Edit and Delete buttons.

Adding/editing a ticket opens an inline editor with:
- From-stop dropdown (all stops, sorted by name)
- To-stop dropdown
- Points (number, default 5)
- "Long route" checkbox

The dropdowns refuse to pick the same stop on both ends.

## 7. File actions

### New
Asks for confirmation if there are unsaved changes (tracked via a
dirty flag toggled by every mutation). Resets to a fresh empty map:

```js
{ name: "Untitled", viewbox_w: 1600, viewbox_h: 900,
  starting_train_cards: 4, min_teams: 2, max_teams: 5,
  locomotives_count: 14, colors: [], stops: [], routes: [], tickets: [] }
```

### Load JSON
Opens a file picker (`<input type="file" accept=".json,application/json">`).
Parses, validates structure, and replaces the current state. Fails
loudly on schema mismatch — error banner with the first parse error.

### Load image
Opens a file picker (`<input type="file" accept="image/*">`). The chosen
image is rendered as a semi-transparent layer behind the SVG content,
sized to the current `viewbox_w × viewbox_h`. Used purely as a tracing
reference: the image is **not** persisted in the JSON and is dropped
when the page reloads or "New" is clicked. A small "Clear image"
button appears next to the load button once one is loaded; an opacity
slider controls the overlay.

### Save
Builds the JSON, runs validation, and triggers a download via a Blob
URL. The filename is `<slug(name)>.json` (e.g.
`utrecht-bus-tram.json`).

## 8. Canvas behavior

The SVG uses the same `viewBox = "0 0 W H"` as the game renderer. We
reuse the existing pan/zoom logic and styling, so what you see in the
editor matches what players will see.

Routes and stops are rendered with the same SVG primitives as the
game. The editor adds:
- An optional background `<image>` element behind everything else,
  loaded via the "Load image" button (see §7).
- A faint grid (every 50 units) for visual alignment.
- A visible highlight ring on the currently-selected stop or route.
- A "ghost" line during Add-route mode connecting `from` to the cursor
  position.
- A semi-transparent overlay on stops when in Delete mode (red tint on
  hover) to make destructive intent obvious.

Click hit-testing uses the existing SVG event flow: each stop is a
group with a circle, each route slot is a rect. The route's own group
catches clicks for the whole route. Click coordinates are translated
from screen space to SVG user units before being stored on stops or
via points.

## 9. Implementation notes

- **One file, one bundle.** A single `public/assets/js/editor.js` ES
  module owns all editor state. A small `views/editor.php` provides
  static markup; no PHP logic, no DB calls.
- **Routing.** Add `GET /editor` serving `editor.php`. No auth gate for
  v1 — it's a static page; the JSON it produces is harmless on its
  own.
- **Render-from-state.** State is one plain object (the JSON above
  plus a transient `selection`, `mode`, and `dirty` flag). Every
  mutation calls `render()` which rebuilds the SVG and panels. With
  ~50 stops and ~100 routes this is fast enough; we can optimize later
  if it isn't.
- **Code reuse.** Lifting the route/stop SVG builders out of `game.js`
  into a small shared module would be ideal but is a bigger refactor.
  For v1 we copy-and-adapt; we can DRY up afterwards.
- **Pan/zoom reuse.** Same — copy-and-adapt for v1.
- **Undo/redo.** Out of scope for v1. Worth a follow-up.

## 10. Decisions

Resolved:

1. **Colors** — managed in the editor (left rail, inline add/edit).
2. **`symbol` field** — exposed as free-text on each color; the game
   renderer uses it as the route slot label.
3. **Background image** — a "Load image" button on the top bar; the
   image overlays the canvas as a tracing reference; **not** persisted
   in the JSON.
4. **Coordinate editing** — a dedicated Move mode (see §3). No drag
   handles; the user clicks to place. The route properties panel has
   a "Clear via" button.
5. **Parallel index** — auto-only, picked when a route is created.
6. **Tickets uniqueness** — A→B and B→A are the same trip; the editor
   rejects directional duplicates.
7. **Ticket points** — plain user input, defaults to 5. No auto-suggest.
8. **DB import** — out of scope; will need its own design with
   admin auth in front of it.
9. **Route hit-testing** — clicking any segment of a multi-segment
   route selects the whole route.

## 11. Game / backend impact (new map fields)

`starting_tickets_count` and `starting_tickets_keep_min` are also
needed by the game runtime, not just the editor. `starting_tickets_count`
is the number of **regular** tickets dealt at game start; the long-ticket
deal is unchanged (always exactly 1 per team). The work that lands
alongside the editor:

- **Schema migration** adds the two columns to `maps` (default 3 / 2,
  matching today's hardcoded behavior).
- **`MapController::map`** (the in-game endpoint) returns both fields.
- **`GameController::start`** reads `starting_tickets_count` from the
  map and deals 1 long + `starting_tickets_count` regular tickets per
  team (replacing the hardcoded `3` for regulars).
- **`GameController::decideTickets`** reads `starting_tickets_keep_min`
  from the map for the starting decision (replacing the hardcoded `2`).
  Mid-game ticket draws are unaffected (still keep ≥1 of 2).
- **`game.js`** reads the keep-minimum from the polled state instead
  of computing `kept.length === 0 ? 2 : 1`.
