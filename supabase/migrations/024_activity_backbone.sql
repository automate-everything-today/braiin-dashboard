-- ============================================================
-- 024_activity_backbone.sql
-- Braiin Stream module - operational event log + correlation
-- infrastructure + forensic paper trail.
--
-- Implements RFC 024 (docs/rfc/024_activity_backbone.md).
--
-- Four locked architectural decisions:
--   1. Polymorphic linking via subject_type TEXT, subject_id TEXT
--      with no RDBMS FK; per-subject-type partial indexes for hot
--      reads; nightly orphan audit view.
--   2. activity.events is partitioned BY RANGE (occurred_at) at
--      monthly granularity from day one. 24 months bootstrap
--      forward; pg_cron rotates a new partition each month.
--      Partition key = occurred_at (when the event happened, not
--      when the row was inserted) so timeline reads get pruning.
--   3. Schema designed with margin-loop end state in mind. The
--      events table carries enough metadata (counterparty,
--      attachments JSONB, structured per-event metadata) to feed
--      the realised-margin reconciliation that ships in 028.
--   4. Three-layer correlation ID: Reply-To token + subject tag +
--      Message-ID / In-Reply-To. activity.outbound_correlation_tokens
--      tracks the token -> subject mapping with 90d expiry.
--
-- Module is INFRASTRUCTURE - not commercially gated. Defaulted on
-- for every tenant in core.module_features (seeded below).
--
-- Lessons baked in from earlier migration apply (023 hit four
-- separate Postgres gotchas):
--   - No CREATE TYPE collision risk: activity.* type names are
--     unique. No DO/EXCEPTION pattern needed.
--   - No date_trunc in index expressions (function not IMMUTABLE
--     for DATE input). Indexes use raw occurred_at.
--   - No UPDATE OF column-list combined with REFERENCING NEW TABLE
--     (Postgres forbids the combination).
--   - Idempotent partition creation (CREATE TABLE IF NOT EXISTS)
--     so the rotation function is safe to re-run.
--
-- Depends on: 021_core_foundation.sql, 022_rate_engine_core.sql,
--             023_commercial_intelligence.sql.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS activity;

ALTER DEFAULT PRIVILEGES IN SCHEMA activity REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA activity REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA activity REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA activity REVOKE ALL ON TYPES FROM PUBLIC;

-- ============================================================
-- TOKEN ENTROPY REQUIREMENT (security)
-- The correlation tokens stored in activity.outbound_correlation_tokens
-- are embedded in OUTBOUND emails (Reply-To envelope, subject tag,
-- Message-ID) which leave our trust boundary. The minted token must
-- carry >= 128 bits of cryptographically random entropy to prevent
-- targeted guessing attacks (an attacker who knows an RFQ exists can
-- otherwise guess a valid token in finite time and pollute the audit
-- trail with crafted "inbound" events).
--
-- Required SDK token format: <entity_prefix>-<22 base64url chars from
-- crypto.randomBytes(16)>. The entity prefix and date are decorative
-- and DO NOT count toward entropy. Any token format with less than
-- 128 bits of randomness MUST be rejected at the SDK boundary.
-- ============================================================

-- ============================================================
-- ENUMS
-- event_type is intentionally exhaustive. Adding values is cheap
-- (ALTER TYPE ... ADD VALUE), removing is expensive. Lean toward
-- specificity now to avoid retroactive renames.
-- ============================================================

