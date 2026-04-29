-- 055_build_queue.sql
-- Build queue + personal access tokens for the dashboard <-> terminal bridge.
-- Already applied via Mgmt API on first run; file exists for migration ordering.

CREATE TABLE IF NOT EXISTS feedback.personal_tokens (
    token_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_sha256    TEXT NOT NULL UNIQUE,
    user_email      TEXT NOT NULL,
    label           TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_personal_tokens_email
    ON feedback.personal_tokens (user_email)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS feedback.build_queue (
    queue_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    source_type         TEXT NOT NULL CHECK (source_type IN ('roadmap','finding','change_request','manual','telegram')),
    source_id           UUID,
    title               TEXT NOT NULL,
    prompt              TEXT NOT NULL,
    target_repo         TEXT,
    working_dir         TEXT,
    priority            TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
    status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','done','cancelled')),
    claimed_at          TIMESTAMPTZ,
    claimed_by          TEXT,
    claimed_machine     TEXT,
    completed_at        TIMESTAMPTZ,
    completed_note      TEXT,
    completed_commit_sha TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_email    TEXT,
    notes               TEXT
);
CREATE INDEX IF NOT EXISTS idx_build_queue_status
    ON feedback.build_queue (org_id, status, priority, created_at);

REVOKE ALL ON feedback.personal_tokens FROM PUBLIC;
REVOKE ALL ON feedback.build_queue FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON feedback.personal_tokens TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON feedback.build_queue TO service_role;
