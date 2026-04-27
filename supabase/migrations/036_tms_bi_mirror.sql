-- 036_tms_bi_mirror.sql
--
-- Local mirror of Cargowise (and other TMS) operational + financial data,
-- populated by the 4x/day sync cron. Lives in `commercial` schema next
-- to existing shipment + lane tables. Powers the /operations BI dashboard
-- without hitting Cargowise on every page load.
--
-- Plus an audit table in `tms` that records every outbound call to a TMS
-- (eAdaptor, Cargo Visibility, future Magaya) so we have a tamperable
-- record of who triggered what + when, for security review and debugging.
-- Audit table NEVER stores credentials or full request bodies that could
-- leak secrets.

-- ============================================================
-- commercial.tms_jobs - mirror of Universal Shipment per job
-- ============================================================

CREATE TABLE IF NOT EXISTS commercial.tms_jobs (
    job_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    provider_id         TEXT NOT NULL DEFAULT 'cargowise',

    -- TMS-side identity
    cw_job_number       TEXT NOT NULL,                       -- 'AS123456'
    cw_job_type         TEXT,                                -- 'ForwardingShipment' | 'ForwardingConsol' | 'CustomsDeclaration'
    cw_company_code     TEXT,
    cw_branch           TEXT,
    cw_department       TEXT,

    -- Operational
    transport_mode      TEXT,
    container_mode      TEXT,
    mbol_number         TEXT,
    hbol_number         TEXT,
    consol_number       TEXT,

    origin_unloco       CHAR(5),
    destination_unloco  CHAR(5),

    carrier_code        TEXT,
    carrier_name        TEXT,
    vessel_name         TEXT,
    voyage_number       TEXT,

    eta                 TIMESTAMPTZ,
    etd                 TIMESTAMPTZ,
    ata                 TIMESTAMPTZ,
    atd                 TIMESTAMPTZ,

    -- Status (open / closed / cancelled / ...)
    status              TEXT,

    -- Parties (denormalised cache for BI - canonical lives in commercial.client_profile etc)
    consignor_name      TEXT,
    consignee_name      TEXT,
    local_client_code   TEXT,

    -- Money (denormalised total at sync time)
    total_revenue_amount    NUMERIC(14, 2),
    total_revenue_currency  CHAR(3),
    total_cost_amount       NUMERIC(14, 2),
    total_cost_currency     CHAR(3),
    margin_amount           NUMERIC(14, 2),
    margin_pct              NUMERIC(7, 4),

    -- Timestamps
    job_opened_at       TIMESTAMPTZ,
    job_closed_at       TIMESTAMPTZ,
    last_modified_at    TIMESTAMPTZ,                          -- per Cargowise

    -- Raw payload kept for re-parsing (Postgres TOAST handles compression)
    raw_xml             TEXT,
    parsed              JSONB,

    synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (provider_id, cw_job_number, cw_job_type)
);

CREATE INDEX IF NOT EXISTS idx_tms_jobs_org_status
    ON commercial.tms_jobs (org_id, status, last_modified_at DESC);

CREATE INDEX IF NOT EXISTS idx_tms_jobs_org_open
    ON commercial.tms_jobs (org_id, last_modified_at DESC)
    WHERE job_closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tms_jobs_mbol
    ON commercial.tms_jobs (mbol_number)
    WHERE mbol_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tms_jobs_hbol
    ON commercial.tms_jobs (hbol_number)
    WHERE hbol_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tms_jobs_lane
    ON commercial.tms_jobs (origin_unloco, destination_unloco, transport_mode);

CREATE INDEX IF NOT EXISTS idx_tms_jobs_synced
    ON commercial.tms_jobs (synced_at DESC);

COMMENT ON TABLE commercial.tms_jobs IS
    'Local mirror of Cargowise jobs (Universal Shipment XML). Refreshed 4x/day by scripts/sync-cargowise.ts. Read-only from app code; sync script owns writes.';


-- ============================================================
-- commercial.tms_charge_lines - per-job charges (job costing tab)
-- ============================================================

