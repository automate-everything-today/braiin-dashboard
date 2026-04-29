-- Voice rules for the anti-AI writing style enforcement layer.
--
-- Loaded at draft-generation time so any LLM output is scanned for banned
-- words / phrases / structures / formatting / tone markers and regenerated
-- on hits. Operator can add/disable/remove rules from /dev/voice without
-- shipping code.
--
-- Design contract: docs/voice/anti-ai-writing-style.md
-- Linter: src/lib/voice/lint.ts (consumes this table)
-- Admin UI: /dev/voice
--
-- Meta-rule (enforced at the API layer): every ban must have a replacement.
-- The 'replacement' column is NOT NULL by design.

CREATE TABLE IF NOT EXISTS voice_rules (
  id SERIAL PRIMARY KEY,
  rule_type TEXT NOT NULL
    CHECK (rule_type IN ('banned_word','banned_phrase','banned_structure','banned_formatting','banned_tone')),
  pattern TEXT NOT NULL,
  replacement TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'block'
    CHECK (severity IN ('block','warn')),
  channel TEXT NOT NULL DEFAULT 'all'
    CHECK (channel IN ('all','email','messaging','social')),
  notes TEXT,
  added_by TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  catch_count INTEGER NOT NULL DEFAULT 0,
  last_caught_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Functional uniqueness must live in a separate index. Postgres does not
-- support expression-based constraints inline on the table.
CREATE UNIQUE INDEX IF NOT EXISTS voice_rules_pattern_uniq
  ON voice_rules (rule_type, lower(pattern), channel);

CREATE INDEX IF NOT EXISTS voice_rules_active_idx
  ON voice_rules (rule_type, active) WHERE active = true;
CREATE INDEX IF NOT EXISTS voice_rules_channel_idx
  ON voice_rules (channel, active) WHERE active = true;

CREATE OR REPLACE FUNCTION voice_rules_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS voice_rules_set_updated_at ON voice_rules;
CREATE TRIGGER voice_rules_set_updated_at
  BEFORE UPDATE ON voice_rules
  FOR EACH ROW
  EXECUTE FUNCTION voice_rules_set_updated_at();

-- Increment catch_count when the linter records a hit. Helps surface which
-- rules are actually doing work in the dashboard.
CREATE OR REPLACE FUNCTION voice_rules_record_catch(rule_id INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE voice_rules
  SET catch_count = catch_count + 1,
      last_caught_at = NOW()
  WHERE id = rule_id;
END;
$$ LANGUAGE plpgsql;
