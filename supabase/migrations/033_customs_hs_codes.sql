-- 033_customs_hs_codes.sql
--
-- WCO Harmonized System (HS) commodity classification codes.
--
-- Every customs declaration, duty calculation, restricted-goods check,
-- and compliance audit uses HS codes. The WCO publishes the master HS
-- nomenclature down to 6 digits (~5500 active subheadings); national
-- authorities extend to 8-10 digits for their own tariff schedules
-- (UK uses 10 via the UK Trade Tariff). This migration covers the
-- world-standard HS6 layer; UK-specific extensions can be added later
-- without breaking what we have here.
--
-- Three-tier hierarchy mirrors the WCO classification:
--   2-digit chapter  (e.g. 84 'Machinery and mechanical appliances')
--   4-digit heading  (e.g. 8418 'Refrigerators, freezers and other...')
--   6-digit subheading (e.g. 841810 'Combined refrigerator-freezers...')
--
-- Source: github.com/datasets/harmonized-system (WCO-aligned).
-- Refreshed quarterly via scripts/import-hs-codes.ts plus the annual
-- reference-data refresh workflow.

CREATE SCHEMA IF NOT EXISTS customs;
GRANT USAGE ON SCHEMA customs TO service_role;


CREATE TABLE IF NOT EXISTS customs.hs_codes (
    code            TEXT PRIMARY KEY,                       -- '84', '8418', '841810' (no separators)
    description     TEXT NOT NULL,                          -- WCO description
    level           SMALLINT NOT NULL CHECK (level IN (2, 4, 6)),
    parent_code     TEXT REFERENCES customs.hs_codes(code) ON DELETE RESTRICT,
    section         TEXT,                                   -- WCO section (e.g. 'XVI' for machinery), nullable on early hierarchy

    imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_release  TEXT
);

-- Hot read paths
CREATE INDEX IF NOT EXISTS idx_hs_codes_level
    ON customs.hs_codes (level, code);

CREATE INDEX IF NOT EXISTS idx_hs_codes_parent
    ON customs.hs_codes (parent_code);

-- Description search. Use case-insensitive LIKE indexes (works without
-- pg_trgm). pg_trgm GIN added best-effort below.
CREATE INDEX IF NOT EXISTS idx_hs_codes_description_lower
    ON customs.hs_codes (LOWER(description) text_pattern_ops);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm') THEN
        CREATE EXTENSION IF NOT EXISTS pg_trgm;
        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'customs' AND indexname = 'idx_hs_codes_desc_trgm'
        ) THEN
            CREATE INDEX idx_hs_codes_desc_trgm
                ON customs.hs_codes USING GIN (description gin_trgm_ops);
        END IF;
    END IF;
END;
$$;

COMMENT ON TABLE customs.hs_codes IS
    'WCO Harmonized System commodity codes (chapter/heading/subheading). Refreshed quarterly. UK-specific 8-10 digit extensions live in a future customs.uk_tariff table.';

REVOKE ALL ON customs.hs_codes FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON customs.hs_codes TO service_role;
