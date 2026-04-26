-- ============================================================
-- 021_core_foundation.sql
-- Multi-tenant + module foundation. Sets up the architectural
-- boundaries that let every later migration be commercially
-- modular: each freight module (Rates / Quote / Pulse / CRM /
-- Inbox / Tasks) lives in its own Postgres schema and is gated
-- per organisation by a feature flag.
--
-- Corten Logistics is "tenant zero" - seeded here so existing
-- migrations and dashboard data continue to work unchanged
-- (every existing public.* row implicitly belongs to Corten).
--
-- The org_id column is added to NEW freight-engine tables from
-- migration 022 onwards. Existing public.* tables (email_classi-
-- fications, tasks, companies, etc.) get retrofitted in a later
-- migration once the new modules are stable.
--
-- RLS posture: same as migrations 018 / 020. Tables enable RLS,
-- revoke anon + authenticated, and rely on the service-role API
-- path for org-scoped reads/writes. Application layer enforces
-- session.org_id filter on every query. RLS is defence in depth.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SCHEMA IF NOT EXISTS core;

-- ============================================================
-- core.organisations
-- One row per paying customer. Corten is tenant zero (seeded).
-- ============================================================
CREATE TABLE core.organisations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug            TEXT NOT NULL UNIQUE,            -- url-safe identifier e.g. 'corten-logistics'
    name            TEXT NOT NULL,                   -- display name
    status          TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','suspended','trial','churned')),
    plan_tier       TEXT NOT NULL DEFAULT 'internal'
                        CHECK (plan_tier IN ('internal','free','starter','growth','enterprise')),
    primary_country CHAR(2),
    home_currency   CHAR(3) NOT NULL DEFAULT 'GBP',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Free-form org-level settings (logo url, theme, signature defaults...)
    settings        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_org_status ON core.organisations (status);

-- Seed Corten as tenant zero. The fixed UUID lets later migrations
-- reference it deterministically when retrofitting existing data.
INSERT INTO core.organisations (id, slug, name, plan_tier, primary_country, home_currency)
VALUES (
    '00000000-0000-0000-0000-000000000001'::UUID,
    'corten-logistics',
    'Corten Logistics',
    'internal',
    'GB',
    'GBP'
);

-- ============================================================
-- core.branches
-- A tenant has 1..N branches. Used for ownership of accounts,
-- rate cards, quotes, deals. Aligns with the existing staff
-- model where reps belong to a branch.
-- ============================================================
CREATE TABLE core.branches (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    code            TEXT NOT NULL,                   -- short code e.g. 'LON', 'MAN'
    name            TEXT NOT NULL,
    country         CHAR(2),
    parent_branch_id UUID REFERENCES core.branches(id),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, code)
);

CREATE INDEX idx_branches_org ON core.branches (org_id, is_active);

-- ============================================================
-- core.module_features
-- Per-org module flags. Drives nav + page guards in the dashboard:
-- a tenant on the "Sales" pack sees Inbox + CRM + Quote in nav,
-- and the Pulse / Rates routes return 403.
--
-- module_key matches the schema name (rates, quotes, commercial,
-- crm, inbox, tasks). This keeps DB schema, API prefix, UI route
-- and feature flag aligned end-to-end.
-- ============================================================
CREATE TABLE core.module_features (
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    module_key      TEXT NOT NULL,                   -- 'rates' | 'quotes' | 'commercial' | 'crm' | 'inbox' | 'tasks'
    enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    -- Per-module config (e.g. rate ingestion gate thresholds, quote pdf template)
    settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled_at      TIMESTAMPTZ,
    enabled_by      TEXT,                            -- operator who turned it on
    PRIMARY KEY (org_id, module_key)
);

-- Corten gets every module on by default so existing functionality
-- keeps working as the modules come online.
INSERT INTO core.module_features (org_id, module_key, enabled, enabled_at)
SELECT '00000000-0000-0000-0000-000000000001'::UUID, m, TRUE, NOW()
FROM (VALUES ('inbox'),('tasks'),('crm'),('rates'),('quotes'),('commercial')) AS modules(m);

-- ============================================================
-- core.staff_org_membership
-- Links the existing public.staff table to organisations + branches
-- and assigns role hierarchy. Multiple memberships per staff row
-- supports the "consultant for two orgs" case if it ever arises;
-- for Corten today every staff row gets one row here.
-- ============================================================
CREATE TABLE core.staff_org_membership (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    staff_email     TEXT NOT NULL,                   -- soft FK to public.staff(email) - keeps this migration independent
    branch_id       UUID REFERENCES core.branches(id),
    role            TEXT NOT NULL DEFAULT 'rep'
                        CHECK (role IN ('rep','branch_manager','regional_manager','commercial_director','operations','finance','super_admin')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, staff_email)
);

CREATE INDEX idx_membership_org ON core.staff_org_membership (org_id, role)
    WHERE is_active = TRUE;
CREATE INDEX idx_membership_email ON core.staff_org_membership (staff_email)
    WHERE is_active = TRUE;
CREATE INDEX idx_membership_branch ON core.staff_org_membership (branch_id)
    WHERE is_active = TRUE;

-- ============================================================
-- updated_at helper (used by core + freight modules)
-- ============================================================
CREATE OR REPLACE FUNCTION core.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_org_updated_at
    BEFORE UPDATE ON core.organisations
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at();

-- ============================================================
-- Helper: which modules does an org have enabled?
-- Used by API guards before serving any /api/<module>/* route.
-- ============================================================
CREATE OR REPLACE FUNCTION core.org_has_module(p_org_id UUID, p_module_key TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT enabled FROM core.module_features
         WHERE org_id = p_org_id AND module_key = p_module_key),
        FALSE
    );
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- Same posture as migrations 018 / 020: deny anon/authenticated,
-- service-role API path is the only access route. Application
-- layer enforces org_id scope on every query.
-- ============================================================
ALTER TABLE core.organisations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.branches               ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.module_features        ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.staff_org_membership   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON core.organisations,
              core.branches,
              core.module_features,
              core.staff_org_membership
       FROM anon, authenticated;

-- ============================================================
-- USAGE FROM THIS POINT ONWARD
-- New module migrations (rates, quotes, commercial, crm) MUST:
--   1. Live in their own schema (CREATE SCHEMA IF NOT EXISTS rates, etc.)
--   2. Add `org_id UUID NOT NULL REFERENCES core.organisations(id)` to every table
--   3. Index every table on (org_id, ...) for the common read pattern
--   4. Enable RLS, REVOKE anon/authenticated grants
--   5. Application layer filters by session.org_id
--
-- Default org for retrofitting existing public.* tables (when we get
-- to that migration): '00000000-0000-0000-0000-000000000001' (Corten).
-- ============================================================
