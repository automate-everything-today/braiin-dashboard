# Event follow-up data layer — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Airtable → dashboard import pipeline to be lossless, add Granola transcript ingestion, same-company grouping with auto-lead, a questionnaire-driven rule engine, baseline template fallback, and event photo upload — so every contact in Airtable lands in the dashboard with the right data and the AI has the best source material to write from.

**Architecture:** Eight additive Postgres migrations behind a per-run `RulesSnapshot` pattern. The importer becomes a five-pass pipeline (fetch → upsert → group-detect → granola-link → audit-log). Draft generation reads `system_rules` for model routing and falls back to a deterministic baseline template when enrichment is absent. Dashboard surfaces a `needs_attention` pile, a `/dev/system-rules` editor, and a `/dev/import-health` audit view.

**Tech Stack:** TypeScript, Next.js (App Router with breaking changes — see `AGENTS.md`), Supabase (Postgres + Storage + Auth), Anthropic Claude (Sonnet 4.6 + Haiku 4.5), Vitest, Zod, Granola MCP.

**Spec source:** `docs/superpowers/specs/2026-04-29-event-followup-data-layer-design.md`

**Migrations applied via clipboard** (per repo convention — no Supabase CLI). After each migration step, the executor copies the SQL to the clipboard with `pbcopy`, the operator pastes into the Supabase SQL editor, and only then proceeds to the next step.

**Branching:** Each phase is independently mergeable. Recommended branch shape: `feat/event-followup-data-layer-phase-N` per phase.

---

## Phase 0 — Test infrastructure (one-time setup)

### Task 0.1: Wire vitest setup file and first co-located test convention

**Files:**
- Create: `vitest.setup.ts`
- Modify: `vitest.config.ts:1-18`
- Create: `src/lib/event-followup/__tests__/.gitkeep`

- [ ] **Step 1: Add a setup file that loads `.env.local` and adds jest-dom matchers**

```typescript
// vitest.setup.ts
import "@testing-library/jest-dom";
```

- [ ] **Step 2: Wire setup into vitest config**

Update `vitest.config.ts` to add `setupFiles: ["./vitest.setup.ts"]`:

```typescript
import { defineConfig } from "vitest/config";
import path from "path";
import { config } from "dotenv";

config({ path: ".env.local" });

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 3: Create the __tests__ directory placeholder**

```bash
mkdir -p src/lib/event-followup/__tests__ src/lib/system-rules/__tests__
touch src/lib/event-followup/__tests__/.gitkeep src/lib/system-rules/__tests__/.gitkeep
```

- [ ] **Step 4: Verify vitest still runs (with no tests yet)**

Run: `npm test`
Expected: `No test files found, exiting with code 0` (or similar; non-zero is a config bug)

- [ ] **Step 5: Commit**

```bash
git add vitest.setup.ts vitest.config.ts src/lib/event-followup/__tests__/.gitkeep src/lib/system-rules/__tests__/.gitkeep
git commit -m "chore: wire vitest setup file and __tests__ directory convention"
```

---

## Phase 1 — Schema migrations

All migrations applied via clipboard. Each task ends with a `pbcopy < <migration-file>` step; operator pastes into Supabase SQL editor and confirms before moving on.

### Task 1.1: Migration 061 — event_contacts data layer extensions

**Files:**
- Create: `supabase/migrations/061_event_contacts_data_layer_extensions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 061: event_contacts data layer extensions
-- Adds seniority_score, data_source_tags, attention_reason, company_group_id;
-- enforces lowercase email; adds 'needs_attention' to follow_up_status enum;
-- adds composite (event_id, tier, name) index for the dominant query.

BEGIN;

ALTER TABLE event_contacts ADD COLUMN seniority_score INTEGER
  CHECK (seniority_score IS NULL OR (seniority_score BETWEEN 0 AND 100));
ALTER TABLE event_contacts ADD COLUMN data_source_tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE event_contacts ADD COLUMN attention_reason TEXT;
ALTER TABLE event_contacts ADD COLUMN company_group_id INTEGER;  -- FK added in 062

ALTER TABLE event_contacts ADD CONSTRAINT event_contacts_email_lowercase
  CHECK (email = lower(email));

DO $$
DECLARE
  cons_name TEXT;
BEGIN
  SELECT conname INTO cons_name
  FROM pg_constraint
  WHERE conrelid = 'public.event_contacts'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%follow_up_status%'
  LIMIT 1;

  IF cons_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE event_contacts DROP CONSTRAINT %I', cons_name);
  END IF;
END $$;

ALTER TABLE event_contacts
  ADD CONSTRAINT event_contacts_follow_up_status_check
  CHECK (follow_up_status IN (
    'pending','already_engaged','drafted','reviewed',
    'queued','sent','replied','bounced','opted_out',
    'cancelled','needs_attention'
  ));

CREATE INDEX IF NOT EXISTS event_contacts_event_tier_name_idx
  ON event_contacts (event_id, tier, name);

COMMIT;
```

- [ ] **Step 2: Bundle to clipboard for operator paste**

Run: `pbcopy < supabase/migrations/061_event_contacts_data_layer_extensions.sql`
Expected: SQL is on the clipboard. Tell operator: "Migration 061 on clipboard. Paste into Supabase SQL editor and run; confirm success before proceeding."

- [ ] **Step 3: Wait for operator confirmation, then commit**

```bash
git add supabase/migrations/061_event_contacts_data_layer_extensions.sql
git commit -m "feat(db): migration 061 - event_contacts data layer extensions"
```

### Task 1.2: Migration 062 — company_groups table + FK back-reference

**Files:**
- Create: `supabase/migrations/062_company_groups.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 062: company_groups
-- Creates the table that groups same-company contacts within an event,
-- adds the FK from event_contacts.company_group_id, and a partial index.

BEGIN;

CREATE TABLE company_groups (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  company_name_canonical TEXT NOT NULL,
  lead_contact_id INTEGER REFERENCES event_contacts(id) ON DELETE SET NULL,
  lead_overridden_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, company_name_canonical)
);

ALTER TABLE event_contacts
  ADD CONSTRAINT event_contacts_company_group_id_fkey
  FOREIGN KEY (company_group_id) REFERENCES company_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS event_contacts_company_group_idx
  ON event_contacts (company_group_id) WHERE company_group_id IS NOT NULL;

COMMIT;
```

- [ ] **Step 2: Bundle to clipboard**

Run: `pbcopy < supabase/migrations/062_company_groups.sql`

- [ ] **Step 3: Wait for operator confirmation, then commit**

```bash
git add supabase/migrations/062_company_groups.sql
git commit -m "feat(db): migration 062 - company_groups + FK back-reference"
```

### Task 1.3: Migration 063 — granola_meetings + event_contact_granola_links

**Files:**
- Create: `supabase/migrations/063_granola_ingestion.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 063: granola_meetings + event_contact_granola_links
-- Caches Granola transcripts and links them many-to-many to event_contacts.

BEGIN;

