-- 039_fx_rates_quote_output.sql
--
-- Quoting engine v2 - FX rates + quote output currency + validity +
-- per-line margin types.
--
-- Three layered additions:
--
-- 1. geo.fx_rates  -- daily FX rates pulled from a primary source
--                     (XE.com when we have a paid feed; fallback to
--                     exchangerate.host / open.er-api.com / fixer.io
--                     until then). Stored as (base, quote, rate, day).
--                     `geo.convert_amount(amount, from, to, on_day)`
--                     does the lookup with a fallback chain.
--
-- 2. quotes.drafts gains:
--      quote_output_currency TEXT   -- 'GBP' / 'USD' / 'EUR' / 'AUD' (default org home)
--      quote_validity_days   INTEGER  -- 7 / 14 / 21 / 30 / NULL when explicit date
--      quote_valid_until     DATE     -- explicit override or computed from validity_days
--
-- 3. quotes.charge_lines (the per-spot-response charge breakdown).
--    Per-line margin model supporting % / flat / per-unit:
--      margin_type   TEXT CHECK IN ('pct', 'flat', 'per_cbm', 'per_kg',
--                                    'per_container', 'per_pallet')
--      margin_value  NUMERIC      -- meaning depends on type
--      visible_to_customer        BOOLEAN
--      consolidated_into_group    TEXT NULL
--
-- Idempotent guards. service_role grants. Add `geo` to Exposed schemas
-- if not already present (migration 031 / 032 added it).

-- ============================================================
-- geo.fx_rates - daily FX rates
-- ============================================================
-- One row per (base_currency, quote_currency, rate_date). The job
-- inserts ON CONFLICT DO UPDATE so re-running the daily fetch is safe.
-- We keep history for audit ("what rate did we use on 2026-04-28?")
-- and for back-dated quote regeneration.

CREATE TABLE IF NOT EXISTS geo.fx_rates (
    rate_id         BIGSERIAL PRIMARY KEY,
    base_currency   TEXT NOT NULL,                          -- ISO 4217 - 'USD'
    quote_currency  TEXT NOT NULL,                          -- ISO 4217 - 'GBP'
    rate            NUMERIC(18,8) NOT NULL CHECK (rate > 0),

    -- The date the rate is for (mid-market close on this date).
    rate_date       DATE NOT NULL,

    -- Where the rate came from. Multiple sources allowed in a single
    -- day - we prefer the highest-priority source that has data.
    source          TEXT NOT NULL,                          -- 'xe' / 'exchangerate.host' / 'open.er-api.com' / 'manual'
    source_priority INTEGER NOT NULL DEFAULT 100,           -- lower wins

    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (base_currency, quote_currency, rate_date, source)
);

CREATE INDEX IF NOT EXISTS idx_geo_fx_rates_lookup
    ON geo.fx_rates (base_currency, quote_currency, rate_date DESC);

-- "Latest rate per pair" - what most callers want.
CREATE INDEX IF NOT EXISTS idx_geo_fx_rates_latest
    ON geo.fx_rates (base_currency, quote_currency, rate_date DESC, source_priority);


-- ============================================================
-- geo.convert_amount() - the lookup function
-- ============================================================
-- Returns NULL when no rate is on file for the requested day or any
-- earlier day within 7 days (sliding window protects against a missed
-- daily fetch). Caller handles NULL by surfacing "FX unavailable" to
-- the operator instead of silently using a stale rate.

CREATE OR REPLACE FUNCTION geo.convert_amount(
    p_amount        NUMERIC,
    p_from_currency TEXT,
    p_to_currency   TEXT,
    p_on_day        DATE DEFAULT CURRENT_DATE
)
RETURNS NUMERIC AS $$
DECLARE
    v_rate NUMERIC;
