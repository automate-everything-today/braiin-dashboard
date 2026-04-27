-- 028_llm_feedback.sql
--
-- Decision-loop foundation (engiine adoption RFC section 3.2).
--
-- Every LLM call now carries a stable `decision_id` (auto-minted by
-- the gateway) which uniquely identifies that AI output. Users (and
-- automated processes) can submit feedback against a `decision_id`
-- through this table, in one of four shapes:
--
--   confirm  - "this was right" (positive signal)
--   reject   - "this was wrong" (negative signal, no correction)
--   correct  - "this was wrong, here's what it should have been" (highest-value signal: paired before/after example)
--   flag     - "this was odd / I'm not sure / needs review" (audit signal)
--
-- The 'correct' shape is what powers the gold-dataset promotion
-- pipeline in a later RFC: confirmed and corrected decisions become
-- regression-test fixtures for the prompt that produced them, so
-- prompt drift is caught before reaching production.
--
-- This is the safety net for high-stakes AI features (quote drafting,
-- exception triage, rate evaluation). A wrong classify-email is
-- recoverable; a wrong quote is a GBP 10k mistake. Capture before
-- the AI goes anywhere near the high-value features.
--
-- service_role grants baked in (lesson from 024/025).

CREATE TABLE IF NOT EXISTS activity.llm_feedback (
    feedback_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Soft FK to activity.llm_calls.decision_id (no enforced FK
    -- because llm_calls is unpartitioned today but may be partitioned
    -- later; feedback rows must survive partition drops on the call
    -- side anyway, so app-layer integrity is the right model).
    decision_id      UUID NOT NULL,

    org_id           UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,

    -- The four engiine-canonical feedback shapes
    feedback_type    TEXT NOT NULL CHECK (feedback_type IN ('confirm', 'reject', 'correct', 'flag')),

    -- Optional human note. Always allowed.
    note             TEXT,

    -- Only meaningful when feedback_type = 'correct'. The right
    -- answer the human provided. Becomes a paired before/after
    -- training example via the gold-dataset promotion pipeline.
    corrected_output TEXT,

    -- Audit
    submitted_by     TEXT NOT NULL,
    submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Free-form context (e.g. UI surface that captured the feedback,
    -- review session ID, etc).
    metadata         JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Hot read paths
-- 1. "Show me all feedback for this decision" (audit view per call)
CREATE INDEX IF NOT EXISTS idx_llm_feedback_decision
    ON activity.llm_feedback (decision_id, submitted_at DESC);

-- 2. "Reject rate per purpose this month" (drift detection)
-- Composed by joining feedback to llm_calls on decision_id; this
-- index supports the feedback-side scan.
CREATE INDEX IF NOT EXISTS idx_llm_feedback_org_type_time
    ON activity.llm_feedback (org_id, feedback_type, submitted_at DESC);

-- 3. "Latest corrections to promote to the gold dataset"
CREATE INDEX IF NOT EXISTS idx_llm_feedback_corrections
    ON activity.llm_feedback (org_id, submitted_at DESC)
    WHERE feedback_type = 'correct';

COMMENT ON TABLE activity.llm_feedback IS
    'Per-call feedback on LLM gateway decisions. Powers the engiine RFC section 3.2 feedback loop. confirm/reject/correct/flag against a decision_id minted by the gateway.';

-- Lockdown - REVOKE PUBLIC then GRANT service_role.
REVOKE ALL ON activity.llm_feedback FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON activity.llm_feedback TO service_role;