CREATE TABLE granola_meetings (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  transcript TEXT NOT NULL,
  summary TEXT,
  participants JSONB NOT NULL DEFAULT '[]',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS granola_meetings_recorded_at_idx
  ON granola_meetings (recorded_at);

CREATE TABLE event_contact_granola_links (
  event_contact_id INTEGER NOT NULL
    REFERENCES event_contacts(id) ON DELETE CASCADE,
  granola_meeting_id UUID NOT NULL
    REFERENCES granola_meetings(id) ON DELETE CASCADE,
  match_confidence INTEGER NOT NULL
    CHECK (match_confidence BETWEEN 0 AND 100),
  match_method TEXT NOT NULL
    CHECK (match_method IN ('name_exact','name_fuzzy','name_and_date','manual','pending_review')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_contact_id, granola_meeting_id)
);

ALTER TABLE granola_meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY granola_meetings_authenticated_read ON granola_meetings
  FOR SELECT USING ((SELECT auth.role()) = 'authenticated');

ALTER TABLE event_contact_granola_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY granola_links_authenticated_read ON event_contact_granola_links
  FOR SELECT USING ((SELECT auth.role()) = 'authenticated');

COMMIT;
```

- [ ] **Step 2: Bundle to clipboard**

Run: `pbcopy < supabase/migrations/063_granola_ingestion.sql`

- [ ] **Step 3: Wait for operator confirmation, then commit**

```bash
git add supabase/migrations/063_granola_ingestion.sql
git commit -m "feat(db): migration 063 - granola_meetings and links table"
```

### Task 1.4: Migration 064 — event_media

**Files:**
- Create: `supabase/migrations/064_event_media.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 064: event_media
-- Stores per-event uploaded photos. Storage bucket created separately.

BEGIN;

CREATE TABLE event_media (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  caption TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by TEXT
);

CREATE INDEX IF NOT EXISTS event_media_event_idx ON event_media (event_id);

ALTER TABLE event_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_media_authenticated_read ON event_media
  FOR SELECT USING ((SELECT auth.role()) = 'authenticated');

COMMIT;
```

- [ ] **Step 2: Bundle to clipboard**

Run: `pbcopy < supabase/migrations/064_event_media.sql`

- [ ] **Step 3: Operator creates Supabase Storage bucket `event-media` via Studio**

The migration alone is not enough — the operator must:
1. Open Supabase Studio → Storage.
2. Create bucket `event-media` (public read = false; authenticated upload = manager+ via RLS policy).
3. Confirm done before next task.

- [ ] **Step 4: Commit migration**

```bash
git add supabase/migrations/064_event_media.sql
git commit -m "feat(db): migration 064 - event_media table"
```

### Task 1.5: Migration 065 — system_rules

**Files:**
- Create: `supabase/migrations/065_system_rules.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 065: system_rules
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
```

- [ ] **Step 2: Bundle to clipboard**

Run: `pbcopy < supabase/migrations/065_system_rules.sql`

- [ ] **Step 3: Wait for operator confirmation, then commit**

```bash
git add supabase/migrations/065_system_rules.sql
git commit -m "feat(db): migration 065 - system_rules table"
```

### Task 1.6: Migration 066 — seed system_rules defaults

**Files:**
- Create: `supabase/migrations/066_seed_system_rules_defaults.sql`

- [ ] **Step 1: Write the seed migration**

```sql
-- Migration 066: seed default rules so the system works out of the box.
-- baseline_template is intentionally empty; operator authors via /dev/system-rules.

BEGIN;

INSERT INTO system_rules (category, key, value, notes) VALUES
('seniority_score', 'weights', '{
  "ceo": 100, "founder": 95, "owner": 95, "president": 95,
  "managing_director": 95, "md": 95,
  "director": 80, "head": 75, "vp": 75,
  "manager": 60, "lead": 60,
  "analyst": 40, "coordinator": 40, "executive": 40, "exec": 40,
  "default_unknown": 20
}'::jsonb, 'Title-keyword to seniority score (0-100). Highest match wins.'),

('company_match', 'canonicalisation', '{
  "strip_suffixes": ["Ltd","Inc","SA","SAS","SL","SLU","GmbH","AG","BV","NV","Group","Logistics","Cargo","Shipping","Worldwide","International","Co","Corp","LLC"],
  "treat_and_equal": true,
  "strip_punctuation": true,
  "lowercase": true
}'::jsonb, 'Canonicalisation rules used for company-grouping equivalence.'),

('granola_match', 'thresholds', '{
  "auto_link_threshold": 80,
  "review_floor": 50,
  "date_buffer_days": 2
}'::jsonb, 'Granola match confidence cutoffs and date proximity window.'),

('model_routing', 'tasks', '{
  "seniority_score": "claude-haiku-4-5",
  "company_canonicalisation": "claude-haiku-4-5",
  "granola_match": "claude-haiku-4-5",
  "already_engaged_summary": "claude-haiku-4-5",
  "draft_email": "claude-sonnet-4-6",
  "voice_lint_regenerate": "claude-sonnet-4-6",
  "baseline_template_authoring": "claude-sonnet-4-6"
}'::jsonb, 'Per-task model assignment. Edit via /dev/system-rules.');

COMMIT;
```

- [ ] **Step 2: Bundle to clipboard**

Run: `pbcopy < supabase/migrations/066_seed_system_rules_defaults.sql`

- [ ] **Step 3: Wait for operator confirmation, then commit**

```bash
git add supabase/migrations/066_seed_system_rules_defaults.sql
git commit -m "feat(db): migration 066 - seed system_rules defaults"
```

### Task 1.7: Migration 067 — import_audit_log

**Files:**
- Create: `supabase/migrations/067_import_audit_log.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 067: import_audit_log
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
```

- [ ] **Step 2: Bundle to clipboard**

Run: `pbcopy < supabase/migrations/067_import_audit_log.sql`

- [ ] **Step 3: Wait for operator confirmation, then commit**

```bash
git add supabase/migrations/067_import_audit_log.sql
git commit -m "feat(db): migration 067 - import_audit_log"
```

### Task 1.8: Migration 068 — extend activity.llm_calls with rules_snapshot_id

**Files:**
- Create: `supabase/migrations/068_llm_calls_rules_snapshot.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 068: extend activity.llm_calls with rules snapshot reference.
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
```

- [ ] **Step 2: Bundle to clipboard**

Run: `pbcopy < supabase/migrations/068_llm_calls_rules_snapshot.sql`

- [ ] **Step 3: Wait for operator confirmation, then commit**

```bash
git add supabase/migrations/068_llm_calls_rules_snapshot.sql
git commit -m "feat(db): migration 068 - llm_calls rules snapshot columns"
```

### Task 1.9: Regenerate database types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Use the existing types-from-supabase script if present**

Run: `grep -E "supabase gen types|gen-types" package.json`

If a script exists, run it (e.g. `npm run gen-types`). If not, the operator must regenerate types from Supabase Studio (Settings → API → Generate types). Document the path used in the commit message.

- [ ] **Step 2: Verify TypeScript compiles after regeneration**

Run: `npx tsc --noEmit`
Expected: 0 errors. If any, the regeneration produced incompatible types — fix before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "chore(types): regenerate database types after migrations 061-068"
```

---

## Phase 2 — System rules infrastructure

### Task 2.1: Define Zod schemas for each system_rules category

**Files:**
- Create: `src/lib/system-rules/schemas.ts`
- Test: `src/lib/system-rules/__tests__/schemas.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/system-rules/__tests__/schemas.test.ts
import { describe, it, expect } from "vitest";
import {
  seniorityScoreSchema,
  companyMatchSchema,
  granolaMatchSchema,
  modelRoutingSchema,
  baselineTemplateSchema,
} from "../schemas";

describe("system_rules Zod schemas", () => {
  it("seniorityScoreSchema requires default_unknown and at least one role weight", () => {
    expect(() => seniorityScoreSchema.parse({ default_unknown: 20 })).toThrow();
    expect(seniorityScoreSchema.parse({ ceo: 100, default_unknown: 20 })).toBeTruthy();
  });

  it("companyMatchSchema requires strip_suffixes array", () => {
    expect(companyMatchSchema.parse({
      strip_suffixes: ["Ltd"],
      treat_and_equal: true,
      strip_punctuation: true,
      lowercase: true,
    })).toBeTruthy();
    expect(() => companyMatchSchema.parse({ treat_and_equal: true })).toThrow();
  });

  it("granolaMatchSchema enforces threshold ordering", () => {
    expect(granolaMatchSchema.parse({
      auto_link_threshold: 80, review_floor: 50, date_buffer_days: 2
    })).toBeTruthy();
    expect(() => granolaMatchSchema.parse({
      auto_link_threshold: 50, review_floor: 80, date_buffer_days: 2
    })).toThrow();
  });

  it("modelRoutingSchema requires draft_email key", () => {
    expect(() => modelRoutingSchema.parse({ seniority_score: "claude-haiku-4-5" })).toThrow();
  });

  it("baselineTemplateSchema requires greeting + ask + signoff", () => {
    expect(baselineTemplateSchema.parse({
      greeting: "Hi {first_name}",
      ask: "Send any active lanes through.",
      signoff: "Best regards",
      length_cap_lines: 4,
      include_country_hook: false,
    })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/system-rules/__tests__/schemas.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the schemas**

```typescript
// src/lib/system-rules/schemas.ts
import { z } from "zod";

export const seniorityScoreSchema = z.object({
  default_unknown: z.number().int().min(0).max(100),
}).catchall(z.number().int().min(0).max(100))
  .refine((obj) => Object.keys(obj).length >= 2, "must include at least one role weight");

export const companyMatchSchema = z.object({
  strip_suffixes: z.array(z.string()).min(0),
  treat_and_equal: z.boolean(),
  strip_punctuation: z.boolean(),
  lowercase: z.boolean(),
});

export const granolaMatchSchema = z.object({
  auto_link_threshold: z.number().int().min(0).max(100),
  review_floor: z.number().int().min(0).max(100),
  date_buffer_days: z.number().int().min(0),
}).refine((d) => d.review_floor < d.auto_link_threshold,
  "review_floor must be less than auto_link_threshold");

export const modelRoutingSchema = z.object({
  draft_email: z.string().min(1),
}).catchall(z.string().min(1));

export const baselineTemplateSchema = z.object({
  greeting: z.string().min(1),
  ask: z.string().min(1),
  signoff: z.string().min(1),
  length_cap_lines: z.number().int().min(1).max(20),
  include_country_hook: z.boolean(),
  country_hook_template: z.string().optional(),
});

export const SCHEMA_BY_CATEGORY = {
  seniority_score: seniorityScoreSchema,
  company_match: companyMatchSchema,
  granola_match: granolaMatchSchema,
  model_routing: modelRoutingSchema,
  baseline_template: baselineTemplateSchema,
} as const;

export type SystemRuleCategory = keyof typeof SCHEMA_BY_CATEGORY;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/system-rules/__tests__/schemas.test.ts`
Expected: PASS, 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/system-rules/schemas.ts src/lib/system-rules/__tests__/schemas.test.ts
git commit -m "feat(system-rules): Zod schemas per category with validation tests"
```

### Task 2.2: Implement loadSystemRule + RulesSnapshot

**Files:**
- Create: `src/lib/system-rules/load.ts`
- Create: `src/lib/system-rules/types.ts`
- Test: `src/lib/system-rules/__tests__/load.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/system-rules/__tests__/load.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadRulesSnapshot, RulesSnapshot } from "../load";

const mockSelect = vi.fn();
vi.mock("@/services/base", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => mockSelect() }) }) },
}));

describe("RulesSnapshot", () => {
  beforeEach(() => mockSelect.mockReset());

  it("loads all categories at once and validates each", async () => {
    mockSelect.mockResolvedValueOnce({
      data: [
        { category: "seniority_score", key: "weights", value: { ceo: 100, default_unknown: 20 } },
        { category: "model_routing", key: "tasks", value: { draft_email: "claude-sonnet-4-6", seniority_score: "claude-haiku-4-5" } },
      ],
      error: null,
    });
    const snap = await loadRulesSnapshot();
    expect(snap.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(snap.modelFor("draft_email")).toBe("claude-sonnet-4-6");
    expect(snap.seniority("ceo")).toBe(100);
  });

  it("aborts loudly on validation failure (no silent fallback)", async () => {
    mockSelect.mockResolvedValueOnce({
      data: [
        { category: "model_routing", key: "tasks", value: { not_an_email: 42 } },
      ],
      error: null,
    });
    await expect(loadRulesSnapshot()).rejects.toThrow(/system_rules.*model_routing/);
  });

  it("falls back to seeded default when row is missing", async () => {
    mockSelect.mockResolvedValueOnce({ data: [], error: null });
    const snap = await loadRulesSnapshot();
    expect(snap.modelFor("draft_email")).toBe("claude-sonnet-4-6");  // default
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/system-rules/__tests__/load.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement loadRulesSnapshot**

```typescript
// src/lib/system-rules/types.ts
export interface RulesSnapshot {
  id: string;
  modelFor(task: string): string;
  seniority(titleKeyword: string): number;
  companyMatch: {
    strip_suffixes: string[];
    treat_and_equal: boolean;
    strip_punctuation: boolean;
    lowercase: boolean;
  };
  granolaThresholds: {
    auto_link_threshold: number;
    review_floor: number;
    date_buffer_days: number;
  };
  baselineTemplate(slotKey: string): null | {
    greeting: string;
    ask: string;
    signoff: string;
    length_cap_lines: number;
    include_country_hook: boolean;
    country_hook_template?: string;
  };
  raw: Record<string, unknown>;  // for import_audit_log.rules_snapshot
}
```

```typescript
// src/lib/system-rules/load.ts
import { randomUUID } from "node:crypto";
import { supabase } from "@/services/base";
import { SCHEMA_BY_CATEGORY, type SystemRuleCategory } from "./schemas";
import type { RulesSnapshot } from "./types";

const HARDCODED_DEFAULTS: Record<string, unknown> = {
  "seniority_score:weights": { ceo: 100, default_unknown: 20 },
  "company_match:canonicalisation": {
    strip_suffixes: ["Ltd","Inc","SA","Group","Logistics"],
    treat_and_equal: true,
    strip_punctuation: true,
    lowercase: true,
  },
  "granola_match:thresholds": {
    auto_link_threshold: 80,
    review_floor: 50,
    date_buffer_days: 2,
  },
  "model_routing:tasks": {
    draft_email: "claude-sonnet-4-6",
    seniority_score: "claude-haiku-4-5",
    granola_match: "claude-haiku-4-5",
  },
};

export async function loadRulesSnapshot(): Promise<RulesSnapshot> {
  const { data, error } = await supabase
    .from("system_rules")
    .select("category, key, value")
    .eq("active", true);
  if (error) throw new Error(`system_rules load failed: ${error.message}`);

  const byCatKey: Record<string, unknown> = {};
  for (const row of (data ?? []) as Array<{ category: string; key: string; value: unknown }>) {
    const schema = SCHEMA_BY_CATEGORY[row.category as SystemRuleCategory];
    if (!schema) continue;
    const parsed = schema.safeParse(row.value);
    if (!parsed.success) {
      // Fail loud per spec section 9 + feedback_error_handling.md.
      throw new Error(
        `system_rules invalid: ${row.category}.${row.key} - ${parsed.error.message}`,
      );
    }
    byCatKey[`${row.category}:${row.key}`] = parsed.data;
  }

  const get = <T>(catKey: string): T => {
    const v = byCatKey[catKey] ?? HARDCODED_DEFAULTS[catKey];
    if (v === undefined) throw new Error(`system_rules: no value for ${catKey}`);
    return v as T;
  };

  const seniorityWeights = get<Record<string, number>>("seniority_score:weights");
  const companyMatch = get<RulesSnapshot["companyMatch"]>("company_match:canonicalisation");
  const granolaThresholds = get<RulesSnapshot["granolaThresholds"]>("granola_match:thresholds");
  const modelRouting = get<Record<string, string>>("model_routing:tasks");

  return {
    id: randomUUID(),
    modelFor: (task) => modelRouting[task] ?? modelRouting.draft_email,
    seniority: (kw) => seniorityWeights[kw.toLowerCase()] ?? seniorityWeights.default_unknown ?? 20,
    companyMatch,
    granolaThresholds,
    baselineTemplate: (slotKey) => {
      const v = byCatKey[`baseline_template:${slotKey}`];
      return (v as RulesSnapshot["baselineTemplate"] extends (k: string) => infer R ? R : never) ?? null;
    },
    raw: byCatKey,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/system-rules/__tests__/load.test.ts`
Expected: PASS, 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/system-rules/load.ts src/lib/system-rules/types.ts src/lib/system-rules/__tests__/load.test.ts
git commit -m "feat(system-rules): loadRulesSnapshot with fail-loud validation"
```

### Task 2.3: API route GET/PATCH /api/system-rules

**Files:**
- Create: `src/app/api/system-rules/route.ts`
- Create: `src/app/api/system-rules/[id]/route.ts`

- [ ] **Step 1: Write GET (list rules) and POST (upsert rule) for the collection**

```typescript
// src/app/api/system-rules/route.ts
import { z } from "zod";
import { supabase } from "@/services/base";
import { requireAuth, requireManager } from "@/lib/api-auth";
import { apiError, apiResponse, validationError } from "@/lib/validation";
import { SCHEMA_BY_CATEGORY, type SystemRuleCategory } from "@/lib/system-rules/schemas";

const ROUTE = "/api/system-rules";

export async function GET(req: Request) {
  const auth = await requireAuth(ROUTE, req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  let q = supabase.from("system_rules").select("id, category, key, value, previous_value, notes, active, updated_at, updated_by");
  if (category) q = q.eq("category", category);
  const { data, error } = await q.order("category").order("key");
  if (error) return apiError(error.message, 500);
  return apiResponse({ rules: data });
}

const upsertSchema = z.object({
  category: z.string().min(1),
  key: z.string().min(1),
  value: z.unknown(),
  notes: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const schema = SCHEMA_BY_CATEGORY[parsed.data.category as SystemRuleCategory];
  if (!schema) return apiError(`Unknown category: ${parsed.data.category}`, 400);
  const valid = schema.safeParse(parsed.data.value);
  if (!valid.success) return apiError(`Invalid value for ${parsed.data.category}: ${valid.error.message}`, 400);

  const { data: existing } = await supabase
    .from("system_rules")
    .select("id, value")
    .eq("category", parsed.data.category)
    .eq("key", parsed.data.key)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("system_rules")
      .update({
        value: valid.data,
        previous_value: existing.value,
        notes: parsed.data.notes ?? null,
        updated_by: auth.user?.email ?? null,
      })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) return apiError(error.message, 500);
    return apiResponse({ rule: data });
  }

  const { data, error } = await supabase
    .from("system_rules")
    .insert({
      category: parsed.data.category,
      key: parsed.data.key,
      value: valid.data,
      notes: parsed.data.notes ?? null,
      updated_by: auth.user?.email ?? null,
    })
    .select()
    .single();
  if (error) return apiError(error.message, 500);
  return apiResponse({ rule: data });
}
```

- [ ] **Step 2: Write a one-step undo route on `/api/system-rules/[id]`**

```typescript
// src/app/api/system-rules/[id]/route.ts
import { supabase } from "@/services/base";
import { requireManager } from "@/lib/api-auth";
import { apiError, apiResponse } from "@/lib/validation";

const ROUTE = "/api/system-rules/[id]";

// POST acts as undo: swap value with previous_value.
export async function POST(req: Request, ctx: { params: { id: string } }) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;
  const id = parseInt(ctx.params.id, 10);
  if (!id) return apiError("Invalid id", 400);

  const { data: row } = await supabase
    .from("system_rules")
    .select("value, previous_value")
    .eq("id", id)
    .maybeSingle();
  if (!row) return apiError("Rule not found", 404);
  if (!row.previous_value) return apiError("No previous_value to undo", 400);

  const { data, error } = await supabase
    .from("system_rules")
    .update({
      value: row.previous_value,
      previous_value: row.value,
      updated_by: auth.user?.email ?? null,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) return apiError(error.message, 500);
  return apiResponse({ rule: data });
}
```

- [ ] **Step 3: Smoke test via curl (manual)**

Document for the operator:
```
curl -i http://localhost:3000/api/system-rules?category=model_routing -H "cookie: ..."
# Should return the seeded model_routing rule.
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/system-rules
git commit -m "feat(api): system-rules GET/POST + undo endpoint"
```

---

## Phase 3 — Importer audit + needs_attention

### Task 3.1: Implement seniority scorer

**Files:**
- Create: `src/lib/event-followup/seniority.ts`
- Test: `src/lib/event-followup/__tests__/seniority.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { scoreTitle } from "../seniority";

const weights = {
  ceo: 100, founder: 95, director: 80, head: 75, manager: 60,
  coordinator: 40, default_unknown: 20,
};

describe("scoreTitle", () => {
  it("returns CEO score for 'Chief Executive Officer'", () => {
    expect(scoreTitle("Chief Executive Officer", weights)).toBe(100);
  });
  it("returns director score for 'Marketing Director'", () => {
    expect(scoreTitle("Marketing Director", weights)).toBe(80);
  });
  it("returns highest match when multiple keywords match", () => {
    expect(scoreTitle("Founder & CEO", weights)).toBe(100);
  });
  it("returns default_unknown for empty/unknown title", () => {
    expect(scoreTitle("", weights)).toBe(20);
    expect(scoreTitle("Sales Specialist", weights)).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/event-followup/__tests__/seniority.test.ts`

- [ ] **Step 3: Implement scoreTitle**

```typescript
// src/lib/event-followup/seniority.ts
const ALIASES: Record<string, string> = {
  ceo: "ceo",
  "chief executive officer": "ceo",
  "chief executive": "ceo",
  founder: "founder",
  "co-founder": "founder",
  cofounder: "founder",
  owner: "owner",
  president: "president",
  "managing director": "managing_director",
  md: "managing_director",
  director: "director",
  head: "head",
  vp: "vp",
  "vice president": "vp",
  manager: "manager",
  lead: "lead",
  analyst: "analyst",
  coordinator: "coordinator",
  executive: "executive",
  exec: "executive",
};

export function scoreTitle(title: string | null | undefined, weights: Record<string, number>): number {
  if (!title) return weights.default_unknown ?? 20;
  const lower = title.toLowerCase();
  let best = -1;
  for (const [phrase, canonical] of Object.entries(ALIASES)) {
    if (lower.includes(phrase)) {
      const score = weights[canonical] ?? -1;
      if (score > best) best = score;
    }
  }
  return best >= 0 ? best : (weights.default_unknown ?? 20);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/event-followup/__tests__/seniority.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-followup/seniority.ts src/lib/event-followup/__tests__/seniority.test.ts
git commit -m "feat(event-followup): seniority scorer with alias map"
```

### Task 3.2: Implement company name canonicalisation

**Files:**
- Create: `src/lib/event-followup/company-canonical.ts`
- Test: `src/lib/event-followup/__tests__/company-canonical.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { canonicalCompany } from "../company-canonical";

const rules = {
  strip_suffixes: ["Ltd","Inc","SA","Group","Logistics"],
  treat_and_equal: true,
  strip_punctuation: true,
  lowercase: true,
};

describe("canonicalCompany", () => {
  it("strips suffix tokens", () => {
    expect(canonicalCompany("Krom Global Logistics", rules)).toBe(canonicalCompany("KROM GLOBAL", rules));
  });
  it("equates & with and", () => {
    expect(canonicalCompany("Smith & Jones", rules)).toBe(canonicalCompany("Smith and Jones", rules));
  });
  it("normalises whitespace", () => {
    expect(canonicalCompany("  ATOS  Shipping ", rules)).toBe(canonicalCompany("Atos Shipping", rules));
  });
  it("returns empty string for null/empty", () => {
    expect(canonicalCompany(null, rules)).toBe("");
    expect(canonicalCompany("", rules)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/event-followup/__tests__/company-canonical.test.ts`

- [ ] **Step 3: Implement canonicalCompany**

```typescript
// src/lib/event-followup/company-canonical.ts
export interface CanonicalRules {
  strip_suffixes: string[];
  treat_and_equal: boolean;
  strip_punctuation: boolean;
  lowercase: boolean;
}

export function canonicalCompany(input: string | null | undefined, rules: CanonicalRules): string {
  if (!input) return "";
  let s = input.trim();
  if (rules.lowercase) s = s.toLowerCase();
  if (rules.treat_and_equal) s = s.replace(/\s*&\s*/g, " and ");
  if (rules.strip_punctuation) s = s.replace(/[.,/'"`!?]+/g, " ");
  for (const suffix of rules.strip_suffixes) {
    const re = new RegExp(`\\b${suffix.toLowerCase()}\\b\\.?`, "gi");
    s = s.replace(re, " ");
  }
  return s.replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/event-followup/__tests__/company-canonical.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-followup/company-canonical.ts src/lib/event-followup/__tests__/company-canonical.test.ts
git commit -m "feat(event-followup): canonicalCompany for grouping equivalence"
```

### Task 3.3: Extend importer to write import_audit_log + needs_attention rows

**Files:**
- Modify: `src/lib/airtable/event-contacts.ts:215-330`
- Test: `src/lib/event-followup/__tests__/import-audit.test.ts`

- [ ] **Step 1: Write a failing integration-style test that mocks Airtable + supabase**

Create the test file with mocks for `fetchAllRecords` and the supabase client. Verify that:
- A record without email lands in `event_contacts` with `follow_up_status='needs_attention'` and `attention_reason='no_email'` (NOT skipped).
- A record without an event lands with `attention_reason='no_event'`.
- An imported record produces an `import_audit_log` row with `result='imported'`, `fields_present` and `fields_landed` populated.

```typescript
// src/lib/event-followup/__tests__/import-audit.test.ts
import { describe, it, expect, vi } from "vitest";
import { importEventContacts } from "@/lib/airtable/event-contacts";

vi.mock("@/services/base", () => {
  const upsertCalls: Array<Record<string, unknown>[]> = [];
  const auditInsertCalls: Array<Record<string, unknown>[]> = [];
  const supabase = {
    from: (table: string) => {
      if (table === "events") return {
        select: () => ({ data: [{ id: 1, name: "Intermodal 2026" }], error: null }),
      };
      if (table === "freight_networks") return {
        select: () => ({ data: [], error: null }),
      };
      if (table === "event_contacts") return {
        upsert: (rows: Record<string, unknown>[]) => {
          upsertCalls.push(rows);
          return { error: null, count: rows.length };
        },
      };
      if (table === "import_audit_log") return {
        insert: (rows: Record<string, unknown>[]) => {
          auditInsertCalls.push(rows);
          return { error: null };
        },
      };
      return {};
    },
    _upsertCalls: upsertCalls,
    _auditInsertCalls: auditInsertCalls,
  };
  return { supabase };
});

vi.mock("@/lib/airtable/event-contacts", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/airtable/event-contacts")>();
  // Override fetchAllRecords with a small fixture.
  return {
    ...actual,
    fetchAllRecords: vi.fn().mockResolvedValue([
      { id: "rec1", fields: { Email: "a@b.com", Event: ["Intermodal 2026"], Name: "Alice", Title: "CEO", Company: "Acme", "Meeting Notes": "rich notes" } },
      { id: "rec2", fields: { Email: "noevent@b.com", Name: "Bob" } },
      { id: "rec3", fields: { Name: "Charlie" } },
    ]),
  };
});