BEGIN
    IF p_from_currency = p_to_currency THEN
        RETURN p_amount;
    END IF;

    -- Direct rate lookup, sliding 7-day window, best source wins.
    SELECT rate INTO v_rate
    FROM   geo.fx_rates
    WHERE  base_currency  = p_from_currency
      AND  quote_currency = p_to_currency
      AND  rate_date BETWEEN (p_on_day - INTERVAL '7 days') AND p_on_day
    ORDER BY rate_date DESC, source_priority ASC
    LIMIT 1;

    IF v_rate IS NOT NULL THEN
        RETURN ROUND(p_amount * v_rate, 4);
    END IF;

    -- Inverse rate lookup (e.g. asked for USD->GBP, only have GBP->USD).
    SELECT (1.0 / rate) INTO v_rate
    FROM   geo.fx_rates
    WHERE  base_currency  = p_to_currency
      AND  quote_currency = p_from_currency
      AND  rate_date BETWEEN (p_on_day - INTERVAL '7 days') AND p_on_day
    ORDER BY rate_date DESC, source_priority ASC
    LIMIT 1;

    IF v_rate IS NOT NULL THEN
        RETURN ROUND(p_amount * v_rate, 4);
    END IF;

    -- Triangulation via USD: A->USD then USD->B.
    DECLARE
        v_usd_from NUMERIC;
        v_usd_to   NUMERIC;
    BEGIN
        SELECT rate INTO v_usd_from
        FROM   geo.fx_rates
        WHERE  base_currency = p_from_currency AND quote_currency = 'USD'
          AND  rate_date BETWEEN (p_on_day - INTERVAL '7 days') AND p_on_day
        ORDER BY rate_date DESC, source_priority ASC LIMIT 1;

        SELECT rate INTO v_usd_to
        FROM   geo.fx_rates
        WHERE  base_currency = 'USD' AND quote_currency = p_to_currency
          AND  rate_date BETWEEN (p_on_day - INTERVAL '7 days') AND p_on_day
        ORDER BY rate_date DESC, source_priority ASC LIMIT 1;

        IF v_usd_from IS NOT NULL AND v_usd_to IS NOT NULL THEN
            RETURN ROUND(p_amount * v_usd_from * v_usd_to, 4);
        END IF;
    END;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;


-- ============================================================
-- quotes.drafts - output currency + validity
-- ============================================================

ALTER TABLE quotes.drafts
    ADD COLUMN IF NOT EXISTS quote_output_currency  TEXT,
    ADD COLUMN IF NOT EXISTS quote_validity_days    INTEGER,
    ADD COLUMN IF NOT EXISTS quote_valid_until      DATE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_quote_validity_days'
    ) THEN
        ALTER TABLE quotes.drafts
            ADD CONSTRAINT chk_quote_validity_days
            CHECK (quote_validity_days IS NULL OR quote_validity_days IN (7, 14, 21, 30));
    END IF;
END $$;

-- Application-side rule: when validity_days is set, valid_until is
-- computed from sent_at + days. When valid_until is set explicitly,
-- validity_days is set to NULL. Trigger keeps them coherent so a UI
-- mistake never produces a draft that can't be displayed.

CREATE OR REPLACE FUNCTION quotes.touch_quote_validity()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.quote_valid_until IS NOT NULL AND NEW.quote_validity_days IS NOT NULL THEN
        IF OLD.quote_valid_until IS DISTINCT FROM NEW.quote_valid_until THEN
            NEW.quote_validity_days := NULL;
        ELSIF OLD.quote_validity_days IS DISTINCT FROM NEW.quote_validity_days THEN
            NEW.quote_valid_until := NULL;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quotes_drafts_validity ON quotes.drafts;
CREATE TRIGGER trg_quotes_drafts_validity
    BEFORE UPDATE ON quotes.drafts
    FOR EACH ROW EXECUTE FUNCTION quotes.touch_quote_validity();


-- ============================================================
-- quotes.charge_lines - the per-spot-response charge breakdown
-- ============================================================
-- One row per individual charge in a carrier's quote response.
-- Operator can override margin per line, hide from customer,
-- and consolidate multiple lines into a single rolled-up line
-- on the customer view (e.g. THC+DOC+Examination = "Origin charges").

