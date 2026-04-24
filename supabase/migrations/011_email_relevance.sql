-- Store the email's content-relevant scope so reply rules can be loaded
-- based on what the email is actually ABOUT, not on the user's own home
-- department / mode. Needed because many staff cover multiple departments
-- or business units, so keying rules off the user's assignment misapplies
-- voice preferences.
--
-- Populated by Claude during classify-email. Nullable so historical rows
-- continue to work; the runtime falls back to the user's home scopes when
-- these are null.

ALTER TABLE email_classifications
  ADD COLUMN IF NOT EXISTS ai_relevant_department TEXT;

ALTER TABLE email_classifications
  ADD COLUMN IF NOT EXISTS ai_relevant_mode TEXT;

-- Constrain mode to the four known business units. Named so it can be
-- dropped cleanly if the mode set changes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_classifications_ai_relevant_mode_check'
  ) THEN
    ALTER TABLE email_classifications
      ADD CONSTRAINT email_classifications_ai_relevant_mode_check
      CHECK (ai_relevant_mode IS NULL OR ai_relevant_mode IN ('Air','Road','Sea','Warehousing'));
  END IF;
END $$;