CREATE TYPE activity.event_type AS ENUM (
    -- Communications
    'email_sent', 'email_received', 'email_bounced', 'email_replied',
    'phone_call', 'meeting', 'sms_sent', 'sms_received',
    'manual_note',
    -- RFQ / quote workflow
    'rfq_drafted', 'rfq_sent', 'rfq_acknowledged',
    'rate_indicated', 'rate_firm_quoted', 'rate_subject_to',
    'rate_validity_expiring', 'rate_validity_expired',
    'rfq_awarded', 'rfq_lost',
    'quote_sent', 'quote_accepted', 'quote_rejected', 'quote_expired',
    'counter_offer_sent', 'counter_offer_received',
    -- Booking lifecycle
    'booking_placed', 'booking_confirmed', 'booking_partial',
    's_o_issued', 'vgm_submitted', 'si_submitted',
    'cargo_ready', 'gate_in', 'loaded_on_board',
    'vessel_departed', 'vessel_arrived',
    'transhipment_connected', 'transhipment_missed',
    'rollover_notified', 'shutout',
    -- Document chase
    'draft_bl_received', 'draft_bl_approved',
    'obl_courier_dispatched', 'obl_received',
    'telex_release_received', 'switch_bl_issued',
    'document_mismatch_detected',
    -- Customs / regulatory
    'customs_lodged', 'customs_query', 'customs_held',
    'customs_inspection_scheduled', 'customs_released', 'customs_seized',
    'sanctions_block', 'dg_declaration_filed', 'dg_declaration_rejected',
    'hs_classification_changed',
    -- Free time / charges
    'free_time_started', 'free_time_warning', 'free_time_expired',
    'demurrage_accruing', 'detention_accruing',
    'storage_accruing', 'invoice_query_raised',
    -- Exceptions / claims
    'exception_raised', 'exception_resolved',
    'claim_filed', 'claim_acknowledged', 'claim_settled', 'claim_rejected',
    'temperature_excursion', 'damage_reported', 'loss_reported',
    -- Internal workflow
    'status_changed', 'owner_assigned', 'task_created',
    'follow_up_scheduled', 'follow_up_fired',
    -- System
    'integration_sync', 'ai_inference', 'webhook_received'
);

CREATE TYPE activity.direction AS ENUM (
    'inbound', 'outbound', 'internal', 'system'
);

CREATE TYPE activity.channel AS ENUM (
    'email', 'phone', 'sms', 'meeting', 'portal', 'edi', 'system', 'manual'
);

CREATE TYPE activity.visibility AS ENUM (
    'public_to_org', 'restricted_to_owner_chain', 'manager_plus', 'directors_plus'
);

CREATE TYPE activity.responsibility AS ENUM (
    'carrier', 'client', 'internal', 'third_party', 'force_majeure', 'unknown'
);

CREATE TYPE activity.event_status AS ENUM (
    'recorded',              -- default; pure log entry
    'awaiting_response',     -- outbound, expecting reply
    'committed',             -- counterparty promised something ("I'll come back tomorrow")
    'acknowledged',          -- counterparty confirmed receipt but not actioned
    'response_received',     -- the awaited response arrived
    'expired',               -- timer ran out without response
    'completed',             -- closed off, no further action expected
    'escalated'              -- escalated to a manager / next tier
);

-- ============================================================
-- activity.events (PARTITIONED BY RANGE (occurred_at))
--
-- Primary key is (org_id, occurred_at, event_id) - the partition
-- key (occurred_at) MUST be in the PK for declarative partitioning.
--
-- event_id is UUID v4: practical uniqueness without a global index.
-- event_links references event_id without an enforced FK (matches
-- the polymorphic pattern documented in the RFC).
-- ============================================================

