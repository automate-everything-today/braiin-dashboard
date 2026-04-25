-- Two-tier opt-out for AI learning from staff replies.
--
-- Existing column: user_preferences.ai_learning_enabled
--   When false, the staff member's outgoing replies are NOT captured into
--   ai_writing_samples at all (handled in /api/email-sync POST).
--
-- New column: user_preferences.ai_learning_share_team
--   When true (default), the staff member's captured replies are visible
--   to OTHER staff members' classify-email prompt assembly - so the whole
--   team learns from their writing voice. When false, their replies are
--   captured for THEIR OWN AI only; other staff classify-email runs do
--   not see their samples.
--
-- This codifies the cross-org learning that 21 introduces while letting
-- individuals keep their reply patterns private to themselves.

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS ai_learning_share_team BOOLEAN NOT NULL DEFAULT TRUE;
