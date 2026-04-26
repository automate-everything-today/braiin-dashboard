-- ============================================================
-- 022_rate_engine_core.sql
-- Braiin Rates module - rate-card source of truth.
-- Replaces Wisor / Catapult / Cargocosting at the data layer.
--
-- Multi-tenant from day one: every table has org_id scoped to
-- core.organisations(id). Module-namespaced under `rates` schema
-- so the commercial packaging story (sell Rates standalone vs
-- bundled) is set up architecturally.
--
-- Depends on: 021_core_foundation.sql
--
-- Follow-up migrations:
--   023 commercial intelligence (commercial.* schema - clients/
--       shipments/lanes/alerts)
--   024 quotes + margin rules (quotes.* schema - the sell-side
--       artifact + email-to-quote bridge)
--   025 cargowise sync staging
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pg_net";
CREATE EXTENSION IF NOT EXISTS "pgmq";
CREATE EXTENSION IF NOT EXISTS "pg_cron";
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE SCHEMA IF NOT EXISTS rates;

-- ============================================================
-- ENUMS
-- direction_type renamed to rate_direction so the commercial
-- schema's own direction enum (which has different values incl.
-- CROSS_TRADE) doesn't clash.
-- ============================================================
CREATE TYPE rates.mode_type AS ENUM (
    'ocean_fcl','ocean_lcl','air','road_ftl',
    'road_ltl','courier','warehouse','all_modes'
);
CREATE TYPE rates.rate_card_type AS ENUM ('SPOT','CONTRACT','TENDER','SPOT_QUOTE');
CREATE TYPE rates.review_status AS ENUM ('PENDING','IN_REVIEW','APPROVED','REJECTED');
CREATE TYPE rates.source_type AS ENUM ('PDF','EXCEL','EMAIL','PORTAL','MANUAL');
CREATE TYPE rates.service_type AS ENUM ('DIRECT','TRANSSHIPMENT','MAINLINE','FEEDER','ANY');
CREATE TYPE rates.incoterm_type AS ENUM ('EXW','FOB','CIF','DAP','DDP','CPT','ANY');
CREATE TYPE rates.rate_direction AS ENUM ('IMPORT','EXPORT','BOTH');
CREATE TYPE rates.category_type AS ENUM ('Base','Surcharge','Fee','Duty','Tax','Storage','Handling');
CREATE TYPE rates.link_code_type AS ENUM ('T01','T02','P01','D01','C01','W01','S01','S02','ALL');
CREATE TYPE rates.calc_order_type AS ENUM ('BEFORE','AFTER','POST-ALL');
CREATE TYPE rates.charge_type_enum AS ENUM ('INDIVIDUAL','GROUPED','PERCENTAGE');
CREATE TYPE rates.billable_to_type AS ENUM ('SHIPPER','CONSIGNEE','THIRD_PARTY');
CREATE TYPE rates.uom_type AS ENUM ('KG','CBM','TEU','PALLET','DAY','ENTRY','AWB','BL','LOAD');
CREATE TYPE rates.rate_type_enum AS ENUM ('FLAT','PCT');
CREATE TYPE rates.confidence_type AS ENUM ('HIGH','MEDIUM','LOW');
CREATE TYPE rates.resolution_type AS ENUM ('ACCEPTED','CORRECTED','REJECTED','ESCALATED');
CREATE TYPE rates.severity_type AS ENUM ('ERROR','WARNING','INFO');
CREATE TYPE rates.issue_type_enum AS ENUM (
    'MISSING','CORRUPT','WRONG_MAPPING',
    'FORMAT_ERROR','OUT_OF_RANGE','DUPLICATE','AMBIGUOUS'
);
CREATE TYPE rates.rule_type_enum AS ENUM (
    'FIELD_MAPPING','FORMAT','LOCATION',
    'DEFAULT_VALUE','ALWAYS_MISSING','RANGE_OVERRIDE'
);

-- ============================================================
-- rates.rate_card_header
-- One row per rate card ingested. org-scoped.
-- ============================================================
CREATE SEQUENCE rates.rate_card_seq START 1;