CREATE TABLE activity.events (
    event_id            UUID NOT NULL DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    branch_id           UUID REFERENCES core.branches(id),

    -- When the event actually happened (partition key + timeline order)
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- When the row was inserted (audit / backfill detection)
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Core event facts
    event_type          activity.event_type NOT NULL,
    direction           activity.direction NOT NULL,
    channel             activity.channel NOT NULL,

    -- Polymorphic primary subject (no RDBMS FK; app-layer integrity)
    -- subject_type values: 'deal' | 'shipment' | 'rfq' | 'quote'
    --                     | 'rate_card' | 'client_profile' | 'company'
    --                     | 'email_classification' | 'task' | ...
    subject_type        TEXT NOT NULL,
    subject_id          TEXT NOT NULL,

    -- Searchable secondary reference (BL, booking, container, AWB, MAWB)
    secondary_ref       TEXT,
    -- Correlation ID for inbound stitching (see RFC section 5)
    correlation_key     TEXT,

    -- Counterparty
    counterparty_type   TEXT,                              -- 'carrier'|'client'|'staff'|'third_party'
    counterparty_id     TEXT,                              -- carrier_code|contact_id|staff_email
    counterparty_email  TEXT,                              -- denormalised for inbound matching

    -- Content
    title               TEXT NOT NULL,
    body                TEXT,
    body_html           TEXT,                              -- preserved for forensic PDF export
    attachments         JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Workflow state
    status              activity.event_status NOT NULL DEFAULT 'recorded',
    awaiting_response_until TIMESTAMPTZ,
    response_event_id   UUID,                              -- soft FK to the answering event

    -- Forensic / case-review
    visibility          activity.visibility NOT NULL DEFAULT 'public_to_org',
    responsibility      activity.responsibility,
    is_pinned           BOOLEAN NOT NULL DEFAULT FALSE,

    -- Threading
    thread_id           UUID,
    parent_event_id     UUID,                              -- soft FK to direct parent

    -- Email-specific threading headers (raw values from MIME).
    -- Capped at 998 chars per RFC 5322; anything larger is an attack
    -- payload (storage amplification).
    email_message_id    TEXT CHECK (email_message_id IS NULL OR char_length(email_message_id) <= 998),
    email_in_reply_to   TEXT CHECK (email_in_reply_to IS NULL OR char_length(email_in_reply_to) <= 998),

    -- Audit
    created_by          TEXT NOT NULL,                     -- staff_email | 'AI_AGENT' | 'SYSTEM'

    PRIMARY KEY (org_id, occurred_at, event_id)
) PARTITION BY RANGE (occurred_at);

-- ============================================================
-- Partition management
--
-- activity.create_month_partition(year, month) - idempotent.
-- pg_cron job runs monthly to ensure 24 months ahead always exists.
-- Bootstrap loop creates current + 23 future + 12 backfill months
-- so backfilled events from up to 12 months ago land cleanly.
-- ============================================================

CREATE OR REPLACE FUNCTION activity.create_month_partition(p_year INT, p_month INT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    partition_name TEXT;
    start_date     DATE;
    end_date       DATE;
BEGIN
    start_date := make_date(p_year, p_month, 1);
    end_date   := (start_date + INTERVAL '1 month')::DATE;
    partition_name := format('events_%s_%s', p_year, lpad(p_month::text, 2, '0'));

    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS activity.%I PARTITION OF activity.events FOR VALUES FROM (%L) TO (%L)',
        partition_name, start_date, end_date
    );
END;
$$;

-- Bootstrap: 12 months back + current + 23 months forward = 36 months.
-- Backfilled events (from migration sync) need historical partitions.
DO $$
DECLARE
    base DATE := date_trunc('month', CURRENT_DATE)::date;
    i INT;
    target_date DATE;
BEGIN
    FOR i IN -12..23 LOOP
        target_date := base + (i || ' months')::interval;
        PERFORM activity.create_month_partition(
            EXTRACT(YEAR FROM target_date)::int,
            EXTRACT(MONTH FROM target_date)::int
        );
    END LOOP;
END $$;

-- Monthly rotation: each 1st of month at 01:00, ensure 24 months
-- ahead exists. Idempotent so missed runs catch up automatically.
SELECT cron.schedule(
    'activity-rotate-partitions',
    '0 1 1 * *',
    $$ SELECT activity.create_month_partition(
           EXTRACT(YEAR FROM (CURRENT_DATE + INTERVAL '24 months'))::int,
           EXTRACT(MONTH FROM (CURRENT_DATE + INTERVAL '24 months'))::int
       ) $$
);

