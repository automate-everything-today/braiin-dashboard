-- Fix the event_contacts unique constraints so the Airtable importer can
-- write multiple rows per Airtable record (one per event the contact
-- attended), while still preventing dupes on (email, event_id).
--
-- Background: migration 058 set airtable_record_id as column-level UNIQUE,
-- which silently blocked imports when a single Airtable record was tagged
-- with multiple Events (e.g. "Intermodal 2025" + "Intermodal 2026"). The
-- importer expands one record into N rows (one per event) - the second row
-- in the same upsert chunk hits the UNIQUE and Postgres rejects the chunk
-- with "ON CONFLICT cannot affect row a second time".
--
-- Fix:
--   1. Drop the UNIQUE on airtable_record_id (keep the column for traceability).
--   2. Replace the functional UNIQUE INDEX on (lower(email), event_id) with
--      a regular UNIQUE INDEX on (email, event_id). The importer always
--      lowercases email before insert, so uniqueness is preserved.
--   3. Add a non-unique index on airtable_record_id for fast lookups.

-- 1. Drop the column-level UNIQUE on airtable_record_id.
DO $$
DECLARE
  cons_name TEXT;
BEGIN
  SELECT conname INTO cons_name
  FROM pg_constraint
  WHERE conrelid = 'public.event_contacts'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) ILIKE '%airtable_record_id%'
  LIMIT 1;

  IF cons_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE event_contacts DROP CONSTRAINT %I', cons_name);
    RAISE NOTICE 'Dropped UNIQUE constraint % on event_contacts.airtable_record_id', cons_name;
  ELSE
    RAISE NOTICE 'No UNIQUE constraint found on event_contacts.airtable_record_id - already removed?';
  END IF;
END $$;

-- 2. Replace the functional UNIQUE INDEX with a regular one (PostgREST
--    upsert needs a non-functional unique index/constraint to target).
DROP INDEX IF EXISTS event_contacts_email_event_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS event_contacts_email_event_uniq
  ON event_contacts (email, event_id);

-- 3. Add a non-unique helper index on airtable_record_id since we still
--    look up by it (importer uses it for dedup-on-update logic).
CREATE INDEX IF NOT EXISTS event_contacts_airtable_record_idx
  ON event_contacts (airtable_record_id) WHERE airtable_record_id IS NOT NULL;

DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM event_contacts;
  RAISE NOTICE 'event_contacts: % rows', n;
END $$;
