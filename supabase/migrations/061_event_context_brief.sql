-- Per-event "context brief" that operators can input from /events.
-- Loaded into the draft generator system prompt so every email written for
-- this event's contacts inherits the same context (e.g. "we were on the WCA
-- stand, focused on signing up LATAM partners for Brazil-bound reefer
-- volumes, Sam was hunting for Vietnam capacity").
--
-- Plain TEXT, no length cap (operators can write a paragraph).

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS context_brief TEXT;

COMMENT ON COLUMN events.context_brief IS 'Free-text per-event context that flavours every AI draft. Operator inputs from /events form. e.g. "WCA stand, focus on LATAM partners, Brazil-bound reefer interest, looking to sign Vietnam agents."';
