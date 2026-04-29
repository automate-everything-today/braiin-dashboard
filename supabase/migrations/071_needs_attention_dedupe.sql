-- Migration 071: clean up duplicate needs_attention rows + add partial unique
-- index to prevent future duplicates.
--
-- Background: the unique index event_contacts_email_event_uniq is on
-- (email, event_id). Postgres treats NULL as distinct in unique indexes,
-- so two rows with the same synthesised email and event_id IS NULL can
-- coexist. The importer's airtable_record_id-based dedupe check fixes
-- this on insert, but a race (or pre-fix imports) left duplicates.
--
-- The bulk-assign endpoint exposes the problem: assigning duplicate rows
-- to an event creates real (email, event_id) collisions which throw the
-- unique constraint.
--
-- Fix:
--   1. Delete duplicate needs_attention rows, keeping the most recent per
--      airtable_record_id.
--   2. Add a partial unique index on airtable_record_id WHERE event_id IS NULL
--      so future races + repeat imports cannot recreate the problem.

BEGIN;

-- 1. De-duplicate. Keep the row with the latest imported_from_airtable_at
--    timestamp per airtable_record_id; tie-break on highest id.
DO $$
DECLARE
  removed INT;
BEGIN
  WITH dupes AS (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY airtable_record_id
        ORDER BY imported_from_airtable_at DESC NULLS LAST, id DESC
      ) AS rn
    FROM event_contacts
    WHERE event_id IS NULL
      AND airtable_record_id IS NOT NULL
  )
  DELETE FROM event_contacts
  WHERE id IN (SELECT id FROM dupes WHERE rn > 1);

  GET DIAGNOSTICS removed = ROW_COUNT;
  RAISE NOTICE 'Removed % duplicate needs_attention rows', removed;
END $$;

-- 2. Add a partial unique index so future inserts for the same Airtable
--    record cannot create a duplicate while the row sits in needs_attention
--    (event_id IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS event_contacts_airtable_no_event_uniq
  ON event_contacts (airtable_record_id)
  WHERE event_id IS NULL AND airtable_record_id IS NOT NULL;

COMMIT;
