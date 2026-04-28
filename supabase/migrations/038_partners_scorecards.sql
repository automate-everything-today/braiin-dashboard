-- 038_partners_scorecards.sql
--
-- Quoting engine v2 - Phase A: carrier rolodex + scorecards.
--
-- The selection problem: when a draft enters `ready` state we need
-- to fan out to the BEST carriers for this lane + mode + equipment.
-- "Best" is a composite of five axes that are recomputed nightly
-- from real history. Operators can override the AI selection or add
-- a brand-new carrier that's not on file.
--
-- Five tables:
--   partners.carriers              - the rolodex (one row per carrier / agent / aggregator)
--   partners.carrier_contacts      - email / phone / portal endpoints (one carrier may have N)
--   partners.scorecards            - per (carrier, mode) 5-axis grading + composite
--   partners.lane_stats            - per (carrier, origin_country, dest_country, mode) aggregated
--   quotes.draft_carrier_selections - join: which carriers an operator chose for which draft
--
-- One function:
--   partners.suggest_carriers(p_org_id, p_mode, p_origin_country,
--                              p_dest_country, p_top_n, p_min_score)
--     -> ranked list of (carrier_id, name, composite_score, suitability_score,
--                         confidence, last_response_minutes, response_rate_pct)
--
-- Idempotent guards throughout. service_role grants baked in.
-- Add `partners` to Supabase Settings > API > Exposed schemas after running.

CREATE SCHEMA IF NOT EXISTS partners;
GRANT USAGE ON SCHEMA partners TO service_role;


-- ============================================================
-- partners.carriers - the rolodex
-- ============================================================

CREATE TABLE IF NOT EXISTS partners.carriers (
    carrier_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,

    name            TEXT NOT NULL,                          -- 'Hapag-Lloyd', 'Maersk Line', 'Lufthansa Cargo'
    legal_name      TEXT,                                   -- full registered name if different
    website         TEXT,

    -- Type of partner. 'carrier' = direct contracting carrier,
    -- 'agent' = origin / destination agent we hand to,
    -- 'broker' = freight broker / forwarder we sub-contract to,
    -- 'nvocc' = non-vessel operating common carrier,
    -- 'aggregator' = rate aggregator (CargoAI / Cargo.one / etc)
    kind            TEXT NOT NULL DEFAULT 'carrier'
                    CHECK (kind IN ('carrier', 'agent', 'broker', 'nvocc', 'aggregator')),

    -- Industry codes used by the cargowise carrier-lookup module.
    scac            TEXT,                                   -- ocean SCAC e.g. 'MAEU', 'MSCU'
    iata_prefix     TEXT,                                   -- 3-digit air code e.g. '020' (LH), '125' (BA)
    icao_code       TEXT,                                   -- 3-letter ICAO airline code

    -- Modes this carrier covers. Drives the selection function -
    -- a sea-only carrier never appears for an air RFQ.
    transport_modes TEXT[] NOT NULL DEFAULT '{}',           -- {'sea_fcl', 'sea_lcl', 'air', 'road', 'rail'}

    -- Type of contracting we have with them - shapes how RFQs are sent.
    -- 'api'         - direct API integration (Maersk Spot, Cargo.one, etc)
    -- 'email'       - emailed RFQ to their quotes desk
    -- 'aggregator'  - via a rate aggregator
    -- 'portal'      - we log into their portal manually
    contracting_method TEXT NOT NULL DEFAULT 'email'
                       CHECK (contracting_method IN ('api', 'email', 'aggregator', 'portal')),

    -- Operator can add a brand-new carrier inline from the Send RFQ
    -- slide-out without creating a full record first. Flag preserves
    -- the audit trail so we know which entries were manually added.
    is_manual           BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,

    -- Free-form notes operators add (e.g. "rep is Sarah Chen, fast on JP lanes").
    notes               TEXT,

    -- Audit
    created_by_staff_id INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One carrier can be on file twice in different orgs, but not within
    -- the same org. Match on legal name + kind to catch duplicates.
    UNIQUE (org_id, name, kind)
);

CREATE INDEX IF NOT EXISTS idx_partners_carriers_org_active
    ON partners.carriers (org_id, is_active);

CREATE INDEX IF NOT EXISTS idx_partners_carriers_modes
    ON partners.carriers USING GIN (transport_modes);

CREATE INDEX IF NOT EXISTS idx_partners_carriers_scac
    ON partners.carriers (scac)
    WHERE scac IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_partners_carriers_iata
    ON partners.carriers (iata_prefix)
    WHERE iata_prefix IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_partners_carriers_manual
    ON partners.carriers (org_id, created_at DESC)
    WHERE is_manual = TRUE;