-- ============================================================
-- Indexes on activity.events
--
-- Postgres 12+ propagates parent indexes to all current AND future
-- partitions automatically. So we index the parent and forget.
--
-- Hot read paths (from RFC section 4.1):
--   1. Deal/shipment timeline (paginated DESC by occurred_at)
--   2. Reference search (BL, booking, container)
--   3. Correlation lookup for inbound stitching
--   4. Counterparty email lookup
--   5. Awaiting-response sweep (used by Phase 3 scheduler)
--   6. Pinned events for forensic timeline
--   7. Email Message-ID / In-Reply-To threading
--   8. Per-subject-type partials for high-volume types
-- ============================================================

-- 1. Timeline read with covering payload (avoids heap fetch on list views)
CREATE INDEX idx_events_subject ON activity.events
    (org_id, subject_type, subject_id, occurred_at DESC)
    INCLUDE (event_type, title, counterparty_email, secondary_ref, status);

-- 2. Reference search (lower() for case-insensitive)
CREATE INDEX idx_events_secondary_ref ON activity.events
    (org_id, lower(secondary_ref))
    WHERE secondary_ref IS NOT NULL;

-- 3. Correlation lookup
CREATE INDEX idx_events_correlation ON activity.events
    (org_id, correlation_key)
    WHERE correlation_key IS NOT NULL;

-- 4. Counterparty email match (carrier reply matching)
CREATE INDEX idx_events_counterparty_email ON activity.events
    (org_id, lower(counterparty_email))
    WHERE counterparty_email IS NOT NULL;

-- 5. Awaiting response sweep
CREATE INDEX idx_events_awaiting ON activity.events
    (org_id, awaiting_response_until)
    WHERE status IN ('awaiting_response', 'committed')
      AND awaiting_response_until IS NOT NULL;

-- 6. Pinned events (forensic timeline)
CREATE INDEX idx_events_pinned ON activity.events
    (org_id, subject_type, subject_id, occurred_at DESC)
    WHERE is_pinned = TRUE;

-- 7. Email Message-ID threading
CREATE INDEX idx_events_email_msg_id ON activity.events
    (org_id, email_message_id)
    WHERE email_message_id IS NOT NULL;

CREATE INDEX idx_events_email_in_reply_to ON activity.events
    (org_id, email_in_reply_to)
    WHERE email_in_reply_to IS NOT NULL;

-- 8. Per-subject-type partials for high-volume subjects
CREATE INDEX idx_events_deals ON activity.events
    (org_id, subject_id, occurred_at DESC)
    WHERE subject_type = 'deal';

CREATE INDEX idx_events_shipments ON activity.events
    (org_id, subject_id, occurred_at DESC)
    WHERE subject_type = 'shipment';

CREATE INDEX idx_events_rfqs ON activity.events
    (org_id, subject_id, occurred_at DESC)
    WHERE subject_type = 'rfq';

-- Thread navigation
CREATE INDEX idx_events_thread ON activity.events
    (org_id, thread_id, occurred_at ASC)
    WHERE thread_id IS NOT NULL;

-- 9. Soft FK reverse lookups (find children, find responses).
-- Used by Phase 2 threading UI - shipping the indexes now so the
-- partitions never need backfilled indexes later.
CREATE INDEX idx_events_parent ON activity.events
    (org_id, parent_event_id, occurred_at ASC)
    WHERE parent_event_id IS NOT NULL;

CREATE INDEX idx_events_response_to ON activity.events
    (org_id, response_event_id)
    WHERE response_event_id IS NOT NULL;

-- ============================================================
-- activity.event_links - secondary subjects
--
-- A single event often relates to multiple subjects: an email
-- about a shipment also belongs to the deal, the RFQ, the quote,
-- maybe the rate card. Primary subject is on events; additional
-- subjects go here.
--
-- Not partitioned (smaller table; partition cost > benefit).
-- ============================================================

