-- Tag-based relevance for emails. Replaces the single department / mode
-- columns from migration 011 with flexible tag arrays so an email can
-- span multiple categories (e.g. a Sea shipment in invoicing carries both
-- 'Accounts' and 'Sea' tags) and so the taxonomy can grow without further
-- schema changes.
--
-- ai_tags:   Claude's suggested tags from classify-email.
-- user_tags: Manual overrides. When non-null the user_tags array is the
--            source of truth for rule scoping; otherwise ai_tags is used.
-- relevance_feedback: optional "thumbs up" positive reinforcement when
--            the AI's tags matched the user's judgement without edits.
--
-- Controlled vocabulary to start (enforced in application code, not the
-- DB, so new tags can be added without a migration):
--   Departments: Ops, Sales, Accounts
--   Modes:       Air, Road, Sea, Warehousing

ALTER TABLE email_classifications
  ADD COLUMN IF NOT EXISTS ai_tags TEXT[];

ALTER TABLE email_classifications
  ADD COLUMN IF NOT EXISTS user_tags TEXT[];

ALTER TABLE email_classifications
  ADD COLUMN IF NOT EXISTS relevance_feedback TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_classifications_relevance_feedback_check'
  ) THEN
    ALTER TABLE email_classifications
      ADD CONSTRAINT email_classifications_relevance_feedback_check
      CHECK (relevance_feedback IS NULL OR relevance_feedback IN ('thumbs_up','thumbs_down'));
  END IF;
END $$;

-- GIN index so queries like "any email tagged 'Accounts'" stay fast as
-- the corpus grows.
CREATE INDEX IF NOT EXISTS email_classifications_user_tags_idx
  ON email_classifications USING GIN (user_tags);

CREATE INDEX IF NOT EXISTS email_classifications_ai_tags_idx
  ON email_classifications USING GIN (ai_tags);