-- ============================================================
-- partners.carrier_contacts
-- ============================================================
-- One carrier can have multiple contact methods (a quotes desk
-- email, a backup contact, a customer-service hotline, an API
-- endpoint, a portal URL).

CREATE TABLE IF NOT EXISTS partners.carrier_contacts (
    contact_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    carrier_id      UUID NOT NULL REFERENCES partners.carriers(carrier_id) ON DELETE CASCADE,
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,

    method          TEXT NOT NULL
                    CHECK (method IN ('email', 'phone', 'portal_url', 'api_endpoint', 'whatsapp', 'other')),
    purpose         TEXT NOT NULL DEFAULT 'rfq'
                    CHECK (purpose IN ('rfq', 'ops', 'finance', 'general', 'escalation')),

    -- The actual address / number / URL.
    value           TEXT NOT NULL,
    label           TEXT,                                   -- 'Quotes desk', 'Sarah Chen', 'After hours'

    -- Preference ranking - we use the lowest priority that matches the
    -- purpose for the RFQ.
    priority        INTEGER NOT NULL DEFAULT 1,

    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partners_carrier_contacts_carrier
    ON partners.carrier_contacts (carrier_id, purpose, priority)
    WHERE is_active = TRUE;


-- ============================================================
-- partners.scorecards - per (carrier, mode) 5-axis grading
-- ============================================================
-- Recomputed nightly by a batch job that aggregates from real
-- history (rfq invitations, quotes, jobs, incidents). Per-carrier
-- per-mode granularity keeps scoring honest - a great ocean carrier
-- might be poor at air freight.

CREATE TABLE IF NOT EXISTS partners.scorecards (
    scorecard_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    carrier_id          UUID NOT NULL REFERENCES partners.carriers(carrier_id) ON DELETE CASCADE,
    mode                TEXT NOT NULL
                        CHECK (mode IN ('sea_fcl', 'sea_lcl', 'air', 'road', 'rail', 'courier')),

    -- All scores 0..100. NULL = insufficient data; treated as
    -- mid-range (50) by the selection function.

    -- Suitability: structural fit. Boolean-like in practice -
    -- can this carrier serve this mode at all, do they take this
    -- equipment, do they have capacity in this region.
    suitability_score   NUMERIC(5,2) CHECK (suitability_score IS NULL OR suitability_score BETWEEN 0 AND 100),

    -- Speed: median minutes RFQ-sent -> RFQ-replied. Inverted into
    -- a 0..100 score (0 = never replies, 100 = replies inside 30 min).
    speed_score         NUMERIC(5,2) CHECK (speed_score IS NULL OR speed_score BETWEEN 0 AND 100),

    -- Accuracy: % of times the quoted rate matched the final invoice
    -- with no surprise charges.
    accuracy_score      NUMERIC(5,2) CHECK (accuracy_score IS NULL OR accuracy_score BETWEEN 0 AND 100),

    -- Price: average rank in multi-carrier RFQs. 100 = always cheapest,
    -- 0 = always the most expensive.
    price_score         NUMERIC(5,2) CHECK (price_score IS NULL OR price_score BETWEEN 0 AND 100),

    -- Service: composite of on-time / incident rate / claim rate /
    -- complaint rate.
    service_score       NUMERIC(5,2) CHECK (service_score IS NULL OR service_score BETWEEN 0 AND 100),

    -- Composite weighted sum. Default weights: 0.20 each on price /
    -- speed / accuracy / service, 0.20 on suitability. Per-org weights
    -- allowed via partners.scorecard_weights below.
    composite_score     NUMERIC(5,2) CHECK (composite_score IS NULL OR composite_score BETWEEN 0 AND 100),

    -- Confidence in the score - rises with sample size.
    -- < 5 RFQs = low (capped at 30), 5-20 = medium, 20+ = high.
    confidence          NUMERIC(5,2) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),

    -- Sample sizes that drove the scores - useful for debug.
    rfq_count_90d       INTEGER NOT NULL DEFAULT 0,
    reply_count_90d     INTEGER NOT NULL DEFAULT 0,
    job_count_90d       INTEGER NOT NULL DEFAULT 0,
    incident_count_90d  INTEGER NOT NULL DEFAULT 0,

    -- Median reply time. Drives the "last replied N min ago" hint
    -- in the Send RFQ slide-out.
    median_reply_minutes INTEGER,

    last_recomputed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (org_id, carrier_id, mode)
);

