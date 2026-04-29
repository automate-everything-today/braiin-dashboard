-- Migration 065: granola_meetings + event_contact_granola_links
-- Caches Granola transcripts and links them many-to-many to event_contacts.

BEGIN;

CREATE TABLE granola_meetings (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  transcript TEXT NOT NULL,
  summary TEXT,
  participants JSONB NOT NULL DEFAULT '[]',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS granola_meetings_recorded_at_idx
  ON granola_meetings (recorded_at);

CREATE TABLE event_contact_granola_links (
  event_contact_id INTEGER NOT NULL
    REFERENCES event_contacts(id) ON DELETE CASCADE,
  granola_meeting_id UUID NOT NULL
    REFERENCES granola_meetings(id) ON DELETE CASCADE,
  match_confidence INTEGER NOT NULL
    CHECK (match_confidence BETWEEN 0 AND 100),
  match_method TEXT NOT NULL
    CHECK (match_method IN ('name_exact','name_fuzzy','name_and_date','manual','pending_review')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_contact_id, granola_meeting_id)
);

ALTER TABLE granola_meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY granola_meetings_authenticated_read ON granola_meetings
  FOR SELECT USING ((SELECT auth.role()) = 'authenticated');

ALTER TABLE event_contact_granola_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY granola_links_authenticated_read ON event_contact_granola_links
  FOR SELECT USING ((SELECT auth.role()) = 'authenticated');

COMMIT;
