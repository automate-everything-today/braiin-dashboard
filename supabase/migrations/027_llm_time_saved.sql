-- 027_llm_time_saved.sql
--
-- Adds time-saved tracking to activity.llm_calls.
--
-- Why: cost telemetry alone tells you how much you spent, not how
-- much value you got. The Braiin USP is "AI replaces human work in
-- a freight forwarder's day"; we need a metric that puts those two
-- numbers next to each other.
--
-- Each LLM call carries a defensible estimate of how long the same
-- work would have taken a human. The gateway populates this column
-- from a per-purpose default table (src/lib/llm-gateway/human-
-- equivalents.ts) with optional per-call override. Failures save
-- zero seconds; cache hits save the full estimate (the work was
-- delivered, just cheaply).
--
-- Idempotent: uses IF NOT EXISTS via DO block so re-running is safe.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'activity'
          AND table_name = 'llm_calls'
          AND column_name = 'time_saved_seconds'
    ) THEN
        ALTER TABLE activity.llm_calls
            ADD COLUMN time_saved_seconds INTEGER NOT NULL DEFAULT 0;
    END IF;
END;
$$;

-- Index supports per-purpose / per-period rollups on the dashboard.
CREATE INDEX IF NOT EXISTS idx_llm_calls_time_saved
    ON activity.llm_calls (org_id, purpose, requested_at DESC)
    WHERE time_saved_seconds > 0;

COMMENT ON COLUMN activity.llm_calls.time_saved_seconds IS
    'Estimate of human-equivalent time saved by this LLM call. Defaults from src/lib/llm-gateway/human-equivalents.ts; per-call override available via humanEquivalentSeconds param. Zero on failures.';
