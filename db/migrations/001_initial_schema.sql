-- 001_initial_schema.sql
-- Route Rush — initial schema.
-- Target: MySQL 8.x, InnoDB, utf8mb4.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- Static map data (admin-managed, shared across many games).
-- ---------------------------------------------------------------------------

CREATE TABLE maps (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name                  VARCHAR(100)    NOT NULL,
    viewbox_w             INT UNSIGNED    NOT NULL,
    viewbox_h             INT UNSIGNED    NOT NULL,
    starting_train_cards  TINYINT UNSIGNED NOT NULL,
    min_teams             TINYINT UNSIGNED NOT NULL DEFAULT 2,
    max_teams             TINYINT UNSIGNED NOT NULL DEFAULT 5,
    locomotives_count     SMALLINT UNSIGNED NOT NULL DEFAULT 14,
    created_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_maps_name (name),
    CONSTRAINT ck_maps_team_range CHECK (min_teams >= 2 AND max_teams >= min_teams)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE map_colors (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    map_id       BIGINT UNSIGNED NOT NULL,
    display_name VARCHAR(50)     NOT NULL,
    hex          CHAR(7)         NOT NULL,           -- "#RRGGBB"
    symbol       VARCHAR(20)     NOT NULL,           -- shape/pattern token for colorblind support
    deck_count   SMALLINT UNSIGNED NOT NULL DEFAULT 12,
    PRIMARY KEY (id),
    UNIQUE KEY uk_map_colors_name (map_id, display_name),
    CONSTRAINT fk_map_colors_map FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE,
    CONSTRAINT ck_map_colors_hex CHECK (hex REGEXP '^#[0-9A-Fa-f]{6}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE map_stops (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    map_id       BIGINT UNSIGNED NOT NULL,
    display_name VARCHAR(100)    NOT NULL,
    x            INT             NOT NULL,           -- SVG canvas coords
    y            INT             NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_map_stops_name (map_id, display_name),
    CONSTRAINT fk_map_stops_map FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE map_routes (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    map_id         BIGINT UNSIGNED NOT NULL,
    from_stop_id   BIGINT UNSIGNED NOT NULL,
    to_stop_id     BIGINT UNSIGNED NOT NULL,
    length         TINYINT UNSIGNED NOT NULL,
    color_id       BIGINT UNSIGNED NOT NULL,
    parallel_index TINYINT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_map_routes_pair (map_id, from_stop_id, to_stop_id, parallel_index),
    KEY ix_map_routes_color (color_id),
    CONSTRAINT fk_map_routes_map   FOREIGN KEY (map_id)       REFERENCES maps(id)       ON DELETE CASCADE,
    CONSTRAINT fk_map_routes_from  FOREIGN KEY (from_stop_id) REFERENCES map_stops(id),
    CONSTRAINT fk_map_routes_to    FOREIGN KEY (to_stop_id)   REFERENCES map_stops(id),
    CONSTRAINT fk_map_routes_color FOREIGN KEY (color_id)     REFERENCES map_colors(id),
    CONSTRAINT ck_map_routes_endpoints CHECK (from_stop_id <> to_stop_id),
    CONSTRAINT ck_map_routes_length    CHECK (length BETWEEN 1 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE map_tickets (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    map_id        BIGINT UNSIGNED NOT NULL,
    from_stop_id  BIGINT UNSIGNED NOT NULL,
    to_stop_id    BIGINT UNSIGNED NOT NULL,
    points        SMALLINT UNSIGNED NOT NULL,
    is_long_route BOOLEAN         NOT NULL DEFAULT FALSE,
    PRIMARY KEY (id),
    KEY ix_map_tickets_long (map_id, is_long_route),
    CONSTRAINT fk_map_tickets_map  FOREIGN KEY (map_id)       REFERENCES maps(id) ON DELETE CASCADE,
    CONSTRAINT fk_map_tickets_from FOREIGN KEY (from_stop_id) REFERENCES map_stops(id),
    CONSTRAINT fk_map_tickets_to   FOREIGN KEY (to_stop_id)   REFERENCES map_stops(id),
    CONSTRAINT ck_map_tickets_endpoints CHECK (from_stop_id <> to_stop_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Per-game runtime data.
-- ---------------------------------------------------------------------------

CREATE TABLE games (
    id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    room_code              CHAR(6)         NOT NULL,
    map_id                 BIGINT UNSIGNED NOT NULL,
    host_player_id         BIGINT UNSIGNED NULL,            -- set after lobby init (chicken-and-egg)
    duration_seconds       INT UNSIGNED    NOT NULL,
    status                 ENUM('lobby','in_progress','ended') NOT NULL DEFAULT 'lobby',
    locomotives_remaining  SMALLINT UNSIGNED NOT NULL,      -- in the pool (not in any hand)
    deck_counter           SMALLINT UNSIGNED NOT NULL,      -- decrements each draw, triggers reshuffle event at 0
    created_at             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at             TIMESTAMP(3)    NULL,
    ended_at               TIMESTAMP(3)    NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_games_room_code (room_code),
    KEY ix_games_status (status),
    CONSTRAINT fk_games_map FOREIGN KEY (map_id) REFERENCES maps(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE game_teams (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    game_id             BIGINT UNSIGNED NOT NULL,
    name                VARCHAR(50)     NOT NULL,
    color_index         TINYINT UNSIGNED NOT NULL,           -- 0..4, mapped to fixed JS palette
    pin_hash            CHAR(60)        NOT NULL,            -- bcrypt
    locomotives_in_hand SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    windows_consumed    INT UNSIGNED    NOT NULL DEFAULT 0,  -- against floor((now - started_at)/300) + 1
    final_score         INT             NULL,                -- populated at end-game
    joined_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_game_teams_name  (game_id, name),
    UNIQUE KEY uk_game_teams_color (game_id, color_index),
    CONSTRAINT fk_game_teams_game FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE game_players (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    team_id       BIGINT UNSIGNED NOT NULL,
    display_name  VARCHAR(50)     NOT NULL,
    session_token CHAR(64)        NOT NULL,                  -- random 256-bit hex
    joined_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_game_players_token (session_token),
    KEY ix_game_players_team (team_id),
    CONSTRAINT fk_game_players_team FOREIGN KEY (team_id) REFERENCES game_teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Now resolve the host FK (deferred to break the cycle: games -> players -> teams -> games).
ALTER TABLE games
    ADD CONSTRAINT fk_games_host_player
    FOREIGN KEY (host_player_id) REFERENCES game_players(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Per-game card economy.
-- Locomotives are not in map_colors; their counts live on games / game_teams.
-- ---------------------------------------------------------------------------

CREATE TABLE game_card_pool (
    game_id  BIGINT UNSIGNED NOT NULL,
    color_id BIGINT UNSIGNED NOT NULL,
    count    SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (game_id, color_id),
    CONSTRAINT fk_card_pool_game  FOREIGN KEY (game_id)  REFERENCES games(id) ON DELETE CASCADE,
    CONSTRAINT fk_card_pool_color FOREIGN KEY (color_id) REFERENCES map_colors(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE game_team_hands (
    team_id  BIGINT UNSIGNED NOT NULL,
    color_id BIGINT UNSIGNED NOT NULL,
    count    SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (team_id, color_id),
    CONSTRAINT fk_team_hands_team  FOREIGN KEY (team_id)  REFERENCES game_teams(id) ON DELETE CASCADE,
    CONSTRAINT fk_team_hands_color FOREIGN KEY (color_id) REFERENCES map_colors(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Tickets, claims, events.
-- ---------------------------------------------------------------------------

CREATE TABLE game_team_tickets (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    team_id     BIGINT UNSIGNED NOT NULL,
    ticket_id   BIGINT UNSIGNED NOT NULL,
    status      ENUM('pending','kept','discarded') NOT NULL DEFAULT 'pending',
    completed   BOOLEAN         NULL,                       -- evaluated at game end
    drawn_at    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    decided_at  TIMESTAMP(3)    NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_team_ticket (team_id, ticket_id),
    KEY ix_team_status (team_id, status),
    CONSTRAINT fk_team_tickets_team   FOREIGN KEY (team_id)   REFERENCES game_teams(id) ON DELETE CASCADE,
    CONSTRAINT fk_team_tickets_ticket FOREIGN KEY (ticket_id) REFERENCES map_tickets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE game_claims (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    game_id    BIGINT UNSIGNED NOT NULL,
    team_id    BIGINT UNSIGNED NOT NULL,
    route_id   BIGINT UNSIGNED NOT NULL,
    claimed_at TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uk_claim_route (game_id, route_id),          -- enforces "first DB write wins"
    KEY ix_claims_team (team_id),
    CONSTRAINT fk_claims_game  FOREIGN KEY (game_id)  REFERENCES games(id) ON DELETE CASCADE,
    CONSTRAINT fk_claims_team  FOREIGN KEY (team_id)  REFERENCES game_teams(id),
    CONSTRAINT fk_claims_route FOREIGN KEY (route_id) REFERENCES map_routes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only event log; serves as the polling cursor source.
-- Clients send the highest event id they've seen; server returns events with id > cursor.
CREATE TABLE game_events (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    game_id      BIGINT UNSIGNED NOT NULL,
    ts           TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    team_id      BIGINT UNSIGNED NULL,
    player_id    BIGINT UNSIGNED NULL,
    kind         ENUM(
        'join','leave','start',
        'draw_train','draw_tickets','keep_tickets','trade',
        'claim_attempt','claim_success','claim_reject',
        'reshuffle','end'
    ) NOT NULL,
    payload_json JSON           NOT NULL,
    PRIMARY KEY (id),
    KEY ix_events_game_id (game_id, id),                    -- cursor lookups
    CONSTRAINT fk_events_game   FOREIGN KEY (game_id)   REFERENCES games(id) ON DELETE CASCADE,
    CONSTRAINT fk_events_team   FOREIGN KEY (team_id)   REFERENCES game_teams(id)   ON DELETE SET NULL,
    CONSTRAINT fk_events_player FOREIGN KEY (player_id) REFERENCES game_players(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Auxiliary: per-IP rate-limiting for failed PIN attempts.
-- One row per offending IP; updated on every failed attempt. Successful
-- attempts do not touch this table. Naturally bounded (one row per IP
-- that has ever failed); no cleanup job needed for v1.
-- ---------------------------------------------------------------------------

CREATE TABLE pin_failed_attempts (
    ip             VARBINARY(16)   NOT NULL,                  -- packed IPv4 or IPv6 (inet_pton)
    last_failed_at TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (ip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
