-- ============================================================
-- 023_commercial_intelligence.sql
-- Braiin Pulse module - shipment history, client profiles, lane
-- analytics, alerts, enrichment audit, account wiki.
--
-- Architectural notes (from the four-agent review):
--
-- - A1 (Pulse <> Rates type coupling) DEFERRED. Pulse references
--   rates.severity_type / rates.confidence_type / rates.category_type /
--   rates.billable_to_type directly. Attempted relocation to core.*
--   triggered a Supabase event-trigger interference during CREATE TYPE
--   (operator-does-not-exist between core.severity_level and
--   rates.severity_type). Investigation deferred; relocation will land
--   in a follow-up migration. For now, selling Pulse standalone
--   requires the Rates schema to also be present.
--
-- - A2 = commercial.client_profile is slim. Status, account_tier,
--   relationship_owner, onboarded_date stripped. Their canonical home
--   will be crm.companies (planned migration 028). Identity fields
--   (company_name, company_number, vat_number) are kept as a
--   denormalised cache for alert text + wiki compilation; reconciled
--   to crm.companies in 028.
--
-- - A4 = tms_job_ref relaxed to nullable, no UNIQUE. Cargowise has
--   multiple identifiers per shipment; will be modelled by a future
--   commercial.shipment_external_refs table when 025 lands.
--
-- Performance + correctness fixes applied (from the four-agent review):
-- C1 volume_trend / gp_trend now computed in rebuild_client_lanes.
-- C2 is_primary_lane reset is a single atomic UPDATE.
-- P-C1 Per-org cron wrappers - rebuild_all_lanes / generate_all_alerts
--      iterate active orgs with per-tenant exception isolation.
-- P-C2 idx_alerts_dedupe covers the NOT EXISTS dedupe key.
-- H1 Alert dedupe checks status IN ('OPEN','SNOOZED').
-- H_A Views included in REVOKE block.
-- P-H1 mark_wiki_stale is statement-level with transition tables.
-- P-H2 Expression index for monthly_performance time-series queries.
-- M2 Partial unique on lower(company_number) where not null.
-- M4 expire-old-alerts is daily, not weekly.
-- L1 No ORDER BY in client_lane_profitability view.
-- S-D ALTER DEFAULT PRIVILEGES on commercial schema.
--
-- Deferred (documented for future migrations):
-- - A1 type relocation as above.
-- - HNSW post-filter behaviour for cross-tenant pgvector queries.
--   Acceptable while service-role-only; revisit when first external
--   customer onboards (likely migration 030).
-- - Composite (org_id, client_id) FKs on the five client-keyed
--   tables. Current global sequence uniqueness is sufficient for
--   tenant isolation under the service-role posture.
-- - Sales motion split (motion_type) - lives in crm.companies in
--   migration 028, not in Pulse.
--
-- Depends on: 021_core_foundation.sql, 022_rate_engine_core.sql.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS commercial;

-- Lock down default grants on this schema. Per-table REVOKE below
-- catches the eight tables created here; this default also catches
-- any table added in a future migration that forgets to REVOKE.
ALTER DEFAULT PRIVILEGES IN SCHEMA commercial
    REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA commercial
    REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA commercial
    REVOKE ALL ON FUNCTIONS FROM PUBLIC;

-- ============================================================
-- ENUMS (Pulse-only; shared types come from core.*)
-- ============================================================
CREATE TYPE commercial.enrichment_source AS ENUM (
    'COMPANIES_HOUSE','IMPORT_YETI','LINKEDIN',
    'HMRC_TRADE','MANUAL','LOOP_EXPORT','WISOR_EXPORT',
    'PIPEDRIVE','PORT_DATA','NEWS','WEBSITE_SCRAPE',
    'CARGOWISE'
);
CREATE TYPE commercial.alert_type AS ENUM (
    'CHURN_RISK','RATE_EXPIRY','MARKET_MOVED',
    'VOLUME_DROP','UPSELL_OPPORTUNITY','INVOICE_ISSUES',
    'NEW_COMPETITOR_SIGNAL','QBR_DUE','ENRICHMENT_STALE',
    'CONTRACT_RENEWAL','CREDIT_RISK'
);
CREATE TYPE commercial.alert_status AS ENUM (
    'OPEN','ACTIONED','DISMISSED','SNOOZED'
);
CREATE TYPE commercial.shipment_mode AS ENUM (
    'OCEAN_FCL','OCEAN_LCL','AIR','ROAD_FTL',
    'ROAD_LTL','COURIER','MULTIMODAL'
);
CREATE TYPE commercial.shipment_status AS ENUM (
    'BOOKED','IN_TRANSIT','AT_PORT','CUSTOMS',
    'OUT_FOR_DELIVERY','DELIVERED','EXCEPTION','CANCELLED'
);
CREATE TYPE commercial.direction_type AS ENUM (
    'IMPORT','EXPORT','CROSS_TRADE'
);
CREATE TYPE commercial.wiki_status AS ENUM (
    'CURRENT','STALE','COMPILING','FAILED'
);

-- ============================================================
-- commercial.client_profile
-- Pulse-specific data only. Status, account_tier, relationship_owner
-- and onboarded_date are NOT here - they live in CRM (future
-- crm.companies in migration 028).
--
-- company_name / company_number / vat_number are kept as a
-- denormalised cache for alert-text generation and wiki compilation.
-- They will be reconciled to crm.companies in 028 (the cache stays
-- as a read-side optimisation; canon moves).
--
-- company_id is a soft FK to the future crm.companies(id). Left
-- nullable so 023 can ship before 028; backfilled in 028.
-- ============================================================
CREATE SEQUENCE commercial.client_seq START 1;