CREATE TABLE IF NOT EXISTS commercial.tms_charge_lines (
    charge_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id              UUID NOT NULL REFERENCES commercial.tms_jobs(job_id) ON DELETE CASCADE,
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,

    cw_line_id          TEXT,
    charge_code         TEXT,
    description         TEXT,

    -- Revenue side
    revenue_amount      NUMERIC(14, 2),
    revenue_currency    CHAR(3),
    revenue_amount_local NUMERIC(14, 2),                     -- in tenant base currency

    -- Cost side
    cost_amount         NUMERIC(14, 2),
    cost_currency       CHAR(3),
    cost_amount_local   NUMERIC(14, 2),

    creditor_code       TEXT,
    debtor_code         TEXT,

    synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tms_charge_lines_job
    ON commercial.tms_charge_lines (job_id);

CREATE INDEX IF NOT EXISTS idx_tms_charge_lines_charge_code
    ON commercial.tms_charge_lines (org_id, charge_code);


-- ============================================================
-- commercial.tms_invoices - mirror of accounting transactions
-- ============================================================

CREATE TABLE IF NOT EXISTS commercial.tms_invoices (
    invoice_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    provider_id         TEXT NOT NULL DEFAULT 'cargowise',

    cw_invoice_number   TEXT NOT NULL,
    cw_transaction_type TEXT,                                -- 'INV' | 'CRD' | 'PAY' | 'JNL'
    cw_branch           TEXT,
    cw_department       TEXT,

    invoice_date        DATE,
    due_date            DATE,

    -- Linked job when traceable. NOT FK because invoices may be
    -- multi-job or not job-attached at all.
    cw_job_number       TEXT,
    job_id              UUID REFERENCES commercial.tms_jobs(job_id) ON DELETE SET NULL,

    organisation_code   TEXT,                                -- customer / vendor
    organisation_name   TEXT,

    amount              NUMERIC(14, 2),
    currency            CHAR(3),
    amount_local        NUMERIC(14, 2),
    tax_amount          NUMERIC(14, 2),

    status              TEXT,                                -- 'OPEN' | 'PAID' | 'PARTIAL' | 'CANCELLED'
    paid_amount         NUMERIC(14, 2),
    paid_at             TIMESTAMPTZ,

    raw_xml             TEXT,
    parsed              JSONB,
    last_modified_at    TIMESTAMPTZ,
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (provider_id, cw_invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_tms_invoices_org_status
    ON commercial.tms_invoices (org_id, status, invoice_date DESC);

CREATE INDEX IF NOT EXISTS idx_tms_invoices_org_open
    ON commercial.tms_invoices (org_id, due_date)
    WHERE status IN ('OPEN', 'PARTIAL');

CREATE INDEX IF NOT EXISTS idx_tms_invoices_job
    ON commercial.tms_invoices (job_id)
    WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tms_invoices_org_code
    ON commercial.tms_invoices (org_id, organisation_code, invoice_date DESC);


-- ============================================================
-- commercial.tms_sync_state - watermark for incremental sync
-- ============================================================

CREATE TABLE IF NOT EXISTS commercial.tms_sync_state (
    sync_state_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    provider_id         TEXT NOT NULL,
    sync_kind           TEXT NOT NULL,                       -- 'jobs' | 'invoices' | 'charges' | 'documents'

    last_run_at         TIMESTAMPTZ,
    last_success_at     TIMESTAMPTZ,
    last_modified_seen  TIMESTAMPTZ,                         -- watermark to advance from on next run

    last_error          TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,

    rows_synced_total   BIGINT NOT NULL DEFAULT 0,
    rows_synced_last_run INTEGER NOT NULL DEFAULT 0,

    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (org_id, provider_id, sync_kind)
);


-- ============================================================
-- tms.outbound_calls - audit log for every TMS call we make
-- ============================================================
-- Every shipment query, document query, subscription create, etc lands
-- here. NEVER stores credentials, NEVER stores full request bodies that
-- might contain auth headers - just operation, summary string, status,
-- timing. The audit row IDs surface in /dev/cargowise so suspicious
-- activity is immediately visible.

CREATE TABLE IF NOT EXISTS tms.outbound_calls (
    call_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    connection_id       UUID REFERENCES tms.connections(connection_id) ON DELETE SET NULL,
    provider_id         TEXT NOT NULL REFERENCES tms.providers(provider_id) ON DELETE RESTRICT,

    operation           TEXT NOT NULL,                       -- 'shipment_query' | 'document_query' | 'subscription_create' | 'transaction_batch_export'
    requested_by        TEXT NOT NULL,                       -- email of authenticated user OR 'sync-cron' OR 'webhook'

    -- Safe summary - e.g. 'job_type=ForwardingShipment job=AS123456'
    -- App code is responsible for ensuring this never contains credentials.
    request_summary     TEXT,

    requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    duration_ms         INTEGER,

    status              TEXT NOT NULL,                       -- 'success' | 'auth_error' | 'http_error' | 'parse_error' | 'timeout' | 'unsupported'
    http_status         INTEGER,
    error_code          TEXT,                                -- short categorisation
    error_message       TEXT,                                -- human-readable, truncated

    bytes_sent          INTEGER,
    bytes_received      INTEGER,

    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tms_outbound_org_time
    ON tms.outbound_calls (org_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_tms_outbound_org_op
    ON tms.outbound_calls (org_id, operation, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_tms_outbound_failures
    ON tms.outbound_calls (org_id, requested_at DESC)
    WHERE status != 'success';

CREATE INDEX IF NOT EXISTS idx_tms_outbound_auth_failures
    ON tms.outbound_calls (provider_id, requested_at DESC)
    WHERE status = 'auth_error';

COMMENT ON TABLE tms.outbound_calls IS
    'Audit log of every outbound TMS call (eAdaptor, Cargo Visibility, Magaya, ...). Never stores credentials or full payloads. Use the auth_failures index for alerting.';


-- ============================================================
-- updated_at trigger for sync_state
-- ============================================================

DROP TRIGGER IF EXISTS trg_tms_sync_state_touch ON commercial.tms_sync_state;
CREATE TRIGGER trg_tms_sync_state_touch
    BEFORE UPDATE ON commercial.tms_sync_state
    FOR EACH ROW EXECUTE FUNCTION tms.touch_updated_at();


-- ============================================================
-- Lockdown
-- ============================================================

REVOKE ALL ON commercial.tms_jobs           FROM PUBLIC;
REVOKE ALL ON commercial.tms_charge_lines   FROM PUBLIC;
REVOKE ALL ON commercial.tms_invoices       FROM PUBLIC;
REVOKE ALL ON commercial.tms_sync_state     FROM PUBLIC;
REVOKE ALL ON tms.outbound_calls            FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON commercial.tms_jobs         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON commercial.tms_charge_lines TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON commercial.tms_invoices     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON commercial.tms_sync_state   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON tms.outbound_calls          TO service_role;
