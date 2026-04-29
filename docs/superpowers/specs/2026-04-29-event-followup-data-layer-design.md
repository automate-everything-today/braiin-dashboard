# Event follow-up data layer — design spec

**Date:** 2026-04-29
**Author:** Claude (Opus 4.7) brainstorm with Rob Donald
**Status:** Draft, revised after architect + database-reviewer review and cross-repo grep. Pending final user approval.

**Review notes:**
- `architect` agent flagged 6 blocker risks and 7 simplifications (applied inline below).
- `database-reviewer` agent flagged the `follow_up_status` CHECK constraint shape, indexing gaps, RLS concerns, and circular FK creation order (applied inline in section 5).
- Cross-repo grep across `connect-app`, `Outreach`, `Outreach-Account-Profiles`, `rate-engine`, `engiine` returned **zero** consumers of `event_contacts`. All references live within the dashboard repo's event-followup module. No external coordination needed.
**Successor spec:** Event follow-up v2 UX (mad-libs / segments / scheduled sends / slide-in editor / optimistic interactions). Written separately once data layer is shipped and verified.

---

## 1. Problem and context

Current state of `/dev/event-followup`:

- 452 records in Airtable "Networking - Follow ups" base, table `Contacts` (`appDiP9IKunUqdPl1` / `tblMriM6Fox1AatVR`).
- Of 200 records sampled (page 1):
  - 195 have email
  - 153 have an `Event` tag (multipleSelects)
  - 153 have `Met By` populated
  - 113 have meeting notes
  - 0 have `Priority` set
- 47 records on page 1 have non-empty meeting notes / company info but **no `Event` tag**, so the importer drops them silently. These are predominantly "same company as X" colleague entries Rob has been adding for CC routing.
- The `Met By` distribution shows zero entries for Sam — either Sam hasn't tagged anyone or the contacts he met haven't been logged.
- Granola has 26+ recordings on Apr 12-16 covering Sao Paulo events; titles align with named Airtable contacts (Prasath, Kim, Citalli, Laura/Atos, Jocelyn, Crasta, Greta Dancourt, Dolrich, Genesis, Lisbeth GSL, Marcelo Flexiexpress, Rafaela Beduschi, Eduardo and Mathis, Susan Sunny Worldwide, Ferse, Arshad, Nevin Kaya, Dayana, Jimin Noordin, Alison Rodriguez, Dinesh-TMT, Kirsten Flynn, GLI Andres Ramos). The current pipeline does not ingest these transcripts.
- Rob's review burden is currently ~30s per contact across ~360 importable rows = ~3 hours per event. The cause is per-contact bespoke draft generation regardless of how thin the source material is.

This spec covers the **data layer fixes only**. The UX redesign that solves the per-contact review burden is deliberately a separate, downstream spec.

---

## 2. Goals

1. The dashboard accurately reflects what's in Airtable and Granola — no silent drops, no missing fields.
2. Same-company colleagues are grouped, with a system-picked lead and operator-overridable assignment.
3. Granola transcripts are first-class source material for draft generation, preferred over Airtable free-text notes when both exist.
4. When no enrichment exists for a contact, the system falls back to an operator-approved baseline template — no LLM speculation, no fabricated meeting context.
5. All matching/scoring/threshold/template/model-routing rules are operator-configurable through questionnaires, not hardcoded.
6. Cheap models (Haiku) handle classification/matching; expensive models (Sonnet) handle writing. Routing is configurable.
7. A validation harness proves Airtable → DB integrity for every named contact in a smoke-test cohort. Phase doesn't ship until the harness is green.

---

## 3. Non-goals (deferred to v2 UX spec)