CREATE TABLE rates.rate_card_header (
    rate_card_id        TEXT PRIMARY KEY DEFAULT 'RC-' || TO_CHAR(NOW(),'YYYY') || '-' || LPAD(NEXTVAL('rates.rate_card_seq')::TEXT, 4, '0'),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    branch_id           UUID REFERENCES core.branches(id),
    carrier_name        TEXT NOT NULL,
    carrier_code        TEXT NOT NULL,
    rate_card_type      rates.rate_card_type NOT NULL,
    mode                rates.mode_type NOT NULL,
    origin_country      CHAR(2) NOT NULL,
    origin_port         TEXT NOT NULL,
    dest_country        CHAR(2) NOT NULL,
    dest_port           TEXT NOT NULL,
    service_type        rates.service_type,
    transit_days        SMALLINT CHECK (transit_days > 0),
    incoterm            rates.incoterm_type,
    commodity           TEXT DEFAULT 'FAK',
    currency            CHAR(3) NOT NULL,
    valid_from          DATE NOT NULL,
    valid_to            DATE NOT NULL,
    version             SMALLINT NOT NULL DEFAULT 1,
    supersedes          TEXT REFERENCES rates.rate_card_header(rate_card_id),
    volume_commitment   TEXT,
    received_date       DATE NOT NULL,
    source_type         rates.source_type NOT NULL,
    source_ref          TEXT,
    contact_name        TEXT,
    ingested_by         TEXT NOT NULL,                   -- staff_email or 'AI_AGENT'
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confidence_score    SMALLINT CHECK (confidence_score BETWEEN 0 AND 100),
    review_status       rates.review_status NOT NULL DEFAULT 'PENDING',
    gate_level          SMALLINT NOT NULL DEFAULT 1 CHECK (gate_level BETWEEN 1 AND 4),
    redis_key           TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT valid_dates CHECK (valid_to > valid_from),
    CONSTRAINT port_not_empty CHECK (origin_port != '' AND dest_port != '')
);

-- Every read filters by org_id; every lane query continues from there.
CREATE INDEX idx_rch_org_lane ON rates.rate_card_header (org_id, mode, origin_port, dest_port);
CREATE INDEX idx_rch_org_carrier ON rates.rate_card_header (org_id, carrier_code, mode);
CREATE INDEX idx_rch_org_validity ON rates.rate_card_header (org_id, valid_from, valid_to);
CREATE INDEX idx_rch_org_status ON rates.rate_card_header (org_id, review_status, gate_level);
CREATE INDEX idx_rch_supersedes ON rates.rate_card_header (supersedes) WHERE supersedes IS NOT NULL;
-- Composite for the hot read path (best-rate lookup per tenant per lane)
CREATE INDEX idx_rch_best_rate_query ON rates.rate_card_header
    (org_id, mode, origin_port, dest_port, valid_from, valid_to, review_status, gate_level);

-- Enforce version monotonicity AND org isolation on supersedes chain
CREATE OR REPLACE FUNCTION rates.enforce_version_monotonic()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    parent_version  SMALLINT;
    parent_org      UUID;
BEGIN
    IF NEW.supersedes IS NOT NULL THEN
        SELECT version, org_id INTO parent_version, parent_org
        FROM rates.rate_card_header
        WHERE rate_card_id = NEW.supersedes;

        IF parent_org IS NOT NULL AND parent_org != NEW.org_id THEN
            RAISE EXCEPTION 'Cannot supersede a rate card belonging to a different organisation';
        END IF;
        IF parent_version IS NOT NULL AND NEW.version <= parent_version THEN
            RAISE EXCEPTION 'Version % must be greater than superseded version %',
                NEW.version, parent_version;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_version_monotonic
    BEFORE INSERT OR UPDATE OF version, supersedes, org_id ON rates.rate_card_header
    FOR EACH ROW EXECUTE FUNCTION rates.enforce_version_monotonic();

-- ============================================================
-- rates.charge_lines
-- ============================================================
CREATE SEQUENCE rates.charge_line_seq START 1;

