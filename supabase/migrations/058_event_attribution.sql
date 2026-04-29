-- Event attribution model.
--
-- Two tables introduce a thin ROI scaffolding without committing to the full
-- /events ROI surface yet (deferred per Option B in the 2026-04-30 scoping).
--
-- - events: per-event metadata (Intermodal Europe 2026, GKF Summit 2026, etc.)
--   Optional via_network_id captures "attended via network's stand" so deal
--   attribution can flow back to network membership ROI later.
--
-- - event_contacts: post-conference contacts being followed up. Mirrors what
--   lives in the "Networking - Follow ups" Airtable base today, but Braiin
--   becomes the source of truth for follow-up state (sent / replied / tier
--   override). Airtable remains the ingest layer.
--
-- ROI scaffolding (data captured now, surface built later):
--   - event_id ties contact to a specific event
--   - attributed_network_id lets a deal closed from this contact roll up to
--     the network's annual fee ROI calculation when /networks gets the ROI
--     surface
--   - cost_gbp on events lets per-event ROI compute later (revenue from
--     attributed deals minus event cost)

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'trade_show'
    CHECK (event_type IN ('trade_show','conference','network_meeting','agm','other')),
  start_date DATE NOT NULL,
  end_date DATE,
  location TEXT,
  via_network_id INTEGER REFERENCES freight_networks(id) ON DELETE SET NULL,
  cost_gbp NUMERIC(12,2),
  attendees TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, start_date)
);

CREATE INDEX IF NOT EXISTS events_via_network_idx
  ON events (via_network_id) WHERE via_network_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_start_date_idx
  ON events (start_date DESC);

CREATE OR REPLACE FUNCTION events_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_set_updated_at ON events;
CREATE TRIGGER events_set_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION events_set_updated_at();

