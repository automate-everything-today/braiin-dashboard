-- ============================================================
-- 024_5_inbox_extensions.sql
-- Stream Phase 1.5 - chat UX layer on top of activity backbone.
--
-- Synthesises three reference systems into one schema expansion:
--   - UnInbox structural patterns (entry_kind, per-entry visibility
--     whitelist, seen-receipts) from github.com/un/inbox
--   - Missive UX patterns (assignment, snooze, task cards, shared
--     drafts) - inferred from product, not source-available
--   - Plain.com AI helper UX (suggestions, thread summaries,
--     auto-extracted action items) - inferred from product
--
-- Adds nothing freight-specific. The freight-specific moat
-- (correlation tokens, polymorphic event_links, partitioning,
-- immutable annotations, responsibility tagging) stays where it is
-- in 024. This migration is pure inbox infrastructure that any
-- chat-style email product needs.
--
-- Multi-provider email (Outlook + Gmail) note: this migration is
-- provider-agnostic. The SDK metadata.email JSON contract carries
-- a `provider` field ('outlook' | 'gmail' | 'imap'). The schema
-- never branches on provider; sync adapters live in application
-- code. public.tasks gets `external_task_id` / `external_list_id`
-- generic columns alongside the existing outlook_* columns so the
-- Gmail / Google Tasks integration can land without schema churn.
--
-- Apply order: 024 first, then this. Both should be applied in the
-- same session to avoid SDK signature drift.
--
-- Depends on: 024_activity_backbone.sql
-- ============================================================

-- ============================================================
-- entry_kind: external | internal_comment | draft
-- (UnInbox convoEntries.type port)
--
-- Lets the UI distinguish customer-facing replies, internal team
-- chatter, and in-progress drafts on the same timeline. The
-- forensic case-bundle export filters by entry_kind = 'external'
-- so internal notes never leak into a claim package.
-- ============================================================

CREATE TYPE activity.entry_kind AS ENUM (
    'external',           -- customer-facing reply, default
    'internal_comment',   -- team-only note in the thread
    'draft'               -- in-progress, not yet sent
);

ALTER TABLE activity.events
    ADD COLUMN entry_kind activity.entry_kind NOT NULL DEFAULT 'external';

-- Hot path: "show me only external messages on this thread"
-- (used by the case-bundle PDF export and the customer view)
CREATE INDEX idx_events_external_only ON activity.events
    (org_id, subject_type, subject_id, occurred_at DESC)
    WHERE entry_kind = 'external';

-- ============================================================
-- Task lifecycle event types
-- (Missive task-card pattern)
--
-- task_created already exists in 024. Adding the rest of the
-- lifecycle so Phase 2 UI can render task cards inline in the
-- thread with checkbox / due-date / assignee, and reflect changes
-- as small events on the timeline.
-- ============================================================

ALTER TYPE activity.event_type ADD VALUE IF NOT EXISTS 'task_completed';
ALTER TYPE activity.event_type ADD VALUE IF NOT EXISTS 'task_assigned';
ALTER TYPE activity.event_type ADD VALUE IF NOT EXISTS 'task_due_changed';
ALTER TYPE activity.event_type ADD VALUE IF NOT EXISTS 'task_reopened';

-- ============================================================
-- activity.event_private_recipients
-- (UnInbox convoEntryPrivateVisibilityParticipants port)
--
-- Per-event whitelist of who can read it. Used when the broad
-- visibility enum isn't fine-grained enough - e.g., "this margin
-- discussion is visible only to me + the branch manager", without
-- needing to introduce a new role tier.
--
-- NOTE: today this is informational metadata only. The DB-layer
-- visibility enforcement (RFC 024 Phase 1.5 follow-up) is what
-- will actually gate reads. Until that ships, the API layer must
-- consult this table.
-- ============================================================

CREATE TABLE activity.event_private_recipients (
    event_id        UUID NOT NULL,
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    staff_email     TEXT NOT NULL,
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by      TEXT NOT NULL,
    PRIMARY KEY (event_id, staff_email)
);

CREATE INDEX idx_event_private_recipients_lookup
    ON activity.event_private_recipients (org_id, staff_email, event_id);

