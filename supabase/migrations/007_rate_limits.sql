-- Server-side rate limit store. Replaces the in-memory Map in src/lib/rate-limit.ts
-- which reset on every Vercel cold start and did not work across worker instances.

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Atomic increment-and-check. Uses an upsert so that concurrent callers from
-- different serverless workers all converge on a single counter row. Returns
-- true if the caller is under the limit, false if they have exceeded it.
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_bucket TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO rate_limits (bucket, window_start, count, updated_at)
  VALUES (p_bucket, NOW(), 1, NOW())
  ON CONFLICT (bucket) DO UPDATE SET
    count = CASE
      WHEN rate_limits.window_start < NOW() - (p_window_seconds || ' seconds')::INTERVAL
        THEN 1
      ELSE rate_limits.count + 1
    END,
    window_start = CASE
      WHEN rate_limits.window_start < NOW() - (p_window_seconds || ' seconds')::INTERVAL
        THEN NOW()
      ELSE rate_limits.window_start
    END,
    updated_at = NOW()
  RETURNING count INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;

-- Housekeeping: drop buckets untouched for 24 hours. Run from a cron or
-- manually. Kept as a function rather than a trigger so callers pay no cost.
CREATE OR REPLACE FUNCTION prune_rate_limits() RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM rate_limits WHERE updated_at < NOW() - INTERVAL '24 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
