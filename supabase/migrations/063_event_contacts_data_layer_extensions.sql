-- Migration 063: event_contacts data layer extensions
-- Adds seniority_score, data_source_tags, attention_reason, company_group_id;
-- enforces lowercase email; adds 'needs_attention' to follow_up_status enum;
-- adds composite (event_id, tier, name) index for the dominant query.

BEGIN;

ALTER TABLE event_contacts ADD COLUMN seniority_score INTEGER
  CHECK (seniority_score IS NULL OR (seniority_score BETWEEN 0 AND 100));
ALTER TABLE event_contacts ADD COLUMN data_source_tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE event_contacts ADD COLUMN attention_reason TEXT;
ALTER TABLE event_contacts ADD COLUMN company_group_id INTEGER;  -- FK added in 064

ALTER TABLE event_contacts ADD CONSTRAINT event_contacts_email_lowercase
  CHECK (email = lower(email));

DO $$
DECLARE
  cons_name TEXT;
BEGIN
  SELECT conname INTO cons_name
  FROM pg_constraint
  WHERE conrelid = 'public.event_contacts'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%follow_up_status%'
  LIMIT 1;

  IF cons_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE event_contacts DROP CONSTRAINT %I', cons_name);
  END IF;
END $$;

ALTER TABLE event_contacts
  ADD CONSTRAINT event_contacts_follow_up_status_check
  CHECK (follow_up_status IN (
    'pending','already_engaged','drafted','reviewed',
    'queued','sent','replied','bounced','opted_out',
    'cancelled','needs_attention'
  ));

CREATE INDEX IF NOT EXISTS event_contacts_event_tier_name_idx
  ON event_contacts (event_id, tier, name);

COMMIT;
