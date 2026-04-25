-- Directory of freight forwarding networks. These are membership organisations
-- (WCA, Globalia, JCtrans, etc.) that connect forwarders worldwide. Their
-- primary business is selling membership and running events, NOT requesting
-- shipping rates - so emails from them should never be classified as
-- quote_request or agent_request.
--
-- The classify-email route looks up the sender's domain in this table and,
-- on a match, biases Claude toward the new `network` category and adds a
-- "SENDER NETWORK MATCH" block to the prompt with the network's relationship
-- status (member / non-member / prospect) so the AI can write a sensible
-- summary and reply.

CREATE TABLE IF NOT EXISTS freight_networks (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  primary_domain TEXT NOT NULL,
  additional_domains TEXT[] NOT NULL DEFAULT '{}',
  relationship TEXT NOT NULL DEFAULT 'non-member'
    CHECK (relationship IN ('member','non-member','prospect','declined')),
  network_type TEXT NOT NULL DEFAULT 'general'
    CHECK (network_type IN ('general','project_cargo','specialised','association')),
  annual_fee_gbp INTEGER,
  events_per_year INTEGER,
  website TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (primary_domain)
);

-- GIN index for fast "any sender on this domain" lookups across
-- additional_domains too. Practical when a network uses multiple TLDs
-- (.com / .net / regional variants).
CREATE INDEX IF NOT EXISTS freight_networks_additional_domains_idx
  ON freight_networks USING GIN (additional_domains);

-- Trigger to keep updated_at fresh.
CREATE OR REPLACE FUNCTION freight_networks_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS freight_networks_set_updated_at ON freight_networks;
CREATE TRIGGER freight_networks_set_updated_at
  BEFORE UPDATE ON freight_networks
  FOR EACH ROW
  EXECUTE FUNCTION freight_networks_set_updated_at();

-- Seed with the 12 best-known freight networks. relationship defaults to
-- 'non-member' - Rob can update via the /networks UI once we know the actual
-- membership status for each.
INSERT INTO freight_networks (name, primary_domain, additional_domains, network_type, website, notes) VALUES
  ('WCA World', 'wcaworld.com', ARRAY['wca-network.com'], 'general', 'https://www.wcaworld.com', 'Largest independent freight forwarder network. Multiple sub-networks: WCA Logistics, WCA Pharma, WCA Perishables, etc.'),
  ('Globalia Logistics Network', 'globalialogisticsnetwork.com', ARRAY[]::TEXT[], 'general', 'https://www.globalialogisticsnetwork.com', 'Exclusive territorial network - one member per city.'),
  ('JCtrans (LogiKnights)', 'jctrans.com', ARRAY['jctrans.net'], 'general', 'https://www.jctrans.com', 'Asia-headquartered global network with very large directory.'),
  ('X2 Group', 'x2group.com', ARRAY['x2elite.com','x2logistics.net'], 'general', 'https://www.x2group.com', 'Premium-tier network. X2 Elite, X2 Logistics, X2 Project Cargo sub-brands.'),
  ('Cargo Connections', 'cargoconnections.net', ARRAY[]::TEXT[], 'general', 'https://www.cargoconnections.net', 'Mid-size network with annual conference.'),
  ('Worldwide Project Consortium (WPC)', 'worldwideprojectconsortium.com', ARRAY['wpc-online.com'], 'project_cargo', 'https://www.worldwideprojectconsortium.com', 'Project cargo / heavy-lift specialists only.'),
  ('Project Cargo Network', 'projectcargonetwork.com', ARRAY[]::TEXT[], 'project_cargo', 'https://www.projectcargonetwork.com', 'PCN - exclusive project cargo network.'),
  ('FIATA', 'fiata.org', ARRAY[]::TEXT[], 'association', 'https://www.fiata.org', 'International Federation of Freight Forwarders Associations - global trade body.'),
  ('Conqueror Freight Network', 'conqueror-network.com', ARRAY[]::TEXT[], 'general', 'https://www.conqueror-network.com', 'Exclusive territorial network.'),
  ('WIN (Worldwide Independent Network)', 'winnetwork.com', ARRAY[]::TEXT[], 'general', 'https://www.winnetwork.com', NULL),
  ('Cooperative Logistics Network', 'cooperativelogisticsnetwork.com', ARRAY[]::TEXT[], 'general', 'https://www.cooperativelogisticsnetwork.com', NULL),
  ('AeroAfrica', 'aeroafrica.com', ARRAY['aeroafrica.org'], 'specialised', 'https://www.aeroafrica.com', 'Africa-focused freight network.')
ON CONFLICT (primary_domain) DO NOTHING;