-- =============================================================================
-- event_contacts: per-contact follow-up state
-- =============================================================================
CREATE TABLE IF NOT EXISTS event_contacts (
  id SERIAL PRIMARY KEY,

  -- Source of truth (Airtable upsert key)
  airtable_record_id TEXT UNIQUE,

  -- Identity
  email TEXT NOT NULL,
  name TEXT,
  title TEXT,
  company TEXT,
  phone TEXT,
  website TEXT,
  country TEXT,
  region TEXT,

  -- Event attribution (the new ROI scaffolding)
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  attributed_network_id INTEGER REFERENCES freight_networks(id) ON DELETE SET NULL,

  -- Conference context
  meeting_notes TEXT,
  company_info TEXT,
  company_type TEXT,

  -- Routing (mirrors Airtable "Met By" + "Internal CC" + "Lead Contact" fields)
  met_by TEXT[] NOT NULL DEFAULT '{}',
  internal_cc TEXT,
  contact_role TEXT
    CHECK (contact_role IS NULL OR contact_role IN ('to','cc','skip')),
  is_lead_contact BOOLEAN NOT NULL DEFAULT false,

  -- Tier (manual rating from Airtable Priority field; 1-5)
  tier INTEGER
    CHECK (tier IS NULL OR (tier BETWEEN 1 AND 5)),

  -- Follow-up state machine
  follow_up_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (follow_up_status IN (
      'pending',           -- not yet drafted
      'already_engaged',   -- existing email contact, skip cold treatment
      'drafted',           -- AI draft generated, awaiting review
      'reviewed',          -- operator reviewed/edited the draft
      'queued',            -- ready to send
      'sent',              -- email sent via Microsoft Graph
      'replied',           -- contact has replied
      'bounced',           -- delivery failed
      'opted_out',         -- contact unsubscribed / asked to stop
      'cancelled'          -- operator decided not to send
    )),

  -- Engagement signals (populated by the already-engaged scanner)
  last_inbound_at TIMESTAMPTZ,
  last_outbound_at TIMESTAMPTZ,
  engagement_summary TEXT,  -- human-readable summary of prior touches

  -- Drafting state
  draft_subject TEXT,
  draft_body TEXT,
  draft_generated_at TIMESTAMPTZ,
  draft_model TEXT,

  -- Send state
  send_from_email TEXT,     -- which rep mailbox the draft is queued from
  sent_at TIMESTAMPTZ,
  sent_message_id TEXT,     -- Microsoft Graph message id
  replied_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  bounce_reason TEXT,

  -- Audit
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_from_airtable_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Email + event combo is the natural uniqueness for "this contact at this event".
-- One person can attend multiple events so we don't unique-on email alone.
CREATE UNIQUE INDEX IF NOT EXISTS event_contacts_email_event_uniq
  ON event_contacts (lower(email), event_id);

CREATE INDEX IF NOT EXISTS event_contacts_event_idx
  ON event_contacts (event_id, follow_up_status);
CREATE INDEX IF NOT EXISTS event_contacts_status_idx
  ON event_contacts (follow_up_status, tier);
CREATE INDEX IF NOT EXISTS event_contacts_attributed_network_idx
  ON event_contacts (attributed_network_id) WHERE attributed_network_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_contacts_email_idx
  ON event_contacts (lower(email));
CREATE INDEX IF NOT EXISTS event_contacts_company_idx
  ON event_contacts (lower(company)) WHERE company IS NOT NULL;

CREATE OR REPLACE FUNCTION event_contacts_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS event_contacts_set_updated_at ON event_contacts;
CREATE TRIGGER event_contacts_set_updated_at
  BEFORE UPDATE ON event_contacts
  FOR EACH ROW
  EXECUTE FUNCTION event_contacts_set_updated_at();

-- =============================================================================
-- Seed the two events we already attended (April 2026).
-- via_network_id resolved from the freight_networks seed; if the network row
-- does not yet exist (GKF/ULN was not in the original 14_freight_networks
-- seed) we INSERT it here so the FK lands.
-- =============================================================================

-- Make sure GKF/ULN is in freight_networks. WCA already exists from migration 014.
INSERT INTO freight_networks (name, primary_domain, additional_domains, network_type, website, notes)
VALUES (
  'GKF / ULN Network',
  'gkfsummit.com',
  ARRAY['ulnetwork.com','gkfworldwide.com']::TEXT[],
  'general',
  'https://www.gkfsummit.com',
  'GKF / ULN Network. Hosts annual GKF Summit (concurrent with Intermodal South America).'
)
ON CONFLICT (primary_domain) DO NOTHING;

-- Intermodal 2026 - attended via WCA's stand.
-- Name matches the Airtable "Event" multi-select choice exactly so importer
-- can map 1:1 without a translation table.
INSERT INTO events (name, event_type, start_date, end_date, location, via_network_id, attendees, notes)
SELECT
  'Intermodal 2026',
  'trade_show',
  '2026-04-14',
  '2026-04-16',
  'Sao Paulo, Brazil',
  fn.id,
  ARRAY['rob.donald@cortenlogistics.com','sam.yauner@cortenlogistics.com','bruna.natale@cortenlogistics.com']::TEXT[],
  'Intermodal South America (Sao Paulo). Attended via WCA stand. Cost rolls up to WCA membership ROI.'
FROM freight_networks fn
WHERE fn.primary_domain = 'wcaworld.com'
ON CONFLICT (name, start_date) DO NOTHING;

-- GKF/ULN Summit 2026 - standalone (per scoping decision 2026-04-30).
-- Name matches the Airtable "Event" multi-select choice exactly.
INSERT INTO events (name, event_type, start_date, end_date, location, via_network_id, attendees, notes)
VALUES (
  'GKF/ULN Summit 2026',
  'conference',
  '2026-04-12',
  '2026-04-13',
  'Sao Paulo, Brazil',
  NULL,  -- standalone for ROI purposes (despite GKF/ULN network membership)
  ARRAY['rob.donald@cortenlogistics.com','sam.yauner@cortenlogistics.com','bruna.natale@cortenlogistics.com']::TEXT[],
  'GKF/ULN Network annual summit. Treated as standalone event for ROI even though we are network members.'
)
ON CONFLICT (name, start_date) DO NOTHING;

-- Backlog: Intermodal 2024 + 2025 also appear as Airtable choices. Adding
-- them so any historical contacts importing don't fail the FK. Rob can
-- backfill cost/attendees later if needed.
INSERT INTO events (name, event_type, start_date, location, notes, active)
VALUES
  ('Intermodal 2025','trade_show','2025-04-15','Sao Paulo, Brazil','Historical event - backfill metadata if needed.', false),
  ('Intermodal 2024','trade_show','2024-04-16','Sao Paulo, Brazil','Historical event - backfill metadata if needed.', false)
ON CONFLICT (name, start_date) DO NOTHING;

DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM events;
  RAISE NOTICE 'events seeded with % rows', n;
END $$;