- Mad-libs / segment / template-batch redesign of the draft flow
- Slide-in side drawer (replaces inline expand)
- Optimistic row interactions (Met By / tier / sender select without refresh roundtrip)
- Scheduled / staggered batch sending
- Bounce / reply cron handlers (already noted as v1 gaps)
- Multi-language template variants (English-only baseline templates in this phase; Bruna's PT-BR voice continues to operate on bespoke drafts)

---

## 4. Scope items (the seven things we ship)

### 4.1 Importer audit and fix

- New table `import_audit_log` records the outcome of every record processed during an import: which fields were present in the Airtable source, which landed in `event_contacts`, and the reason for any drop.
- Importer continues to upsert `event_contacts` keyed on `(email, event_id)` but stops dropping records — see 4.2.
- Field map verification:

  | Airtable field | DB column | Notes |
  |---|---|---|
  | Name | name | |
  | Title | title | drives `seniority_score` |
  | Company | company | drives `company_groups` canonicalisation |
  | Email | email | required, lowercased |
  | Phone | phone | |
  | Website | website | |
  | Country | country | |
  | Region | region | |
  | Event | event_id | required; rows without an event tag land in the `needs_attention` pile per 4.2 |
  | Met By | met_by[] | raw, includes "GKF Directory"/"Business Card" |
  | Internal CC | internal_cc | |
  | Contact Role | contact_role | overridden by group lead logic |
  | Lead Contact | is_lead_contact | tie-breaker for group lead |
  | Priority | tier | currently 0% populated; not an importer bug |
  | Company Type | company_type | |
  | Company Info | company_info | |
  | Meeting Notes | meeting_notes | also tagged in `data_source_tags` if non-empty |

**Auto-event-assignment cut (per architect review).** Earlier draft proposed auto-attributing records with no Event tag if exactly one active recent event existed. Cut: it's a heuristic that fires on a data-quality bug and would be silently wrong some of the time. All such records land as `needs_attention:no_event` and the operator one-click assigns from the dashboard.

### 4.2 Surface dropped records as `needs_attention`

- New `follow_up_status` value: `needs_attention`.
- New column `attention_reason` (TEXT, nullable): `no_email` / `no_event` / `unmapped_event:<name>` / `lead_lost` (the contact was a `company_groups.lead_contact_id` but disappeared on a re-import — see 4.3).
- Records that previously got dropped now land in `event_contacts` with `follow_up_status = 'needs_attention'` and the appropriate `attention_reason`.
- Dashboard adds a "Needs attention" pile to `/dev/event-followup` showing those records, with one-click classify actions (assign event, mark as junk, edit in Airtable).

### 4.3 Same-company grouping with auto-lead by seniority

- New table `company_groups` (one row per `(event_id, company_canonical)`).
- New column on `event_contacts`: `company_group_id` (nullable FK to `company_groups.id`, `ON DELETE SET NULL`).
- New column on `event_contacts`: `seniority_score` (integer 0-100, computed from job title at import time per `system_rules.seniority_score`; persisted, not derived, so manual overrides stick).
- **Records with NULL event_id are skipped from grouping** (they sit in `needs_attention` until classified — `company_groups` is unique on `(event_id, company_canonical)` so cannot accept NULL).
- After upsert, the importer runs a group-detection pass:
  1. Group `event_contacts` rows for that event by canonical company name (canonicalisation rules read from `system_rules.company_match`).
  2. Where ≥2 contacts share a canonical company, create a `company_groups` row.
  3. Set `lead_contact_id` to the highest-`seniority_score` contact. Tie-break on Airtable `is_lead_contact = true`. Last resort: alphabetical first name.
  4. Set the lead's `contact_role = 'to'`. Other group members default to `contact_role = 'cc'`.
  5. **Lead-override-aware re-import:** if `company_groups.lead_overridden_at IS NOT NULL`, skip auto-lead computation for that group entirely. Manual overrides survive every re-import.
- `company_groups.lead_contact_id` FK uses `ON DELETE SET NULL` (avoids blocking deletes of contacts who are leads). When a re-import sets `lead_contact_id = NULL` on a group with `lead_overridden_at IS NOT NULL`, the group is flagged: any `event_contacts` row in that group gets `attention_reason = 'lead_lost'` so the operator notices and re-elects.
- **Lead-swap draft handling (pure option B, confirmed by Rob):** when a contact's role changes from lead to CC, **all existing drafts are left untouched** — sent, unsent, drafted, reviewed, all preserved. The UI surfaces a flag on the contact card: "this contact was the lead for [company] but is now a CC on [new lead]'s draft. Review and cancel/keep." Operator decides per-contact whether to send the existing draft, edit it, or cancel it. The architect-recommended "clear unsent drafts" refinement was considered and rejected — Rob's instinct is that draft work should never be silently destroyed and the operator-decides-per-contact path is the right one.

### 4.4 Granola transcript ingestion

- New table `granola_meetings`:
  - `id` (Granola UUID, primary key)
  - `title` (TEXT)
  - `recorded_at` (TIMESTAMPTZ)
  - `transcript` (TEXT)
  - `summary` (TEXT, nullable; the Granola-generated structured notes if available)
  - `participants` (JSONB)
  - `imported_at` (TIMESTAMPTZ, default now())
- New join table `event_contact_granola_links`:
  - `event_contact_id` (FK to `event_contacts(id)`, `ON DELETE CASCADE`)
  - `granola_meeting_id` (FK to `granola_meetings(id)`, `ON DELETE CASCADE`)
  - `match_confidence` (integer 0-100)
  - `match_method` (TEXT: `name_exact` / `name_fuzzy` / `name_and_date` / `manual` / `pending_review`)
  - `created_at`
  - Composite primary key on `(event_contact_id, granola_meeting_id)`.
  - Cascade behaviour: deleting a contact or a meeting removes any orphan links. Re-imports must NOT delete-and-recreate `event_contacts` (and the current importer doesn't — it upserts on `(email, event_id)` per migration 060). This invariant is pinned in the spec; any future importer change must preserve it or links are lost.
- Many-to-many because a single recording can cover multiple contacts ("Eduardo and Mathis") and a contact can have multiple recordings.
- Ingestion step `importGranolaMeetings(eventId)` runs after `event_contacts` upsert:
  1. Query Granola for meetings within the event's date window ± a configurable buffer (`system_rules.granola_match.date_buffer_days`).
  2. Upsert each meeting into `granola_meetings`.
  3. For each meeting, attempt to match it to one or more contacts at the event:
     - `name_exact`: full name match
     - `name_fuzzy`: token-overlap match (Haiku-assisted only when rule-based confidence is ambiguous)
     - `name_and_date`: name match plus recording date within 24h of the contact's first interaction
  4. If `match_confidence >= auto_link_threshold` (default 80), insert a `event_contact_granola_links` row with the computed method.
  5. If `review_floor <= match_confidence < auto_link_threshold` (default 50-80), insert with `match_method = 'pending_review'` and surface a "review these matches" banner on `/dev/event-followup`.
  6. Below `review_floor`, no link.
- Draft generator pulls the linked Granola transcript when present and includes it in the user prompt as the primary source, preferring it over Airtable `meeting_notes` (Airtable notes become a secondary signal).

### 4.5 Baseline email template fallback

- A contact with no Granola transcript, no meeting notes, and no actionable company info qualifies as a `baseline-template` send.
- Template is **authored once** with Sonnet's help via the questionnaire on `/dev/system-rules` (see 4.6) and stored in `system_rules.baseline_template.<slot_key>` keyed by `(language, tier_band)`. Per architect review — `event_id` cut from the key for v1: it created an explosion where every new event needed a new authored template before first send. A single per-`(language, tier_band)` template is reused across events, with the event's name interpolated as a placeholder.
- Template uses simple placeholders: `{first_name}`, `{company}`, `{event_name}`, `{rep_first_name}`, optional `{country_hook}`.
- At send time, rendering is **deterministic** — no LLM call, near-zero latency, near-zero cost.
- Drafts produced via this path get `data_source_tags` flagged with `baseline_template` and a UI badge "from baseline template" so the operator knows which contacts got the lite treatment.

### 4.6 Questionnaire-driven rule engine

- New table `system_rules`:
  - `id`
  - `category` (TEXT)
  - `key` (TEXT)
  - `value` (JSONB) with `CHECK (jsonb_typeof(value) = 'object')` per database-reviewer
  - `previous_value` (JSONB, nullable) — set on every save to the prior `value`. One-step undo. Per architect simplification — full version history was overkill for ~10-20 rules edited a few times a year.
  - `notes` (TEXT, nullable)
  - `active` (BOOLEAN, default true)
  - `updated_at`, `updated_by`
  - Unique constraint on `(category, key)` (no `version` in the key — only one current row per category/key, plus a single previous_value snapshot).
- Categories shipped in this phase:
  - `seniority_score`: title→score weight mapping
  - `company_match`: canonicalisation rules (suffix tokens, punctuation handling, equivalence aliases)
  - `granola_match`: thresholds (`auto_link_threshold`, `review_floor`, `date_buffer_days`)
  - `baseline_template`: per-slot template text + variable list
  - `model_routing`: per-task model assignment (see 4.7)
- New page `/dev/system-rules` — one section per category, each driven by a questionnaire that writes back to `system_rules`. Defaults shipped via seed migration so the system works out of the box.
- Importer and draft generator call `loadSystemRule(category, key)` instead of using hardcoded constants. **Per-run snapshot** (not just per-call cache): at the start of an import or batch-draft run, the orchestrator snapshots all required rules into a `RulesSnapshot` object that is threaded through the call chain. `import_audit_log.rules_snapshot` (JSONB) and `llm_call_log.rules_snapshot_id` (FK or UUID) record the exact rules each run used, so editing rules mid-batch can never cause split-batch behaviour silently. Per architect blocker risk 5.

#### 4.6.1 Questionnaire shapes

**Seniority score:**
- Which titles count as the most senior decision-makers? (multi-tag input → score 95-100)
- Which count as senior managers? (→ 70-85)
- Which are individual contributors / coordinators? (→ 30-50)
- Default for unknown title? (slider 10-30)

**Company match:**
- Suffix tokens to strip when canonicalising (chip input; defaults: Ltd, Inc, SA, SAS, SL, GmbH, Group, Logistics, Cargo, Shipping, Worldwide, International)
- Treat `&` and `and` as equivalent? (toggle, default yes)
- Strip punctuation? (toggle, default yes)

**Granola match:**
- Auto-link confidence floor (slider 70-95, default 80)
- Review-pile range (sliders, default 50-80)
- Date-proximity window in days (number, default ±2)

**Baseline template:**
- Pick a slot: language / tier band (event is interpolated at render time, not part of the slot key)
- Greeting opener (free text, default `Hi {first_name}`)
- One-line ask when no other context (default `If there's a specific lane or service you're working on, send it through and we will take a look.`)
- Sign-off phrase (default `Best regards`)
- Include optional country-hook line? (toggle)
- Length cap in lines (number, default 4)
- "Generate draft template" → Sonnet receives questionnaire answers, active voice rules, Corten company brief, selected rep voice notes, event photos (per 4.8), returns a proposed template
- Operator reviews, edits, approves; stored in `system_rules.baseline_template.<slot_key>`

**Model routing:**
- For lightweight classification (seniority parsing, name matching), which model? (dropdown Haiku / Sonnet / Opus, default Haiku)
- For drafting customer-facing emails, which model? (dropdown, default Sonnet)
- For high-stakes writing (Tier-A bespoke), promote to Opus? (toggle, default off)

### 4.7 Model routing

- Defaults shipped in `system_rules.model_routing`:

  | Task | Default model | Rationale |
  |---|---|---|
  | Seniority score from job title | `claude-haiku-4-5` | Tiny classification |
  | Company canonicalisation (LLM-assist on edge cases only) | `claude-haiku-4-5` | Rule-based first, LLM as tiebreaker |
  | Granola → contact name matching | `claude-haiku-4-5` | Fuzzy classification |
  | Already-engaged scan summarisation | `claude-haiku-4-5` | Per-contact one-line summary |
  | Draft email generation (bespoke path) | `claude-sonnet-4-6` | Quality-critical writing |
  | Voice lint regenerate | `claude-sonnet-4-6` | Same model fixes its own output |
  | Baseline template **authoring** (one-time) | `claude-sonnet-4-6` | Template gets reused, quality goes in once |
  | Baseline template **rendering** (every send) | none | Deterministic substitution, no LLM call |

- Every LLM call is tagged with `task` and `model` and logged to `llm_call_log` (table created in this phase if it doesn't already exist). Tokens and cost estimates included.
- `/dev/import-health` displays last-7-days LLM spend by task so the operator can see where budget goes.

### 4.8 Event photo upload (Section 2.6 in brainstorm; consolidated here)

- New Supabase Storage bucket `event-media`.
- New table `event_media`:
  - `id`
  - `event_id` (FK)
  - `storage_path` (TEXT)
  - `caption` (TEXT, nullable; operator-typed)
  - `uploaded_at`, `uploaded_by`
- `/events` form gains a multi-image drag-drop uploader.
- Draft generator pulls up to 3 most-recent / captioned images for the contact's event and includes them in the system prompt as base64, marked `cacheControl: 'ephemeral'` so a batch run amortises the cost.
- Dashboard contact editor shows the same images in a collapsed "event context" strip at the top of the editor pane.
- Hard cap: 3 images per event in v1, ≤2 MB each. Beyond that we'd need to think about resizing pipeline; not in scope.

---

## 5. Data model summary (consolidated migration list)

Migration numbers TBD by next available slot; current head is 060. Order matters — the FK between `event_contacts.company_group_id` and `company_groups.id` is circular with `company_groups.lead_contact_id` and `event_contacts.id`, so creation must be staged.

### 5.1 Migration `061_event_contacts_data_layer_extensions.sql`

```sql
-- Additive columns on event_contacts.
ALTER TABLE event_contacts ADD COLUMN seniority_score INTEGER
  CHECK (seniority_score IS NULL OR (seniority_score BETWEEN 0 AND 100));
ALTER TABLE event_contacts ADD COLUMN data_source_tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE event_contacts ADD COLUMN attention_reason TEXT;
ALTER TABLE event_contacts ADD COLUMN company_group_id INTEGER;  -- FK added in 062

-- Lowercase email invariant (architect blocker 1).
ALTER TABLE event_contacts ADD CONSTRAINT event_contacts_email_lowercase
  CHECK (email = lower(email));

-- Drop and recreate the follow_up_status CHECK to add 'needs_attention'.
-- Use the migration 060 pattern: DO block with name lookup (constraint name
-- is auto-generated by Postgres, do not assume it).
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

-- Composite index for the dominant query: list contacts for an event,
-- ordered by tier then name (per database-reviewer).
CREATE INDEX IF NOT EXISTS event_contacts_event_tier_name_idx
  ON event_contacts (event_id, tier, name);
```

### 5.2 Migration `062_company_groups.sql`

```sql
CREATE TABLE company_groups (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  company_name_canonical TEXT NOT NULL,
  lead_contact_id INTEGER REFERENCES event_contacts(id) ON DELETE SET NULL,
  lead_overridden_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, company_name_canonical)
);

-- Add the FK from event_contacts.company_group_id now that company_groups exists.
ALTER TABLE event_contacts
  ADD CONSTRAINT event_contacts_company_group_id_fkey
  FOREIGN KEY (company_group_id) REFERENCES company_groups(id) ON DELETE SET NULL;

-- Partial index — most contacts are not in groups, so a sparse index is far cheaper.
CREATE INDEX IF NOT EXISTS event_contacts_company_group_idx
  ON event_contacts (company_group_id) WHERE company_group_id IS NOT NULL;
```

### 5.3 Migration `063_granola_ingestion.sql`

```sql
CREATE TABLE granola_meetings (
  id UUID PRIMARY KEY,                 -- Granola UUID, set by importer
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

-- RLS: transcripts are personally sensitive (database-reviewer recommendation).
ALTER TABLE granola_meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY granola_meetings_authenticated_read ON granola_meetings
  FOR SELECT USING ((SELECT auth.role()) = 'authenticated');

ALTER TABLE event_contact_granola_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY granola_links_authenticated_read ON event_contact_granola_links
  FOR SELECT USING ((SELECT auth.role()) = 'authenticated');
```

### 5.4 Migration `064_event_media.sql`

```sql
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

-- Storage bucket creation: handled separately. This migration assumes the
-- 'event-media' bucket has been created via Supabase Studio with policies
-- restricting upload to manager+ roles.
```

### 5.5 Migration `065_system_rules.sql`

```sql
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

-- Partial index on active=true (database-reviewer): the dominant query is
-- "fetch active rules for this category" and most rules will stay active.
CREATE INDEX IF NOT EXISTS system_rules_category_active_idx
  ON system_rules (category) WHERE active = true;

ALTER TABLE system_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY system_rules_authenticated_read ON system_rules
  FOR SELECT USING ((SELECT auth.role()) = 'authenticated');
-- Writes governed by the API layer (requireManager); RLS write policies
-- can be tightened later if direct PostgREST writes become a concern.
```

### 5.6 Migration `066_seed_system_rules_defaults.sql`

Seed `seniority_score`, `company_match`, `granola_match`, `model_routing` with sensible defaults so the system works out of the box. `baseline_template` rows left empty until operator runs the questionnaire.

### 5.7 Migration `067_import_audit_log.sql`

```sql
CREATE TABLE import_audit_log (
  id BIGSERIAL PRIMARY KEY,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  airtable_record_id TEXT,
  result TEXT NOT NULL,                 -- 'imported' | 'skipped:no_email' | 'skipped:no_event' | 'error:<msg>'
  fields_present TEXT[] NOT NULL DEFAULT '{}',
  fields_landed TEXT[] NOT NULL DEFAULT '{}',
  rules_snapshot JSONB,                 -- snapshot of system_rules used by this import run (architect blocker 5)
  run_id UUID                           -- groups all rows from one import invocation
);

CREATE INDEX IF NOT EXISTS import_audit_run_idx
  ON import_audit_log (run_id);
CREATE INDEX IF NOT EXISTS import_audit_airtable_idx
  ON import_audit_log (airtable_record_id);
```

### 5.8 Migration `068_llm_call_log.sql` (if not already present)

```sql
CREATE TABLE IF NOT EXISTS llm_call_log (
  id BIGSERIAL PRIMARY KEY,
  called_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  task TEXT NOT NULL,                   -- 'draft' | 'seniority_score' | 'granola_match' | etc.
  model TEXT NOT NULL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost_estimate_pence INTEGER,
  contact_id INTEGER REFERENCES event_contacts(id) ON DELETE SET NULL,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  rules_snapshot_id UUID                -- ties to import_audit_log.run_id when applicable
);
```

All migrations are additive — no DROP TABLE, no destructive data backfill. The `follow_up_status` CHECK is dropped and recreated, but that's a constraint reshape, not data destruction.

---

## 6. API surface additions

- `GET /api/event-followup/audit?event_id=` — returns the latest field-by-field audit diff (Section 7.1).
- `POST /api/event-followup/audit?event_id=` — runs a fresh audit and returns the result.
- `POST /api/event-followup/import` — existing endpoint, extended to write `import_audit_log` rows and to perform the audit (4.1), surface drops as `needs_attention` (4.2), run group-detection (4.3), and trigger Granola ingestion (4.4).
- `GET /api/system-rules?category=` — list rules in a category.
- `PATCH /api/system-rules/:id` — update a rule.
- `POST /api/system-rules/baseline-template/generate` — runs the Sonnet authoring step for a baseline template slot.
- `GET /api/event-media?event_id=` — list event media.
- `POST /api/event-media` — multipart upload, returns storage_path + signed read URL.

All endpoints follow the existing auth pattern: `requireAuth` for reads, `requireManager` for writes.

---

## 7. Validation plan

The phase does not ship until all three layers below pass.

### 7.1 Layer 1 — Field-by-field audit (automated)

Endpoint `/api/event-followup/audit` performs a one-way diff Airtable → DB:
- For each Airtable record with a non-empty Email AND non-empty Event, verify `event_contacts` has a row with the same `(email, event_id)`.
- For each verified row, diff every mapped field listed in 4.1.
- Output: `{ matched: N, missing: [airtable_record_ids], field_mismatches: [{ airtable_id, field, airtable_value, db_value }] }`.
- Result is persisted to `import_audit_log` and surfaced on `/dev/event-followup` as a "Last audit: X mismatches" banner.

**Pass criterion:** zero `missing` and zero `field_mismatches` for records with Email + Event.

### 7.2 Layer 2 — Smoke-test cohort (manual sign-off)

A named list of 10 contacts to spot-check after each importer run:
- **Tier-A with rich notes:** Prasath (Aerotrans), Citalli (MexProud), Kim (Super Cargo), Laura (ATOS), Jocelyn (Group JoM)
- **Same-company colleague pairs:** Adrià + Felipe Caicedo (Krom Global), Analia + Raquel (Universal Cargo), Lesly + Fernanda (Kaalog)
- **Granola-recorded:** Prasath, Kim, Citalli, Laura/Atos
- **Directory-only:** any 1 from the GKF Directory pile

For each, the dashboard editor must show: full meeting notes, correct met-by, correct group/lead assignment, linked Granola transcript (if applicable), correct seniority score on each group member.

**Pass criterion:** all 10 contacts pass operator inspection.

### 7.3 Layer 3 — End-to-end draft test

Once 7.1 and 7.2 are green, generate drafts for the smoke-test cohort using the new system_rules-driven model routing, Granola transcripts where linked, and baseline template fallback for the directory-only contact.

**Pass criterion:** operator reads all 10 drafts and confirms they:
- Quote real lane mentions from Granola where available
- Address the right lead in groups
- Do not fabricate context for directory-only contacts (those use baseline template)

### 7.4 Telemetry shipped alongside

- `import_audit_log` populated on every import.
- `llm_call_log` populated on every LLM call.
- New `/dev/import-health` page surfaces:
  - Most recent audit results (count of mismatches, drilldown link)
  - `needs_attention` pile size by reason
  - Granola pending-review queue size

**Cut from this phase (per architect):** the "last-7-days LLM spend by task / model" view. The data is logged to `llm_call_log`, but the dashboard surface is deferred to v2 — no current stakeholder ask for it and it's pure feature creep in this scope.

---

## 8. Definition of done

1. Layer 1 audit reports zero missing and zero field_mismatches for records with Email + Event.
2. Layer 2 smoke-test cohort all show correct data in the dashboard editor.
3. Layer 3 ten generated drafts pass operator review.
4. `/dev/system-rules` is functional with all five rule categories editable.
5. `/dev/import-health` exists and surfaces audit + dropped-record + cost data.
6. CHANGELOG updated.
7. No regression in v1 send / scan / draft endpoints.

---

## 9. Risks and tradeoffs

- **Granola match false positives.** A meeting titled "Kim" could match either Kim Lee at Super Cargo or a different Kim. Mitigation: confidence threshold + review pile; `match_method` tracked so operator can audit.
- **JSONB schema drift in `system_rules.value`.** Without per-category Zod schemas, runtime failures on malformed rules. **Mitigation (per architect blocker 6 + user `feedback_error_handling.md`): fail loud, never silent fallback.** Every consumer `loadSystemRule` call validates against a category-specific Zod schema. On validation failure the import or draft run **aborts with a visible error on `/dev/import-health`**. No auto-fallback — silent degradation is forbidden by repo convention. DB-layer guard: `CHECK (jsonb_typeof(value) = 'object')` catches scalar-vs-object mistakes (database-reviewer).
- **Mid-batch rule changes causing split-batch behaviour.** Editing `model_routing` while a 50-draft batch is in flight could split the batch across two models silently. Mitigation: per-run `RulesSnapshot` (section 4.6) — the orchestrator captures all relevant rules at run start, threads them through the call chain, and stamps `import_audit_log.rules_snapshot` + `llm_call_log.rules_snapshot_id` so every call within a run is traceable to the exact rules version it used.
- **Sonnet template authoring drift.** A regenerated template might produce subtly different copy than the previous version. Mitigation: `system_rules` versions are retained; rollback is one click in `/dev/system-rules`.
- **Photo cost.** Three images per event prompt at full price ≈ ~4500 tokens; with ephemeral caching on a 50-draft batch this amortises cleanly, but a single one-off draft hours later pays full cost. Mitigation: cap at 3 images and document the cost shape.
- **Lead override semantics on re-import.** If `lead_overridden_at` is set, importer must skip the auto-lead computation for that group. Tested by the smoke-test cohort.
- **Rule-engine performance.** Reading `system_rules` once per import/draft run is fine; reading per-record would not be. Implementation must cache for the run duration.

---

## 10. Open questions for review

1. Should `import_audit_log` retention be capped (e.g. last 90 days) or unbounded? Current default: unbounded; we revisit if it grows past 100k rows.
2. Should the baseline template authoring questionnaire produce a single template, or three variants the operator picks from? Current spec: single, regenerate to iterate.

**Resolved:** Lead-swap draft handling — Rob confirmed pure option B (leave all drafts alone, operator decides per contact). See section 4.3.

---

## Appendix A — Out-of-scope items deferred to v2 UX spec

These were raised during the brainstorm but explicitly belong to the UX phase:

- Mad-libs / segmented batch / template-with-hook architectural decision (option A/B/C/D from the v1 brainstorm note)
- Slide-in side drawer replacing the inline expand
- Optimistic row interactions on Met By / tier / sender select
- Scheduled / staggered batch sends with throttling
- Bounce / reply cron handlers
- Editable company brief in dashboard

These get their own design spec once this data layer is verified.
