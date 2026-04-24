-- Thread lifecycle stages. One email can carry a stage hint; the thread's
-- effective stage is the stage of its most recent email (or the user's
-- override if set). Nullable because not every email is part of a
-- trackable lifecycle (internal admin chatter, marketing, FYI etc).
--
-- Vocabulary controlled in app code (src/lib/conversation-stages.ts) as
-- well as here. A DB CHECK gives us a safety net against bad writes from
-- future code paths.

ALTER TABLE email_classifications
  ADD COLUMN IF NOT EXISTS ai_conversation_stage TEXT;

ALTER TABLE email_classifications
  ADD COLUMN IF NOT EXISTS user_conversation_stage TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_classifications_ai_conversation_stage_check'
  ) THEN
    ALTER TABLE email_classifications
      ADD CONSTRAINT email_classifications_ai_conversation_stage_check
      CHECK (ai_conversation_stage IS NULL OR ai_conversation_stage IN (
        'lead','quote_request','awaiting_info','quote_sent','quote_follow_up',
        'quote_secured','booked','live_shipment','exception','delivered',
        'invoicing','paid','closed'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_classifications_user_conversation_stage_check'
  ) THEN
    ALTER TABLE email_classifications
      ADD CONSTRAINT email_classifications_user_conversation_stage_check
      CHECK (user_conversation_stage IS NULL OR user_conversation_stage IN (
        'lead','quote_request','awaiting_info','quote_sent','quote_follow_up',
        'quote_secured','booked','live_shipment','exception','delivered',
        'invoicing','paid','closed'
      ));
  END IF;
END $$;

-- Index for the stages dashboard, which groups threads by stage. Partial
-- index skips NULL stages (most internal mail) so the dashboard query only
-- scans rows it actually cares about.
CREATE INDEX IF NOT EXISTS email_classifications_effective_stage_idx
  ON email_classifications (
    COALESCE(user_conversation_stage, ai_conversation_stage)
  )
  WHERE COALESCE(user_conversation_stage, ai_conversation_stage) IS NOT NULL;
