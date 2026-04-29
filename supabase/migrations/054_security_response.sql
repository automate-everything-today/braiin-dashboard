-- 054_security_response.sql
--
-- Phase 5: actual incident response capability.
--
-- Three tables:
--   1. feedback.ip_blocklist  - IPs to deny at the route layer.
--                               Auto-populated by the alert cron + honeypot
--                               cluster detection; manually toggled via
--                               /dev/security Actions panel + Telegram /block.
--   2. feedback.system_flags  - global toggles. Currently drives:
--                               - lockdown_mode_active (boolean)
--                               - session_min_iat (epoch seconds; JWTs
--                                 issued before this are rejected)
--                               One row per flag, no cascade.
--   3. feedback.security_actions_log - immutable audit of every action
--                               taken from the response panel or Telegram
--                               command. Separate from security_events
--                               because actions are operator decisions,
--                               not detected events.
--
-- Manual: apply once after 053. Idempotent on (ip) / (key).

CREATE SCHEMA IF NOT EXISTS feedback;
GRANT USAGE ON SCHEMA feedback TO service_role;

-- =============================================================================
-- ip_blocklist
-- =============================================================================

CREATE TABLE IF NOT EXISTS feedback.ip_blocklist (
    ip                  TEXT PRIMARY KEY,
    reason              TEXT NOT NULL,
    -- 'auto:honeypot' | 'auto:auth-cluster' | 'manual' | 'telegram'
    source              TEXT NOT NULL DEFAULT 'manual',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_email    TEXT,
    -- NULL = permanent until manually unblocked. Otherwise auto-expires.
    expires_at          TIMESTAMPTZ,
    notes               TEXT
);

-- Plain b-tree on expires_at - we filter `WHERE expires_at IS NULL OR
-- expires_at > NOW()` at query time. PG can't index NOW() in a partial
-- index because NOW() isn't IMMUTABLE.
CREATE INDEX IF NOT EXISTS idx_ip_blocklist_expires
    ON feedback.ip_blocklist (expires_at);

-- =============================================================================
-- system_flags
-- =============================================================================

CREATE TABLE IF NOT EXISTS feedback.system_flags (
    flag_key            TEXT PRIMARY KEY,
    flag_value          JSONB NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by_email    TEXT,
    notes               TEXT
);

-- Seed default flags so the route helpers always find something.
INSERT INTO feedback.system_flags (flag_key, flag_value, notes)
VALUES
    ('lockdown_mode_active',  'false'::jsonb, 'When true, every non-GET /api/* returns 503 maintenance.'),
    ('session_min_iat',       '0'::jsonb,     'Unix-second floor on JWT iat. Bumping invalidates all sessions issued before this value.')
ON CONFLICT (flag_key) DO NOTHING;

-- =============================================================================
-- security_actions_log - operator action trail (separate from events)
-- =============================================================================

CREATE TABLE IF NOT EXISTS feedback.security_actions_log (
    action_id           BIGSERIAL PRIMARY KEY,
    action              TEXT NOT NULL,
    -- 'block_ip' | 'unblock_ip' | 'set_lockdown' | 'clear_lockdown' |
    -- 'revoke_all_sessions' | 'reset_blocklist'
    actor_email         TEXT,
    actor_source        TEXT NOT NULL DEFAULT 'dashboard',
    -- 'dashboard' | 'telegram' | 'auto-cron'
    payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_actions_recent
    ON feedback.security_actions_log (occurred_at DESC);

-- =============================================================================
-- Grants
-- =============================================================================

REVOKE ALL ON feedback.ip_blocklist            FROM PUBLIC;
REVOKE ALL ON feedback.system_flags            FROM PUBLIC;
REVOKE ALL ON feedback.security_actions_log    FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON feedback.ip_blocklist            TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON feedback.system_flags            TO service_role;
GRANT SELECT, INSERT, DELETE         ON feedback.security_actions_log    TO service_role;
GRANT USAGE, SELECT ON SEQUENCE feedback.security_actions_log_action_id_seq TO service_role;