-- ============================================================
-- activity.event_seen
-- (UnInbox convoEntrySeenTimestamps port)
--
-- Per-staff per-event read receipts. Two purposes:
--   1. UX: render unread / read state in the inbox.
--   2. Forensic: in a claim, prove the manager DID see the
--      rollover notice on Tuesday at 11:42, settling who owed
--      what to whom.
-- ============================================================

CREATE TABLE activity.event_seen (
    event_id        UUID NOT NULL,
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    staff_email     TEXT NOT NULL,
    seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, staff_email)
);

CREATE INDEX idx_event_seen_by_staff
    ON activity.event_seen (org_id, staff_email, seen_at DESC);

CREATE INDEX idx_event_seen_by_event
    ON activity.event_seen (org_id, event_id);

-- ============================================================
-- activity.ai_suggestions
-- (Plain-style inline AI helper)
--
-- Tracks every AI-generated suggestion (suggested replies,
-- extracted action items, summary regenerations). Append-only
-- like event_annotations so we have a clean record of what AI
-- proposed vs what the rep actually accepted - feeds future
-- model fine-tuning and gives users a "history of suggestions"
-- view.
-- ============================================================

CREATE TYPE activity.suggestion_type AS ENUM (
    'reply_draft',         -- a suggested reply body
    'action_item',         -- "carrier promised rate by Tuesday EOD"
    'thread_summary',      -- one-paragraph summary of the conversation
    'classification',      -- inbox routing classification
    'next_step'            -- "follow up in 24h" / "escalate to manager"
);

CREATE TABLE activity.ai_suggestions (
    suggestion_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id          UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    event_id        UUID,                                -- nullable: thread-level summaries
    thread_id       UUID,                                -- nullable: event-level suggestions
    subject_type    TEXT,                                -- denormalised for fast filter
    subject_id      TEXT,                                -- denormalised for fast filter
    suggestion_type activity.suggestion_type NOT NULL,
    body            TEXT NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- model name, tokens, prompt id, etc.
    confidence      NUMERIC(4,3),                        -- 0.000 - 1.000
    accepted        BOOLEAN,                             -- NULL = not yet decided
    accepted_at     TIMESTAMPTZ,
    accepted_by     TEXT,
    discarded_reason TEXT,                               -- "wrong tone", "irrelevant", etc.
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    generated_by    TEXT NOT NULL DEFAULT 'AI_AGENT'
);

CREATE INDEX idx_ai_suggestions_event
    ON activity.ai_suggestions (org_id, event_id, generated_at DESC)
    WHERE event_id IS NOT NULL;

CREATE INDEX idx_ai_suggestions_thread
    ON activity.ai_suggestions (org_id, thread_id, generated_at DESC)
    WHERE thread_id IS NOT NULL;

CREATE INDEX idx_ai_suggestions_pending
    ON activity.ai_suggestions (org_id, suggestion_type, generated_at DESC)
    WHERE accepted IS NULL;

-- Append-only enforcement: AI suggestion history is forensic too
-- (proves what the AI proposed vs what the human chose). Same
-- pattern as activity.event_annotations.
CREATE OR REPLACE FUNCTION activity.prevent_suggestion_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Allow ONLY accepted/discarded fields to change after creation.
    IF OLD.body IS DISTINCT FROM NEW.body
       OR OLD.suggestion_type <> NEW.suggestion_type
       OR OLD.event_id IS DISTINCT FROM NEW.event_id
       OR OLD.thread_id IS DISTINCT FROM NEW.thread_id
       OR OLD.metadata IS DISTINCT FROM NEW.metadata
       OR OLD.confidence IS DISTINCT FROM NEW.confidence
       OR OLD.generated_at <> NEW.generated_at THEN
        RAISE EXCEPTION 'activity.ai_suggestions: only accepted/accepted_at/accepted_by/discarded_reason are mutable after creation'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ai_suggestions_partial_immutable
    BEFORE UPDATE ON activity.ai_suggestions
    FOR EACH ROW EXECUTE FUNCTION activity.prevent_suggestion_mutation();

CREATE OR REPLACE FUNCTION activity.prevent_suggestion_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'activity.ai_suggestions is append-only; DELETE is forbidden'
        USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER trg_ai_suggestions_no_delete
    BEFORE DELETE ON activity.ai_suggestions
    FOR EACH ROW EXECUTE FUNCTION activity.prevent_suggestion_delete();

