-- 026_llm_gateway.sql
--
-- Schema support for the single LLM boundary (`src/lib/llm-gateway/`).
-- Implements two engiine ideas in Braiin's stack:
--   1. Centralised telemetry  - every LLM call writes a row to
--      `activity.llm_calls` so token spend, cost, latency, cache
--      hit rate, and per-purpose breakdown are queryable in one
--      place. Today these numbers are scattered across 14 fetch()
--      call sites with no central visibility.
--   2. Content-hash cache    - identical (prompt, model, params)
--      tuples return cached responses, paying tokens once. Sits
--      alongside Anthropic's 5-minute prompt cache, not instead
--      of it: ephemeral prompt-cache wins inside a 5-minute burst,
--      content-hash cache wins across hours/days for deterministic
--      prompts (classification, extraction, schema-bound JSON).
--
-- Lives inside the existing `activity` schema rather than a new
-- one - LLM calls are part of the activity backbone story (every
-- AI decision should ultimately link back to an activity event).
-- Reuses migration 025's grants and the schema's existing partition
-- / RLS posture.
--
-- Service-role grants are baked in at the bottom of this migration
-- (lesson from 024/025: never assume Supabase auto-grants service_role
-- on tables in non-public schemas - it does not, and silent write
-- failures are the result).

-- ============================================================
-- activity.llm_calls - per-call telemetry
-- ============================================================
-- One row per LLM invocation. Cache hits also write a row with
-- cache_hit=true and zero output_tokens (the cached response was
-- served, no new tokens were consumed by the model itself).

CREATE TABLE activity.llm_calls (
    call_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id               UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,

    -- What was called
    provider             TEXT NOT NULL,                         -- 'anthropic' | 'openai' | future
    model                TEXT NOT NULL,                         -- 'claude-sonnet-4-6' | etc
    purpose              TEXT NOT NULL,                         -- caller-defined tag: 'classify_email' | 'enrich_company' | etc

    -- Token usage and cost
    input_tokens         INTEGER NOT NULL DEFAULT 0,
    output_tokens        INTEGER NOT NULL DEFAULT 0,
    cached_input_tokens  INTEGER NOT NULL DEFAULT 0,            -- Anthropic prompt-cache hits (5-min ephemeral)
    cost_cents           NUMERIC(12, 6),                        -- nullable; computed where pricing is known

    -- Performance
    latency_ms           INTEGER,                               -- nullable on cache-hit short-circuit before request

    -- Caching - content-hash level (separate from Anthropic prompt cache)
    cache_key            TEXT,                                  -- SHA-256 of (provider, model, prompt, params)
    cache_hit            BOOLEAN NOT NULL DEFAULT FALSE,        -- TRUE when content-hash cache served the response

    -- Linkage to higher-level decision tracking (decision_id arrives in a later RFC)
    decision_id          UUID,                                  -- soft link; no FK because decisions table doesn't exist yet
    correlation_event_id UUID,                                  -- if the call was triggered by an activity event

    -- Audit
    requested_by         TEXT NOT NULL,                         -- email | service-role caller name
    requested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    success              BOOLEAN NOT NULL,
    error_code           TEXT,                                  -- HTTP status or provider error class
    error_message        TEXT,                                  -- truncated to 1k by app layer

    -- Free-form metadata bag (purpose-specific context)
    metadata             JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Hot read paths
-- 1. "What did we spend on classify-email this month?"
CREATE INDEX idx_llm_calls_org_purpose_time
    ON activity.llm_calls (org_id, purpose, requested_at DESC);

-- 2. "Show me failures in the last hour"
CREATE INDEX idx_llm_calls_failures
    ON activity.llm_calls (org_id, requested_at DESC)
    WHERE success = FALSE;

-- 3. "Cache hit rate per purpose"
CREATE INDEX idx_llm_calls_cache_hits
    ON activity.llm_calls (org_id, purpose, cache_hit, requested_at DESC);

COMMENT ON TABLE activity.llm_calls IS
    'Per-call telemetry for the LLM gateway (src/lib/llm-gateway/). One row per invocation; cache hits also write a row with cache_hit=TRUE.';


-- ============================================================
-- activity.llm_cache - content-hash response cache
-- ============================================================
-- Keyed by SHA-256 of (provider, model, prompt, params). Sits
-- next to Anthropic's ephemeral 5-minute prompt cache: ephemeral
-- saves tokens within a burst, this saves dollars across days
-- for deterministic prompts (classification, extraction, schema-
-- bound JSON). NOT used for chat / streaming / nondeterministic
-- prompts - the gateway only writes here when the caller opts in
-- via cacheKey.

CREATE TABLE activity.llm_cache (
    cache_key       TEXT PRIMARY KEY,                          -- SHA-256(provider|model|prompt|params)
    response        JSONB NOT NULL,                            -- {content, input_tokens, output_tokens, finish_reason, ...}
    provider        TEXT NOT NULL,
    model           TEXT NOT NULL,
    purpose         TEXT,                                      -- denormalised for cost analytics
    input_tokens    INTEGER NOT NULL,
    output_tokens   INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_hit_at     TIMESTAMPTZ,
    hit_count       INTEGER NOT NULL DEFAULT 0,
    expires_at      TIMESTAMPTZ                                -- nullable; some prompts shouldn't cache forever
);

-- Maintenance index: expire cron will scan for expires_at < NOW()
CREATE INDEX idx_llm_cache_expires
    ON activity.llm_cache (expires_at)
    WHERE expires_at IS NOT NULL;

-- "Most-hit cache entries" for cost-savings analytics
CREATE INDEX idx_llm_cache_hit_count
    ON activity.llm_cache (hit_count DESC, last_hit_at DESC);

COMMENT ON TABLE activity.llm_cache IS
    'Content-hash response cache for the LLM gateway. Keyed by SHA-256 of (provider|model|prompt|params). Caller opts in via cacheKey.';


-- ============================================================
-- Daily expiry cron - drop entries past their expires_at
-- ============================================================
-- Runs at 03:15 UTC. Idempotent. If pg_cron is not installed in
-- this environment, the schedule call will fail silently and ops
-- can run the DELETE manually until the extension is enabled.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'activity-llm-cache-expire',
            '15 3 * * *',
            $cron$ DELETE FROM activity.llm_cache WHERE expires_at IS NOT NULL AND expires_at < NOW(); $cron$
        );
    END IF;
END;
$$;


-- ============================================================
-- Lockdown - REVOKE PUBLIC then GRANT service_role
-- ============================================================
-- Mirrors the 024 / 025 pattern. service_role is the only role
-- that should ever read or write these tables; the gateway is
-- server-side only.

REVOKE ALL ON activity.llm_calls FROM PUBLIC;
REVOKE ALL ON activity.llm_cache FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON activity.llm_calls TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON activity.llm_cache TO service_role;