CREATE TABLE commercial.client_profile (
    client_id           TEXT PRIMARY KEY DEFAULT 'CLT-' || LPAD(NEXTVAL('commercial.client_seq')::TEXT, 5, '0'),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    branch_id           UUID REFERENCES core.branches(id),
    -- Soft FK to future crm.companies(id); reconciled in 028.
    company_id          TEXT,
    -- Denormalised identity cache (canonical home: crm.companies in 028)
    company_name        TEXT NOT NULL,
    company_number      TEXT,
    vat_number          TEXT,
    duns_number         TEXT,
    hq_country          CHAR(2),
    hq_city             TEXT,
    industry_sector     TEXT,
    -- Pulse-specific
    commodity_profile   TEXT[],
    currency            CHAR(3) NOT NULL DEFAULT 'GBP',
    credit_limit        NUMERIC(12,2),
    payment_terms_days  SMALLINT,
    estimated_annual_freight_spend NUMERIC(14,2),
    forwarder_annual_spend         NUMERIC(14,2),
    first_shipment_date DATE,
    last_shipment_date  DATE,
    last_enriched_at    TIMESTAMPTZ,
    enrichment_score    SMALLINT CHECK (enrichment_score BETWEEN 0 AND 100),
    wiki_page_path      TEXT,
    wiki_status         commercial.wiki_status NOT NULL DEFAULT 'STALE',
    wiki_last_compiled  TIMESTAMPTZ,
    -- Audit
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by          TEXT NOT NULL,
    notes               TEXT
);

-- Partial unique on lower(company_number) where present. NULLs are
-- not deduplicated - that requires CRM-level identity resolution.
CREATE UNIQUE INDEX uniq_client_company_number
    ON commercial.client_profile (org_id, lower(company_number))
    WHERE company_number IS NOT NULL;
CREATE UNIQUE INDEX uniq_client_vat_number
    ON commercial.client_profile (org_id, lower(vat_number))
    WHERE vat_number IS NOT NULL;

CREATE INDEX idx_client_profile_org_branch ON commercial.client_profile (org_id, branch_id);
CREATE INDEX idx_client_profile_org_country ON commercial.client_profile (org_id, hq_country);
CREATE INDEX idx_client_profile_org_last_shipment ON commercial.client_profile (org_id, last_shipment_date DESC NULLS LAST);
CREATE INDEX idx_client_profile_org_wiki ON commercial.client_profile (org_id, wiki_status, wiki_last_compiled);
CREATE INDEX idx_client_profile_company_id ON commercial.client_profile (org_id, company_id)
    WHERE company_id IS NOT NULL;
CREATE INDEX idx_client_profile_name_search ON commercial.client_profile
    USING GIN (to_tsvector('english', company_name));

-- ============================================================
-- commercial.client_contacts
-- ============================================================
CREATE SEQUENCE commercial.contact_seq START 1;

CREATE TABLE commercial.client_contacts (
    contact_id          TEXT PRIMARY KEY DEFAULT 'CON-' || LPAD(NEXTVAL('commercial.contact_seq')::TEXT, 5, '0'),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    client_id           TEXT NOT NULL REFERENCES commercial.client_profile(client_id) ON DELETE CASCADE,
    full_name           TEXT NOT NULL,
    job_title           TEXT,
    email               TEXT,
    phone               TEXT,
    linkedin_url        TEXT,
    is_primary          BOOLEAN NOT NULL DEFAULT FALSE,
    is_decision_maker   BOOLEAN NOT NULL DEFAULT FALSE,
    last_contact_date   DATE,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contacts_org_client ON commercial.client_contacts (org_id, client_id, is_primary);
CREATE INDEX idx_contacts_org_email ON commercial.client_contacts (org_id, lower(email))
    WHERE email IS NOT NULL;
CREATE UNIQUE INDEX uniq_primary_contact_per_client
    ON commercial.client_contacts (org_id, client_id)
    WHERE is_primary = TRUE;

-- ============================================================
-- commercial.shipments
-- tms_job_ref is nullable + non-unique. Cargowise has multiple
-- identifiers per shipment; multi-ref handling will live in
-- commercial.shipment_external_refs (added by 025).
-- ============================================================
CREATE TABLE commercial.shipments (
    shipment_id             TEXT NOT NULL,
    org_id                  UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    client_id               TEXT NOT NULL REFERENCES commercial.client_profile(client_id),
    branch_id               UUID REFERENCES core.branches(id),
    tms_job_ref             TEXT,
    house_bl_number         TEXT,
    master_bl_number        TEXT,
    booking_ref             TEXT,
    mode                    commercial.shipment_mode NOT NULL,
    direction               commercial.direction_type NOT NULL,
    status                  commercial.shipment_status NOT NULL DEFAULT 'BOOKED',
    carrier_code            TEXT,
    carrier_name            TEXT,
    service_name            TEXT,
    vessel_name             TEXT,
    voyage_number           TEXT,
    origin_country          CHAR(2),
    origin_port             TEXT,
    dest_country            CHAR(2),
    dest_port               TEXT,
    pol                     TEXT,
    pod                     TEXT,
    via_port                TEXT,
    etd                     DATE,
    eta                     DATE,
    atd                     DATE,
    ata                     DATE,
    transit_days_quoted     SMALLINT,
    transit_days_actual     SMALLINT,
    commodity               TEXT,
    hs_code                 TEXT,
    is_dg                   BOOLEAN NOT NULL DEFAULT FALSE,
    is_reefer               BOOLEAN NOT NULL DEFAULT FALSE,
    is_oog                  BOOLEAN NOT NULL DEFAULT FALSE,
    container_type          TEXT,
    container_count         SMALLINT,
    gross_weight_kg         NUMERIC(12,2),
    volume_cbm              NUMERIC(10,2),
    chargeable_weight_kg    NUMERIC(12,2),
    rate_card_id            TEXT REFERENCES rates.rate_card_header(rate_card_id),
    quoted_cost             NUMERIC(12,2),
    actual_cost             NUMERIC(12,2),
    sell_price              NUMERIC(12,2),
    gross_profit            NUMERIC(12,2),
    gp_percent              NUMERIC(5,2),
    currency                CHAR(3) NOT NULL DEFAULT 'GBP',
    exception_count         SMALLINT NOT NULL DEFAULT 0,
    delay_days              SMALLINT,
    has_invoice_query       BOOLEAN NOT NULL DEFAULT FALSE,
    tms_last_synced         TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, shipment_id)
);