CREATE TABLE activity.event_links (
    event_id            UUID NOT NULL,
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    subject_type        TEXT NOT NULL,
    subject_id          TEXT NOT NULL,
    link_role           TEXT,                              -- 'parent'|'related'|'caused_by'|'caused'
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, subject_type, subject_id)
);

-- Reverse lookup: "all events linked to subject X"
CREATE INDEX idx_event_links_subject ON activity.event_links
    (org_id, subject_type, subject_id);

-- ============================================================
-- activity.outbound_correlation_tokens
--
-- Generated when an outbound communication is logged. Embedded
-- in three places (Reply-To, subject tag, Message-ID) for
-- maximum inbound capture. Tokens expire after 90 days.
-- ============================================================

CREATE TABLE activity.outbound_correlation_tokens (
    token               TEXT PRIMARY KEY,
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    subject_type        TEXT NOT NULL,
    subject_id          TEXT NOT NULL,
    minted_by_event_id  UUID NOT NULL,                     -- the outbound event
    minted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
    match_count         INTEGER NOT NULL DEFAULT 0,
    last_matched_at     TIMESTAMPTZ
);

CREATE INDEX idx_correlation_tokens_subject ON activity.outbound_correlation_tokens
    (org_id, subject_type, subject_id);

-- Sweep: identify tokens that never matched anything
CREATE INDEX idx_correlation_tokens_unused ON activity.outbound_correlation_tokens
    (expires_at)
    WHERE match_count = 0;

-- ============================================================
-- activity.communication_threads
--
-- Groups events into a logical conversation. One RFQ thread =
-- N rate responses + counter-offers + the award notice. Maintained
-- in real-time by SDK on event log; thread is created if absent
-- when the first event for a subject is logged.
-- ============================================================

