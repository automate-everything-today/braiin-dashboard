-- 045_security_findings.sql
--
-- Durable record of each security finding from an audit. Whereas
-- security_events captures runtime signals (someone hit a rate limit, an
-- upload was rejected), security_findings captures KNOWN vulnerabilities
-- discovered by audits that are still open or have been resolved.
--
-- The /dev/security dashboard reads this table to show the open punch list
-- the operator must work through. New audits append; existing findings can
-- be transitioned through `acknowledged -> resolved` (or `wontfix` with a
-- documented reason).
--
-- After running:
--   - Seed today's audit findings via /dev/security or the seed script.

CREATE SCHEMA IF NOT EXISTS feedback;
GRANT USAGE ON SCHEMA feedback TO service_role;

CREATE TABLE IF NOT EXISTS feedback.security_findings (
    finding_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,

    -- Audit run identifier. Multiple findings share the same source_audit so
    -- the dashboard can group "everything from the 2026-04-29 review".
    source_audit        TEXT NOT NULL,
    source_reviewer     TEXT,           -- 'security-reviewer' | 'typescript-reviewer' | 'code-reviewer' | 'manual'

    severity            TEXT NOT NULL
                        CHECK (severity IN ('critical', 'high', 'medium', 'low')),

    -- Workflow:
    --   open         - just landed, awaiting triage
    --   acknowledged - operator has read it, plans to fix
    --   resolved     - fixed in a commit (record commit_sha)
    --   wontfix      - explicitly accepted as risk (record rationale)
    status              TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'acknowledged', 'resolved', 'wontfix')),

    title               TEXT NOT NULL,
    description         TEXT NOT NULL,
    recommendation      TEXT,

    -- Pinpoint location. Either may be NULL for cross-cutting findings.
    file_path           TEXT,
    line_number         INTEGER,

    -- Tags for filtering ('auth', 'input-validation', 'csv', 'storage', ...)
    tags                TEXT[] NOT NULL DEFAULT '{}',

    -- Audit trail of status transitions. Each entry:
    --   { at, by_email, from_status, to_status, note }
    history             JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Resolution record (populated when status = resolved | wontfix)
    resolved_at         TIMESTAMPTZ,
    resolved_by_email   TEXT,
    resolved_commit_sha TEXT,
    resolved_note       TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_findings_open
    ON feedback.security_findings (org_id, severity, created_at DESC)
    WHERE status IN ('open', 'acknowledged');

CREATE INDEX IF NOT EXISTS idx_security_findings_audit
    ON feedback.security_findings (source_audit, severity);

DROP TRIGGER IF EXISTS trg_security_findings_touch ON feedback.security_findings;
CREATE TRIGGER trg_security_findings_touch
    BEFORE UPDATE ON feedback.security_findings
    FOR EACH ROW EXECUTE FUNCTION feedback.touch_updated_at();

REVOKE ALL ON feedback.security_findings FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON feedback.security_findings TO service_role;