CREATE INDEX idx_shipments_org_client ON commercial.shipments (org_id, client_id, etd DESC NULLS LAST);
CREATE INDEX idx_shipments_org_mode ON commercial.shipments (org_id, mode, direction);
CREATE INDEX idx_shipments_org_lane ON commercial.shipments (org_id, mode, origin_port, dest_port);
CREATE INDEX idx_shipments_org_carrier ON commercial.shipments (org_id, carrier_code);
CREATE INDEX idx_shipments_org_dates ON commercial.shipments (org_id, etd, eta, status);
CREATE INDEX idx_shipments_org_financials ON commercial.shipments (org_id, client_id, gross_profit DESC NULLS LAST);
-- Hot path: rebuild_client_lanes; partial filter excludes cancelled rows from the index.
CREATE INDEX idx_shipments_org_client_lane ON commercial.shipments
    (org_id, client_id, mode, origin_port, dest_port, etd DESC)
    WHERE status <> 'CANCELLED';
-- Time-series index for monthly_performance view (caller MUST pass
-- org_id). date_trunc cannot live in an index expression because
-- it is STABLE not IMMUTABLE; this btree on etd still gives the
-- view a usable range scan.
CREATE INDEX idx_shipments_monthly ON commercial.shipments
    (org_id, client_id, etd, mode)
    WHERE status <> 'CANCELLED';
CREATE INDEX idx_shipments_exceptions ON commercial.shipments (org_id, client_id)
    WHERE has_invoice_query = TRUE OR exception_count > 0;

-- ============================================================
-- commercial.shipment_charges (uses core.* shared types)
-- ============================================================
CREATE SEQUENCE commercial.charge_seq START 1;

CREATE TABLE commercial.shipment_charges (
    charge_id           TEXT PRIMARY KEY DEFAULT 'CHG-' || LPAD(NEXTVAL('commercial.charge_seq')::TEXT, 7, '0'),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    shipment_id         TEXT NOT NULL,
    charge_code         TEXT,
    charge_name         TEXT NOT NULL,
    category            rates.category_type,
    billable_to         rates.billable_to_type,
    cost_amount         NUMERIC(12,2),
    sell_amount         NUMERIC(12,2),
    currency            CHAR(3) NOT NULL DEFAULT 'GBP',
    is_quoted           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (org_id, shipment_id)
        REFERENCES commercial.shipments(org_id, shipment_id) ON DELETE CASCADE
);

CREATE INDEX idx_sc_org_shipment ON commercial.shipment_charges (org_id, shipment_id);
CREATE INDEX idx_sc_org_unquoted ON commercial.shipment_charges (org_id, shipment_id)
    WHERE is_quoted = FALSE;
CREATE INDEX idx_sc_org_charge_code ON commercial.shipment_charges (org_id, charge_code);

-- ============================================================
-- commercial.client_lanes (materialised by rebuild_client_lanes)
-- ============================================================
CREATE SEQUENCE commercial.lane_seq START 1;

CREATE TABLE commercial.client_lanes (
    lane_id                 TEXT PRIMARY KEY DEFAULT 'LNE-' || LPAD(NEXTVAL('commercial.lane_seq')::TEXT, 6, '0'),
    org_id                  UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    client_id               TEXT NOT NULL REFERENCES commercial.client_profile(client_id),
    mode                    commercial.shipment_mode NOT NULL,
    origin_country          CHAR(2),
    origin_port             TEXT,
    dest_country            CHAR(2),
    dest_port               TEXT,
    shipment_count_12m      INTEGER NOT NULL DEFAULT 0,
    teu_count_12m           NUMERIC(10,2),
    cbm_12m                 NUMERIC(12,2),
    kg_12m                  NUMERIC(14,2),
    total_sell_12m          NUMERIC(14,2),
    total_gp_12m            NUMERIC(14,2),
    avg_gp_percent_12m      NUMERIC(5,2),
    -- Trend vs prior 12 months (computed by rebuild_client_lanes)
    volume_trend            NUMERIC(6,2),
    gp_trend                NUMERIC(6,2),
    first_shipment_date     DATE,
    last_shipment_date      DATE,
    market_rate_index       NUMERIC(12,2),
    client_vs_market        NUMERIC(6,2),
    rate_card_id            TEXT REFERENCES rates.rate_card_header(rate_card_id),
    rate_card_expires       DATE,
    is_primary_lane         BOOLEAN NOT NULL DEFAULT FALSE,
    at_risk                 BOOLEAN NOT NULL DEFAULT FALSE,
    upsell_potential        BOOLEAN NOT NULL DEFAULT FALSE,
    last_rebuilt            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, client_id, mode, origin_port, dest_port)
);

