-- 002_route_via.sql
-- Optional waypoint to bend a route at a non-stop coordinate.
-- Both columns must be set together; either both NULL (straight route) or
-- both NOT NULL (route bends through this point).

SET NAMES utf8mb4;

ALTER TABLE map_routes
    ADD COLUMN via_x INT NULL AFTER to_stop_id,
    ADD COLUMN via_y INT NULL AFTER via_x,
    ADD CONSTRAINT ck_map_routes_via_pair
        CHECK ((via_x IS NULL AND via_y IS NULL)
            OR (via_x IS NOT NULL AND via_y IS NOT NULL));