-- ============================================================
-- activity.communication_threads - Missive enhancements
--
-- Add: assigned_to, assigned_at, assigned_by (Missive's inline
-- assignment indicator); snoozed_until (Missive's snooze);
-- ai_summary + ai_summary_generated_at (Plain's hover summary).
-- ============================================================

ALTER TABLE activity.communication_threads
    ADD COLUMN assigned_to              TEXT,
    ADD COLUMN assigned_at              TIMESTAMPTZ,
    ADD COLUMN assigned_by              TEXT,
    ADD COLUMN snoozed_until            TIMESTAMPTZ,
    ADD COLUMN ai_summary               TEXT,
    ADD COLUMN ai_summary_generated_at  TIMESTAMPTZ,
    ADD COLUMN unread_count             INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_threads_assigned
    ON activity.communication_threads (org_id, assigned_to, last_event_at DESC NULLS LAST)
    WHERE assigned_to IS NOT NULL AND is_open = TRUE;

-- Partial index without NOW() comparison (NOW() is STABLE, not
-- IMMUTABLE, so can't live in an index predicate). Queries filter
-- by snoozed_until > NOW() at query time; the index is still
-- sorted on snoozed_until so the planner uses it efficiently.
CREATE INDEX idx_threads_snoozed
    ON activity.communication_threads (org_id, snoozed_until)
    WHERE snoozed_until IS NOT NULL;

-- ============================================================
-- public.tasks - Missive task-card linkage
--
-- source_event_id: which event in the activity timeline spawned
-- this task ("Convert to task" from the chat).
-- related_thread_id: which conversation thread the task belongs
-- to (so the task card renders inline in the right thread).
--
-- Generic provider columns sit alongside the existing
-- outlook_task_id / outlook_list_id from migration 017 so the
-- Gmail / Google Tasks / Asana / Linear integrations can land
-- later without re-naming Outlook columns. Provider value lives
-- in the new `external_provider` field. The Outlook-specific
-- columns stay populated for legacy Outlook ToDo sync; new
-- provider integrations populate the generic columns.
-- ============================================================

ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS source_event_id     UUID,
    ADD COLUMN IF NOT EXISTS related_thread_id   UUID,
    ADD COLUMN IF NOT EXISTS external_provider   TEXT,
    ADD COLUMN IF NOT EXISTS external_task_id    TEXT,
    ADD COLUMN IF NOT EXISTS external_list_id    TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_source_event
    ON public.tasks (source_event_id)
    WHERE source_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_thread
    ON public.tasks (related_thread_id)
    WHERE related_thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_external
    ON public.tasks (external_provider, external_task_id)
    WHERE external_task_id IS NOT NULL;

-- ============================================================
-- ROW LEVEL SECURITY on the new tables.
-- Same posture: deny anon + authenticated, service-role only.
-- ============================================================

ALTER TABLE activity.event_private_recipients   ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity.event_seen                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity.ai_suggestions             ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON activity.event_private_recipients,
              activity.event_seen,
              activity.ai_suggestions
       FROM anon, authenticated;

-- The new enum types
REVOKE ALL ON TYPE activity.entry_kind,
                   activity.suggestion_type
       FROM anon, authenticated;

-- ============================================================
-- SDK metadata contract documentation (informational only)
-- ============================================================
-- Standard shape of activity.events.metadata for emails, mirroring
-- UnInbox's convoEntries.metadata.email schema:
--
-- {
--   "email": {
--     "provider":          "outlook" | "gmail" | "imap",
--     "messageId":         "<RFC5322 Message-ID>",
--     "inReplyTo":         "<RFC5322 In-Reply-To>",
--     "references":        ["<msg-id>", ...],
--     "from":              { "name": "...", "address": "..." },
--     "to":                [{ "name": "...", "address": "..." }],
--     "cc":                [...],
--     "bcc":               [...],
--     "subjectRaw":        "<original subject>",
--     "subjectNormalised": "<lowercased, Re:/Fwd: stripped>",
--     "headers":           { "<header-name>": "<value>", ... },
--     "missingParticipants": ["..."]   // addresses we lack a contact for
--   },
--   "ai_extracted":        true | false,         // event was synthesised by AI
--   "ai_suggestion_id":    "<uuid>" | null       // back-reference if from suggestion
-- }
--
-- The provider field MUST be set on every email event so the
-- inbox UI can render provider-specific affordances (Outlook
-- categories vs Gmail labels, etc.) without column branching.
-- ============================================================
