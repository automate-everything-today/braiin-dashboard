-- 044_security_events.sql
--
-- Structured security event log written by proxy.ts, api-auth, the upload
-- route, the rate limiter, and any other code path that detects an
-- unauthorised, suspicious, or rejected action.
--
-- This is the live stream behind /dev/security. 30-day rolling retention is
-- applied by the trim_security_events() function below; either run it from a
-- daily cron route or call it on a maintenance task.
--
-- After running:
--   - feedback schema is already exposed (see 041); no changes needed.

CREATE SCHEMA IF NOT EXISTS feedback;
GRANT USAGE ON SCHEMA feedback TO service_role;

CREATE TABLE IF NOT EXISTS feedback.security_events (
    event_id        BIGSERIAL PRIMARY KEY,

    -- Event taxonomy. Keep in sync with src/lib/security/log.ts SecurityEventType.
    event_type      TEXT NOT NULL
                    CHECK (event_type IN (
                        'auth_failure',
                        'session_expired',
                        'role_denied',
                        'upload_rejected',
                        'rate_limit_hit',
                        'csrf_failure',
                        'input_validation_failed',
                        'service_key_missing',
                        'unusual_activity'
                    )),

    severity        TEXT NOT NULL DEFAULT 'medium'
                    CHECK (severity IN ('low', 'medium', 'high', 'critical')),

    -- Where the event occurred. Plain text, denormalised so the dashboard can
    -- render the stream with no joins.
    route           TEXT,

    -- Who. user_email is captured from the verified JWT payload at the time
    -- of the event - if no session was present, this is NULL.
    user_email      TEXT,
    user_role       TEXT,

    -- Caller fingerprint. Best-effort (these can be spoofed) but useful for
    -- spotting patterns from the same source.
    ip              TEXT,
    user_agent      TEXT,

    -- Per-event payload. Examples:
    --   role_denied: { allowed: ["manager","sales_manager"] }
    --   upload_rejected: { reason: "size_exceeded", size: 12345678, limit: 10485760 }
    --   auth_failure: { reason: "no_session" | "expired" | "invalid_jwt" }
    details         JSONB NOT NULL DEFAULT '{}'::jsonb,

    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_events_recent
    ON feedback.security_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_type_recent
    ON feedback.security_events (event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_severity_recent
    ON feedback.security_events (severity, occurred_at DESC);

-- 30-day rolling retention. Run from a daily cron route to keep the table
-- bounded; the index supports the WHERE clause efficiently.
CREATE OR REPLACE FUNCTION feedback.trim_security_events(p_keep_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted INTEGER;
BEGIN
    DELETE FROM feedback.security_events
    WHERE occurred_at < NOW() - (p_keep_days || ' days')::INTERVAL;
    GET DIAGNOSTICS deleted = ROW_COUNT;
    RETURN deleted;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON feedback.security_events FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON feedback.security_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE feedback.security_events_event_id_seq TO service_role;
