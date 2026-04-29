-- Wave 4: ROI surface extensions for events + networks.
--
-- Three things this migration adds:
--   1. Multi-currency support on events.cost_gbp and freight_networks.annual_fee_gbp.
--      Renames to *_amount + adds a *_currency column (GBP / USD / EUR).
--      Existing values are interpreted as GBP (unchanged semantics).
--   2. Sub-network hierarchy via freight_networks.parent_network_id (self-FK).
--      Seeds known WCA + X2 sub-networks.
--   3. Deal attribution: deals.attributed_event_contact_id FK, with auto-link
--      trigger that fires on insert when a deal's contact_email matches an
--      event_contacts row.
--
-- ROI calculations always normalise to GBP via geo.fx_rates. The display
-- currency on the dashboard is a separate user preference.

-- =============================================================================
-- 1. Multi-currency on events
-- =============================================================================

ALTER TABLE events
  RENAME COLUMN cost_gbp TO cost_amount;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS cost_currency TEXT NOT NULL DEFAULT 'GBP'
    CHECK (cost_currency IN ('GBP','USD','EUR'));

COMMENT ON COLUMN events.cost_amount IS 'Total event cost (registration + travel + stand contribution) in cost_currency. Convert to GBP at calc time using geo.fx_rates.';
COMMENT ON COLUMN events.cost_currency IS 'ISO 4217 code for the cost_amount value. GBP/USD/EUR supported.';

-- =============================================================================
-- 2. Multi-currency on freight_networks
-- =============================================================================

ALTER TABLE freight_networks
  RENAME COLUMN annual_fee_gbp TO annual_fee_amount;

ALTER TABLE freight_networks
  ADD COLUMN IF NOT EXISTS fee_currency TEXT NOT NULL DEFAULT 'GBP'
    CHECK (fee_currency IN ('GBP','USD','EUR'));

COMMENT ON COLUMN freight_networks.annual_fee_amount IS 'Annual membership fee in fee_currency. NULL on sub-networks means "covered by parent membership".';
COMMENT ON COLUMN freight_networks.fee_currency IS 'ISO 4217 code for the annual_fee_amount value. GBP/USD/EUR supported.';

-- =============================================================================
-- 3. Sub-network hierarchy
-- =============================================================================

ALTER TABLE freight_networks
  ADD COLUMN IF NOT EXISTS parent_network_id INTEGER
    REFERENCES freight_networks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS freight_networks_parent_idx
  ON freight_networks (parent_network_id) WHERE parent_network_id IS NOT NULL;

COMMENT ON COLUMN freight_networks.parent_network_id IS 'Self-FK. NULL = top-level network. Set when this row is a sub-network (e.g. WCA Pharma -> WCA World).';

-- Seed known sub-networks. Idempotent via ON CONFLICT - existing primary_domain
-- rows are skipped so a re-run is safe. Each sub-network has parent_network_id
-- resolved by primary_domain lookup so the seed is order-independent.

DO $$
DECLARE
  wca_id INTEGER;
  x2_id INTEGER;
BEGIN
  SELECT id INTO wca_id FROM freight_networks WHERE primary_domain = 'wcaworld.com';
  SELECT id INTO x2_id FROM freight_networks WHERE primary_domain = 'x2group.com';

  -- WCA sub-networks. Annual fees null = covered by parent membership.
  IF wca_id IS NOT NULL THEN
    INSERT INTO freight_networks (name, primary_domain, additional_domains, network_type, parent_network_id, fee_currency, website, notes, active)
    VALUES
      ('WCA Pharma', 'wcapharma.com', ARRAY[]::TEXT[], 'specialised', wca_id, 'GBP', 'https://www.wcapharma.com', 'Pharma-cargo specialised sub-network of WCA. Fee covered by parent.', true),
      ('WCA Perishables', 'wcaperishables.com', ARRAY[]::TEXT[], 'specialised', wca_id, 'GBP', 'https://www.wcaperishables.com', 'Reefer / perishables specialised sub-network of WCA.', true),
      ('WCA Project Cargo', 'wcaprojects.com', ARRAY[]::TEXT[], 'project_cargo', wca_id, 'GBP', 'https://www.wcaprojects.com', 'Project / heavy-lift sub-network of WCA.', true),
      ('WCA eCommerce', 'wcaecommerce.com', ARRAY[]::TEXT[], 'specialised', wca_id, 'GBP', 'https://www.wcaecommerce.com', 'eCommerce / cross-border B2C sub-network of WCA.', true)
    ON CONFLICT (primary_domain) DO NOTHING;
  END IF;

  -- X2 sub-networks.
  IF x2_id IS NOT NULL THEN
    INSERT INTO freight_networks (name, primary_domain, additional_domains, network_type, parent_network_id, fee_currency, website, notes, active)
    VALUES
      ('X2 Elite', 'x2elite.com', ARRAY[]::TEXT[], 'general', x2_id, 'GBP', 'https://www.x2elite.com', 'Premium-tier sub-network of X2 Group.', true),
      ('X2 Logistics', 'x2logistics.net', ARRAY[]::TEXT[], 'general', x2_id, 'GBP', 'https://www.x2logistics.net', 'General sub-network of X2 Group.', true),
      ('X2 Project Cargo', 'x2projectcargo.com', ARRAY[]::TEXT[], 'project_cargo', x2_id, 'GBP', 'https://www.x2projectcargo.com', 'Project cargo sub-network of X2 Group.', true)
    ON CONFLICT (primary_domain) DO NOTHING;
  END IF;
