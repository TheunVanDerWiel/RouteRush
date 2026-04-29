-- 005_editor_otps.sql
-- One-time password storage for the map editor's "Save to DB" flow.
-- A new OTP is generated when the editor requests one, sent to the
-- configured notification email, and validated when the editor posts a
-- map. Hashed (sha256) so a stolen DB doesn't directly leak the code.

SET NAMES utf8mb4;

CREATE TABLE editor_otps (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    otp_hash   CHAR(64)        NOT NULL,            -- sha256 hex
    expires_at TIMESTAMP(3)    NOT NULL,
    used_at    TIMESTAMP(3)    NULL,
    created_at TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY ix_editor_otps_expires (expires_at),
    KEY ix_editor_otps_used    (used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