CREATE TABLE IF NOT EXISTS quotes.charge_lines (
    line_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    draft_id            UUID NOT NULL REFERENCES quotes.drafts(draft_id) ON DELETE CASCADE,

    -- Which spot response this line belongs to. spot_responses is built
    -- in Phase D - we keep a forward-compatible UUID column so we can
    -- cross-reference once that table lands.
    spot_response_id    UUID,
    carrier_id          UUID,                               -- denormalised from spot_response for fast filter

    -- Charge identity
    category            TEXT NOT NULL CHECK (category IN (
                            'origin', 'pickup', 'freight', 'surcharges',
                            'destination', 'delivery', 'customs', 'insurance', 'other'
                        )),
    code                TEXT,                               -- 'THC', 'BAF', 'OCN', ...
    description         TEXT NOT NULL,

    -- Cost side - what the carrier charges us, in whatever currency
    -- they quoted. A single quote can mix USD ocean freight + GBP
    -- local charges + EUR origin agent charges.
    cost_amount         NUMERIC(14,2) NOT NULL,
    cost_currency       TEXT NOT NULL,

    -- Sell-side margin model. See the rule-engine plan in the v2 memory
    -- for the matching `quotes.margin_rules.markup_method` enum:
    --   pct           - sell = cost * (1 + value/100)
    --   flat          - sell = cost + value (in cost_currency)
    --   per_cbm       - sell = cost + (value * draft.volume_cbm)
    --   per_kg        - sell = cost + (value * draft.weight_kg)
    --   per_container - sell = cost + (value * draft.container_count)
    --   per_pallet    - sell = cost + (value * draft.pallet_count)
    margin_type         TEXT NOT NULL DEFAULT 'pct'
                        CHECK (margin_type IN (
                            'pct', 'flat', 'per_cbm', 'per_kg', 'per_container', 'per_pallet', 'override'
                        )),
    margin_value        NUMERIC(14,4) NOT NULL DEFAULT 0,
    -- For margin_type='override' this holds the operator's flat sell
    -- amount in margin_currency, ignoring cost entirely. Used when
    -- the operator types a sell that does not derive cleanly from
    -- a pct / flat / per_unit calculation.
    sell_amount_override NUMERIC(14,2),

    -- The currency the flat / per-unit margin is denominated in. Pct
    -- ignores this. Useful when carrier quoted in USD but we want to
    -- add £20 GBP - we add £20 in GBP, FX-convert to USD before
    -- summing. Defaults to the draft's quote_output_currency.
    margin_currency     TEXT,

    -- Customer-facing presentation
    visible_to_customer        BOOLEAN NOT NULL DEFAULT TRUE,
    consolidated_into_group    TEXT,                        -- NULL = standalone, otherwise group label

    -- Indicative charges ride the quote document as a caveat - shown
    -- to the customer for awareness ("demurrage at $200/day after the
    -- 7-day free time") but do NOT contribute to per-currency totals
    -- or the all-in figure. The accompanying caveat_note is the
    -- customer-facing explanation that prints alongside the line.
    is_indicative              BOOLEAN NOT NULL DEFAULT FALSE,
    caveat_note                TEXT,

    -- Operator notes (optional, internal only)
    notes               TEXT,

    -- Display ordering within the category for the customer view
    sort_order          INTEGER NOT NULL DEFAULT 0,

    -- Provenance + override audit
    source              TEXT NOT NULL DEFAULT 'extracted'
                        CHECK (source IN ('extracted', 'operator_added', 'rule_applied')),
    extracted_from_text TEXT,                               -- snippet from carrier email / API for audit

    -- 90% of cost lines come from the carrier extractor. When the
    -- operator overrides cost (typo correction, manual rate, etc) we
    -- preserve the original AND flag the override.
    cost_amount_extracted   NUMERIC(14,2),                  -- original from extractor, NEVER overwritten
    cost_overridden_by_operator BOOLEAN NOT NULL DEFAULT FALSE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_charge_lines_draft
    ON quotes.charge_lines (draft_id, category, sort_order);

CREATE INDEX IF NOT EXISTS idx_quotes_charge_lines_spot
    ON quotes.charge_lines (spot_response_id)
    WHERE spot_response_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_charge_lines_carrier
    ON quotes.charge_lines (org_id, carrier_id)
    WHERE carrier_id IS NOT NULL;

-- "Indicative caveats per draft" - customer-facing footnote query
CREATE INDEX IF NOT EXISTS idx_quotes_charge_lines_indicative
    ON quotes.charge_lines (draft_id, category)
    WHERE is_indicative = TRUE;


-- ============================================================
-- quotes.drafts - quantity columns referenced by per-unit margins
-- ============================================================
-- volume_cbm + weight_kg already exist (migration 037). Add the
-- container + pallet counts. Operator-editable; AI populates from
-- classify-email when present.

ALTER TABLE quotes.drafts
    ADD COLUMN IF NOT EXISTS container_count INTEGER,
    ADD COLUMN IF NOT EXISTS pallet_count    INTEGER;


-- ============================================================
-- updated_at + lockdown
-- ============================================================

DROP TRIGGER IF EXISTS trg_quotes_charge_lines_touch ON quotes.charge_lines;
CREATE TRIGGER trg_quotes_charge_lines_touch
    BEFORE UPDATE ON quotes.charge_lines
    FOR EACH ROW EXECUTE FUNCTION quotes.touch_updated_at();

REVOKE ALL ON geo.fx_rates              FROM PUBLIC;
REVOKE ALL ON quotes.charge_lines       FROM PUBLIC;
REVOKE USAGE, SELECT ON SEQUENCE geo.fx_rates_rate_id_seq FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON geo.fx_rates              TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON quotes.charge_lines       TO service_role;
GRANT USAGE, SELECT ON SEQUENCE geo.fx_rates_rate_id_seq          TO service_role;

GRANT EXECUTE ON FUNCTION geo.convert_amount(NUMERIC, TEXT, TEXT, DATE) TO service_role;
