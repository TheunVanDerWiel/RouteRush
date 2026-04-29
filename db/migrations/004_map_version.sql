-- 004_map_version.sql
-- Add a version number to maps so the same map name can exist as multiple
-- revisions. The "Start a new game" dropdown shows only the highest
-- version per name; existing games keep working because they reference
-- the map by id (via games.map_id), not by name.

SET NAMES utf8mb4;

ALTER TABLE maps
    ADD COLUMN version SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER name,
    DROP INDEX uk_maps_name,
    ADD UNIQUE KEY uk_maps_name_version (name, version);
