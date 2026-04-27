-- 034_aviation_carriers.sql
--
-- IATA / ICAO airline carrier reference data.
--
-- Used to canonicalise airline references on AWBs, air-freight rate
-- cards, and Cargowise air-leg jobs. IATA publishes the master carrier
-- list but only via paid feeds; the openflights.org community dataset
-- (CC-BY) tracks the same data including IATA + ICAO + active flag and
-- is the de facto free source for non-commercial use, which fits our
-- internal-use purpose.
--
-- Source: github.com/jpatokal/openflights (airlines.dat). ~6000 rows
-- including dormant / merged carriers (active = FALSE).
--
-- Loaded by scripts/import-iata-carriers.ts. Refreshed annually via
-- the reference-data refresh workflow.

CREATE SCHEMA IF NOT EXISTS aviation;
GRANT USAGE ON SCHEMA aviation TO service_role;


CREATE TABLE IF NOT EXISTS aviation.carriers (
    carrier_id      INTEGER PRIMARY KEY,                    -- openflights numeric id (stable across releases)
    name            TEXT NOT NULL,                          -- 'British Airways'
    alias           TEXT,                                   -- alternative trade name
    iata_code       CHAR(2),                                -- 2-letter IATA ('BA')
    icao_code       CHAR(3),                                -- 3-letter ICAO ('BAW')
    callsign        TEXT,                                   -- radio callsign ('SPEEDBIRD')
    country         TEXT,                                   -- country name (free text from openflights)
    active          BOOLEAN NOT NULL DEFAULT TRUE,

    imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_release  TEXT
);

CREATE INDEX IF NOT EXISTS idx_aviation_carriers_iata
    ON aviation.carriers (iata_code)
    WHERE iata_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aviation_carriers_icao
    ON aviation.carriers (icao_code)
    WHERE icao_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aviation_carriers_active
    ON aviation.carriers (active, name)
    WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_aviation_carriers_name_lower
    ON aviation.carriers (LOWER(name));

COMMENT ON TABLE aviation.carriers IS
    'Airline carrier reference (IATA + ICAO codes, active flag). Sourced from openflights.org under CC-BY. Used to canonicalise AWB and air-freight rate-card references.';

REVOKE ALL ON aviation.carriers FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON aviation.carriers TO service_role;