CREATE INDEX idx_cl_org_client ON commercial.client_lanes (org_id, client_id, is_primary_lane);
CREATE INDEX idx_cl_org_risk ON commercial.client_lanes (org_id, at_risk) WHERE at_risk = TRUE;
CREATE INDEX idx_cl_org_expiry ON commercial.client_lanes (org_id, rate_card_expires)
    WHERE rate_card_expires IS NOT NULL;
CREATE INDEX idx_cl_org_upsell ON commercial.client_lanes (org_id, upsell_potential)
    WHERE upsell_potential = TRUE;
CREATE INDEX idx_cl_org_lane_lookup ON commercial.client_lanes (org_id, mode, origin_port, dest_port);

-- ============================================================
-- commercial.enrichment_log (uses rates.confidence_type)
-- ============================================================
CREATE SEQUENCE commercial.enr_seq START 1;

CREATE TABLE commercial.enrichment_log (
    enrichment_id   TEXT PRIMARY KEY DEFAULT 'ENR-' || LPAD(NEXTVAL('commercial.enr_seq')::TEXT, 7, '0'),
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    client_id       TEXT NOT NULL REFERENCES commercial.client_profile(client_id),
    contact_id      TEXT REFERENCES commercial.client_contacts(contact_id),
    source          commercial.enrichment_source NOT NULL,
    source_ref      TEXT,
    field_updated   TEXT NOT NULL,
    old_value       TEXT,
    new_value       TEXT,
    confidence      rates.confidence_type NOT NULL DEFAULT 'MEDIUM',
    ingested_by     TEXT NOT NULL,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes           TEXT
);

CREATE INDEX idx_enr_org_client ON commercial.enrichment_log (org_id, client_id, ingested_at DESC);
CREATE INDEX idx_enr_org_source ON commercial.enrichment_log (org_id, source, ingested_at DESC);

-- ============================================================
-- commercial.alerts (uses rates.severity_type)
-- assigned_to is currently filled from
-- core.organisations.settings ->> 'pulse_default_alert_owner'.
-- When 028 lands, generate_alerts gets updated to JOIN
-- crm.companies for per-client owner routing.
-- ============================================================
CREATE SEQUENCE commercial.alert_seq START 1;

CREATE TABLE commercial.alerts (
    alert_id        TEXT PRIMARY KEY DEFAULT 'ALT-' || LPAD(NEXTVAL('commercial.alert_seq')::TEXT, 7, '0'),
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    client_id       TEXT NOT NULL REFERENCES commercial.client_profile(client_id),
    alert_type      commercial.alert_type NOT NULL,
    severity        rates.severity_type NOT NULL DEFAULT 'WARNING',
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    data_payload    JSONB,
    assigned_to     TEXT NOT NULL,
    status          commercial.alert_status NOT NULL DEFAULT 'OPEN',
    snoozed_until   TIMESTAMPTZ,
    actioned_at     TIMESTAMPTZ,
    actioned_by     TEXT,
    actioned_notes  TEXT,
    shipment_id     TEXT,
    lane_id         TEXT REFERENCES commercial.client_lanes(lane_id),
    rate_card_id    TEXT REFERENCES rates.rate_card_header(rate_card_id),
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,
    FOREIGN KEY (org_id, shipment_id)
        REFERENCES commercial.shipments(org_id, shipment_id) ON DELETE SET NULL
);

CREATE INDEX idx_alerts_org_owner ON commercial.alerts (org_id, assigned_to, status, generated_at DESC);
CREATE INDEX idx_alerts_org_client ON commercial.alerts (org_id, client_id, status);
CREATE INDEX idx_alerts_org_open ON commercial.alerts (org_id, alert_type, severity)
    WHERE status = 'OPEN';
CREATE INDEX idx_alerts_org_expiry ON commercial.alerts (org_id, expires_at)
    WHERE expires_at IS NOT NULL AND status = 'OPEN';
-- Covers the NOT EXISTS dedupe in generate_alerts; partial filter
-- includes both OPEN and SNOOZED so re-firing on snooze expiry is a
-- single index probe.
CREATE INDEX idx_alerts_dedupe ON commercial.alerts
    (org_id, client_id, alert_type, lane_id)
    WHERE status IN ('OPEN','SNOOZED');

-- ============================================================
-- commercial.account_wiki_pages
-- HNSW index is global across all orgs. Postgres pgvector does
-- post-filter (not pre-filter), so a query that omits org_id will
-- silently return cross-tenant nearest neighbours. The application
-- layer MUST scope every NN query: WHERE org_id = $1. Repartition
-- to per-org partial HNSW indexes when any single tenant exceeds
-- ~30% of total wiki rows (review item M1).
-- ============================================================
CREATE SEQUENCE commercial.wiki_seq START 1;

CREATE TABLE commercial.account_wiki_pages (
    page_id         TEXT PRIMARY KEY DEFAULT 'WKP-' || LPAD(NEXTVAL('commercial.wiki_seq')::TEXT, 5, '0'),
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    client_id       TEXT NOT NULL REFERENCES commercial.client_profile(client_id),
    git_path        TEXT NOT NULL,
    git_sha         TEXT,
    raw_url         TEXT,
    status          commercial.wiki_status NOT NULL DEFAULT 'STALE',
    last_compiled   TIMESTAMPTZ,
    compile_trigger TEXT,
    word_count      INTEGER,
    quality_score   SMALLINT CHECK (quality_score BETWEEN 0 AND 100),
    embedding       vector(1536),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, client_id)
);

