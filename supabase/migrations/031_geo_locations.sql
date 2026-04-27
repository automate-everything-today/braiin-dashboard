-- 031_geo_locations.sql
--
-- UN/LOCODE reference data (UN Code for Trade and Transport Locations).
--
-- Cargowise and every reputable freight system uses UN/LOCODE as the
-- canonical 5-character location identifier (2 ISO-3166 country chars +
-- 3 location chars, e.g. GBFXT = Felixstowe). To match Cargowise jobs,
-- validate port references on emails / rate cards, and feed the rate
-- engine canonical codes, we hold the full ~110k-row dataset locally.
--
-- Source: UNECE (https://unece.org/trade/cefact/UNLOCODE-Download).
-- Released twice yearly (typically May and November) as 'YYYY-N'.
-- The import script in scripts/import-unlocode.ts handles refresh; a
-- GitHub Actions cron triggers it on the UNECE release cadence.
--
-- Two tables:
--   geo.countries  - ISO 3166-1 country codes (parent FK target)
--   geo.locations  - UN/LOCODE rows (port, airport, rail, road, ICD, ...)
--
-- service_role grants baked in. The geo schema must also be added to
-- Supabase Dashboard > Settings > API > Exposed schemas after running.

-- ============================================================
-- Schema
-- ============================================================

CREATE SCHEMA IF NOT EXISTS geo;
GRANT USAGE ON SCHEMA geo TO service_role;


-- ============================================================
-- geo.countries - ISO 3166-1 alpha-2 reference
-- ============================================================
-- Loaded by scripts/import-iso-countries.ts. Kept thin: just the
-- pieces we use across freight workflows. Region and subregion
-- come from M49 (used by UNECE for grouping ports).

CREATE TABLE IF NOT EXISTS geo.countries (
    code        CHAR(2) PRIMARY KEY,                  -- ISO 3166-1 alpha-2 ('GB', 'NL', 'CN')
    code_a3     CHAR(3),                              -- ISO 3166-1 alpha-3 ('GBR', 'NLD', 'CHN')
    code_num    CHAR(3),                              -- ISO 3166-1 numeric ('826', '528', '156')
    name        TEXT NOT NULL,                        -- Common short name ('United Kingdom')
    official_name TEXT,                               -- Official name ('United Kingdom of Great Britain and Northern Ireland')
    region      TEXT,                                 -- M49 region ('Europe', 'Asia', 'Africa', ...)
    subregion   TEXT,                                 -- M49 subregion ('Northern Europe', ...)

    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_release TEXT
);

CREATE INDEX IF NOT EXISTS idx_geo_countries_name_lower
    ON geo.countries (LOWER(name));

COMMENT ON TABLE geo.countries IS
    'ISO 3166-1 country reference. Parent FK target for geo.locations and several other reference tables.';


-- ============================================================
-- geo.locations - UN/LOCODE
-- ============================================================
-- Primary key is the 5-char unlocode (no separator). Country code is
-- the first 2 chars and FKs to geo.countries; location code is the
-- last 3 chars (kept as a separate column for indexed lookups even
-- though it is derivable, because Cargowise sometimes ships just the
-- 3-char location piece in a country context).

CREATE TABLE IF NOT EXISTS geo.locations (
    unlocode        CHAR(5) PRIMARY KEY,                                              -- 'GBFXT'
    country_code    CHAR(2) NOT NULL REFERENCES geo.countries(code) ON DELETE RESTRICT, -- 'GB'
    location_code   CHAR(3) NOT NULL,                                                 -- 'FXT'

    name            TEXT NOT NULL,                                                    -- 'Felixstowe'
    name_no_diacritics TEXT,                                                          -- 'Felixstowe' (ASCII fold)
    subdivision     TEXT,                                                             -- ISO 3166-2 subdivision ('ENG' for England)

    -- UN/LOCODE function flags (8 chars in source, e.g. '1-3-----'):
    -- 1 = port (sea/IWW), 2 = rail terminal, 3 = road terminal,
    -- 4 = airport, 5 = postal, 6 = inland clearance depot,
    -- 7 = fixed transport (pipeline), B = border crossing.
    -- Stored as discrete booleans so indexes and queries are clean.
    function_port      BOOLEAN NOT NULL DEFAULT FALSE,
    function_rail      BOOLEAN NOT NULL DEFAULT FALSE,
    function_road      BOOLEAN NOT NULL DEFAULT FALSE,
    function_airport   BOOLEAN NOT NULL DEFAULT FALSE,
    function_postal    BOOLEAN NOT NULL DEFAULT FALSE,
    function_icd       BOOLEAN NOT NULL DEFAULT FALSE,
    function_fixed     BOOLEAN NOT NULL DEFAULT FALSE,
    function_border    BOOLEAN NOT NULL DEFAULT FALSE,
    function_raw       CHAR(8),                                                       -- raw 8-char string for forensics

    -- Status code per UNECE:
    -- AA = approved by national agency, AC = approved (customs etc),
    -- AF = approved (foreign), AI = associated functional unit,
    -- AS = (Reserved) request from national authority,
    -- RL = recognised location (no UN/LOCODE assigned by member),
    -- RN = (Reserved) request from non-national authority,
    -- RQ = (Reserved) under consideration, RR = rejected,
    -- UR = entry under review, XX = entry to be deleted.
    status          CHAR(2),

    date_changed    CHAR(4),                                                          -- 'YYMM' from source

    iata_code       CHAR(3),                                                          -- when applicable

    -- Decimal degrees parsed from the source DDMM[N|S] DDDMM[E|W] format
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,

    imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_release  TEXT                                                              -- e.g. '2024-2'
);

-- Hot read paths
CREATE INDEX IF NOT EXISTS idx_geo_locations_country
    ON geo.locations (country_code, name);

CREATE INDEX IF NOT EXISTS idx_geo_locations_location_code
    ON geo.locations (location_code);

CREATE INDEX IF NOT EXISTS idx_geo_locations_name_lower
    ON geo.locations (LOWER(name));

CREATE INDEX IF NOT EXISTS idx_geo_locations_iata
    ON geo.locations (iata_code)
    WHERE iata_code IS NOT NULL;

-- "All ports in the UK" is a common query
CREATE INDEX IF NOT EXISTS idx_geo_locations_country_port
    ON geo.locations (country_code)
    WHERE function_port = TRUE;

CREATE INDEX IF NOT EXISTS idx_geo_locations_country_airport
    ON geo.locations (country_code)
    WHERE function_airport = TRUE;

COMMENT ON TABLE geo.locations IS
    'UN/LOCODE reference data. ~110k rows refreshed twice yearly from UNECE. Source of truth for port / airport / rail / road / ICD codes used by Cargowise and most freight systems.';


-- ============================================================
-- Optional pg_trgm fuzzy-search index (best-effort)
-- ============================================================
-- Lets `WHERE name ILIKE '%felix%'` and similarity() searches use an
-- index. Skipped silently if the extension isn't available in the
-- target environment.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm') THEN
        CREATE EXTENSION IF NOT EXISTS pg_trgm;
        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'geo' AND indexname = 'idx_geo_locations_name_trgm'
        ) THEN
            CREATE INDEX idx_geo_locations_name_trgm
                ON geo.locations USING GIN (name gin_trgm_ops);
        END IF;
    END IF;
END;
$$;


-- ============================================================
-- Lockdown - REVOKE PUBLIC then GRANT service_role
-- ============================================================

REVOKE ALL ON geo.countries  FROM PUBLIC;
REVOKE ALL ON geo.locations  FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON geo.countries TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON geo.locations TO service_role;
