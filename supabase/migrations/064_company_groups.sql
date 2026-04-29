-- Migration 064: company_groups
-- Creates the table that groups same-company contacts within an event,
-- adds the FK from event_contacts.company_group_id, and a partial index.

BEGIN;

CREATE TABLE company_groups (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  company_name_canonical TEXT NOT NULL,
  lead_contact_id INTEGER REFERENCES event_contacts(id) ON DELETE SET NULL,
  lead_overridden_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, company_name_canonical)
);

ALTER TABLE event_contacts
  ADD CONSTRAINT event_contacts_company_group_id_fkey
  FOREIGN KEY (company_group_id) REFERENCES company_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS event_contacts_company_group_idx
  ON event_contacts (company_group_id) WHERE company_group_id IS NOT NULL;

COMMIT;