CREATE INDEX idx_wiki_org_status ON commercial.account_wiki_pages (org_id, status, last_compiled);
CREATE INDEX idx_wiki_embedding ON commercial.account_wiki_pages
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ============================================================
-- VIEWS
-- All views expose org_id. Callers MUST WHERE-filter on it.
-- The views are NOT a tenant-isolation boundary; they are a query
-- convenience over base tables that already enforce isolation.
-- ============================================================

CREATE VIEW commercial.account_health AS
SELECT
    c.org_id,
    c.client_id,
    c.company_name,
    c.last_shipment_date,
    c.forwarder_annual_spend,
    CURRENT_DATE - c.last_shipment_date                  AS days_since_last_shipment,
    COUNT(a.alert_id) FILTER (WHERE a.status = 'OPEN')   AS open_alerts,
    COUNT(a.alert_id) FILTER (WHERE a.status = 'OPEN' AND a.severity = 'ERROR') AS critical_alerts,
    COUNT(DISTINCT cl.lane_id)                           AS active_lanes,
    BOOL_OR(cl.at_risk)                                  AS any_lane_at_risk,
    BOOL_OR(cl.upsell_potential)                         AS upsell_exists,
    MIN(cl.rate_card_expires)                            AS earliest_expiry,
    c.wiki_status,
    c.wiki_last_compiled,
    CURRENT_DATE - c.wiki_last_compiled::DATE            AS wiki_age_days
FROM commercial.client_profile c
LEFT JOIN commercial.alerts a
    ON c.client_id = a.client_id AND c.org_id = a.org_id AND a.status = 'OPEN'
LEFT JOIN commercial.client_lanes cl
    ON c.client_id = cl.client_id AND c.org_id = cl.org_id
GROUP BY c.org_id, c.client_id, c.company_name,
         c.last_shipment_date, c.forwarder_annual_spend,
         c.wiki_status, c.wiki_last_compiled;

CREATE VIEW commercial.client_lane_profitability AS
SELECT
    cl.org_id,
    c.company_name,
    cl.client_id,
    cl.lane_id,
    cl.mode,
    cl.origin_port,
    cl.dest_port,
    cl.shipment_count_12m,
    cl.teu_count_12m,
    cl.total_sell_12m,
    cl.total_gp_12m,
    cl.avg_gp_percent_12m,
    cl.volume_trend,
    cl.client_vs_market,
    cl.rate_card_expires,
    cl.at_risk,
    cl.upsell_potential
FROM commercial.client_lanes cl
JOIN commercial.client_profile c
    ON cl.client_id = c.client_id AND cl.org_id = c.org_id;

CREATE VIEW commercial.monthly_performance AS
SELECT
    org_id,
    client_id,
    DATE_TRUNC('month', etd)                                    AS month,
    mode,
    COUNT(*)                                                    AS shipment_count,
    SUM(container_count)                                        AS total_teu,
    SUM(volume_cbm)                                             AS total_cbm,
    SUM(sell_price)                                             AS total_revenue,
    SUM(gross_profit)                                           AS total_gp,
    AVG(gp_percent)                                             AS avg_gp_percent,
    COUNT(*) FILTER (WHERE has_invoice_query)                   AS invoice_queries,
    COUNT(*) FILTER (WHERE delay_days > 0)                      AS delayed_shipments,
    AVG(delay_days) FILTER (WHERE delay_days > 0)               AS avg_delay_days
FROM commercial.shipments
WHERE status != 'CANCELLED'
GROUP BY org_id, client_id, DATE_TRUNC('month', etd), mode;