CREATE TABLE rates.charge_lines (
    charge_line_id          TEXT PRIMARY KEY DEFAULT 'CL-' || LPAD(NEXTVAL('rates.charge_line_seq')::TEXT, 6, '0'),
    rate_card_id            TEXT NOT NULL REFERENCES rates.rate_card_header(rate_card_id) ON DELETE CASCADE,
    org_id                  UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    charge_line_seq         SMALLINT NOT NULL DEFAULT 10,
    charge_code             TEXT NOT NULL,
    charge_name             TEXT NOT NULL,
    category                rates.category_type NOT NULL,
    mode                    rates.mode_type NOT NULL,
    direction               rates.rate_direction NOT NULL DEFAULT 'BOTH',
    origin_port             TEXT,
    dest_port               TEXT,
    charge_basis            TEXT NOT NULL,
    currency                CHAR(3) NOT NULL,
    mandatory               BOOLEAN NOT NULL DEFAULT TRUE,
    billable_to             rates.billable_to_type NOT NULL DEFAULT 'SHIPPER',
    link_code               rates.link_code_type NOT NULL,
    applies_to              TEXT,
    calc_order              rates.calc_order_type NOT NULL,
    charge_type             rates.charge_type_enum NOT NULL,
    cap_amount              NUMERIC(12,2),
    apply_when              TEXT NOT NULL DEFAULT 'Always',
    free_units              NUMERIC(8,2),
    effective_from          DATE,
    effective_to            DATE,
    extraction_confidence   rates.confidence_type NOT NULL DEFAULT 'MEDIUM',
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (rate_card_id, charge_line_seq),
    -- BEFORE has no applies_to; AFTER and POST-ALL require it.
    CONSTRAINT applies_to_required CHECK (
        (calc_order = 'BEFORE' AND applies_to IS NULL) OR
        (calc_order IN ('AFTER','POST-ALL') AND applies_to IS NOT NULL)
    )
);

CREATE INDEX idx_cl_org_rate_card ON rates.charge_lines (org_id, rate_card_id);
CREATE INDEX idx_cl_charge_code ON rates.charge_lines (charge_code);
CREATE INDEX idx_cl_link_code ON rates.charge_lines (link_code, calc_order);
CREATE INDEX idx_cl_mode_direction ON rates.charge_lines (mode, direction);
CREATE INDEX idx_cl_mandatory ON rates.charge_lines (rate_card_id, link_code)
    WHERE mandatory = TRUE;

-- ============================================================
-- rates.rate_breaks
-- Breaks are rows, not columns. Each charge has 1..N breaks.
-- ============================================================
CREATE SEQUENCE rates.break_seq START 1;

CREATE TABLE rates.rate_breaks (
    break_id            TEXT PRIMARY KEY DEFAULT 'BR-' || LPAD(NEXTVAL('rates.break_seq')::TEXT, 7, '0'),
    charge_line_id      TEXT NOT NULL REFERENCES rates.charge_lines(charge_line_id) ON DELETE CASCADE,
    rate_card_id        TEXT NOT NULL REFERENCES rates.rate_card_header(rate_card_id) ON DELETE CASCADE,
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    break_seq           SMALLINT NOT NULL DEFAULT 10,
    break_label         TEXT NOT NULL,
    uom                 rates.uom_type NOT NULL,
    min_qty             NUMERIC(12,4) NOT NULL DEFAULT 0,
    max_qty             NUMERIC(12,4),
    zone                TEXT,
    commodity_class     TEXT,
    rate                NUMERIC(14,4) NOT NULL,
    rate_type           rates.rate_type_enum NOT NULL,
    min_charge          NUMERIC(12,2),
    -- Explicit currency for min_charge so the calc engine can't mix
    -- a min_charge in USD with a rate-card currency of GBP and
    -- silently corrupt totals.
    min_charge_currency CHAR(3),
    -- NULL = inherit from charge line
    currency            CHAR(3),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (charge_line_id, break_seq),
    CONSTRAINT rate_positive CHECK (rate >= 0),
    CONSTRAINT qty_range CHECK (max_qty IS NULL OR max_qty >= min_qty)
);

CREATE INDEX idx_rb_charge_line ON rates.rate_breaks (charge_line_id, break_seq);
CREATE INDEX idx_rb_org_rate_card ON rates.rate_breaks (org_id, rate_card_id);
CREATE INDEX idx_rb_break_label ON rates.rate_breaks (break_label);
CREATE INDEX idx_rb_qty_range ON rates.rate_breaks (charge_line_id, min_qty, max_qty);

-- ============================================================
-- rates.feedback_log
-- Validation events from ingestion. Drives the gate-level lift
-- and the carrier_profile rule learning.
-- ============================================================
CREATE SEQUENCE rates.feedback_seq START 1;

