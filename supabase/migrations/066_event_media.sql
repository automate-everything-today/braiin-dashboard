-- Migration 066: event_media
-- Stores per-event uploaded photos. Storage bucket created separately.

BEGIN;

CREATE TABLE event_media (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  caption TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by TEXT
);

CREATE INDEX IF NOT EXISTS event_media_event_idx ON event_media (event_id);

ALTER TABLE event_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_media_authenticated_read ON event_media
  FOR SELECT USING ((SELECT auth.role()) = 'authenticated');

COMMIT;