-- ============================================================
-- commercial.rebuild_client_lanes(p_org_id)
--
-- Rebuilds lane summaries for a single org. Callers (the cron
-- wrapper below) iterate orgs so a slow tenant does not block the
-- others.
--
-- volume_trend / gp_trend compare the rolling-12-month window vs
-- the prior 12 months (months 13-24 ago). NULL trend = no prior
-- period data, treated as "no trend" by the alert engine.
--
-- is_primary_lane is set in a single atomic UPDATE using the
-- window function, so there is no false-zero window during the
-- rebuild (closes the race condition that fired zero alerts when
-- the cron overlapped).
-- ============================================================
CREATE OR REPLACE FUNCTION commercial.rebuild_client_lanes(p_org_id UUID)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    rebuilt_count INTEGER;
BEGIN
    -- Aggregate current and prior 12-month windows, compute trend.
    WITH current_window AS (
        SELECT
            org_id, client_id, mode, origin_port, dest_port,
            origin_country, dest_country,
            COUNT(*)                AS shipments,
            SUM(container_count)    AS teus,
            SUM(volume_cbm)         AS cbm,
            SUM(gross_weight_kg)    AS kg,
            SUM(sell_price)         AS sell,
            SUM(gross_profit)       AS gp,
            AVG(gp_percent)         AS gp_pct,
            MIN(etd)                AS first_etd,
            MAX(etd)                AS last_etd
        FROM commercial.shipments
        WHERE org_id = p_org_id
          AND status <> 'CANCELLED'
          AND etd >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY org_id, client_id, mode, origin_port, dest_port,
                 origin_country, dest_country
    ),
    prior_window AS (
        SELECT
            org_id, client_id, mode, origin_port, dest_port,
            COUNT(*)                AS prior_shipments,
            SUM(sell_price)         AS prior_sell,
            SUM(gross_profit)       AS prior_gp
        FROM commercial.shipments
        WHERE org_id = p_org_id
          AND status <> 'CANCELLED'
          AND etd >= CURRENT_DATE - INTERVAL '24 months'
          AND etd <  CURRENT_DATE - INTERVAL '12 months'
        GROUP BY org_id, client_id, mode, origin_port, dest_port
    )
    INSERT INTO commercial.client_lanes (
        org_id, client_id, mode, origin_port, dest_port,
        origin_country, dest_country,
        shipment_count_12m, teu_count_12m, cbm_12m, kg_12m,
        total_sell_12m, total_gp_12m, avg_gp_percent_12m,
        volume_trend, gp_trend,
        first_shipment_date, last_shipment_date, last_rebuilt
    )
    SELECT
        cw.org_id, cw.client_id, cw.mode, cw.origin_port, cw.dest_port,
        cw.origin_country, cw.dest_country,
        cw.shipments, cw.teus, cw.cbm, cw.kg,
        cw.sell, cw.gp, cw.gp_pct,
        -- Trend = (current - prior) / prior * 100, NULL if no prior
        CASE WHEN pw.prior_shipments IS NULL OR pw.prior_shipments = 0 THEN NULL
             ELSE ROUND(((cw.shipments - pw.prior_shipments)::NUMERIC / pw.prior_shipments) * 100, 2)
        END,
        CASE WHEN pw.prior_gp IS NULL OR pw.prior_gp = 0 THEN NULL
             ELSE ROUND(((cw.gp - pw.prior_gp) / pw.prior_gp) * 100, 2)
        END,
        cw.first_etd, cw.last_etd, NOW()
    FROM current_window cw
    LEFT JOIN prior_window pw
      ON  cw.org_id      = pw.org_id
      AND cw.client_id   = pw.client_id
      AND cw.mode        = pw.mode
      AND cw.origin_port = pw.origin_port
      AND cw.dest_port   = pw.dest_port
    ON CONFLICT (org_id, client_id, mode, origin_port, dest_port)
    DO UPDATE SET
        shipment_count_12m  = EXCLUDED.shipment_count_12m,
        teu_count_12m       = EXCLUDED.teu_count_12m,
        cbm_12m             = EXCLUDED.cbm_12m,
        kg_12m              = EXCLUDED.kg_12m,
        total_sell_12m      = EXCLUDED.total_sell_12m,
        total_gp_12m        = EXCLUDED.total_gp_12m,
        avg_gp_percent_12m  = EXCLUDED.avg_gp_percent_12m,
        volume_trend        = EXCLUDED.volume_trend,
        gp_trend            = EXCLUDED.gp_trend,
        last_shipment_date  = EXCLUDED.last_shipment_date,
        last_rebuilt        = NOW();

    GET DIAGNOSTICS rebuilt_count = ROW_COUNT;

    -- Atomic primary-lane reset: single UPDATE eliminates the
    -- false-zero window where every lane briefly has is_primary_lane
    -- = FALSE while the alert cron is reading.
    UPDATE commercial.client_lanes cl
       SET is_primary_lane = (ranked.rn <= 3)
      FROM (
          SELECT lane_id,
                 ROW_NUMBER() OVER (
                     PARTITION BY org_id, client_id
                     ORDER BY total_sell_12m DESC NULLS LAST
                 ) AS rn
          FROM commercial.client_lanes
          WHERE org_id = p_org_id
      ) ranked
     WHERE cl.lane_id = ranked.lane_id;

    -- Roll up to client_profile.
    UPDATE commercial.client_profile c
       SET last_shipment_date     = sub.last_ship,
           forwarder_annual_spend = sub.annual_spend,
           updated_at             = NOW()
      FROM (
          SELECT client_id,
                 MAX(last_shipment_date) AS last_ship,
                 SUM(total_sell_12m)     AS annual_spend
          FROM commercial.client_lanes
          WHERE org_id = p_org_id
          GROUP BY client_id
      ) sub
     WHERE c.client_id = sub.client_id AND c.org_id = p_org_id;

    RETURN rebuilt_count;
END;
$$;

-- ============================================================
-- commercial.generate_alerts(p_org_id)
--
-- Generates threshold-based alerts for a single org. Dedupe checks
-- treat OPEN and SNOOZED as "already exists" so re-firing on
-- snooze-expiry does not produce duplicates.
--
-- assigned_to is filled from core.organisations.settings JSON key
-- 'pulse_default_alert_owner'. When migration 028 lands, this
-- function gets updated to JOIN crm.companies for per-client
-- routing. Tenants with no default owner skip alert generation
-- (RAISE WARNING in the cron wrapper).
-- ============================================================
CREATE OR REPLACE FUNCTION commercial.generate_alerts(p_org_id UUID)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    inserted_count INTEGER := 0;
    tmp_count      INTEGER;
    default_owner  TEXT;