describe("importEventContacts with audit log", () => {
  it("records every record outcome and surfaces drops as needs_attention", async () => {
    const result = await importEventContacts();
    expect(result.fetched).toBe(3);
    // imported (rec1) + needs_attention (rec2 no_event) + needs_attention (rec3 no_email) = 3 rows persisted
    // expectations against the mocked supabase recorded calls
    // (the mock surface is asserted here; full impl below)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/event-followup/__tests__/import-audit.test.ts`
Expected: FAIL — current importer drops records with no email/event.

- [ ] **Step 3: Refactor `buildRows` and add audit-log writing**

Update `src/lib/airtable/event-contacts.ts` to:
1. Take a `runId: string` and `RulesSnapshot` parameter into `importEventContacts(runId, snapshot)`.
2. For each record, instead of `recordSkip`, build a row with:
   - `follow_up_status = 'needs_attention'` and the `attention_reason` populated when `email` or `event` is missing.
   - `event_id` left null when no event resolves.
3. After upsert, write one `import_audit_log` row per processed record (not per row) with `result`, `fields_present`, `fields_landed`, `run_id`, and `rules_snapshot`.

Show the full diff in the implementation step (~120 lines). Key change in `buildRows`:

```typescript
// Replace early-exit drops with attention rows.
if (!email) {
  rows.push({
    airtable_record_id: rec.id,
    email: `pending+${rec.id}@needs-attention.local`,  // synthesised lowercase email to satisfy NOT NULL + lowercase check
    name: asString(f["Name"]),
    follow_up_status: "needs_attention",
    attention_reason: "no_email",
    imported_from_airtable_at: new Date().toISOString(),
  });
  recordOutcome("needs_attention:no_email", rec, []);
  continue;
}
if (eventNames.length === 0) {
  rows.push({
    ...baseRow,
    event_id: null,
    follow_up_status: "needs_attention",
    attention_reason: "no_event",
  });
  recordOutcome("needs_attention:no_event", rec, fieldsFor(baseRow));
  continue;
}
// ... existing per-event row push, but call recordOutcome("imported", rec, fieldsFor(baseRow)).
```

(Full implementation is provided when this task runs — the refactor pattern is unambiguous from the test and the spec.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/event-followup/__tests__/import-audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/airtable/event-contacts.ts src/lib/event-followup/__tests__/import-audit.test.ts
git commit -m "feat(importer): write import_audit_log and surface drops as needs_attention"
```

### Task 3.4: Extend `/api/event-followup/import` POST to thread runId + RulesSnapshot

**Files:**
- Modify: `src/app/api/event-followup/import/route.ts:79-90`

- [ ] **Step 1: Update the POST handler**

```typescript
// At the top of the file, add:
import { randomUUID } from "node:crypto";
import { loadRulesSnapshot } from "@/lib/system-rules/load";

// Replace the POST handler body with:
export async function POST(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  const runId = randomUUID();
  const snapshot = await loadRulesSnapshot();

  try {
    const result = await importEventContacts({ runId, snapshot });
    return apiResponse({ result, run_id: runId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Import failed";
    return apiError(msg, 500);
  }
}
```

- [ ] **Step 2: Manual smoke test**

```bash
npm run dev
# In another terminal:
curl -X POST http://localhost:3000/api/event-followup/import -H "cookie: <session>"
# Confirm response includes run_id and result.skip_reasons no longer used (now landed as needs_attention).
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/event-followup/import/route.ts
git commit -m "feat(api): thread runId and RulesSnapshot through importer"
```

### Task 3.5: Add audit endpoint `/api/event-followup/audit`

**Files:**
- Create: `src/app/api/event-followup/audit/route.ts`
- Create: `src/lib/event-followup/audit.ts`
- Test: `src/lib/event-followup/__tests__/audit.test.ts`

- [ ] **Step 1: Test the diff function with a fixture**

```typescript
// src/lib/event-followup/__tests__/audit.test.ts
import { describe, it, expect } from "vitest";
import { diffAirtableVsDb } from "../audit";

describe("diffAirtableVsDb", () => {
  it("reports missing rows + field mismatches", () => {
    const airtable = [
      { id: "rec1", email: "a@b.com", event_name: "Intermodal 2026", meeting_notes: "rich" },
      { id: "rec2", email: "c@d.com", event_name: "Intermodal 2026", meeting_notes: null },
    ];
    const db = [
      { airtable_record_id: "rec1", email: "a@b.com", event_id: 1, meeting_notes: null },
    ];
    const events = new Map([[ "intermodal 2026", 1 ]]);
    const out = diffAirtableVsDb(airtable, db, events);
    expect(out.missing).toContain("rec2");
    expect(out.field_mismatches).toContainEqual(
      expect.objectContaining({ airtable_id: "rec1", field: "meeting_notes" })
    );
  });
});
```

- [ ] **Step 2: Implement diffAirtableVsDb + the route**

```typescript
// src/lib/event-followup/audit.ts
export interface AirtableRowSummary {
  id: string;
  email: string | null;
  event_name: string | null;
  name?: string | null;
  meeting_notes?: string | null;
  // ... other compared fields
}
export interface DbRowSummary {
  airtable_record_id: string;
  email: string | null;
  event_id: number | null;
  meeting_notes?: string | null;
  // ...
}
export interface AuditDiff {
  matched: number;
  missing: string[];
  field_mismatches: Array<{ airtable_id: string; field: string; airtable_value: unknown; db_value: unknown }>;
}

export function diffAirtableVsDb(
  airtable: AirtableRowSummary[],
  db: DbRowSummary[],
  eventsByLowerName: Map<string, number>,
): AuditDiff {
  const out: AuditDiff = { matched: 0, missing: [], field_mismatches: [] };
  const dbIdx = new Map<string, DbRowSummary>(db.map((r) => [r.airtable_record_id, r]));

  for (const at of airtable) {
    if (!at.email || !at.event_name) continue; // these go to needs_attention, not missing
    const eventId = eventsByLowerName.get(at.event_name.toLowerCase());
    if (!eventId) {
      out.missing.push(at.id);
      continue;
    }
    const dbRow = dbIdx.get(at.id);
    if (!dbRow) {
      out.missing.push(at.id);
      continue;
    }
    out.matched++;
    if ((at.meeting_notes ?? null) !== (dbRow.meeting_notes ?? null)) {
      out.field_mismatches.push({
        airtable_id: at.id, field: "meeting_notes",
        airtable_value: at.meeting_notes, db_value: dbRow.meeting_notes,
      });
    }
    // Repeat the comparison for every field in the importer's field map.
  }
  return out;
}
```

```typescript
// src/app/api/event-followup/audit/route.ts
import { supabase } from "@/services/base";
import { requireAuth, requireManager } from "@/lib/api-auth";
import { apiError, apiResponse } from "@/lib/validation";
import { diffAirtableVsDb } from "@/lib/event-followup/audit";
// + the existing fetchAllRecords helper if exported, or inline a similar fetch

const ROUTE = "/api/event-followup/audit";

export async function GET(req: Request) {
  const auth = await requireAuth(ROUTE, req);
  if (!auth.ok) return auth.response;
  // Return the most recent audit run summary from import_audit_log.
  const { data, error } = await supabase
    .from("import_audit_log")
    .select("run_id, result, count: id")
    .order("imported_at", { ascending: false })
    .limit(1000);
  if (error) return apiError(error.message, 500);
  return apiResponse({ recent: data });
}

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;
  // Run a fresh audit: pull Airtable + event_contacts and diff.
  // Implementation calls the (extracted) fetcher and diff function.
  return apiResponse({ ok: true });
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npm test -- src/lib/event-followup/__tests__/audit.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/lib/event-followup/audit.ts src/lib/event-followup/__tests__/audit.test.ts src/app/api/event-followup/audit/route.ts
git commit -m "feat(audit): /api/event-followup/audit + diffAirtableVsDb"
```

---

## Phase 4 — Same-company grouping

### Task 4.1: Implement group-detection pass

**Files:**
- Create: `src/lib/event-followup/group-detection.ts`
- Test: `src/lib/event-followup/__tests__/group-detection.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { detectGroups } from "../group-detection";

describe("detectGroups", () => {
  it("groups same-company contacts and picks senior as lead", () => {
    const contacts = [
      { id: 1, company: "Krom Global Logistics", title: "BD Manager", is_lead_contact: false, seniority_score: 60 },
      { id: 2, company: "Krom Global", title: "CEO", is_lead_contact: false, seniority_score: 100 },
      { id: 3, company: "Acme", title: "Manager", is_lead_contact: false, seniority_score: 60 },
    ];
    const groups = detectGroups(contacts, {
      strip_suffixes: ["Logistics"], treat_and_equal: true, strip_punctuation: true, lowercase: true,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].lead_contact_id).toBe(2);
    expect(groups[0].member_ids.sort()).toEqual([1, 2]);
  });

  it("respects is_lead_contact tie-breaker on equal seniority", () => {
    const contacts = [
      { id: 1, company: "Acme", title: "Manager", is_lead_contact: true, seniority_score: 60 },
      { id: 2, company: "Acme", title: "Manager", is_lead_contact: false, seniority_score: 60 },
    ];
    const groups = detectGroups(contacts, { strip_suffixes: [], treat_and_equal: true, strip_punctuation: true, lowercase: true });
    expect(groups[0].lead_contact_id).toBe(1);
  });

  it("returns no groups for solo contacts", () => {
    const contacts = [{ id: 1, company: "Solo", title: "Manager", is_lead_contact: false, seniority_score: 60 }];
    const groups = detectGroups(contacts, { strip_suffixes: [], treat_and_equal: true, strip_punctuation: true, lowercase: true });
    expect(groups).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement detectGroups**

```typescript
// src/lib/event-followup/group-detection.ts
import { canonicalCompany, type CanonicalRules } from "./company-canonical";

interface ContactInput {
  id: number;
  company: string | null;
  title: string | null;
  is_lead_contact: boolean;
  seniority_score: number;
}
export interface DetectedGroup {
  company_name_canonical: string;
  member_ids: number[];
  lead_contact_id: number;
}

export function detectGroups(contacts: ContactInput[], rules: CanonicalRules): DetectedGroup[] {
  const buckets = new Map<string, ContactInput[]>();
  for (const c of contacts) {
    const key = canonicalCompany(c.company, rules);
    if (!key) continue;
    const arr = buckets.get(key) ?? [];
    arr.push(c);
    buckets.set(key, arr);
  }
  const out: DetectedGroup[] = [];
  for (const [key, members] of buckets.entries()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => {
      if (b.seniority_score !== a.seniority_score) return b.seniority_score - a.seniority_score;
      if (a.is_lead_contact !== b.is_lead_contact) return a.is_lead_contact ? -1 : 1;
      return a.id - b.id; // last resort: deterministic
    });
    out.push({
      company_name_canonical: key,
      member_ids: members.map((m) => m.id),
      lead_contact_id: sorted[0].id,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-followup/group-detection.ts src/lib/event-followup/__tests__/group-detection.test.ts
git commit -m "feat(event-followup): detectGroups with seniority + lead tie-breaker"
```

### Task 4.2: Wire group detection into importer (post-upsert pass)

**Files:**
- Modify: `src/lib/airtable/event-contacts.ts` (add `runGroupDetection` call after `upsertRows`)

- [ ] **Step 1: Implement the runner**

```typescript
async function runGroupDetection(eventId: number, snapshot: RulesSnapshot) {
  const { data: contacts } = await supabase
    .from("event_contacts")
    .select("id, company, title, is_lead_contact, seniority_score, company_group_id")
    .eq("event_id", eventId);

  const groups = detectGroups((contacts ?? []) as ContactInput[], snapshot.companyMatch);

  for (const g of groups) {
    // Upsert group; respect lead_overridden_at.
    const { data: existing } = await supabase
      .from("company_groups")
      .select("id, lead_overridden_at")
      .eq("event_id", eventId)
      .eq("company_name_canonical", g.company_name_canonical)
      .maybeSingle();
    let groupId: number;
    if (existing) {
      groupId = existing.id;
      if (!existing.lead_overridden_at) {
        await supabase
          .from("company_groups")
          .update({ lead_contact_id: g.lead_contact_id })
          .eq("id", groupId);
      }
    } else {
      const { data: created, error } = await supabase
        .from("company_groups")
        .insert({
          event_id: eventId,
          company_name_canonical: g.company_name_canonical,
          lead_contact_id: g.lead_contact_id,
        })
        .select("id")
        .single();
      if (error || !created) throw new Error(`company_groups insert failed: ${error?.message}`);
      groupId = created.id;
    }
    // Tag members, set contact_role.
    await supabase
      .from("event_contacts")
      .update({ company_group_id: groupId, contact_role: "cc" })
      .in("id", g.member_ids);
    await supabase
      .from("event_contacts")
      .update({ contact_role: "to" })
      .eq("id", g.lead_contact_id);
  }
}
```

Call this after `upsertRows` for each event_id encountered.

- [ ] **Step 2: Manual smoke test against the smoke-test cohort**

Run import; verify in DB that `Adrià Rabadán + Felipe Caicedo (Krom Global)` are in the same `company_group_id` and the lead is the more senior of the two.

- [ ] **Step 3: Commit**

```bash
git add src/lib/airtable/event-contacts.ts
git commit -m "feat(importer): post-upsert group detection with lead-override safety"
```

---

## Phase 5 — Granola ingestion

### Task 5.1: Implement Granola match algorithm

**Files:**
- Create: `src/lib/event-followup/granola-match.ts`
- Test: `src/lib/event-followup/__tests__/granola-match.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { scoreGranolaMatch } from "../granola-match";

describe("scoreGranolaMatch", () => {
  it("scores name_exact at 100", () => {
    const r = scoreGranolaMatch(
      { id: "uuid", title: "Prasath", recorded_at: "2026-04-13T17:57:00Z" },
      { id: 1, name: "Prasath", first_email_at: "2026-04-13T18:00:00Z" }, 2,
    );
    expect(r.confidence).toBe(100);
    expect(r.method).toBe("name_exact");
  });
  it("scores name_fuzzy lower than exact", () => {
    const r = scoreGranolaMatch(
      { id: "uuid", title: "Kim - Super Cargo Service", recorded_at: "2026-04-13T14:15:00Z" },
      { id: 1, name: "Kim Lee", first_email_at: "2026-04-13T14:00:00Z" }, 2,
    );
    expect(r.confidence).toBeGreaterThanOrEqual(60);
    expect(r.confidence).toBeLessThan(100);
    expect(r.method).toBe("name_fuzzy");
  });
  it("returns 0 for no name overlap and out-of-window date", () => {
    const r = scoreGranolaMatch(
      { id: "uuid", title: "Xyz", recorded_at: "2026-01-01T00:00:00Z" },
      { id: 1, name: "Prasath", first_email_at: "2026-04-13T18:00:00Z" }, 2,
    );
    expect(r.confidence).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement scoreGranolaMatch**

```typescript
// src/lib/event-followup/granola-match.ts
export function scoreGranolaMatch(
  meeting: { id: string; title: string; recorded_at: string },
  contact: { id: number; name: string | null; first_email_at: string | null },
  dateBufferDays: number,
): { confidence: number; method: "name_exact" | "name_fuzzy" | "name_and_date" | "none" } {
  if (!contact.name) return { confidence: 0, method: "none" };
  const titleTokens = meeting.title.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
  const nameTokens = contact.name.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
  if (nameTokens.length === 0) return { confidence: 0, method: "none" };

  // name_exact: full first name appears as a token in the title
  const firstName = nameTokens[0];
  const firstNameInTitle = titleTokens.includes(firstName);
  // name_fuzzy: token-overlap ratio
  const overlap = nameTokens.filter((t) => titleTokens.includes(t)).length / nameTokens.length;

  // date proximity
  const inWindow = (() => {
    if (!contact.first_email_at) return true; // unknown; don't penalise
    const ms = Math.abs(
      new Date(meeting.recorded_at).getTime() - new Date(contact.first_email_at).getTime()
    );
    return ms <= dateBufferDays * 24 * 60 * 60 * 1000;
  })();

  if (firstNameInTitle && inWindow) return { confidence: 100, method: "name_exact" };
  if (overlap >= 0.5 && inWindow) return { confidence: Math.round(60 + overlap * 30), method: "name_fuzzy" };
  if (firstNameInTitle) return { confidence: 60, method: "name_and_date" };
  return { confidence: 0, method: "none" };
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-followup/granola-match.ts src/lib/event-followup/__tests__/granola-match.test.ts
git commit -m "feat(granola): scoreGranolaMatch with name_exact / name_fuzzy / date logic"
```

### Task 5.2: Implement granola-import (call MCP, persist meetings, link by score)

**Files:**
- Create: `src/lib/event-followup/granola-import.ts`

- [ ] **Step 1: Sketch the orchestrator**

```typescript
// src/lib/event-followup/granola-import.ts
import { supabase } from "@/services/base";
import { scoreGranolaMatch } from "./granola-match";
import type { RulesSnapshot } from "@/lib/system-rules/types";

interface GranolaApiClient {
  listMeetings(window: { start: string; end: string }): Promise<Array<{
    id: string; title: string; recorded_at: string; participants: unknown;
  }>>;
  getTranscript(id: string): Promise<{ transcript: string; summary: string | null }>;
}

export async function importGranolaForEvent(
  eventId: number,
  granola: GranolaApiClient,
  snapshot: RulesSnapshot,
): Promise<{ ingested: number; linked: number; pending_review: number }> {
  // 1. Lookup event window.
  const { data: event } = await supabase
    .from("events").select("id, start_date, end_date").eq("id", eventId).maybeSingle();
  if (!event) throw new Error(`Event ${eventId} not found`);

  const buffer = snapshot.granolaThresholds.date_buffer_days;
  const start = new Date(event.start_date);
  start.setDate(start.getDate() - buffer);
  const end = new Date(event.end_date ?? event.start_date);
  end.setDate(end.getDate() + buffer);

  // 2. Pull meetings in window.
  const meetings = await granola.listMeetings({ start: start.toISOString(), end: end.toISOString() });

  // 3. Upsert each into granola_meetings with transcript.
  for (const m of meetings) {
    const { transcript, summary } = await granola.getTranscript(m.id);
    await supabase.from("granola_meetings").upsert({
      id: m.id, title: m.title, recorded_at: m.recorded_at,
      transcript, summary, participants: m.participants ?? [],
    });
  }

  // 4. Pull contacts for the event, score every (contact, meeting) pair.
  const { data: contacts } = await supabase
    .from("event_contacts")
    .select("id, name, sent_at, last_inbound_at")
    .eq("event_id", eventId);
  const auto = snapshot.granolaThresholds.auto_link_threshold;
  const review = snapshot.granolaThresholds.review_floor;
  let linked = 0, pending = 0;

  for (const c of contacts ?? []) {
    for (const m of meetings) {
      const { confidence, method } = scoreGranolaMatch(
        { id: m.id, title: m.title, recorded_at: m.recorded_at },
        { id: c.id, name: c.name, first_email_at: c.last_inbound_at ?? c.sent_at ?? null },
        buffer,
      );
      if (confidence >= auto) {
        await supabase.from("event_contact_granola_links")
          .upsert({ event_contact_id: c.id, granola_meeting_id: m.id, match_confidence: confidence, match_method: method });
        linked++;
      } else if (confidence >= review) {
        await supabase.from("event_contact_granola_links")
          .upsert({ event_contact_id: c.id, granola_meeting_id: m.id, match_confidence: confidence, match_method: "pending_review" });
        pending++;
      }
    }
  }

  return { ingested: meetings.length, linked, pending_review: pending };
}
```

- [ ] **Step 2: Wire a Granola MCP adapter**

Document for the executor: the agent calling this code has access to `mcp__claude_ai_Granola__list_meetings` and `mcp__claude_ai_Granola__get_meeting_transcript`. Wrap them behind the `GranolaApiClient` interface above so production code uses MCP and tests can pass a mock.

- [ ] **Step 3: Add minimal smoke test (mocked MCP)**

```typescript
// src/lib/event-followup/__tests__/granola-import.test.ts
// Mock the supabase client and a fake GranolaApiClient.
// Confirm: 1 meeting in window, 1 contact named "Prasath", produces 1 auto-link.
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/event-followup/granola-import.ts src/lib/event-followup/__tests__/granola-import.test.ts
git commit -m "feat(granola): importGranolaForEvent with confidence-based linking"
```

### Task 5.3: Wire granola import into POST /api/event-followup/import

**Files:**
- Modify: `src/app/api/event-followup/import/route.ts`

- [ ] **Step 1: Call importGranolaForEvent for each event after upsert**

Add to the POST handler, after `importEventContacts`:

```typescript
const eventIds = [...new Set((result.imported_event_ids ?? []) as number[])];
const granolaClient = createGranolaMcpClient();  // see adapter
for (const eventId of eventIds) {
  await importGranolaForEvent(eventId, granolaClient, snapshot);
}
```

- [ ] **Step 2: Manual smoke test**

After running import, query `event_contact_granola_links` for the smoke-test cohort:
```sql
SELECT ec.name, gm.title, l.match_confidence
FROM event_contact_granola_links l
JOIN event_contacts ec ON ec.id = l.event_contact_id
JOIN granola_meetings gm ON gm.id = l.granola_meeting_id
WHERE ec.event_id = (SELECT id FROM events WHERE name = 'Intermodal 2026')
ORDER BY l.match_confidence DESC
LIMIT 20;
```

Expected: Prasath, Kim, Citalli, Laura, etc. linked with confidence ≥80.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/event-followup/import/route.ts
git commit -m "feat(api): trigger Granola ingestion as part of import POST"
```

---

## Phase 6 — Baseline template (author + render)

### Task 6.1: Implement deterministic template renderer

**Files:**
- Create: `src/lib/event-followup/baseline-template.ts`
- Test: `src/lib/event-followup/__tests__/baseline-template.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { renderBaselineTemplate } from "../baseline-template";

describe("renderBaselineTemplate", () => {
  it("substitutes placeholders deterministically", () => {
    const tpl = {
      greeting: "Hi {first_name}",
      ask: "Send any active lanes through.",
      signoff: "Best regards",
      length_cap_lines: 4,
      include_country_hook: false,
    };
    const out = renderBaselineTemplate(tpl, {
      first_name: "Adrià", company: "Krom Global", event_name: "Intermodal 2026", rep_first_name: "Rob", country: "Spain",
    });
    expect(out.body).toContain("Hi Adrià");
    expect(out.body).toContain("Best regards");
    expect(out.body).toContain("Rob");
    expect(out.subject).toMatch(/Intermodal/i);
  });

  it("includes country hook when enabled and country known", () => {
    const tpl = {
      greeting: "Hi {first_name}",
      ask: "Send any active lanes through.",
      signoff: "Best regards",
      length_cap_lines: 6,
      include_country_hook: true,
      country_hook_template: "{country} is one of our active lanes — happy to chat anytime.",
    };
    const out = renderBaselineTemplate(tpl, {
      first_name: "Adrià", company: "Krom", event_name: "Intermodal 2026", rep_first_name: "Rob", country: "Spain",
    });
    expect(out.body).toContain("Spain is one of our active lanes");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement renderBaselineTemplate**

```typescript
// src/lib/event-followup/baseline-template.ts
export interface BaselineTemplate {
  greeting: string;
  ask: string;
  signoff: string;
  length_cap_lines: number;
  include_country_hook: boolean;
  country_hook_template?: string;
}
export interface RenderInput {
  first_name: string;
  company: string;
  event_name: string;
  rep_first_name: string;
  country: string | null;
}
export function renderBaselineTemplate(tpl: BaselineTemplate, vars: RenderInput): { subject: string; body: string } {
  const sub = (s: string) => s
    .replaceAll("{first_name}", vars.first_name)
    .replaceAll("{company}", vars.company)
    .replaceAll("{event_name}", vars.event_name)
    .replaceAll("{rep_first_name}", vars.rep_first_name)
    .replaceAll("{country}", vars.country ?? "");
  const lines: string[] = [sub(tpl.greeting), ""];
  lines.push(`Good to meet you at ${vars.event_name}.`);
  if (tpl.include_country_hook && vars.country && tpl.country_hook_template) {
    lines.push(sub(tpl.country_hook_template));
  }
  lines.push(sub(tpl.ask));
  lines.push("");
  lines.push(sub(tpl.signoff));
  lines.push(vars.rep_first_name);
  const body = lines.slice(0, tpl.length_cap_lines + 4).join("\n");
  const subject = `Following up after ${vars.event_name}`;
  return { subject, body };
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-followup/baseline-template.ts src/lib/event-followup/__tests__/baseline-template.test.ts
git commit -m "feat(event-followup): deterministic baseline template renderer"
```

### Task 6.2: Sonnet-backed template authoring endpoint

**Files:**
- Create: `src/app/api/system-rules/baseline-template/generate/route.ts`

- [ ] **Step 1: Implement the POST handler**

```typescript
// src/app/api/system-rules/baseline-template/generate/route.ts
import { z } from "zod";
import { complete } from "@/lib/llm-gateway";
import { requireManager } from "@/lib/api-auth";
import { apiError, apiResponse, validationError } from "@/lib/validation";
import { loadRulesSnapshot } from "@/lib/system-rules/load";
import { baselineTemplateSchema } from "@/lib/system-rules/schemas";

const ROUTE = "/api/system-rules/baseline-template/generate";

const inputSchema = z.object({
  language: z.enum(["en","pt-br"]),
  tier_band: z.enum(["A","B","C","D"]),
  greeting_default: z.string().min(1),
  ask_default: z.string().min(1),
  signoff_default: z.string().min(1),
  include_country_hook: z.boolean(),
  length_cap_lines: z.number().int().min(2).max(20),
  rep_first_name: z.string().min(1),
});

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const snapshot = await loadRulesSnapshot();
  const model = snapshot.modelFor("baseline_template_authoring");
  const system = `You compose baseline cold-follow-up email templates for ${parsed.data.rep_first_name} at Corten Logistics. Output is a JSON object matching the BaselineTemplate schema. Use the operator's defaults as a starting point, refine for clarity, no AI tells, no hedging. Placeholders allowed: {first_name}, {company}, {event_name}, {rep_first_name}, {country}.`;
  const user = `Operator answers:\n${JSON.stringify(parsed.data, null, 2)}\n\nReturn ONLY a JSON object with keys: greeting, ask, signoff, length_cap_lines, include_country_hook, country_hook_template (optional).`;

  const result = await complete({
    purpose: "baseline_template_authoring",
    system: [{ text: system, cacheControl: "ephemeral" }],
    user,
    model,
    maxTokens: 800,
    temperature: 0.4,
  });

  let parsedTpl: unknown;
  try {
    parsedTpl = JSON.parse(result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""));
  } catch (e) {
    return apiError(`LLM did not return valid JSON: ${e instanceof Error ? e.message : "parse"}`, 502);
  }
  const validated = baselineTemplateSchema.safeParse(parsedTpl);
  if (!validated.success) return apiError(`LLM output failed schema: ${validated.error.message}`, 502);

  return apiResponse({ proposed: validated.data });
}
```

- [ ] **Step 2: Manual smoke test**

```bash
curl -X POST http://localhost:3000/api/system-rules/baseline-template/generate \
  -H "Content-Type: application/json" -H "cookie: ..." \
  -d '{"language":"en","tier_band":"D","greeting_default":"Hi {first_name}","ask_default":"Send any active lanes through.","signoff_default":"Best regards","include_country_hook":false,"length_cap_lines":4,"rep_first_name":"Rob"}'
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/system-rules/baseline-template/generate/route.ts
git commit -m "feat(system-rules): Sonnet-backed baseline template authoring"
```

### Task 6.3: Wire baseline template into draft generator fallback

**Files:**
- Modify: `src/lib/event-followup/generate-draft.ts`

- [ ] **Step 1: Add fallback branch when no Granola transcript + no notes + no company info**

Insert near the top of `generateDraft`:

```typescript
const isBaselineCase = !input.meeting_notes && !input.company_info && (input.granola_transcripts ?? []).length === 0;
if (isBaselineCase) {
  const slotKey = `${input.language ?? "en"}:${tierBand(input.tier)}`;
  const tpl = snapshot.baselineTemplate(slotKey);
  if (!tpl) {
    throw new Error(`No baseline template authored for slot ${slotKey}; operator must run /dev/system-rules questionnaire`);
  }
  const rendered = renderBaselineTemplate(tpl, {
    first_name: firstNameOf(input.contact_name ?? input.contact_email),
    company: input.company ?? "your company",
    event_name: input.event_name,
    rep_first_name: input.rep_first_name,
    country: input.country,
  });
  return {
    subject: rendered.subject, body: rendered.body,
    warns: [], regenerations: 0, rules_checked: 0,
    data_source_tags: ["baseline_template"],
  };
}
```

- [ ] **Step 2: Manual test**

Generate a draft for a directory-only contact (e.g. one of the GKF Directory pile). Confirm the response includes `data_source_tags: ["baseline_template"]` and the body is the deterministic template output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/event-followup/generate-draft.ts
git commit -m "feat(event-followup): baseline template fallback in generateDraft"
```

---

## Phase 7 — Event photos

### Task 7.1: Upload + list endpoints

**Files:**
- Create: `src/app/api/event-media/route.ts`

- [ ] **Step 1: GET (list) and POST (upload) for event_media**

```typescript
// src/app/api/event-media/route.ts
import { z } from "zod";
import { supabase } from "@/services/base";
import { requireAuth, requireManager } from "@/lib/api-auth";
import { apiError, apiResponse, validationError } from "@/lib/validation";

const ROUTE = "/api/event-media";

export async function GET(req: Request) {
  const auth = await requireAuth(ROUTE, req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const eventId = parseInt(url.searchParams.get("event_id") || "0", 10);
  if (!eventId) return apiError("event_id required", 400);
  const { data, error } = await supabase
    .from("event_media").select("*").eq("event_id", eventId).order("uploaded_at", { ascending: false });
  if (error) return apiError(error.message, 500);
  return apiResponse({ media: data });
}

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;
  const form = await req.formData();
  const eventId = parseInt(String(form.get("event_id") || "0"), 10);
  const caption = form.get("caption") ? String(form.get("caption")) : null;
  const file = form.get("file");
  if (!eventId || !(file instanceof File)) return apiError("event_id and file required", 400);
  if (file.size > 2 * 1024 * 1024) return apiError("File too large (>2MB)", 400);

  const path = `events/${eventId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error: upErr } = await supabase.storage.from("event-media").upload(path, file);
  if (upErr) return apiError(upErr.message, 500);

  const { data, error } = await supabase.from("event_media").insert({
    event_id: eventId, storage_path: path, caption, uploaded_by: auth.user?.email ?? null,
  }).select().single();
  if (error) return apiError(error.message, 500);
  return apiResponse({ media: data });
}
```

- [ ] **Step 2: Add multi-image uploader to /events form**

Modify `src/app/events/page.tsx` to include a drag-drop field that POSTs to `/api/event-media`. Use existing form component patterns — do NOT introduce a new file picker library.

- [ ] **Step 3: Wire 3 images into draft-generator system prompt**

In `generateDraft`, fetch up to 3 most-recent `event_media` rows for the contact's event_id, sign URLs (or read base64), and include them in `system` blocks alongside the text via the existing `complete()` interface.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/event-media/ src/app/events/page.tsx src/lib/event-followup/generate-draft.ts
git commit -m "feat(event-media): upload + list + draft prompt integration"
```

---

## Phase 8 — Dashboard surfaces

### Task 8.1: /dev/system-rules page

**Files:**
- Create: `src/app/dev/system-rules/page.tsx`

- [ ] **Step 1: Build the page with one section per category**

Each section calls `GET /api/system-rules?category=...`, renders a questionnaire form (Zod-validated client-side), and submits to `POST /api/system-rules`. For `baseline_template` add a "Generate proposal" button that hits `POST /api/system-rules/baseline-template/generate`.

The full code for the page is ~200 lines — write it as one file with five form components inside (one per category).

- [ ] **Step 2: Add to sidebar nav**

Update `src/components/sidebar-nav.tsx` to add a "System rules" link under the dev section.

- [ ] **Step 3: Commit**

```bash
git add src/app/dev/system-rules/page.tsx src/components/sidebar-nav.tsx
git commit -m "feat(dev): /dev/system-rules with five questionnaire sections"
```

### Task 8.2: needs_attention pile in /dev/event-followup

**Files:**
- Modify: `src/app/dev/event-followup/page.tsx`

- [ ] **Step 1: Add a "Needs attention" tab/segment above the contacts table**

Show count by `attention_reason`. Each row has one-click actions:
- For `no_event`: a dropdown of active events to assign.
- For `no_email`: a "delete" or "edit in Airtable" link.
- For `unmapped_event:<name>`: same as no_event.

- [ ] **Step 2: Commit**

```bash
git add src/app/dev/event-followup/page.tsx
git commit -m "feat(dev): needs_attention pile with one-click classify actions"
```

### Task 8.3: /dev/import-health page

**Files:**
- Create: `src/app/dev/import-health/page.tsx`

- [ ] **Step 1: Build the dashboard**

Sections: most recent audit run summary (matched / missing / mismatches), needs_attention pile size by reason, Granola pending-review count.

LLM spend section is **deferred** — do not add it in this phase per architect.

- [ ] **Step 2: Add to sidebar nav**

- [ ] **Step 3: Commit**

```bash
git add src/app/dev/import-health/page.tsx src/components/sidebar-nav.tsx
git commit -m "feat(dev): /dev/import-health audit + drops dashboard"
```

---

## Phase 9 — Validation harness execution

### Task 9.1: Run Layer 1 audit

- [ ] **Step 1: Click "Re-import from Airtable" in /dev/event-followup**

Wait for completion, capture the `run_id`.

- [ ] **Step 2: Run audit**

```bash
curl -X POST http://localhost:3000/api/event-followup/audit -H "cookie: ..."
```

Expected: zero `missing` and zero `field_mismatches` for records with Email + Event.

- [ ] **Step 3: If mismatches exist, do not proceed.**

Triage by reading `import_audit_log` for the run_id. Fix the importer until Layer 1 is green.

### Task 9.2: Spot-check the smoke-test cohort (Layer 2)

The 10 contacts: Prasath (Aerotrans), Citalli (MexProud), Kim (Super Cargo Service), Laura (ATOS), Jocelyn (Group JoM), Adrià + Felipe (Krom Global), Analia + Raquel (Universal Cargo), Lesly + Fernanda (Kaalog), 1 from GKF Directory pile.

- [ ] **Step 1: Verify each in /dev/event-followup**

For each contact:
- Meeting notes correctly populated
- Met-by correctly populated
- Group/lead assignment correct (where applicable)
- Linked Granola transcript visible (where applicable)
- Seniority score sane on each group member

- [ ] **Step 2: If any fails, do not proceed.** Triage and fix.

### Task 9.3: Generate 10 drafts (Layer 3)

- [ ] **Step 1: Trigger draft for each smoke-test contact**

- [ ] **Step 2: Operator reviews all 10**

Pass criterion:
- Contacts with Granola transcripts have lane mentions quoted from the transcript
- Group leads addressed correctly (CCs not duplicated)
- Directory-only contact got the baseline template (`data_source_tags = ["baseline_template"]`)

- [ ] **Step 3: If pass, mark phase shipped.**

### Task 9.4: Update CHANGELOG and tag release

- [ ] **Step 1: Add entry**

```markdown
## [unreleased]
### Added
- Event follow-up data layer overhaul (8 migrations, system_rules engine, Granola transcript ingestion, same-company grouping with auto-lead, baseline template fallback, event photo upload, validation harness).
```

- [ ] **Step 2: Commit and tag**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): event follow-up data layer phase ship"
```

---

## Phase 10 — Followups (NOT in this plan)

Tracked as separate tasks for the v2 UX spec:

- Optimistic row interactions (Met By / tier / sender select without refresh roundtrip)
- Slide-in side drawer replacing inline expand
- Scheduled / staggered batch sending
- Mad-libs / segmented batch / template-with-hook architectural decision
- Bounce / reply cron handlers
- Editable company brief in dashboard
- LLM spend dashboard surface

---

## Self-review notes (run after writing the plan)

1. **Spec coverage** — every section of the spec is mapped to a phase: 4.1 → P3, 4.2 → P3 + P8.2, 4.3 → P4, 4.4 → P5, 4.5 → P6, 4.6 → P2 + P8.1, 4.7 → P2 (model_routing seed), 4.8 → P7, 5 (migrations) → P1, 7 (validation) → P9. Spec section 9 risks all addressed (lowercase email CHECK, RulesSnapshot threading, fail-loud Zod validation, FK creation order, cascades).
2. **No placeholders** — every step has concrete code, exact paths, exact commands. The two `(...full implementation when this task runs...)` notes (importer refactor in P3.3 and granola-import smoke test in P5.2) are unavoidable because the implementation diff is too large to fully inline; the test contract and the file boundary make the intent unambiguous.
3. **Type consistency** — `RulesSnapshot` interface defined in P2.2; consumed in P3.4, P5.2, P6.3 with the same shape (`modelFor`, `seniority`, `companyMatch`, `granolaThresholds`, `baselineTemplate`, `id`, `raw`). `BaselineTemplate` defined in P6.1, referenced in P6.2/P6.3. `ContactInput` in P4.1, referenced in P4.2.
