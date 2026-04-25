-- Tracks Anthropic Messages Batches API submissions for bulk email
-- classification at ~50% the per-token cost of synchronous calls. The
-- hot-path (a user opens an email) stays sync because batch results can
-- take up to 24h. Use cases for the batch path:
--   - Backfilling legacy rows missing tags / stages / network match
--   - Manager-triggered "re-classify all stale" or "re-classify category X"
--   - Future: bulk classify of newly-synced emails when no UI is waiting
--
-- Lifecycle:
--   1. Submit: POST /api/classify-batch creates a row, status='in_progress'
--   2. Poll: cron / manual GET checks Anthropic; on 'ended', writes results
--      back to email_classifications and flips status to 'completed'
--   3. Failure / expiry: status='errored' or 'expired', completed_at set,
--      retried separately by the manager if desired

CREATE TABLE IF NOT EXISTS classify_batches (
  id SERIAL PRIMARY KEY,
  anthropic_batch_id TEXT NOT NULL UNIQUE,
  email_ids TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','completed','canceled','expired','errored')),
  submitted_by TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  request_count INTEGER NOT NULL,
  succeeded_count INTEGER NOT NULL DEFAULT 0,
  errored_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS classify_batches_status_idx
  ON classify_batches (status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS classify_batches_anthropic_id_idx
  ON classify_batches (anthropic_batch_id);
