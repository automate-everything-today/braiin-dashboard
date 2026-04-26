-- email_classifications rows are shared across the team: one row per
-- Outlook email_id, with per-user override fields (user_rating,
-- user_tags, user_override_category, etc.) that any authenticated
-- caller can write. This matches the "shared inbox" model used by
-- inbox_groups, but it means a user can overwrite another user's
-- override with no audit trail.
--
-- Add a last_modified_by audit column so writes are traceable. The
-- /api/classify-email PUT handler stamps this on every update. A
-- proper per-user override table is a future schema redesign; until
-- then this gives us accountability.

ALTER TABLE email_classifications
  ADD COLUMN IF NOT EXISTS last_modified_by TEXT;

ALTER TABLE email_classifications
  ADD COLUMN IF NOT EXISTS last_modified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS email_classifications_last_modified_by_idx
  ON email_classifications (last_modified_by)
  WHERE last_modified_by IS NOT NULL;
