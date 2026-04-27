-- 032_geo_currencies.sql
--
-- ISO 4217 currency reference data.
--
-- Used by rate cards, invoicing, multi-currency quoting, and FX
-- normalisation when reading carrier rate sheets in non-GBP currencies.
-- Refreshed annually by scripts/import-currencies.ts; ISO 4217 changes
-- rarely (a handful of additions/withdrawals per year).
--
-- Source: github.com/datasets/currency-codes (ISO 4217-aligned).
-- ~180 active codes plus historical / withdrawn codes (XEU etc).

CREATE TABLE IF NOT EXISTS geo.currencies (
    code            CHAR(3) PRIMARY KEY,                -- 'GBP', 'USD', 'EUR'
    name            TEXT NOT NULL,                      -- 'Pound Sterling'
    numeric_code    CHAR(3),                            -- ISO 4217 numeric '826'
    minor_unit      INTEGER,                            -- decimal places (2 for GBP, 0 for JPY, 3 for KWD)
    active          BOOLEAN NOT NULL DEFAULT TRUE,      -- FALSE for historical / withdrawn currencies
    withdrawal_date TEXT,                               -- ISO 4217 withdrawal date when active=FALSE
    countries       TEXT[] NOT NULL DEFAULT '{}',       -- ISO 3166 alpha-2 codes that use this currency

    imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_release  TEXT
);

CREATE INDEX IF NOT EXISTS idx_geo_currencies_active
    ON geo.currencies (active)
    WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_geo_currencies_countries
    ON geo.currencies USING GIN (countries);

COMMENT ON TABLE geo.currencies IS
    'ISO 4217 currency reference. Used by rate cards, invoicing, FX normalisation. Refreshed annually from the github.com/datasets/currency-codes mirror.';

REVOKE ALL ON geo.currencies FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON geo.currencies TO service_role;