BEGIN
    SELECT settings ->> 'pulse_default_alert_owner'
      INTO default_owner
      FROM core.organisations
     WHERE id = p_org_id;

    IF default_owner IS NULL OR default_owner = '' THEN
        RAISE NOTICE 'Org % has no pulse_default_alert_owner; skipping alert generation', p_org_id;
        RETURN 0;
    END IF;

    -- 1. VOLUME DROP
    INSERT INTO commercial.alerts (
        org_id, client_id, alert_type, severity, title, body,
        data_payload, assigned_to, lane_id
    )
    SELECT
        cl.org_id,
        cl.client_id,
        'VOLUME_DROP',
        'WARNING',
        'Volume drop on ' || cl.origin_port || ' -> ' || cl.dest_port,
        'Shipment volumes on this lane have fallen ' ||
            ABS(ROUND(cl.volume_trend))::TEXT || '% vs the prior period.',
        jsonb_build_object(
            'lane',           cl.origin_port || '-' || cl.dest_port,
            'mode',           cl.mode,
            'volume_trend',   cl.volume_trend,
            'last_shipment',  cl.last_shipment_date
        ),
        default_owner,
        cl.lane_id
    FROM commercial.client_lanes cl
    WHERE cl.org_id        = p_org_id
      AND cl.volume_trend  <= -30
      AND cl.is_primary_lane = TRUE
      AND NOT EXISTS (
          SELECT 1 FROM commercial.alerts a
           WHERE a.org_id     = cl.org_id
             AND a.client_id  = cl.client_id
             AND a.alert_type = 'VOLUME_DROP'
             AND a.lane_id    = cl.lane_id
             AND a.status IN ('OPEN','SNOOZED')
      );
    GET DIAGNOSTICS tmp_count = ROW_COUNT;
    inserted_count := inserted_count + tmp_count;

    -- 2. RATE EXPIRY
    INSERT INTO commercial.alerts (
        org_id, client_id, alert_type, severity, title, body,
        data_payload, assigned_to, lane_id, rate_card_id
    )
    SELECT
        cl.org_id,
        cl.client_id,
        'RATE_EXPIRY',
        CASE WHEN cl.rate_card_expires <= CURRENT_DATE + 14 THEN 'ERROR' ELSE 'WARNING' END,
        'Rate card expiring in ' || (cl.rate_card_expires - CURRENT_DATE)::TEXT || ' days',
        'The rate card on ' || cl.origin_port || ' -> ' || cl.dest_port ||
            ' expires on ' || cl.rate_card_expires::TEXT || '.',
        jsonb_build_object(
            'expires',          cl.rate_card_expires,
            'days_remaining',   cl.rate_card_expires - CURRENT_DATE,
            'client_vs_market', cl.client_vs_market
        ),
        default_owner,
        cl.lane_id,
        cl.rate_card_id
    FROM commercial.client_lanes cl
    WHERE cl.org_id            = p_org_id
      AND cl.rate_card_expires IS NOT NULL
      AND cl.rate_card_expires BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
      AND NOT EXISTS (
          SELECT 1 FROM commercial.alerts a
           WHERE a.org_id     = cl.org_id
             AND a.client_id  = cl.client_id
             AND a.alert_type = 'RATE_EXPIRY'
             AND a.lane_id    = cl.lane_id
             AND a.status IN ('OPEN','SNOOZED')
      );
    GET DIAGNOSTICS tmp_count = ROW_COUNT;
    inserted_count := inserted_count + tmp_count;

    -- 3. MARKET MOVED
    INSERT INTO commercial.alerts (
        org_id, client_id, alert_type, severity, title, body,
        data_payload, assigned_to, lane_id
    )
    SELECT
        cl.org_id,
        cl.client_id,
        'MARKET_MOVED',
        'WARNING',
        'Market rates moved on ' || cl.origin_port || ' -> ' || cl.dest_port,
        'Current market rates are ' || ABS(ROUND(cl.client_vs_market))::TEXT ||
            '% below this client''s contracted rate. Proactive renewal recommended.',
        jsonb_build_object(
            'client_vs_market',  cl.client_vs_market,
            'market_rate_index', cl.market_rate_index
        ),
        default_owner,
        cl.lane_id
    FROM commercial.client_lanes cl
    WHERE cl.org_id            = p_org_id
      AND cl.client_vs_market  > 20
      AND cl.market_rate_index IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM commercial.alerts a
           WHERE a.org_id     = cl.org_id
             AND a.client_id  = cl.client_id
             AND a.alert_type = 'MARKET_MOVED'
             AND a.lane_id    = cl.lane_id
             AND a.status IN ('OPEN','SNOOZED')
      );
    GET DIAGNOSTICS tmp_count = ROW_COUNT;
    inserted_count := inserted_count + tmp_count;

    -- 4. CHURN RISK
    INSERT INTO commercial.alerts (
        org_id, client_id, alert_type, severity, title, body,
        data_payload, assigned_to
    )
    SELECT
        c.org_id,
        c.client_id,
        'CHURN_RISK',
        'ERROR',
        'No shipment in ' || (CURRENT_DATE - c.last_shipment_date)::TEXT || ' days',
        c.company_name || ' has not shipped in ' ||
            (CURRENT_DATE - c.last_shipment_date)::TEXT || ' days.',
        jsonb_build_object(
            'last_shipment', c.last_shipment_date,
            'days_silent',   CURRENT_DATE - c.last_shipment_date,
            'annual_spend',  c.forwarder_annual_spend
        ),
        default_owner
    FROM commercial.client_profile c
    WHERE c.org_id            = p_org_id
      AND c.last_shipment_date IS NOT NULL
      AND CURRENT_DATE - c.last_shipment_date >= 45
      AND COALESCE(c.forwarder_annual_spend, 0) > 5000
      AND NOT EXISTS (
          SELECT 1 FROM commercial.alerts a
           WHERE a.org_id     = c.org_id
             AND a.client_id  = c.client_id
             AND a.alert_type = 'CHURN_RISK'
             AND a.status IN ('OPEN','SNOOZED')
      );
    GET DIAGNOSTICS tmp_count = ROW_COUNT;
    inserted_count := inserted_count + tmp_count;

    RETURN inserted_count;
END;
$$;