CREATE TABLE rates.feedback_log (
    feedback_id             TEXT PRIMARY KEY DEFAULT 'FB-' || LPAD(NEXTVAL('rates.feedback_seq')::TEXT, 7, '0'),
    rate_card_id            TEXT NOT NULL REFERENCES rates.rate_card_header(rate_card_id),
    org_id                  UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    charge_line_id          TEXT REFERENCES rates.charge_lines(charge_line_id),
    break_id                TEXT REFERENCES rates.rate_breaks(break_id),
    field_name              TEXT NOT NULL,
    validation_code         TEXT NOT NULL,
    severity                rates.severity_type NOT NULL,
    issue_type              rates.issue_type_enum NOT NULL,
    extracted_value         TEXT,
    corrected_value         TEXT,
    confidence              rates.confidence_type NOT NULL,
    resolution              rates.resolution_type,
    reviewer_id             TEXT,
    reviewed_at             TIMESTAMPTZ,
    review_duration_sec     INTEGER,
    gate_level_at_time      SMALLINT,
    auto_rule_created       BOOLEAN NOT NULL DEFAULT FALSE,
    rule_id                 TEXT,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fl_org_rate_card ON rates.feedback_log (org_id, rate_card_id);
CREATE INDEX idx_fl_unresolved ON rates.feedback_log (org_id, severity)
    WHERE resolution IS NULL;
CREATE INDEX idx_fl_errors ON rates.feedback_log (org_id, validation_code)
    WHERE severity = 'ERROR';

-- ============================================================
-- rates.carrier_profile
-- Learned extraction rules per carrier per org.
-- ============================================================
CREATE TABLE rates.carrier_profile (
    rule_id             TEXT PRIMARY KEY,
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    carrier_code        TEXT NOT NULL,
    rule_type           rates.rule_type_enum NOT NULL,
    applies_to_field    TEXT NOT NULL,
    condition_text      TEXT NOT NULL,
    action_text         TEXT NOT NULL,
    value_text          TEXT,
    confidence_boost    SMALLINT NOT NULL DEFAULT 10 CHECK (confidence_boost BETWEEN 0 AND 100),
    created_from        TEXT NOT NULL REFERENCES rates.feedback_log(feedback_id),
    times_applied       INTEGER NOT NULL DEFAULT 0,
    times_correct       INTEGER NOT NULL DEFAULT 0,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cp_org_carrier ON rates.carrier_profile (org_id, carrier_code, active);

-- ============================================================
-- rates.charge_code_ref
-- Master library of charge codes. Org-scoped so each tenant
-- can extend with their own house codes alongside the standards.
-- A bootstrap row set is loaded by a separate seed migration.
-- ============================================================
CREATE TABLE rates.charge_code_ref (
    charge_code         TEXT NOT NULL,
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    charge_name         TEXT NOT NULL,
    category            rates.category_type NOT NULL,
    applies_to_modes    TEXT[] NOT NULL,
    typical_basis       TEXT,
    typical_link_code   rates.link_code_type,
    mandatory_for_modes TEXT[],
    notes               TEXT,
    active              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, charge_code)
);

CREATE INDEX idx_ccr_org_mode ON rates.charge_code_ref USING GIN (applies_to_modes);

-- ============================================================
-- rates.composition_queue
-- Tracks composition jobs (visibility + retry audit). pgmq is
-- the actual queue; this table is the audit log.
-- ============================================================
CREATE TABLE rates.composition_queue (
    job_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rate_card_id        TEXT NOT NULL REFERENCES rates.rate_card_header(rate_card_id),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    status              TEXT NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING','PROCESSING','DONE','FAILED','RETRYING')),
    attempt_count       SMALLINT NOT NULL DEFAULT 0,
    max_attempts        SMALLINT NOT NULL DEFAULT 3,
    error_message       TEXT,
    redis_key           TEXT,
    queued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    next_retry_at       TIMESTAMPTZ
);

CREATE INDEX idx_cq_pending ON rates.composition_queue (status, queued_at)
    WHERE status IN ('PENDING','RETRYING');
CREATE INDEX idx_cq_rate_card ON rates.composition_queue (rate_card_id);

-- Idempotency: at most one open job per rate_card. Trigger
-- double-fires can't create duplicate composition tasks.
CREATE UNIQUE INDEX uniq_cq_open_per_card
    ON rates.composition_queue (rate_card_id)
    WHERE status IN ('PENDING','PROCESSING','RETRYING');

-- ============================================================
-- updated_at triggers
-- ============================================================
CREATE TRIGGER trg_rch_updated_at
    BEFORE UPDATE ON rates.rate_card_header
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at();

CREATE TRIGGER trg_cp_updated_at
    BEFORE UPDATE ON rates.carrier_profile
    FOR EACH ROW EXECUTE FUNCTION core.update_updated_at();

-- ============================================================
-- Composition trigger (on approval)
-- The pgmq message includes org_id so the composer can route
-- the composed object to the right Redis namespace per tenant.
-- ============================================================
CREATE OR REPLACE FUNCTION rates.trigger_composition_on_approval()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.review_status = 'APPROVED' AND
       (OLD.review_status IS DISTINCT FROM 'APPROVED') THEN

        INSERT INTO rates.composition_queue (rate_card_id, org_id)
        VALUES (NEW.rate_card_id, NEW.org_id)
        ON CONFLICT DO NOTHING;

        PERFORM pgmq.send(
            'rate_card_composition',
            jsonb_build_object(
                'rate_card_id', NEW.rate_card_id,
                'org_id',       NEW.org_id,
                'mode',         NEW.mode,
                'origin_port',  NEW.origin_port,
                'dest_port',    NEW.dest_port,
                'carrier_code', NEW.carrier_code,
                'valid_from',   NEW.valid_from,
                'version',      NEW.version
            )
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_composition_on_approval
    AFTER UPDATE OF review_status ON rates.rate_card_header
    FOR EACH ROW EXECUTE FUNCTION rates.trigger_composition_on_approval();

-- Daily expiry job
SELECT cron.schedule(
    'expire-rate-cards',
    '0 0 * * *',
    $$ UPDATE rates.rate_card_header
       SET review_status = 'REJECTED', updated_at = NOW()
       WHERE review_status = 'APPROVED'
         AND valid_to < CURRENT_DATE
         AND redis_key IS NOT NULL $$
);

-- ============================================================
-- pgmq queues (one set per Supabase project; messages carry org_id)
-- ============================================================
SELECT pgmq.create('rate_card_composition');
SELECT pgmq.create('rate_card_expiry');
SELECT pgmq.create('carrier_profile_rebuild');

-- ============================================================
-- VIEWS
-- All views WHERE-filter active gate-2+ cards. Application layer
-- adds org_id filter at query time.
-- ============================================================
CREATE VIEW rates.active_rate_cards AS
SELECT
    rch.rate_card_id, rch.org_id, rch.carrier_code, rch.carrier_name, rch.mode,
    rch.origin_port, rch.dest_port, rch.rate_card_type, rch.transit_days,
    rch.valid_from, rch.valid_to, rch.confidence_score, rch.gate_level,
    rch.redis_key, rch.currency
FROM rates.rate_card_header rch
WHERE rch.review_status = 'APPROVED'
  AND rch.valid_from <= CURRENT_DATE
  AND rch.valid_to >= CURRENT_DATE
  AND rch.gate_level > 1;

CREATE VIEW rates.unresolved_feedback AS
SELECT fl.*, rch.carrier_name, rch.mode, rch.origin_port, rch.dest_port
FROM rates.feedback_log fl
JOIN rates.rate_card_header rch ON fl.rate_card_id = rch.rate_card_id
WHERE fl.resolution IS NULL
ORDER BY fl.severity DESC, fl.created_at ASC;

CREATE VIEW rates.gate_progression AS
SELECT org_id, carrier_code, mode, origin_port, dest_port,
    COUNT(*) FILTER (WHERE review_status = 'APPROVED') AS approved_cards,
    MAX(gate_level) AS current_gate_level,
    AVG(confidence_score) AS avg_confidence,
    COUNT(*) FILTER (WHERE review_status = 'APPROVED' AND gate_level >= 2) AS auto_eligible
FROM rates.rate_card_header
GROUP BY org_id, carrier_code, mode, origin_port, dest_port;

-- ============================================================
-- ROW LEVEL SECURITY
-- Same pattern as 018, 020, 021: REVOKE anon/authenticated,
-- service-role API path is the only access route. Application
-- layer enforces org_id filter on every query.
-- ============================================================
ALTER TABLE rates.rate_card_header  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates.charge_lines      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates.rate_breaks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates.feedback_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates.carrier_profile   ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates.charge_code_ref   ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates.composition_queue ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON rates.rate_card_header,
              rates.charge_lines,
              rates.rate_breaks,
              rates.feedback_log,
              rates.carrier_profile,
              rates.charge_code_ref,
              rates.composition_queue
       FROM anon, authenticated;
