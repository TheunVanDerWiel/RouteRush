-- 003_starting_tickets.sql
-- Make the starting-deal ticket counts configurable per map.
-- starting_tickets_count is the number of *regular* tickets dealt to each
-- team at game start; the long-route ticket count is unchanged (always 1).
-- starting_tickets_keep_min is the minimum number of tickets a team must
-- keep from the starting batch (long + regulars combined).

SET NAMES utf8mb4;

ALTER TABLE maps
    ADD COLUMN starting_tickets_count    TINYINT UNSIGNED NOT NULL DEFAULT 3 AFTER starting_train_cards,
    ADD COLUMN starting_tickets_keep_min TINYINT UNSIGNED NOT NULL DEFAULT 2 AFTER starting_tickets_count,
    ADD CONSTRAINT ck_maps_starting_tickets
        CHECK (starting_tickets_count >= starting_tickets_keep_min
           AND starting_tickets_keep_min >= 1);
