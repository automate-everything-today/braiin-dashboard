-- 050_cost_tracking.sql
--
-- Cost tracking system for the /dev/costs dashboard.
--
-- Three tables:
--   1. feedback.cost_sources    - registry of every cost source (Anthropic,
--                                 Vercel, Supabase, Claude MAX, domains,
--                                 SaaS subscriptions, etc.). Extensible -
--                                 the dashboard can add/remove via the UI.
--   2. feedback.cost_entries    - actual line items per source per period.
--                                 Populated by the live-fetch routes
--                                 (Vercel/Anthropic/Supabase) or by manual
--                                 entry / CSV upload for everything else.
--   3. feedback.work_sessions   - time tracking for the counterfactual
--                                 calculation. Either manually logged at
--                                 session-end or derived from git commit
--                                 timestamps as a fallback.
--
-- FX conversion piggybacks on the existing geo.fx_rates table from
-- migration 039 so we don't duplicate rate fetching.
--
-- Manual: apply once after 049.

CREATE SCHEMA IF NOT EXISTS feedback;
GRANT USAGE ON SCHEMA feedback TO service_role;

-- =============================================================================
-- cost_sources - registry
-- =============================================================================

CREATE TABLE IF NOT EXISTS feedback.cost_sources (
    source_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,

    -- Display name (e.g. "Anthropic API", "Claude MAX 20x", "Vercel Pro")
    name                TEXT NOT NULL,

    -- Vendor identifier - drives which fetcher to call. Free text but
    -- the live-fetch route only knows about: anthropic | vercel | supabase
    -- | github | resend | cloudmailin | microsoft365. Anything else is
    -- treated as manual-only.
    vendor              TEXT NOT NULL,

    -- usage  - operational, scales with traffic (API calls, hosting, etc.)
    -- build  - investment in building (subscriptions, dev tools)
    category            TEXT NOT NULL CHECK (category IN ('usage', 'build')),

    -- manual - operator types it in (or CSV upload)
    -- api    - live-fetched from the vendor's API on a schedule
    provenance          TEXT NOT NULL DEFAULT 'manual'
                        CHECK (provenance IN ('manual', 'api')),

    -- ISO 4217 (e.g. GBP, USD, EUR)
    default_currency    TEXT NOT NULL DEFAULT 'GBP',

    -- For api-provenance: API endpoint or identifier the fetcher uses
    -- (e.g. Vercel project id, Anthropic org id). Free-form JSONB so each
    -- vendor can store what it needs.
    api_config          JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Pro-rating knob for shared subscriptions (Claude MAX especially).
    -- 1.0 = 100% attributed to this project. 0.8 = 80% attributed.
    -- Applied at read time when summing entries.
    pro_rate            NUMERIC(5,4) NOT NULL DEFAULT 1.0
                        CHECK (pro_rate >= 0 AND pro_rate <= 1),

    -- Recurring monthly amount in default_currency. Used to auto-create
    -- monthly entries for subscription-style sources where the API cost
    -- is fixed (e.g. Claude MAX = $200/mo).
    recurring_monthly   NUMERIC(12,2),

    -- When the source started costing money. NULL = "since project start".
    started_at          DATE,
    ended_at            DATE,

    notes               TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_cost_sources_active
    ON feedback.cost_sources (org_id, category, is_active);

DROP TRIGGER IF EXISTS trg_cost_sources_touch ON feedback.cost_sources;
CREATE TRIGGER trg_cost_sources_touch
    BEFORE UPDATE ON feedback.cost_sources
    FOR EACH ROW EXECUTE FUNCTION feedback.touch_updated_at();

-- =============================================================================
-- cost_entries - line items
-- =============================================================================

CREATE TABLE IF NOT EXISTS feedback.cost_entries (
    entry_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    source_id           UUID NOT NULL REFERENCES feedback.cost_sources(source_id) ON DELETE CASCADE,

    -- Period covered by this entry. period_start = first day inclusive,
    -- period_end = last day inclusive. For one-off charges, both equal
    -- the charge date.
    period_start        DATE NOT NULL,
    period_end          DATE NOT NULL,
    period_type         TEXT NOT NULL DEFAULT 'monthly'
                        CHECK (period_type IN ('daily', 'weekly', 'monthly', 'annual', 'one-off')),

    -- Amount in source currency.
    amount              NUMERIC(12,2) NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'GBP',

    -- Cached GBP equivalent at the time the entry was recorded. Filled
    -- by the API or backfilled by the FX-conversion pass. NULL means
    -- "convert on the fly using current fx_rates".
    amount_gbp          NUMERIC(12,2),
    fx_rate_used        NUMERIC(14,8),
    fx_rate_date        DATE,

    description         TEXT,
    raw_payload         JSONB,

    -- Provenance trail
    fetched_at          TIMESTAMPTZ,
    fetched_by_email    TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Idempotency: same source + same period = same entry. Re-fetching
    -- updates rather than duplicates.
    UNIQUE (source_id, period_start, period_end, period_type)
);

CREATE INDEX IF NOT EXISTS idx_cost_entries_period
    ON feedback.cost_entries (org_id, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_cost_entries_source_period
    ON feedback.cost_entries (source_id, period_start DESC);

DROP TRIGGER IF EXISTS trg_cost_entries_touch ON feedback.cost_entries;
CREATE TRIGGER trg_cost_entries_touch
    BEFORE UPDATE ON feedback.cost_entries
    FOR EACH ROW EXECUTE FUNCTION feedback.touch_updated_at();

-- =============================================================================
-- work_sessions - time tracking for the counterfactual
-- =============================================================================

CREATE TABLE IF NOT EXISTS feedback.work_sessions (
    session_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,

    started_at          TIMESTAMPTZ NOT NULL,
    ended_at            TIMESTAMPTZ,
    duration_minutes    INTEGER GENERATED ALWAYS AS (
        CASE
            WHEN ended_at IS NULL THEN NULL
            ELSE EXTRACT(EPOCH FROM (ended_at - started_at)) / 60
        END
    ) STORED,

    -- Free-text identifier for the project. Default 'braiin-dashboard'
    -- so future use across multiple projects naturally splits.
    project             TEXT NOT NULL DEFAULT 'braiin-dashboard',

    notes               TEXT,

    -- manual              - operator clicked Start/Stop or pasted a duration
    -- auto-from-commits   - inferred from git commit timestamps
    -- claude-mem          - imported from claude-mem session export
    source              TEXT NOT NULL DEFAULT 'manual'
                        CHECK (source IN ('manual', 'auto-from-commits', 'claude-mem')),

    -- Per-session attribution split. Default 100% to this project for
    -- explicit logs; auto-from-commits sessions might be < 1 if multiple
    -- repos saw activity in the same window.
    project_attribution NUMERIC(5,4) NOT NULL DEFAULT 1.0
                        CHECK (project_attribution >= 0 AND project_attribution <= 1),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_sessions_recent
    ON feedback.work_sessions (org_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_work_sessions_project
    ON feedback.work_sessions (org_id, project, started_at DESC);

-- =============================================================================
-- counterfactual_assumptions - tunable knobs for the team-cost comparison
-- =============================================================================

CREATE TABLE IF NOT EXISTS feedback.counterfactual_scenarios (
    scenario_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,

    name                TEXT NOT NULL,
    description         TEXT,

    -- Headcount and roles
    team_size           NUMERIC(4,2) NOT NULL,
    roles               JSONB NOT NULL,                     -- e.g. [{role: "PM", count: 1, day_rate_gbp: 800}, ...]

    -- Day rate basis (UK loaded / London agency / US)
    region              TEXT NOT NULL,

    -- Velocity multiplier: a traditional team would have shipped how many
    -- working days for the same scope as your actual elapsed days.
    -- e.g. 7.0 = "what took you 1 day would take a 5-person team 7 days."
    velocity_multiplier NUMERIC(6,2) NOT NULL DEFAULT 5.0,

    -- Working days per month assumption (default 21).
    working_days_per_month INTEGER NOT NULL DEFAULT 21,

    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    is_default          BOOLEAN NOT NULL DEFAULT FALSE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_counterfactual_scenarios_active
    ON feedback.counterfactual_scenarios (org_id, is_active);

DROP TRIGGER IF EXISTS trg_counterfactual_scenarios_touch ON feedback.counterfactual_scenarios;
CREATE TRIGGER trg_counterfactual_scenarios_touch
    BEFORE UPDATE ON feedback.counterfactual_scenarios
    FOR EACH ROW EXECUTE FUNCTION feedback.touch_updated_at();

-- =============================================================================
-- Grants (service role only - this is sensitive financial data)
-- =============================================================================

REVOKE ALL ON feedback.cost_sources                 FROM PUBLIC;
REVOKE ALL ON feedback.cost_entries                 FROM PUBLIC;
REVOKE ALL ON feedback.work_sessions                FROM PUBLIC;
REVOKE ALL ON feedback.counterfactual_scenarios     FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON feedback.cost_sources               TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON feedback.cost_entries               TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON feedback.work_sessions              TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON feedback.counterfactual_scenarios   TO service_role;