CREATE INDEX IF NOT EXISTS idx_partners_scorecards_lookup
    ON partners.scorecards (org_id, mode, composite_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_partners_scorecards_carrier
    ON partners.scorecards (carrier_id, mode);


-- ============================================================
-- partners.scorecard_weights - per-org composite weights
-- ============================================================

CREATE TABLE IF NOT EXISTS partners.scorecard_weights (
    org_id              UUID PRIMARY KEY REFERENCES core.organisations(id) ON DELETE CASCADE,
    weight_suitability  NUMERIC(4,3) NOT NULL DEFAULT 0.20,
    weight_speed        NUMERIC(4,3) NOT NULL DEFAULT 0.20,
    weight_accuracy     NUMERIC(4,3) NOT NULL DEFAULT 0.20,
    weight_price        NUMERIC(4,3) NOT NULL DEFAULT 0.20,
    weight_service      NUMERIC(4,3) NOT NULL DEFAULT 0.20,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_weights_sum_to_one
        CHECK (ABS((weight_suitability + weight_speed + weight_accuracy +
                    weight_price + weight_service) - 1.000) < 0.001)
);


-- ============================================================
-- partners.lane_stats - per (carrier, origin_country, dest_country, mode)
-- ============================================================
-- Drives the suitability axis for a SPECIFIC lane. A carrier with
-- a 90-percent reply rate globally might never reply for FRA-LAX.
-- Aggregated nightly from rfq invitations.

CREATE TABLE IF NOT EXISTS partners.lane_stats (
    lane_stat_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    carrier_id          UUID NOT NULL REFERENCES partners.carriers(carrier_id) ON DELETE CASCADE,

    origin_country      TEXT NOT NULL,                      -- ISO-2 country code
    destination_country TEXT NOT NULL,                      -- ISO-2 country code
    mode                TEXT NOT NULL,

    rfq_count_90d       INTEGER NOT NULL DEFAULT 0,
    reply_count_90d     INTEGER NOT NULL DEFAULT 0,
    win_count_90d       INTEGER NOT NULL DEFAULT 0,
    avg_rate_rank       NUMERIC(4,2),                       -- 1.00 = always cheapest, higher = more expensive
    median_reply_minutes INTEGER,
    on_time_pct_90d     NUMERIC(5,2),

    last_recomputed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (org_id, carrier_id, origin_country, destination_country, mode)
);

CREATE INDEX IF NOT EXISTS idx_partners_lane_stats_lookup
    ON partners.lane_stats (org_id, mode, origin_country, destination_country, reply_count_90d DESC);


-- ============================================================
-- quotes.draft_carrier_selections - which carriers picked for an RFQ
-- ============================================================
-- Persisted record of the selection step. Lets us answer "what did
-- the AI suggest, what did the operator change, what did we send to".

CREATE TABLE IF NOT EXISTS quotes.draft_carrier_selections (
    selection_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    draft_id            UUID NOT NULL REFERENCES quotes.drafts(draft_id) ON DELETE CASCADE,
    carrier_id          UUID NOT NULL REFERENCES partners.carriers(carrier_id) ON DELETE RESTRICT,

    -- Provenance of THIS specific selection:
    --   ai_suggested  - in the original AI shortlist for this lane / mode
    --   operator_added - operator added a carrier the AI didn't pick
    --   operator_kept  - operator un-checked AI suggestion then re-checked
    -- AI-suggested carriers that the operator un-checked are NOT in
    -- this table at all - they were never selected.
    provenance          TEXT NOT NULL CHECK (provenance IN ('ai_suggested', 'operator_added', 'operator_kept')),

    -- Composite score the AI used at the time we suggested. Snapshotted
    -- so operator can see "AI picked this when it had a 78 score" later
    -- even after nightly rescore.
    score_at_selection  NUMERIC(5,2),

    -- True if operator un-checked then re-checked, or added manually.
    -- Feeds the AI prompt next time ("operator overrode you for this
    -- carrier on this lane").
    overridden_by_operator BOOLEAN NOT NULL DEFAULT FALSE,

    selected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    selected_by_staff_id INTEGER,

    UNIQUE (draft_id, carrier_id)
);

CREATE INDEX IF NOT EXISTS idx_quotes_draft_carrier_selections_draft
    ON quotes.draft_carrier_selections (draft_id);

-- "How often does operator override AI for this carrier on this org?"
CREATE INDEX IF NOT EXISTS idx_quotes_draft_carrier_selections_override
    ON quotes.draft_carrier_selections (org_id, carrier_id)
    WHERE overridden_by_operator = TRUE;


-- ============================================================
-- partners.suggest_carriers() - the selection function
-- ============================================================
-- Returns the top N carriers for a (mode, origin_country,
-- destination_country) lane. Lane is optional - if unknown, falls
-- back to (mode-only) ranking. NULL scores treated as 50 (neutral)
-- so brand-new carriers can still surface and gather data.

CREATE OR REPLACE FUNCTION partners.suggest_carriers(
    p_org_id            UUID,
    p_mode              TEXT,
    p_origin_country    TEXT DEFAULT NULL,
    p_dest_country      TEXT DEFAULT NULL,
    p_top_n             INTEGER DEFAULT 8,
    p_min_score         NUMERIC DEFAULT 0
)
RETURNS TABLE (
    carrier_id              UUID,
    name                    TEXT,
    kind                    TEXT,
    contracting_method      TEXT,
    composite_score         NUMERIC,
    suitability_score       NUMERIC,
    speed_score             NUMERIC,
    accuracy_score          NUMERIC,
    price_score             NUMERIC,
    service_score           NUMERIC,
    confidence              NUMERIC,
    rfq_count_90d           INTEGER,
    reply_count_90d         INTEGER,
    median_reply_minutes    INTEGER,
    is_manual               BOOLEAN,
    has_lane_history        BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.carrier_id,
        c.name,
        c.kind,
        c.contracting_method,
        COALESCE(s.composite_score, 50)        AS composite_score,
        COALESCE(s.suitability_score, 50)      AS suitability_score,
        COALESCE(s.speed_score, 50)            AS speed_score,
        COALESCE(s.accuracy_score, 50)         AS accuracy_score,
        COALESCE(s.price_score, 50)            AS price_score,
        COALESCE(s.service_score, 50)          AS service_score,
        COALESCE(s.confidence, 0)              AS confidence,
        COALESCE(s.rfq_count_90d, 0)           AS rfq_count_90d,
        COALESCE(s.reply_count_90d, 0)         AS reply_count_90d,
        s.median_reply_minutes,
        c.is_manual,
        (l.lane_stat_id IS NOT NULL)           AS has_lane_history
    FROM partners.carriers c
    LEFT JOIN partners.scorecards s
        ON s.carrier_id = c.carrier_id
        AND s.org_id    = c.org_id
        AND s.mode      = p_mode
    LEFT JOIN partners.lane_stats l
        ON l.carrier_id           = c.carrier_id
        AND l.org_id              = c.org_id
        AND l.mode                = p_mode
        AND (p_origin_country  IS NULL OR l.origin_country      = p_origin_country)
        AND (p_dest_country    IS NULL OR l.destination_country = p_dest_country)
    WHERE c.org_id    = p_org_id
      AND c.is_active = TRUE
      AND p_mode = ANY(c.transport_modes)
      AND COALESCE(s.composite_score, 50) >= p_min_score
    ORDER BY
        -- Lane history first (carriers we've used on THIS lane jump up)
        (l.lane_stat_id IS NOT NULL) DESC,
        COALESCE(s.composite_score, 50) DESC,
        c.name ASC
    LIMIT p_top_n;
END;
$$ LANGUAGE plpgsql STABLE;


-- ============================================================
-- updated_at triggers
-- ============================================================

CREATE OR REPLACE FUNCTION partners.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_partners_carriers_touch ON partners.carriers;
CREATE TRIGGER trg_partners_carriers_touch
    BEFORE UPDATE ON partners.carriers
    FOR EACH ROW EXECUTE FUNCTION partners.touch_updated_at();

DROP TRIGGER IF EXISTS trg_partners_carrier_contacts_touch ON partners.carrier_contacts;
CREATE TRIGGER trg_partners_carrier_contacts_touch
    BEFORE UPDATE ON partners.carrier_contacts
    FOR EACH ROW EXECUTE FUNCTION partners.touch_updated_at();


-- ============================================================
-- Lockdown
-- ============================================================

REVOKE ALL ON partners.carriers              FROM PUBLIC;
REVOKE ALL ON partners.carrier_contacts      FROM PUBLIC;
REVOKE ALL ON partners.scorecards            FROM PUBLIC;
REVOKE ALL ON partners.scorecard_weights     FROM PUBLIC;
REVOKE ALL ON partners.lane_stats            FROM PUBLIC;
REVOKE ALL ON quotes.draft_carrier_selections FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON partners.carriers              TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON partners.carrier_contacts      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON partners.scorecards            TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON partners.scorecard_weights     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON partners.lane_stats            TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON quotes.draft_carrier_selections TO service_role;

GRANT EXECUTE ON FUNCTION partners.suggest_carriers(UUID, TEXT, TEXT, TEXT, INTEGER, NUMERIC) TO service_role;