END $$;

-- =============================================================================
-- 4. Deal attribution to event contacts
-- =============================================================================

-- The deals table already exists (older migration). Add the FK column.
-- Wrapped in DO block + EXCEPTION so this migration is safe if deals
-- doesn't exist yet in some environments.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'deals') THEN
    BEGIN
      ALTER TABLE deals
        ADD COLUMN IF NOT EXISTS attributed_event_contact_id INTEGER
          REFERENCES event_contacts(id) ON DELETE SET NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not add attributed_event_contact_id to deals: %', SQLERRM;
    END;

    BEGIN
      CREATE INDEX IF NOT EXISTS deals_attributed_event_contact_idx
        ON deals (attributed_event_contact_id) WHERE attributed_event_contact_id IS NOT NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not create deals_attributed_event_contact_idx: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'deals table not found - skipping attributed_event_contact_id. Add manually when deals table is introduced.';
  END IF;
END $$;

-- Auto-link trigger: when a deal is inserted, if any contact email matches
-- an event_contacts row, set attributed_event_contact_id automatically.
-- Operator can override manually via UPDATE later.
--
-- This trigger only fires when attributed_event_contact_id is NULL on insert,
-- so manual operator overrides are preserved on subsequent updates.
--
-- The deals table's contact email column varies between projects. We try
-- common candidate columns in order. If none exist, the trigger silently
-- no-ops (and a warning is raised on creation).

DO $$
DECLARE
  contact_col TEXT := NULL;
  candidate TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'deals') THEN
    RAISE NOTICE 'deals table not found - skipping auto-link trigger.';
    RETURN;
  END IF;

  FOREACH candidate IN ARRAY ARRAY['contact_email','email','primary_contact_email','client_email'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'deals' AND column_name = candidate
    ) THEN
      contact_col := candidate;
      EXIT;
    END IF;
  END LOOP;

  IF contact_col IS NULL THEN
    RAISE NOTICE 'deals has no recognisable contact email column - auto-link trigger NOT created. Operator must set attributed_event_contact_id manually.';
    RETURN;
  END IF;

  -- Build the trigger function dynamically so we can reference the right column.
  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION deals_autolink_event_contact()
    RETURNS TRIGGER AS $body$
    BEGIN
      IF NEW.attributed_event_contact_id IS NULL AND NEW.%I IS NOT NULL THEN
        SELECT id INTO NEW.attributed_event_contact_id
        FROM event_contacts
        WHERE lower(email) = lower(NEW.%I)
        ORDER BY imported_at DESC
        LIMIT 1;
      END IF;
      RETURN NEW;
    END;
    $body$ LANGUAGE plpgsql;
  $f$, contact_col, contact_col);

  DROP TRIGGER IF EXISTS deals_autolink_event_contact ON deals;
  CREATE TRIGGER deals_autolink_event_contact
    BEFORE INSERT ON deals
    FOR EACH ROW
    EXECUTE FUNCTION deals_autolink_event_contact();

  RAISE NOTICE 'deals_autolink_event_contact trigger created using deals.% as contact email column.', contact_col;
END $$;

-- =============================================================================
-- Sanity
-- =============================================================================

DO $$
DECLARE
  network_count INTEGER;
  subnet_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO network_count FROM freight_networks WHERE parent_network_id IS NULL;
  SELECT COUNT(*) INTO subnet_count FROM freight_networks WHERE parent_network_id IS NOT NULL;
  RAISE NOTICE 'freight_networks: % top-level, % sub-networks', network_count, subnet_count;
END $$;
