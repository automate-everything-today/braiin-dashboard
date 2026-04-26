# RFC 024 - Activity Backbone (Braiin Stream)

**Status:** Approved 2026-04-27 (architectural calls locked)
**Author:** Rob Donald
**Reviewers:** architect, performance-optimizer, freight-domain solution-architect (parallel agent reviews 2026-04-27)
**Migrations:** 024_activity_backbone.sql (this document scopes the schema and SDK)

---

## 1. Why this exists

Braiin's six-module foundation (Inbox, Tasks, CRM, Rates, Quote, Pulse) handles distinct domains well, but a freight forwarder's daily reality is **cross-cutting**: one shipment touches communications (Inbox), the deal it relates to (CRM), the rate card it was booked on (Rates), the original quote (Quote), and the live shipment intel (Pulse). Reps and ops staff need to see all of those threads on one timeline. When a shipment goes wrong - rolled vessel, customs hold, demurrage accruing - the team must reconstruct the paper trail across all stakeholders to settle responsibility.

This RFC introduces a **seventh module** - `activity` (Braiin Stream) - that owns the operational event log, the spot-rate workflow, and the correlation infrastructure that links inbound communications back to the right shipment, RFQ, deal, or quote.

The activity module is **not commercially gated**. Like `core`, it ships defaulted on for every tenant. Modules emit events through a thin SDK; activity does not depend on any module other than `core`.

## 2. The four locked architectural decisions

Confirmed 2026-04-27 after parallel agent review.