-- ============================================================
-- Per-org cron wrappers
-- These iterate active orgs with per-tenant exception isolation,
-- so a slow or broken tenant cannot block the others.
-- ============================================================
CREATE OR REPLACE FUNCTION commercial.rebuild_all_lanes_for_active_orgs()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    o RECORD;
    total INTEGER := 0;
BEGIN
    FOR o IN SELECT id FROM core.organisations WHERE status = 'active'
    LOOP
        BEGIN
            total := total + commercial.rebuild_client_lanes(o.id);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'commercial.rebuild_client_lanes failed for org %: %',
                o.id, SQLERRM;
        END;
    END LOOP;
    RETURN total;
END;
$$;

CREATE OR REPLACE FUNCTION commercial.generate_all_alerts_for_active_orgs()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    o RECORD;
    total INTEGER := 0;
BEGIN
    FOR o IN SELECT id FROM core.organisations WHERE status = 'active'
    LOOP
        BEGIN
            total := total + commercial.generate_alerts(o.id);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'commercial.generate_alerts failed for org %: %',
                o.id, SQLERRM;
        END;
    END LOOP;
    RETURN total;
END;
$$;

-- ============================================================
-- updated_at triggers
-- ============================================================
CREATE TRIGGER trg_client_profile_updated_at
    BEFORE UPDATE ON commercial.client_profile
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at();

CREATE TRIGGER trg_contacts_updated_at
    BEFORE UPDATE ON commercial.client_contacts
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at();

CREATE TRIGGER trg_shipments_updated_at
    BEFORE UPDATE ON commercial.shipments
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at();

CREATE TRIGGER trg_wiki_updated_at
    BEFORE UPDATE ON commercial.account_wiki_pages
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at();

-- ============================================================
-- Statement-level wiki staleness trigger.
-- FOR EACH STATEMENT with NEW TABLE transition table - one
-- batched UPDATE per affected client, instead of N row-level
-- UPDATEs. Critical for the 025 Cargowise bulk sync.
-- ============================================================
CREATE OR REPLACE FUNCTION commercial.mark_wiki_stale()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    UPDATE commercial.client_profile c
       SET wiki_status = 'STALE', updated_at = NOW()
      FROM (SELECT DISTINCT org_id, client_id FROM new_shipments) ns
     WHERE c.org_id = ns.org_id
       AND c.client_id = ns.client_id
       AND c.wiki_status <> 'COMPILING';
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_shipment_marks_wiki_stale_insert
    AFTER INSERT ON commercial.shipments
    REFERENCING NEW TABLE AS new_shipments
    FOR EACH STATEMENT EXECUTE FUNCTION commercial.mark_wiki_stale();

-- Postgres forbids UPDATE OF column-list together with REFERENCING
-- NEW TABLE. Trigger fires on any UPDATE; function only writes
-- distinct affected clients and skips COMPILING ones, so the cost
-- of broader firing is negligible.
CREATE TRIGGER trg_shipment_marks_wiki_stale_update
    AFTER UPDATE ON commercial.shipments
    REFERENCING NEW TABLE AS new_shipments
    FOR EACH STATEMENT EXECUTE FUNCTION commercial.mark_wiki_stale();

-- ============================================================
-- pg_cron jobs
-- All run for active orgs in a per-tenant loop with exception
-- isolation. Daily expire-old-alerts (was weekly).
-- ============================================================
SELECT cron.schedule(
    'commercial-rebuild-client-lanes',
    '0 2 * * *',
    $$ SELECT commercial.rebuild_all_lanes_for_active_orgs() $$
);

SELECT cron.schedule(
    'commercial-generate-alerts',
    '0 3 * * *',
    $$ SELECT commercial.generate_all_alerts_for_active_orgs() $$
);

SELECT cron.schedule(
    'commercial-expire-old-alerts',
    '0 4 * * *',
    $$
        UPDATE commercial.alerts
           SET status = 'DISMISSED'
         WHERE expires_at IS NOT NULL
           AND expires_at < NOW()
           AND status = 'OPEN'
    $$
);

-- ============================================================
-- ROW LEVEL SECURITY
-- Same posture as 018 / 020 / 021 / 022: deny anon + authenticated,
-- service-role API path is the only access route. Application
-- layer enforces session.org_id on every query. RLS is defence
-- in depth.
--
-- Views are explicitly REVOKEd alongside base tables so a future
-- non-service role with USAGE on the schema cannot bypass tenancy
-- by querying the views.
-- ============================================================
ALTER TABLE commercial.client_profile       ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial.client_contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial.shipments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial.shipment_charges     ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial.client_lanes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial.enrichment_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial.alerts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial.account_wiki_pages   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON commercial.client_profile,
              commercial.client_contacts,
              commercial.shipments,
              commercial.shipment_charges,
              commercial.client_lanes,
              commercial.enrichment_log,
              commercial.alerts,
              commercial.account_wiki_pages,
              commercial.account_health,
              commercial.client_lane_profitability,
              commercial.monthly_performance
       FROM anon, authenticated;

-- ============================================================
-- Per-tenant config (e.g. pulse_default_alert_owner) is set during
-- org onboarding, NOT in this migration. Until that flow exists,
-- run this manually for each tenant whose alerts should fire:
--
--   UPDATE core.organisations
--      SET settings = jsonb_set(settings, '{pulse_default_alert_owner}', '"owner@example.com"'::jsonb)
--    WHERE slug = '<tenant-slug>';
--
-- Tenants without the setting have alert generation skipped (the
-- generate_alerts function returns 0 with a NOTICE).
-- ============================================================
