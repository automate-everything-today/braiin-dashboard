-- Migration 067: system_rules
-- Operator-configurable rules engine mirroring the voice_rules pattern.
-- One row per (category, key); previous_value JSONB column for one-step undo.

BEGIN;

CREATE TABLE system_rules (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  previous_value JSONB,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  UNIQUE (category, key),
  CONSTRAINT system_rules_value_is_object
    CHECK (jsonb_typeof(value) = 'object')
);

CREATE INDEX IF NOT EXISTS system_rules_category_active_idx
  ON system_rules (category) WHERE active = true;

CREATE OR REPLACE FUNCTION system_rules_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER system_rules_updated_at_trigger
  BEFORE UPDATE ON system_rules
  FOR EACH ROW EXECUTE FUNCTION system_rules_set_updated_at();

ALTER TABLE system_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY system_rules_authenticated_read ON system_rules
  FOR SELECT USING ((SELECT auth.role()) = 'authenticated');

COMMIT;