| # | Decision | Rationale |
|---|---|---|
| 1 | **Polymorphic linking** via `subject_type TEXT, subject_id TEXT` with no RDBMS FK. Application-layer integrity. Per-subject-type partial indexes for hot reads. Nightly orphan audit view. | The alternative (per-module join tables) forces every new module to ship a join migration and breaks the "modules independent" story. |
| 2 | **Partition `activity.events` by month from day one**, 24-month retention via `DROP PARTITION` on month 25. | Postgres has no `ALTER TABLE ... PARTITION BY`. Retrofitting at 18M rows requires multi-week online migration. Day-one partitioning is the only viable path. |
| 3 | **Design with the margin-loop end state in mind**. Schema must support reconciling predicted-margin-at-quote against realised-margin-post-delivery, with attribution (which event/cost line caused the leak). Build the loop in Phase 5. | This is the moat. Wisor / Catapult / Cargocosting see rates only. Loop / Project44 see shipments only. Cargowise sees both but with bad UX. Braiin closing the loop is what makes a commercial director sign. |
| 4 | **Three-layer correlation ID** for inbound stitching: Reply-To token (`inbound+<token>@inbound.braiin.app`) + subject-line tag + Message-ID / In-Reply-To. | Reply-To is most reliable (carriers can't strip envelope). Subject tag is human-readable. Message-ID catches conventional replies. All three together approach 100% inbound capture. |

## 3. The freight-domain reality this schema must absorb

From the domain reviewer (validated 2026-04-27): the founder's mental model collapsed an 11-state RFQ workflow into 3 and reduced a 10-axis carrier scorecard to "response time". The schema deliberately models the messier reality:

- **RFQ states** (not the binary sent/received): `drafted`, `sent`, `acknowledged`, `indication_received`, `firm_quoted`, `subject_to_conditions`, `validity_expiring`, `validity_expired`, `awarded`, `booking_placed`, `booking_confirmed`, `s_o_issued`, `rolled_or_loaded`.
- **First-class events** that any forwarder expects: vessel rollover / shutout, free-time / demurrage / detention countdown per container per port, customs hold / inspection state machine, document chase (SI cutoff / VGM / draft BL / OBL release), equipment shortage / partial allocation, claims, sanctions screening, DG declaration, HS classification, CI/PL mismatch detection.
- **Carrier scorecard axes** (per lane × equipment): allocation reliability, equipment availability, schedule reliability, rollover rate, rate stability, doc quality, claims responsiveness, EDI uptime, free-time generosity, rep response time. Multidimensional weighted index, not a flat number.

Phase 4 builds the scorecard. Phase 1 ensures the event types exist and are searchable.

## 4. Schema (Phase 1 - migration 024)

### 4.1 `activity.events` (partitioned)

```sql
CREATE SCHEMA IF NOT EXISTS activity;

ALTER DEFAULT PRIVILEGES IN SCHEMA activity REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA activity REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA activity REVOKE ALL ON FUNCTIONS FROM PUBLIC;

CREATE TYPE activity.event_type AS ENUM (
    -- Communications
    'email_sent', 'email_received', 'email_bounced', 'email_replied',
    'phone_call', 'meeting', 'sms_sent', 'sms_received',
    'manual_note',
    -- RFQ / Quote workflow
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
    -- Internal
    'status_changed', 'owner_assigned', 'task_created',
    'follow_up_scheduled', 'follow_up_fired',
    -- System
    'integration_sync', 'ai_inference', 'webhook_received'
);

CREATE TYPE activity.direction AS ENUM ('inbound', 'outbound', 'internal', 'system');
CREATE TYPE activity.channel AS ENUM ('email', 'phone', 'sms', 'meeting', 'portal', 'edi', 'system', 'manual');
CREATE TYPE activity.visibility AS ENUM ('public_to_org', 'restricted_to_owner_chain', 'manager_plus', 'directors_plus');
CREATE TYPE activity.responsibility AS ENUM ('carrier', 'client', 'internal', 'third_party', 'force_majeure', 'unknown');

CREATE TABLE activity.events (
    event_id        UUID NOT NULL DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    branch_id       UUID REFERENCES core.branches(id),

    -- Core event facts
    event_type      activity.event_type NOT NULL,
    direction       activity.direction NOT NULL,
    channel         activity.channel NOT NULL,

    -- Polymorphic primary subject (no RDBMS FK; app-layer integrity)
    -- subject_type: 'deal' | 'shipment' | 'rfq' | 'quote' | 'rate_card' | 'client_profile' | ...
    subject_type    TEXT NOT NULL,
    subject_id      TEXT NOT NULL,
    -- Searchable secondary reference (BL number, booking ref, container number, etc.)
    secondary_ref   TEXT,
    -- Correlation ID for inbound stitching (see section 5)
    correlation_key TEXT,

    -- Counterparty (carrier, client contact, internal staff, third party)
    counterparty_type   TEXT,                -- 'carrier' | 'client' | 'staff' | 'third_party'
    counterparty_id     TEXT,                -- carrier_code | contact_id | staff_email
    counterparty_email  TEXT,                -- denormalised for search

    -- Content
    title           TEXT NOT NULL,
    body            TEXT,
    body_html       TEXT,                    -- preserved for PDF export (forensic case bundle)
    attachments     JSONB NOT NULL DEFAULT '[]'::jsonb,
                                             -- [{name, url, content_hash, mime, size_bytes}]
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
                                             -- per-event-type structured data

    -- Workflow state
    status          TEXT NOT NULL DEFAULT 'recorded',
                                             -- 'recorded' | 'awaiting_response' | 'acknowledged'
                                             -- | 'committed' (carrier said "tomorrow")
                                             -- | 'response_received' | 'expired'
                                             -- | 'completed' | 'escalated'
    awaiting_response_until TIMESTAMPTZ,      -- promise timer; populated for 'committed' status
    response_event_id   UUID,                 -- when this event is answered, link the response

    -- Forensic / case-review
    visibility      activity.visibility NOT NULL DEFAULT 'public_to_org',
    responsibility  activity.responsibility,  -- nullable; set during case review
    is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,  -- key-fact marker for forensic timeline

    -- Communication threading
    thread_id       UUID,                    -- groups related events into a logical conversation
    parent_event_id UUID,                    -- direct reply chain
    -- email-specific Message-ID / In-Reply-To threading (raw header values)
    email_message_id TEXT,
    email_in_reply_to TEXT,

    -- Audit
    created_by      TEXT NOT NULL,           -- staff_email or 'AI_AGENT' or 'SYSTEM'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- when the event actually happened
                                             -- (may differ from created_at when backfilled)

    PRIMARY KEY (org_id, created_at, event_id)  -- partition key + uniqueness
) PARTITION BY RANGE (created_at);
```

**Partitioning bootstrap** (24 months ahead, monthly):

```sql
-- Macro to create a month partition
CREATE OR REPLACE FUNCTION activity.create_month_partition(p_year INT, p_month INT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    partition_name TEXT;
    start_date     DATE;
    end_date       DATE;
BEGIN
    start_date := make_date(p_year, p_month, 1);
    end_date   := start_date + INTERVAL '1 month';
    partition_name := format('events_%s_%s', p_year, lpad(p_month::text, 2, '0'));
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS activity.%I PARTITION OF activity.events FOR VALUES FROM (%L) TO (%L)',
        partition_name, start_date, end_date
    );
END;
$$;

-- Bootstrap 24 months from current month forward
DO $$
DECLARE
    base DATE := date_trunc('month', CURRENT_DATE)::date;
    i INT;
BEGIN
    FOR i IN 0..23 LOOP
        PERFORM activity.create_month_partition(
            EXTRACT(YEAR FROM base + (i || ' months')::interval)::int,
            EXTRACT(MONTH FROM base + (i || ' months')::interval)::int
        );
    END LOOP;
END $$;

-- pg_cron job: each month, create the partition 24 months out
SELECT cron.schedule(
    'activity-rotate-partitions',
    '0 1 1 * *',  -- 01:00 on the 1st of each month
    $$ SELECT activity.create_month_partition(
           EXTRACT(YEAR FROM (CURRENT_DATE + INTERVAL '24 months'))::int,
           EXTRACT(MONTH FROM (CURRENT_DATE + INTERVAL '24 months'))::int
       ) $$
);

-- Retention: drop partitions older than 24 months (compliance permitting)
-- Disabled by default; enable per-tenant via core.module_features.activity.settings
```

**Indexes** (applied per partition automatically):

```sql
-- Hot path 1: deal/shipment timeline (paginated DESC by occurred_at)
CREATE INDEX ON activity.events (org_id, subject_type, subject_id, occurred_at DESC)
    INCLUDE (event_type, title, counterparty_email, secondary_ref);

-- Hot path 2: search by reference (BL, booking, container)
CREATE INDEX ON activity.events (org_id, lower(secondary_ref))
    WHERE secondary_ref IS NOT NULL;

-- Hot path 3: correlation lookup for inbound stitching
CREATE INDEX ON activity.events (org_id, correlation_key)
    WHERE correlation_key IS NOT NULL;

-- Hot path 4: counterparty email lookup (carrier reply matching)
CREATE INDEX ON activity.events (org_id, lower(counterparty_email))
    WHERE counterparty_email IS NOT NULL;

-- Hot path 5: awaiting response sweep (used by follow-up scheduler in phase 3)
CREATE INDEX ON activity.events (org_id, awaiting_response_until)
    WHERE status IN ('awaiting_response', 'committed') AND awaiting_response_until IS NOT NULL;

-- Hot path 6: pinned events for forensic timeline
CREATE INDEX ON activity.events (org_id, subject_type, subject_id, occurred_at DESC)
    WHERE is_pinned = TRUE;

-- Email threading
CREATE INDEX ON activity.events (org_id, email_message_id) WHERE email_message_id IS NOT NULL;
CREATE INDEX ON activity.events (org_id, email_in_reply_to) WHERE email_in_reply_to IS NOT NULL;

-- Per-subject-type partials for high-volume subjects
CREATE INDEX ON activity.events (org_id, subject_id, occurred_at DESC)
    WHERE subject_type = 'deal';
CREATE INDEX ON activity.events (org_id, subject_id, occurred_at DESC)
    WHERE subject_type = 'shipment';
```

**Note** Postgres does not allow a foreign key on the polymorphic columns. A nightly orphan audit job runs:

```sql
-- activity.orphan_audit (view) - flags events whose subject no longer exists
-- Implementation deferred to Phase 1.5 (UI for resolving orphans)
```

### 4.2 `activity.event_links` - secondary subjects

A single event often relates to multiple subjects: an email about a shipment also belongs to the deal, the RFQ, the quote, and possibly the rate card. The primary subject is on `events`. Additional subjects go here:

```sql
CREATE TABLE activity.event_links (
    event_id        UUID NOT NULL,
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    subject_type    TEXT NOT NULL,
    subject_id      TEXT NOT NULL,
    link_role       TEXT,                    -- 'parent' | 'related' | 'caused_by' | 'caused'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, subject_type, subject_id)
);

CREATE INDEX ON activity.event_links (org_id, subject_type, subject_id);
```

This means the deal-page query is:

```sql
-- All events on a deal (primary OR secondary subject)
SELECT * FROM activity.events e
WHERE e.org_id = $1
  AND (
    (e.subject_type = 'deal' AND e.subject_id = $2)
    OR EXISTS (
        SELECT 1 FROM activity.event_links l
        WHERE l.event_id = e.event_id
          AND l.subject_type = 'deal' AND l.subject_id = $2
    )
  )
ORDER BY e.occurred_at DESC LIMIT 50;
```

### 4.3 `activity.outbound_correlation_tokens`

Generated when an outbound communication is logged. Embeds in Reply-To envelope, subject-line tag, and (for emails) `Message-ID`. Inbound parser checks all three layers and finds the matching token.

```sql
CREATE TABLE activity.outbound_correlation_tokens (
    token           TEXT PRIMARY KEY,        -- short URL-safe token, e.g. "rfq-2026-04-27-a7f3"
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    subject_type    TEXT NOT NULL,
    subject_id      TEXT NOT NULL,
    -- The outbound event that minted this token
    minted_by_event_id UUID NOT NULL,
    minted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '90 days',
    -- How many inbound matches this token has caught
    match_count     INTEGER NOT NULL DEFAULT 0,
    last_matched_at TIMESTAMPTZ
);

CREATE INDEX ON activity.outbound_correlation_tokens (org_id, subject_type, subject_id);
CREATE INDEX ON activity.outbound_correlation_tokens (expires_at) WHERE match_count = 0;
```

### 4.4 `activity.communication_threads`

Many events form one logical conversation (one RFQ thread = N rate responses + counter-offers + the award notice). `thread_id` on `events` references this:

```sql
CREATE TABLE activity.communication_threads (
    thread_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    subject_type    TEXT NOT NULL,
    subject_id      TEXT NOT NULL,
    title           TEXT NOT NULL,
    -- Denormalised summary for fast list reads
    event_count     INTEGER NOT NULL DEFAULT 0,
    first_event_at  TIMESTAMPTZ,
    last_event_at   TIMESTAMPTZ,
    last_event_summary TEXT,
    is_open         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON activity.communication_threads (org_id, subject_type, subject_id, last_event_at DESC);
CREATE INDEX ON activity.communication_threads (org_id, is_open, last_event_at DESC) WHERE is_open = TRUE;
```

Phase 1 creates threads but does not auto-populate `event_count` / `last_event_at` in real time - those are deferred to Phase 2 (a trigger after the spot rate workflow lands).

### 4.5 `activity.event_pins` and responsibility tags

Pinning is denormalised to `events.is_pinned` for fast filtering. The audit log of pin/unpin and responsibility-tag changes lives separately:

```sql
CREATE TABLE activity.event_annotations (
    annotation_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    event_id        UUID NOT NULL,
    annotation_type TEXT NOT NULL,           -- 'pin' | 'unpin' | 'responsibility' | 'note'
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    annotated_by    TEXT NOT NULL,
    annotated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON activity.event_annotations (org_id, event_id, annotated_at DESC);
```

## 5. Correlation ID strategy (the threading layer)

Three layers, applied to every outbound email logged through the SDK:

### Layer 1 - Reply-To envelope token

Every outbound email is sent with `Reply-To: inbound+<token>@inbound.braiin.app`. Carriers that hit "Reply" in their mail client send their response to that address. The catch-all subdomain `inbound.braiin.app` is configured to route all mail to a webhook (CloudMailin is already wired per memory `project_corten_outbound`; extend with the new subdomain).

Token format: `<entity_type>-<yyyy-mm-dd>-<random6>`, e.g. `rfq-2026-04-27-a7f3xs`. URL-safe, ~24 chars, easy to grep in logs.

### Layer 2 - Subject-line tag

Append `[Braiin Ref: <token>]` to the subject line on outbound. Most mail clients preserve subject lines on reply (with `Re:` prefix). When the Reply-To envelope is stripped (some carriers force `From:` to be the canonical sales rep email), the subject tag survives.

### Layer 3 - Message-ID / In-Reply-To header threading

Standard email convention. We capture the outbound `Message-ID` we generate, store on `events.email_message_id`. When an inbound arrives with `In-Reply-To: <our-message-id>` or `References:` containing it, we match.

### Inbound matcher precedence

```
1. Reply-To token match  (highest confidence)
2. Subject-line token match
3. Message-ID / In-Reply-To match
4. Fuzzy match: from address + subject substring + recency window (7 days)
   -> if matched, queue for human confirmation; do not auto-link
```

Match → write to `events.correlation_key`, increment `outbound_correlation_tokens.match_count`, link to the originating thread. No match → log as orphan inbound; surface in a "needs assignment" inbox UI.

### Webhook endpoint

`POST /api/inbound/email` (extends existing CloudMailin handler):

1. Parse `Reply-To` recipient -> extract token if `inbound+<token>@`
2. Parse subject for `[Braiin Ref: <token>]`
3. Parse `In-Reply-To` and `References` headers
4. Match against `outbound_correlation_tokens` and `events.email_message_id`
5. Write inbound event with `direction='inbound'`, set `correlation_key` if matched, set `parent_event_id` and `thread_id` accordingly
6. If the matched outbound was `awaiting_response`, update its `status='response_received'` and set `response_event_id`
7. Trigger downstream: classify_batches for AI extraction (rate parse, intent classification)

## 6. SDK design (`src/lib/activity/log-event.ts`)

```typescript
import { type ActivityEvent, type CorrelationToken } from '@/types/activity';

interface LogEventInput {
    orgId: string;
    eventType: ActivityEventType;
    direction: 'inbound' | 'outbound' | 'internal' | 'system';
    channel: ActivityChannel;
    subjectType: string;
    subjectId: string;
    secondaryRef?: string;
    counterpartyType?: 'carrier' | 'client' | 'staff' | 'third_party';
    counterpartyId?: string;
    counterpartyEmail?: string;
    title: string;
    body?: string;
    bodyHtml?: string;
    attachments?: Attachment[];
    metadata?: Record<string, unknown>;
    threadId?: string;             // optional - SDK creates one if subject is new
    parentEventId?: string;
    emailMessageId?: string;
    emailInReplyTo?: string;
    awaitingResponseUntil?: Date;  // sets status to 'awaiting_response' or 'committed'
    visibility?: ActivityVisibility;  // default: public_to_org
    additionalLinks?: { subjectType: string; subjectId: string; linkRole?: string }[];
    createdBy: string;             // staff_email or 'AI_AGENT' or 'SYSTEM'
}

interface LogEventOutput {
    eventId: string;
    correlationKey?: string;        // set if outbound; embed in email
    threadId: string;
    replyToAddress?: string;        // set if outbound email; use as Reply-To header
    subjectTag?: string;            // set if outbound email; append to subject line
}

export async function logEvent(input: LogEventInput): Promise<LogEventOutput>;
```

When `direction === 'outbound'` and `channel === 'email'`, the SDK:
1. Mints a correlation token, writes to `outbound_correlation_tokens`
2. Returns `replyToAddress: 'inbound+<token>@inbound.braiin.app'` and `subjectTag: '[Braiin Ref: <token>]'`
3. The caller is expected to apply both to the outbound email

## 7. Read APIs (Phase 1)

Three primary endpoints, all under `/api/activity/*`:

### 7.1 `GET /api/activity/timeline?subjectType=deal&subjectId=<id>&before=<cursor>&limit=50`

Returns events for a subject (primary + via `event_links`), paginated DESC by `occurred_at`, includes `is_pinned`, `responsibility`, attachment metadata.

### 7.2 `GET /api/activity/search?ref=<bl_or_booking_or_container>&limit=20`

Searches `events.secondary_ref` (and optionally fuzzy on `title`/`body`). Returns matching events with subject context.

### 7.3 `GET /api/activity/case-bundle?subjectType=shipment&subjectId=<id>&format=json|pdf`

Forensic export. Returns all events for a subject, all linked subjects (recursive one level), all attachments. PDF format generates a timeline document with the body text, key facts pinned at the top, attachments inlined.

Service-role only at this point; role-gated at the API layer per `core.staff_org_membership.role` and `events.visibility`.

## 8. Phase boundaries

### Phase 1 ends when

- `activity.events` table partitioned and live, with all indexes
- SDK `logEvent()` available and used by at least one outbound path (suggest: existing email-send flow)
- CloudMailin inbound webhook extended to parse correlation tokens and write inbound events
- Deal page in dashboard renders the activity timeline (primary subject + linked subjects)
- Shipment page in dashboard renders the activity timeline + reference search box
- Forensic export API returns JSON; PDF export ships in Phase 1.5

### Phase 1 does NOT include

- Spot rate request / response schema (Phase 2 - migration 025)
- Comparison matrix UI (Phase 2)
- Follow-up scheduler / sequence engine (Phase 3 - migration 026)
- Carrier scorecard cache + UI (Phase 4 - migration 027)
- Margin reconciliation / leak alerting (Phase 5 - migration 028, with Cargowise sync)
- Mass negotiate primitives (Phase 6 - migration 029)

## 9. Open questions deferred to later phases

- **Carrier scorecard weighting**. 10 axes; per-tenant weighting strategy or platform default? (Phase 4)
- **Margin model**. Linear regression on (lane × equipment × season × carrier × commodity) vs simple percentile bands? (Phase 5)
- **Mass negotiate approval**. Does mass counter-offer require manager approval per tenant policy? (Phase 6)
- **Orphan resolution UI**. When inbound matches no token, how does a rep find and assign? (Phase 1.5)
- **Document mismatch detection**. Auto-diff between BL / CI / PL — own model or rule-based? (deferred)

## 10. Migration sequencing

| Migration | What | Status |
|---|---|---|
| 024_activity_backbone.sql | This RFC | Drafted; needs execution |
| 025_spot_rates.sql | Spot rate workflow | Designed; depends on 024 |
| 026_follow_ups.sql | Sequence engine | Depends on 024 |
| 027_carrier_scorecard.sql | 10-axis scorecard cache | Depends on 024, 025, Cargowise sync |
| 028_margin_reconciliation.sql | The moat. Closes the loop. Includes Cargowise sync (was originally 025). | Depends on 024-027 |
| 029_quotes.sql | Quotes module (was originally 024). Renumbered after activity took 024. | Depends on 024 |
| 030_mass_negotiate.sql | Counter-offer fan-out | Depends on 025, 026 |

The original 024 (quotes) is renumbered to 029. The original 025 (cargowise sync) is folded into 028 (margin reconciliation) since they ship together.

## 11. References

- Parallel-agent reviews 2026-04-27: architect, performance-optimizer, freight-domain solution-architect
- `/Users/robdonald-agent/.claude/projects/-Users-robdonald-agent-ai-projects/memory/project_braiin_modular_architecture.md`
- `/Users/robdonald-agent/ai-projects/Corten Outreach/dashboard/supabase/migrations/021_core_foundation.sql`
- `/Users/robdonald-agent/ai-projects/Corten Outreach/dashboard/supabase/migrations/022_rate_engine_core.sql`
- `/Users/robdonald-agent/ai-projects/Corten Outreach/dashboard/supabase/migrations/023_commercial_intelligence.sql`
- Original spot rate brainstorm: `/Users/robdonald-agent/Desktop/quoting engine/`
