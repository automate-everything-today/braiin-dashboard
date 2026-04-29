-- 052_security_events_alerted_at.sql
--
-- Track which security_events have already triggered a Telegram / webhook
-- alert so the alerting cron doesn't re-fire on the same row every 5 min.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE feedback.security_events
    ADD COLUMN IF NOT EXISTS alerted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_security_events_unalerted
    ON feedback.security_events (occurred_at DESC)
    WHERE alerted_at IS NULL;
