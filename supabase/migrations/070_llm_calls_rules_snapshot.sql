-- Migration 070: extend activity.llm_calls with rules snapshot reference.
-- The table already exists from migration 026; this only adds nullable cols.

BEGIN;

ALTER TABLE activity.llm_calls ADD COLUMN IF NOT EXISTS rules_snapshot_id UUID;
ALTER TABLE activity.llm_calls ADD COLUMN IF NOT EXISTS event_contact_id INTEGER
  REFERENCES public.event_contacts(id) ON DELETE SET NULL;
ALTER TABLE activity.llm_calls ADD COLUMN IF NOT EXISTS event_id INTEGER
  REFERENCES public.events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_llm_calls_rules_snapshot
  ON activity.llm_calls (rules_snapshot_id) WHERE rules_snapshot_id IS NOT NULL;

COMMIT;
