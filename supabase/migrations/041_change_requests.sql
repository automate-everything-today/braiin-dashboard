-- 041_change_requests.sql
--
-- Change request capture + workflow.
-- Operators raise requests from any page (auto-captures source_page);
-- CTO reviews, brainstorms, decides; approved items land in build
-- queue. Screenshots attach as URLs to a Supabase Storage bucket.
--
-- After running:
--   - Add `feedback` to Settings -> API -> Exposed schemas.
--   - Create a Storage bucket named `change-request-attachments`
--     (public read, authenticated write).

CREATE SCHEMA IF NOT EXISTS feedback;
GRANT USAGE ON SCHEMA feedback TO service_role;

CREATE TABLE IF NOT EXISTS feedback.change_requests (
    request_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,

    source_page         TEXT NOT NULL,                  -- '/dev/margins'
    title               TEXT NOT NULL,
    description         TEXT NOT NULL,

    -- Workflow:
    --   new           - just raised, not yet looked at
    --   reviewing     - CTO has eyes on it
    --   brainstorming - actively being scoped / sketched
    --   approved      - confirmed for build queue
    --   in_build      - someone is implementing it
    --   shipped       - merged + deployed
    --   rejected      - won't do
    --   parked        - good idea, not now
    status              TEXT NOT NULL DEFAULT 'new'
                        CHECK (status IN (
                            'new', 'reviewing', 'brainstorming',
                            'approved', 'in_build', 'shipped',
                            'rejected', 'parked'
                        )),

    priority            TEXT NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),

    -- Tags for filtering ('ux', 'backend', 'ai', 'data', ...)
    tags                TEXT[] NOT NULL DEFAULT '{}',

    -- Provenance
    raised_by_staff_id  INTEGER,
    raised_by_name      TEXT,
    raised_by_email     TEXT,

    -- CTO review
    cto_decision_note   TEXT,
    cto_decided_at      TIMESTAMPTZ,
    cto_decided_by      INTEGER,

    -- Brainstorm phase notes (free-form scoping)
    brainstorm_notes    TEXT,

    -- Build tracking
    build_started_at    TIMESTAMPTZ,
    shipped_at          TIMESTAMPTZ,
    shipped_commit_sha  TEXT,

    -- Comments thread inline JSONB. Each entry:
    --   { id, body, kind, by_name, by_staff_id, at }
    -- kind: 'insight' | 'question' | 'decision' | 'update'
    comments            JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Screenshot / file URLs in change-request-attachments bucket.
    -- Each entry: { url, filename, content_type, size, uploaded_at }
    attachments         JSONB NOT NULL DEFAULT '[]'::jsonb,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_change_requests_status
    ON feedback.change_requests (org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_change_requests_source
    ON feedback.change_requests (source_page, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_change_requests_priority_open
    ON feedback.change_requests (org_id, priority, created_at DESC)
    WHERE status NOT IN ('shipped', 'rejected');

-- updated_at trigger (reuses existing function pattern)
CREATE OR REPLACE FUNCTION feedback.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_change_requests_touch ON feedback.change_requests;
CREATE TRIGGER trg_change_requests_touch
    BEFORE UPDATE ON feedback.change_requests
    FOR EACH ROW EXECUTE FUNCTION feedback.touch_updated_at();

REVOKE ALL ON feedback.change_requests FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON feedback.change_requests TO service_role;
