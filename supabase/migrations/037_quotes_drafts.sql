-- 037_quotes_drafts.sql
--
-- Quoting engine v2 - foundational schema (Phase A0 backend).
--
-- Three tables underpin the entire quoting workflow:
--
--   quotes.sibling_groups   - one inbound email split into N quote drafts
--                              (e.g. "give me Express, Standard, and Economy
--                              for FRA-ORD" -> 3 sibling drafts).
--   quotes.drafts           - the heart of the engine. Each row is one quote
--                              progressing through a state machine. Holds
--                              extracted shipment fields, AI confidence,
--                              denormalised inbox columns.
--   quotes.input_requests   - operator-facing open questions when the draft
--                              is in `needs_input` (delivery rate fetch,
--                              manual spot quote, internal question).
--
-- State machine for quotes.drafts.status:
--
--   new -> gathering -> ready -> sourcing -> recommended -> sent -> won
--                                                                |- lost
--                                                                |- expired
--
--   needs_input is reachable from any active state (new / gathering / ready /
--   sourcing / recommended). When the operator answers, the draft returns to
--   the state stored in last_state_before_input.
--
-- Idempotent guards throughout. service_role grants baked in.
-- After running: add `quotes` to Supabase Settings > API > Exposed schemas.

CREATE SCHEMA IF NOT EXISTS quotes;
GRANT USAGE ON SCHEMA quotes TO service_role;


-- ============================================================
-- quotes.sibling_groups
-- ============================================================
-- One row per inbound email that classify-email decided to split into
-- N drafts. Singletons (the common case) get NULL sibling_group_id on
-- the draft and no row here.

CREATE TABLE IF NOT EXISTS quotes.sibling_groups (
    group_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,

    -- Source email reference. communication_thread_id is also held on each
    -- child draft, but kept here too for fast group-level lookup.
    source_email_id     TEXT,
    communication_thread_id UUID REFERENCES activity.communication_threads(thread_id) ON DELETE SET NULL,

    -- AI confidence in the split (0..1). Below threshold -> operator review
    -- flag set; above threshold -> auto-create children.
    split_confidence    NUMERIC(4,3) NOT NULL CHECK (split_confidence BETWEEN 0 AND 1),
    split_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Operator review state. Set TRUE once a human confirmed or edited the
    -- split. Low-confidence splits stay FALSE until reviewed.
    operator_reviewed   BOOLEAN NOT NULL DEFAULT FALSE,
    operator_reviewed_at TIMESTAMPTZ,
    operator_reviewed_by INTEGER,

    -- AI's reasoning for the split (which sentences triggered which sibling).
    -- Useful for the operator review screen and for prompt tuning.
    split_reasoning     JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_sibling_groups_org
    ON quotes.sibling_groups (org_id, split_at DESC);

CREATE INDEX IF NOT EXISTS idx_quotes_sibling_groups_review
    ON quotes.sibling_groups (org_id, split_at DESC)
    WHERE operator_reviewed = FALSE;


-- ============================================================
-- quotes.drafts - the central RFQ table
-- ============================================================
-- Identity:
--   draft_id     - internal UUID PK
--   display_id   - human-readable code 'BR-YYYY-MMDD-NNNN' generated at
--                  insert time. Unique per org. Used in operator UI,
--                  customer-facing emails, and CW push ClientReference.

CREATE TABLE IF NOT EXISTS quotes.drafts (
    draft_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    display_id      TEXT NOT NULL,
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,

    -- Customer side. Soft-FK to commercial.companies if/when present.
    -- Kept loose so a draft from an unknown sender can land before
    -- the customer is on file.
    customer_id     UUID,
    customer_name   TEXT NOT NULL,

    -- =========================================================
    -- State machine
    -- =========================================================
    status          TEXT NOT NULL DEFAULT 'new'
                    CHECK (status IN (
                        'new',
                        'gathering',
                        'needs_input',
                        'ready',
                        'sourcing',
                        'recommended',
                        'sent',
                        'won',
                        'lost',
                        'expired'
                    )),

    -- When status='needs_input', this is the state we came from so we know
    -- where to flip back to once the input arrives.
    last_state_before_input TEXT
                    CHECK (last_state_before_input IS NULL OR last_state_before_input IN (
                        'new', 'gathering', 'ready', 'sourcing', 'recommended'
                    )),

    -- Per-status entered-at timestamps. Set on first transition into the
    -- state; not overwritten if the draft passes through twice (use the
    -- separate quotes.input_requests timeline for needs_input cycles).
    received_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    gathering_started_at    TIMESTAMPTZ,
    needs_input_at          TIMESTAMPTZ,
    ready_at                TIMESTAMPTZ,
    sourcing_started_at     TIMESTAMPTZ,
    first_response_at       TIMESTAMPTZ,
    recommended_at          TIMESTAMPTZ,
    sent_at                 TIMESTAMPTZ,
    outcome_at              TIMESTAMPTZ,

    -- Time-in-current-state convenience pointer. Updated by the
    -- status-transition trigger to whichever of the per-status
    -- timestamps matches `status` right now. Lets the inbox query
    -- sort by current-state age without a CASE expression.
    state_entered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- =========================================================
    -- Sibling group (multi-quote-per-email)
    -- =========================================================
    sibling_group_id    UUID REFERENCES quotes.sibling_groups(group_id) ON DELETE SET NULL,
    sibling_intent      TEXT,                       -- 'Express', 'Standard', 'LCL option'
    sibling_index       INTEGER,                    -- 1, 2, 3... within the group

    -- =========================================================
    -- Source attribution
    -- =========================================================
    source_type         TEXT NOT NULL DEFAULT 'email'
                        CHECK (source_type IN ('email', 'manual', 'portal', 'phone')),
    source_inbox        TEXT,                       -- 'rob@', 'ops@', 'quotes@'
    source_external_ref TEXT,                       -- inbound email message-id, portal ref, ...
    communication_thread_id UUID REFERENCES activity.communication_threads(thread_id) ON DELETE SET NULL,

    -- =========================================================
    -- Shipment specifics (extracted from the inbound RFQ)
    -- =========================================================
    mode                TEXT
                        CHECK (mode IS NULL OR mode IN (
                            'sea_fcl', 'sea_lcl', 'air', 'road', 'rail', 'courier', 'multimodal'
                        )),
    equipment           TEXT,
    origin_unlocode     TEXT,
    destination_unlocode TEXT,
    origin_text         TEXT,                       -- free-form when no LOCODE match
    destination_text    TEXT,
    volume_text         TEXT,                       -- '2x40HC, 50 CBM' free-form
    weight_kg           NUMERIC(12,2),
    volume_cbm          NUMERIC(12,2),
    pieces              INTEGER,
    commodity           TEXT,
    incoterms           TEXT,                       -- 'DDP', 'CIF', 'FOB', 'EXW', ...
    collection_date     DATE,
    validity_needed_days INTEGER,

    -- =========================================================
    -- AI extraction + decision-loop
    -- =========================================================
    -- Raw classify-email output (entire object).
    ai_extracted        JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Pointer into activity.llm_calls / llm_feedback so we can attribute
    -- subsequent operator overrides back to the prompt that produced this.
    ai_decision_id      UUID,

    -- Outstanding fields the AI flagged as missing, free-form text.
    -- Drives the inbox 'missing: X, Y' display and the Ask-for-info panel.
    missing_fields      TEXT[] NOT NULL DEFAULT '{}',

    -- =========================================================
    -- Denormalised columns for inbox (set on transitions, kept fresh
    -- by application code or recompute jobs).
    -- =========================================================
    carriers_invited            INTEGER,
    carriers_responded          INTEGER,
    top_recommendation_summary  TEXT,                   -- 'Hapag-Lloyd · £2,510'
    top_recommendation_margin_pct NUMERIC(6,3),
    top_recommendation_currency TEXT,
    top_recommendation_amount   NUMERIC(14,2),

    -- =========================================================
    -- Audit
    -- =========================================================
    created_by_staff_id     INTEGER,
    closed_at               TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (org_id, display_id),
    CONSTRAINT chk_sibling_consistency
        CHECK (
            (sibling_group_id IS NULL AND sibling_intent IS NULL AND sibling_index IS NULL) OR
            (sibling_group_id IS NOT NULL AND sibling_intent IS NOT NULL AND sibling_index IS NOT NULL)
        )
);

-- =========================================================
-- Indexes for the inbox query
-- =========================================================

-- Primary inbox view: open drafts sorted by current-state age.
CREATE INDEX IF NOT EXISTS idx_quotes_drafts_org_status_state_entered
    ON quotes.drafts (org_id, status, state_entered_at DESC);

-- Open-only partial index for the default 'Open' filter.
CREATE INDEX IF NOT EXISTS idx_quotes_drafts_open
    ON quotes.drafts (org_id, state_entered_at DESC)
    WHERE status IN ('new', 'gathering', 'needs_input', 'ready', 'sourcing', 'recommended');

-- Sibling lookup: 'show me all drafts in this group'.
CREATE INDEX IF NOT EXISTS idx_quotes_drafts_sibling_group
    ON quotes.drafts (sibling_group_id, sibling_index)
    WHERE sibling_group_id IS NOT NULL;

-- Customer search: 'all drafts for ABC Manufacturing in last 30 days'.
CREATE INDEX IF NOT EXISTS idx_quotes_drafts_customer
    ON quotes.drafts (org_id, customer_id, created_at DESC)
    WHERE customer_id IS NOT NULL;

-- Lane search: 'all FXT-CNSHA drafts in last 90 days for scorecard input'.
CREATE INDEX IF NOT EXISTS idx_quotes_drafts_lane
    ON quotes.drafts (org_id, origin_unlocode, destination_unlocode, mode, created_at DESC)
    WHERE origin_unlocode IS NOT NULL AND destination_unlocode IS NOT NULL;

-- Inbound thread back-reference: 'find the draft that came from this email'.
CREATE INDEX IF NOT EXISTS idx_quotes_drafts_source_ref
    ON quotes.drafts (org_id, source_external_ref)
    WHERE source_external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_drafts_thread
    ON quotes.drafts (communication_thread_id)
    WHERE communication_thread_id IS NOT NULL;

-- Stale-row monitoring: rows that have been waiting on input for too long.
CREATE INDEX IF NOT EXISTS idx_quotes_drafts_needs_input
    ON quotes.drafts (org_id, needs_input_at)
    WHERE status = 'needs_input';


-- ============================================================
-- quotes.input_requests
-- ============================================================
-- Operator-facing open questions when a draft is in needs_input.
-- One draft can have multiple open requests (e.g. one for delivery
-- rate, one for a customer question that came in via phone). When
-- ALL outstanding requests are answered, the draft flips back to
-- last_state_before_input.

CREATE TABLE IF NOT EXISTS quotes.input_requests (
    request_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    draft_id        UUID NOT NULL REFERENCES quotes.drafts(draft_id) ON DELETE CASCADE,
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,

    -- What kind of input is needed:
    --   delivery_rate  - need to fetch a haulage / last-mile rate
    --   spot_rate      - need to manually quote a carrier outside automation
    --   question       - operator question (internal SME, customer, finance)
    --   haulage        - shorthand for delivery_rate (legacy alias)
    --   other          - free-form
    kind            TEXT NOT NULL CHECK (kind IN (
                        'delivery_rate', 'spot_rate', 'question', 'haulage', 'other'
                    )),

    -- The actual question / what's needed. Free-form, AI-generated when
    -- classify-email determined the input, operator-edited otherwise.
    description     TEXT NOT NULL,

    -- Optional structured context (carrier name, lane segment, etc).
    context         JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Routing
    asked_of_staff_id   INTEGER,                    -- who needs to answer
    asked_by_staff_id   INTEGER,                    -- who raised it (NULL when AI raised)

    -- Lifecycle
    asked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    answered_at     TIMESTAMPTZ,
    answer          TEXT,
    answer_metadata JSONB,                          -- e.g. rate amount + currency for delivery_rate

    -- Cancelled (e.g. customer answered separately, no longer relevant).
    cancelled_at    TIMESTAMPTZ,
    cancelled_reason TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_input_requests_draft
    ON quotes.input_requests (draft_id, asked_at DESC);

-- 'My open input requests' - operator dashboard view.
CREATE INDEX IF NOT EXISTS idx_quotes_input_requests_open_assignee
    ON quotes.input_requests (org_id, asked_of_staff_id, asked_at)
    WHERE answered_at IS NULL AND cancelled_at IS NULL;

-- 'Unassigned open input requests' - triage queue.
CREATE INDEX IF NOT EXISTS idx_quotes_input_requests_open_unassigned
    ON quotes.input_requests (org_id, asked_at)
    WHERE answered_at IS NULL AND cancelled_at IS NULL AND asked_of_staff_id IS NULL;


-- ============================================================
-- Status transition trigger
-- ============================================================
-- Keeps state_entered_at and the per-status timestamps coherent on
-- every UPDATE. Application code only has to write the new status -
-- the timestamps follow automatically.

CREATE OR REPLACE FUNCTION quotes.touch_state_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    -- Always bump updated_at.
    NEW.updated_at := NOW();

    -- Only rewrite state timestamps on actual status change.
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        NEW.state_entered_at := NOW();

        -- Stamp the FIRST entry into each state; never overwrite.
        IF NEW.status = 'gathering'   AND NEW.gathering_started_at IS NULL THEN
            NEW.gathering_started_at := NOW();
        ELSIF NEW.status = 'needs_input' THEN
            NEW.needs_input_at := NOW();
            -- Capture where to flip back to.
            IF OLD.status <> 'needs_input' THEN
                NEW.last_state_before_input := OLD.status;
            END IF;
        ELSIF NEW.status = 'ready'    AND NEW.ready_at IS NULL THEN
            NEW.ready_at := NOW();
            -- Returning from needs_input clears the marker.
            NEW.last_state_before_input := NULL;
        ELSIF NEW.status = 'sourcing' AND NEW.sourcing_started_at IS NULL THEN
            NEW.sourcing_started_at := NOW();
            NEW.last_state_before_input := NULL;
        ELSIF NEW.status = 'recommended' AND NEW.recommended_at IS NULL THEN
            NEW.recommended_at := NOW();
            NEW.last_state_before_input := NULL;
        ELSIF NEW.status = 'sent'     AND NEW.sent_at IS NULL THEN
            NEW.sent_at := NOW();
        ELSIF NEW.status IN ('won', 'lost', 'expired') AND NEW.outcome_at IS NULL THEN
            NEW.outcome_at := NOW();
            NEW.closed_at  := NOW();
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quotes_drafts_state ON quotes.drafts;
CREATE TRIGGER trg_quotes_drafts_state
    BEFORE UPDATE ON quotes.drafts
    FOR EACH ROW EXECUTE FUNCTION quotes.touch_state_timestamps();


-- ============================================================
-- updated_at maintenance for the side tables
-- ============================================================

CREATE OR REPLACE FUNCTION quotes.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quotes_sibling_groups_touch ON quotes.sibling_groups;
CREATE TRIGGER trg_quotes_sibling_groups_touch
    BEFORE UPDATE ON quotes.sibling_groups
    FOR EACH ROW EXECUTE FUNCTION quotes.touch_updated_at();

DROP TRIGGER IF EXISTS trg_quotes_input_requests_touch ON quotes.input_requests;
CREATE TRIGGER trg_quotes_input_requests_touch
    BEFORE UPDATE ON quotes.input_requests
    FOR EACH ROW EXECUTE FUNCTION quotes.touch_updated_at();


-- ============================================================
-- display_id generator
-- ============================================================
-- Generates 'BR-YYYY-MMDD-NNNN' where NNNN is a per-org daily counter.
-- Application code calls SELECT quotes.next_display_id(org_id) before
-- INSERTing the draft. Daily reset keeps the digits readable.

CREATE TABLE IF NOT EXISTS quotes.display_id_counter (
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    day             DATE NOT NULL,
    last_value      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (org_id, day)
);

CREATE OR REPLACE FUNCTION quotes.next_display_id(p_org_id UUID)
RETURNS TEXT AS $$
DECLARE
    v_day   DATE   := CURRENT_DATE;
    v_next  INTEGER;
BEGIN
    INSERT INTO quotes.display_id_counter (org_id, day, last_value)
    VALUES (p_org_id, v_day, 1)
    ON CONFLICT (org_id, day) DO UPDATE
        SET last_value = quotes.display_id_counter.last_value + 1
    RETURNING last_value INTO v_next;

    RETURN 'BR-' || TO_CHAR(v_day, 'YYYY-MMDD') || '-' || LPAD(v_next::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- Lockdown
-- ============================================================

REVOKE ALL ON quotes.sibling_groups       FROM PUBLIC;
REVOKE ALL ON quotes.drafts               FROM PUBLIC;
REVOKE ALL ON quotes.input_requests       FROM PUBLIC;
REVOKE ALL ON quotes.display_id_counter   FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON quotes.sibling_groups     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON quotes.drafts             TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON quotes.input_requests     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON quotes.display_id_counter TO service_role;

GRANT EXECUTE ON FUNCTION quotes.next_display_id(UUID) TO service_role;
