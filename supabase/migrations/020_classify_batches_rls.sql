-- Lock classify_batches the same way 018 locked tasks. Migration 015
-- created the table without enabling RLS; the application accesses it
-- via /api/classify-batch (manager-gated), but a leaked anon key could
-- read every batch (including batches submitted by other users) or
-- insert spurious tracking rows.
--
-- Service role bypasses RLS, so the API path remains the only read or
-- write path.

ALTER TABLE classify_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all" ON classify_batches;
DROP POLICY IF EXISTS "classify_batches_select_all" ON classify_batches;
DROP POLICY IF EXISTS "classify_batches_insert_all" ON classify_batches;
DROP POLICY IF EXISTS "classify_batches_update_all" ON classify_batches;
DROP POLICY IF EXISTS "classify_batches_delete_all" ON classify_batches;

REVOKE ALL ON classify_batches FROM anon;
REVOKE ALL ON classify_batches FROM authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'classify_batches_id_seq' AND relkind = 'S'
  ) THEN
    EXECUTE 'REVOKE ALL ON SEQUENCE classify_batches_id_seq FROM anon';
    EXECUTE 'REVOKE ALL ON SEQUENCE classify_batches_id_seq FROM authenticated';
  END IF;
END $$;