CREATE TABLE activity.communication_threads (
    thread_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    subject_type        TEXT NOT NULL,
    subject_id          TEXT NOT NULL,
    title               TEXT NOT NULL,
    -- Denormalised summary for fast list reads
    event_count         INTEGER NOT NULL DEFAULT 0,
    first_event_at      TIMESTAMPTZ,
    last_event_at       TIMESTAMPTZ,
    last_event_summary  TEXT,
    is_open             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_threads_subject ON activity.communication_threads
    (org_id, subject_type, subject_id, last_event_at DESC NULLS LAST);

CREATE INDEX idx_threads_open ON activity.communication_threads
    (org_id, last_event_at DESC NULLS LAST)
    WHERE is_open = TRUE;

-- ============================================================
-- activity.event_annotations
--
-- Audit trail for pin/unpin actions, responsibility tagging,
-- forensic notes. Denormalised state lives on events.is_pinned
-- and events.responsibility for fast filtering; the audit log
-- here records who did what, when, and why.
-- ============================================================

CREATE TABLE activity.event_annotations (
    annotation_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    event_id            UUID NOT NULL,
    annotation_type     TEXT NOT NULL
        CHECK (annotation_type IN ('pin', 'unpin', 'responsibility', 'note', 'visibility_change')),
    payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
    annotated_by        TEXT NOT NULL,
    annotated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_annotations_event ON activity.event_annotations
    (org_id, event_id, annotated_at DESC);

CREATE INDEX idx_annotations_by_user ON activity.event_annotations
    (org_id, annotated_by, annotated_at DESC);

-- ============================================================
-- Immutability enforcement (forensic chain of custody)
--
-- event_annotations is the audit trail for pin/unpin /
-- responsibility tagging / visibility changes. For dispute
-- settlement use, the table must be append-only at the DB level
-- so an application bug or admin misclick cannot rewrite history.
-- ============================================================

CREATE OR REPLACE FUNCTION activity.prevent_annotation_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'activity.event_annotations is append-only; UPDATE and DELETE are forbidden'
        USING ERRCODE = '42501', HINT = 'Append a new annotation row instead';
END;
$$;

CREATE TRIGGER trg_annotations_immutable_update
    BEFORE UPDATE ON activity.event_annotations
    FOR EACH ROW EXECUTE FUNCTION activity.prevent_annotation_mutation();

CREATE TRIGGER trg_annotations_immutable_delete
    BEFORE DELETE ON activity.event_annotations
    FOR EACH ROW EXECUTE FUNCTION activity.prevent_annotation_mutation();

-- ============================================================
-- activity.find_orphans(org_id, since) - function, not view.
--
-- A plain view would seq-scan all 36M+ partitioned rows on every
-- call. This function takes mandatory tenant + time-window args
-- so the planner gets partition pruning and index-only scans.
--
-- Surfaces events whose primary subject no longer exists in its
-- referenced module table. Application UI shows these in a
-- "needs assignment" inbox. Add new subject_type branches as
-- new modules ship.
-- ============================================================

CREATE OR REPLACE FUNCTION activity.find_orphans(
    p_org_id UUID,
    p_since  TIMESTAMPTZ DEFAULT (NOW() - INTERVAL '7 days')
)
RETURNS TABLE (
    event_id     UUID,
    occurred_at  TIMESTAMPTZ,
    subject_type TEXT,
    subject_id   TEXT
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN QUERY
    SELECT e.event_id, e.occurred_at, e.subject_type, e.subject_id
    FROM activity.events e
    WHERE e.org_id = p_org_id
      AND e.occurred_at >= p_since
      AND e.subject_type IN ('shipment', 'client_profile', 'rate_card')
      AND (
        (e.subject_type = 'shipment' AND NOT EXISTS (
            SELECT 1 FROM commercial.shipments s
             WHERE s.org_id = p_org_id AND s.shipment_id = e.subject_id
        ))
        OR
        (e.subject_type = 'client_profile' AND NOT EXISTS (
            SELECT 1 FROM commercial.client_profile c
             WHERE c.org_id = p_org_id AND c.client_id = e.subject_id
        ))
        OR
        (e.subject_type = 'rate_card' AND NOT EXISTS (
            SELECT 1 FROM rates.rate_card_header r
             WHERE r.org_id = p_org_id AND r.rate_card_id = e.subject_id
        ))
      );
END;
$$;

-- ============================================================
-- Module flag: register `activity` in core.module_features for
-- every active organisation. Defaulted on (infrastructure module).
-- ============================================================

INSERT INTO core.module_features (org_id, module_key, enabled, enabled_at)
SELECT id, 'activity', TRUE, NOW()
FROM core.organisations
WHERE status = 'active'
ON CONFLICT (org_id, module_key) DO UPDATE
   SET enabled = TRUE,
       enabled_at = COALESCE(core.module_features.enabled_at, NOW());

-- ============================================================
-- ROW LEVEL SECURITY
-- Same posture as 018 / 020 / 021 / 022 / 023: deny anon +
-- authenticated, service-role API path is the only access route.
-- Application layer enforces session.org_id on every query.
--
-- For activity events, the API layer additionally filters by
-- events.visibility against the staff member's role in
-- core.staff_org_membership (see RFC section 4.1).
-- ============================================================

ALTER TABLE activity.events                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity.event_links                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity.outbound_correlation_tokens    ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity.communication_threads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity.event_annotations              ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON activity.events,
              activity.event_links,
              activity.outbound_correlation_tokens,
              activity.communication_threads,
              activity.event_annotations
       FROM anon, authenticated;

-- Lock down the enum types too so a misconfigured role with
-- schema USAGE cannot reference them in crafted queries.
REVOKE ALL ON TYPE activity.event_type,
              activity.direction,
              activity.channel,
              activity.visibility,
              activity.responsibility,
              activity.event_status
       FROM anon, authenticated;

-- Lock down the find_orphans function. Service-role bypasses; no
-- other role gets EXECUTE.
REVOKE EXECUTE ON FUNCTION activity.find_orphans(UUID, TIMESTAMPTZ)
    FROM anon, authenticated;
