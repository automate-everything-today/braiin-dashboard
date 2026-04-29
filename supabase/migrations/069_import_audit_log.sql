-- Migration 069: import_audit_log
-- Per-record outcome of every import run, plus a rules_snapshot per run.

BEGIN;

CREATE TABLE import_audit_log (
  id BIGSERIAL PRIMARY KEY,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  airtable_record_id TEXT,
  result TEXT NOT NULL,
  fields_present TEXT[] NOT NULL DEFAULT '{}',
  fields_landed TEXT[] NOT NULL DEFAULT '{}',
  rules_snapshot JSONB,
  run_id UUID
);

CREATE INDEX IF NOT EXISTS import_audit_run_idx
  ON import_audit_log (run_id);
CREATE INDEX IF NOT EXISTS import_audit_airtable_idx
  ON import_audit_log (airtable_record_id);

ALTER TABLE import_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_audit_authenticated_read ON import_audit_log
  FOR SELECT USING ((SELECT auth.role()) = 'authenticated');

COMMIT;
