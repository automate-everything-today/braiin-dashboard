-- Unified reply rules table with hierarchical scopes. Rules are aggregated
-- at classify / refine time in this order (most specific first):
--   1. category     (per email type: quote_request, internal, etc.)
--   2. user         (personal voice, auto-learned from refinements)
--   3. mode         (Air / Road / Sea / Warehousing)
--   4. department   (Ops / Sales / Accounts)
--   5. branch       (London / Manchester / etc.)
--   6. global       (Corten-wide house style)
--
-- Rules can be learned automatically (source='learned') from a user
-- refinement, or set manually by a manager (source='set'). A rule is
-- active unless explicitly disabled.

CREATE TABLE IF NOT EXISTS reply_rules (
  id SERIAL PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('user', 'category', 'mode', 'department', 'branch', 'global')),
  scope_value TEXT NOT NULL,         -- email / category name / mode / etc. 'global' for scope_type='global'
  instruction TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'learned' CHECK (source IN ('learned', 'set')),
  created_by TEXT,                   -- email of whoever authored (manager for set, user for learned)
  active BOOLEAN NOT NULL DEFAULT true,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS reply_rules_scope_idx
  ON reply_rules (scope_type, scope_value, active);
CREATE INDEX IF NOT EXISTS reply_rules_created_idx
  ON reply_rules (created_at DESC);

-- Add mode column to staff so the session can carry it and rules can be
-- scoped per business unit. Nullable - fill in per staff member when ready.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS mode TEXT
  CHECK (mode IS NULL OR mode IN ('Air', 'Road', 'Sea', 'Warehousing'));
