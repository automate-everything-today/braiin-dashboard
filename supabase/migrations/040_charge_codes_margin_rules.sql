-- 040_charge_codes_margin_rules.sql
--
-- Quoting engine v2 - charge code dictionary, multi-TMS mapping,
-- margin rule engine, and the per-line schema extensions that ride
-- on top of them.
--
-- Five things in one migration:
--
-- 1. quotes.charge_codes      - canonical Braiin charge dictionary
--                               (independent of any specific TMS).
-- 2. tms.charge_code_map      - per-TMS code -> Braiin code translations.
--                               First seed is Cargowise (107 entries).
-- 3. quotes.margin_rules      - the margin rule engine.
--                               Per-org rules scoped by mode / direction /
--                               lane / customer / charge_code with auto-
--                               computed precedence (most-specific wins).
-- 4. quotes.charge_lines      - extended with billing_type, charge_code FK,
--                               min_charge floor, expanded margin types,
--                               and rule_id pointer for "why is this
--                               margin?" traceability.
-- 5. quotes.drafts.direction  - import / export / crosstrade enum.
--
-- Idempotent guards. service_role grants. After running:
--   - already-exposed schemas (quotes, tms) need no further wiring.

-- ============================================================
-- quotes.charge_codes - canonical Braiin dictionary
-- ============================================================

CREATE TABLE IF NOT EXISTS quotes.charge_codes (
    braiin_code             TEXT PRIMARY KEY,                   -- 'origin_thc', 'air_freight'
    description             TEXT NOT NULL,
    billing_type            TEXT NOT NULL DEFAULT 'margin'
                            CHECK (billing_type IN ('margin', 'revenue', 'disbursement')),
    macro_group             TEXT NOT NULL
                            CHECK (macro_group IN ('origin_exw', 'freight', 'destination_delivery', 'insurance_other')),
    default_margin_pct      NUMERIC(6,3) NOT NULL DEFAULT 0,
    applicable_modes        TEXT[] NOT NULL DEFAULT '{}',       -- 'sea_fcl', 'sea_lcl', 'air', 'road', 'rail'
    applicable_directions   TEXT[] NOT NULL DEFAULT '{}',       -- 'import', 'export', 'crosstrade'
    tms_origin              TEXT,                               -- 'cargowise', 'magaya', 'native' - where this code came from
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_charge_codes_active
    ON quotes.charge_codes (macro_group, billing_type)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_quotes_charge_codes_modes
    ON quotes.charge_codes USING GIN (applicable_modes);


-- ============================================================
-- tms.charge_code_map - per-TMS translation layer
-- ============================================================
-- Same pattern as tms.identity_map (entity refs) - a soft FK from
-- a TMS-specific code to our canonical dictionary. New TMS adapters
-- just add rows with their own provider_id.

CREATE TABLE IF NOT EXISTS tms.charge_code_map (
    map_id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id             TEXT NOT NULL REFERENCES tms.providers(provider_id) ON DELETE RESTRICT,

    tms_code                TEXT NOT NULL,                      -- 'AFRT', 'DTHC', 'BAF'
    braiin_code             TEXT NOT NULL REFERENCES quotes.charge_codes(braiin_code) ON DELETE RESTRICT,

    tms_description         TEXT,                               -- TMS's own description
    tms_metadata            JSONB NOT NULL DEFAULT '{}'::jsonb, -- e.g. CW department filter

    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (provider_id, tms_code)
);

CREATE INDEX IF NOT EXISTS idx_tms_charge_code_map_braiin
    ON tms.charge_code_map (braiin_code, provider_id)
    WHERE is_active = TRUE;


-- ============================================================
-- quotes.margin_rules - the margin engine
-- ============================================================
-- Scope-based rule resolution. A draft picks the most specific rule
-- where every non-NULL scope field matches. Precedence is computed
-- from the count of non-NULL scope fields (more specific wins).

CREATE TABLE IF NOT EXISTS quotes.margin_rules (
    rule_id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id                  UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,

    -- Operator-readable name for the rule (e.g. "Default FCL freight",
    -- "ABC Manufacturing - all lanes")
    name                    TEXT NOT NULL,
    description             TEXT,

    -- =========================================================
    -- Scope - all NULL = applies to everything (the default)
    -- =========================================================
    customer_id             UUID,                               -- specific customer
    carrier_id              UUID,                               -- specific carrier
    mode                    TEXT
                            CHECK (mode IS NULL OR mode IN (
                                'sea_fcl', 'sea_lcl', 'air', 'road', 'rail', 'courier', 'multimodal'
                            )),
    direction               TEXT
                            CHECK (direction IS NULL OR direction IN ('import', 'export', 'crosstrade')),
    origin_country          TEXT,                               -- ISO-2
    destination_country     TEXT,                               -- ISO-2
    origin_unlocode         TEXT,
    destination_unlocode    TEXT,
    macro_group             TEXT
                            CHECK (macro_group IS NULL OR macro_group IN ('origin_exw', 'freight', 'destination_delivery', 'insurance_other')),
    charge_code             TEXT REFERENCES quotes.charge_codes(braiin_code),

    -- Auto-computed: count of non-NULL scope fields. Most specific wins.
    rule_priority           INTEGER GENERATED ALWAYS AS (
        (CASE WHEN customer_id          IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN carrier_id           IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN mode                 IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN direction            IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN origin_country       IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN destination_country  IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN origin_unlocode      IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN destination_unlocode IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN macro_group          IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN charge_code          IS NOT NULL THEN 1 ELSE 0 END)
    ) STORED,

    -- =========================================================
    -- Markup model - extended type set covering Wisor + Cargowise
    -- =========================================================
    markup_method           TEXT NOT NULL CHECK (markup_method IN (
        'pct',                          -- sell = cost * (1 + value/100)
        'flat',                         -- sell = cost + value (margin_currency)
        'per_cbm',                      -- sell = cost + value * draft.volume_cbm
        'per_kg',                       -- sell = cost + value * draft.weight_kg
        'per_chargeable_weight',        -- sell = cost + value * draft.chargeable_weight_kg
        'per_wm',                       -- sell = cost + value * max(weight_t, volume_cbm) [LCL]
        'per_container',                -- sell = cost + value * draft.container_count
        'per_container_20',             -- container-size specific
        'per_container_40',
        'per_pallet',
        'per_bill',                     -- sell = cost + value (one per BL/HBL)
        'per_hs_code',                  -- sell = cost + value * (HS_count - included_count)
        'per_shipment',                 -- alias for flat per-quote
        'pct_of_line',                  -- chained: sell = parent_line.cost * value/100
        'currency_conditional',         -- value depends on cost currency (see currency_rates)
        'override',                     -- sell = override_value, ignore cost
        'on_cost'                       -- sell = cost (zero markup, used for disbursements)
    )),
    markup_value            NUMERIC(14,4) NOT NULL DEFAULT 0,
    markup_currency         TEXT NOT NULL DEFAULT 'GBP',

    -- For markup_method='currency_conditional': map of cost-currency
    -- to markup-amount. e.g. {"GBP": 10, "USD": 15, "EUR": 15}
    -- meaning add £10 if cost is GBP, $15 if USD, €15 if EUR.
    currency_rates          JSONB,

    -- For markup_method='per_hs_code': how many HS codes are included
    -- before the per-code rate kicks in. Default 1.
    included_hs_count       INTEGER DEFAULT 1,

    -- Guardrails
    min_charge_amount       NUMERIC(14,2),
    min_charge_currency     TEXT,
    max_sell_amount         NUMERIC(14,2),
    max_sell_currency       TEXT,
    min_margin_pct          NUMERIC(6,3),                       -- floor under % markup

    -- Volume gating (apply only when annual revenue / shipment count
    -- with this customer is above threshold).
    apply_above_annual_gbp  NUMERIC(14,2),

    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_staff_id     INTEGER,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_margin_rules_lookup
    ON quotes.margin_rules (org_id, rule_priority DESC, mode, direction)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_quotes_margin_rules_customer
    ON quotes.margin_rules (org_id, customer_id, rule_priority DESC)
    WHERE customer_id IS NOT NULL AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_quotes_margin_rules_charge_code
    ON quotes.margin_rules (org_id, charge_code, rule_priority DESC)
    WHERE charge_code IS NOT NULL AND is_active = TRUE;


-- ============================================================
-- quotes.charge_lines extensions
-- ============================================================

ALTER TABLE quotes.charge_lines
    ADD COLUMN IF NOT EXISTS billing_type    TEXT,
    ADD COLUMN IF NOT EXISTS charge_code     TEXT REFERENCES quotes.charge_codes(braiin_code),
    ADD COLUMN IF NOT EXISTS rule_id         UUID REFERENCES quotes.margin_rules(rule_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS min_charge_amount   NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS min_charge_currency TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_charge_lines_billing_type'
    ) THEN
        ALTER TABLE quotes.charge_lines
            ADD CONSTRAINT chk_charge_lines_billing_type
            CHECK (billing_type IS NULL OR billing_type IN ('margin', 'revenue', 'disbursement'));
    END IF;
END $$;

-- Drop the old margin_type CHECK and re-add with the wider set.
DO $$
DECLARE
    v_constraint_name TEXT;
BEGIN
    SELECT conname INTO v_constraint_name
    FROM   pg_constraint
    WHERE  conrelid = 'quotes.charge_lines'::regclass
    AND    pg_get_constraintdef(oid) LIKE '%margin_type%'
    AND    contype = 'c'
    LIMIT 1;
    IF v_constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE quotes.charge_lines DROP CONSTRAINT ' || quote_ident(v_constraint_name);
    END IF;

    ALTER TABLE quotes.charge_lines
        ADD CONSTRAINT chk_charge_lines_margin_type
        CHECK (margin_type IN (
            'pct', 'flat', 'per_cbm', 'per_kg', 'per_chargeable_weight', 'per_wm',
            'per_container', 'per_container_20', 'per_container_40',
            'per_pallet', 'per_bill', 'per_hs_code', 'per_shipment',
            'pct_of_line', 'currency_conditional', 'override', 'on_cost'
        ));
END $$;

CREATE INDEX IF NOT EXISTS idx_quotes_charge_lines_code
    ON quotes.charge_lines (charge_code)
    WHERE charge_code IS NOT NULL;


-- ============================================================
-- quotes.drafts.direction
-- ============================================================

ALTER TABLE quotes.drafts
    ADD COLUMN IF NOT EXISTS direction TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_drafts_direction'
    ) THEN
        ALTER TABLE quotes.drafts
            ADD CONSTRAINT chk_drafts_direction
            CHECK (direction IS NULL OR direction IN ('import', 'export', 'crosstrade'));
    END IF;
END $$;


-- ============================================================
-- updated_at triggers
-- ============================================================

DROP TRIGGER IF EXISTS trg_quotes_charge_codes_touch ON quotes.charge_codes;
CREATE TRIGGER trg_quotes_charge_codes_touch
    BEFORE UPDATE ON quotes.charge_codes
    FOR EACH ROW EXECUTE FUNCTION quotes.touch_updated_at();

DROP TRIGGER IF EXISTS trg_quotes_margin_rules_touch ON quotes.margin_rules;
CREATE TRIGGER trg_quotes_margin_rules_touch
    BEFORE UPDATE ON quotes.margin_rules
    FOR EACH ROW EXECUTE FUNCTION quotes.touch_updated_at();

DROP TRIGGER IF EXISTS trg_tms_charge_code_map_touch ON tms.charge_code_map;
CREATE TRIGGER trg_tms_charge_code_map_touch
    BEFORE UPDATE ON tms.charge_code_map
    FOR EACH ROW EXECUTE FUNCTION tms.touch_updated_at();


-- ============================================================
-- Lockdown
-- ============================================================

REVOKE ALL ON quotes.charge_codes  FROM PUBLIC;
REVOKE ALL ON quotes.margin_rules  FROM PUBLIC;
REVOKE ALL ON tms.charge_code_map  FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON quotes.charge_codes  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON quotes.margin_rules  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON tms.charge_code_map  TO service_role;


-- ============================================================
-- Seed: Braiin canonical charge codes from CW dictionary
-- (107 codes - billing_type / macro_group / mode applicability
--  curated; default markup 100 except where CW marks differently;
--  tms_origin='cargowise' so we know provenance.)
-- ============================================================
-- ============================================================
-- quotes.charge_codes - 107 canonical entries from CW dictionary
-- ============================================================
INSERT INTO quotes.charge_codes
    (braiin_code, description, billing_type, macro_group, default_margin_pct,
     applicable_modes, applicable_directions, tms_origin, is_active)
VALUES
    ('administration_fee', 'ADMINISTRATION FEE', 'margin', 'insurance_other', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('agency_fee', 'AGENCY FEE', 'revenue', 'insurance_other', 0.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('air_freight', 'Air Freight', 'margin', 'freight', 100.0, ARRAY['air']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('airline_collection', 'Airline Collection', 'margin', 'origin_exw', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('airline_delivery', 'Airline Delivery', 'margin', 'destination_delivery', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('airline_handling', 'Airline Handling', 'margin', 'freight', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('amendment_fee', 'Amendment fee', 'margin', 'insurance_other', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('ams_aci_fee', 'AMS/ACI FEE', 'margin', 'origin_exw', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('bank_service_charge', 'Bank service charge', 'revenue', 'insurance_other', 0.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('booking_fee', 'Booking Fee', 'margin', 'insurance_other', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('bunker_adjustment_factor', 'Bunker Adjustment Factor', 'margin', 'freight', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('cancellation_fee_wasted_journey', 'Cancellation Fee / Wasted Journey', 'margin', 'insurance_other', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('cleaning_fee', 'Cleaning Fee', 'margin', 'insurance_other', 100.0, ARRAY['sea_fcl']::TEXT[], ARRAY['import']::TEXT[], 'cargowise', TRUE),
    ('collection', 'Collection', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('co_loader_costs', 'Co-Loader Costs', 'margin', 'freight', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('container_devan', 'Container Devan', 'margin', 'destination_delivery', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('container_inspection_fee', 'Container Inspection Fee', 'margin', 'origin_exw', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('container_protect_essential', 'Container Protect Essential', 'margin', 'insurance_other', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('container_shunt', 'Container Shunt', 'margin', 'destination_delivery', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('continuous_bond_fee', 'Continuous Bond Fee', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('currency_adjustment_factor', 'Currency Adjustment Factor', 'margin', 'freight', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('currency_exposure_fee', 'Currency Exposure Fee', 'revenue', 'insurance_other', 0.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('customs_port_costs_origin', 'Customs Port Costs - Origin', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('delivery', 'Delivery', 'margin', 'destination_delivery', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('delivery_order_fee', 'Delivery Order Fee', 'margin', 'destination_delivery', 0.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('demurrage', 'Demurrage', 'disbursement', 'destination_delivery', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('destination_other_charges', 'Destination - Other Charges', 'margin', 'destination_delivery', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('destination_airline_handling', 'Destination Airline Handling', 'margin', 'destination_delivery', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('destination_coordination_services', 'Destination Coordination Services', 'margin', 'destination_delivery', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('destination_documentation_fee', 'Destination Documentation Fee', 'margin', 'destination_delivery', 0.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('destination_miscellaneous_charges', 'Destination Miscellaneous Charges', 'margin', 'destination_delivery', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('destination_storage_warehousing', 'Destination Storage / Warehousing', 'disbursement', 'destination_delivery', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('destination_terminal_handling_charges', 'Destination Terminal Handling Charges', 'margin', 'destination_delivery', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('detention', 'Detention', 'disbursement', 'destination_delivery', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('dg_documentation_fee', 'DG Documentation Fee', 'margin', 'freight', 0.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('disbursement_processing_fee_min_gbp_25_or_3_of_duty_vat_payable', 'Disbursement Processing Fee - (Min GBP 25 or 3% of Duty & VAT payable)', 'margin', 'insurance_other', 0.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('discount', 'Discount', 'margin', 'insurance_other', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('domestic_courier', 'Domestic Courier', 'margin', 'destination_delivery', 100.0, ARRAY['air','road','sea_fcl','warehouse']::TEXT[], ARRAY['domestic','export','import']::TEXT[], 'cargowise', TRUE),
    ('driver_retention_surcharge', 'Driver Retention Surcharge', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('drop_fee', 'Drop Fee', 'margin', 'destination_delivery', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('duties_and_fees', 'DUTIES AND FEES', 'disbursement', 'destination_delivery', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('duty_customs', 'Duty (Customs)', 'disbursement', 'destination_delivery', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('e_manifest', 'E-Manifest', 'margin', 'origin_exw', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('emcs_entry', 'EMCS Entry', 'margin', 'origin_exw', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('emergency_contingency_surcharge', 'Emergency Contingency Surcharge', 'margin', 'freight', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('emergency_fuel_adjustment_factor', 'Emergency Fuel Adjustment Factor', 'margin', 'freight', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('emergency_risk_surcharge', 'Emergency Risk Surcharge', 'margin', 'freight', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('emission_control_areas', 'Emission Control Areas', 'margin', 'freight', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('emission_surcharge', 'Emission Surcharge', 'margin', 'freight', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('ens_fee', 'ENS FEE', 'margin', 'origin_exw', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('entry_prep', 'Entry Prep', 'margin', 'origin_exw', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('equipment_positioning_service_export_cy', 'Equipment Positioning Service Export (CY)', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('export_customs_clearance_fee', 'Export Customs Clearance Fee', 'margin', 'origin_exw', 0.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('exw_charges', 'EXW Charges', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('fossil_fuel_fee', 'Fossil Fuel Fee', 'margin', 'freight', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('free_in_service', 'Free In Service', 'margin', 'freight', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('fuel_surcharge', 'Fuel Surcharge', 'margin', 'freight', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('handling_fee', 'Handling Fee', 'margin', 'freight', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('hazardous_fee', 'Hazardous Fee', 'margin', 'freight', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('imo_surcharge', 'IMO Surcharge', 'margin', 'freight', 100.0, ARRAY['sea_fcl']::TEXT[], ARRAY['domestic','export','import']::TEXT[], 'cargowise', TRUE),
    ('import_customs_clearance_fee', 'Import Customs Clearance Fee', 'margin', 'destination_delivery', 0.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('importer_of_record', 'Importer of Record', 'margin', 'destination_delivery', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('international_courier', 'International Courier', 'margin', 'freight', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('isf_filing', 'ISF Filing', 'margin', 'origin_exw', 0.0, ARRAY['sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('isps', 'ISPS', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('labelling_fee', 'Labelling Fee', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('lo_lo', 'LO/LO', 'margin', 'freight', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('low_sulpher_surcharge_lss', 'Low Sulpher Surcharge (LSS)', 'margin', 'freight', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('marine_insurance', 'Marine Insurance', 'margin', 'insurance_other', 100.0, ARRAY['air','road','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('marine_insurance_admin_fee', 'Marine Insurance Admin Fee', 'margin', 'insurance_other', 100.0, ARRAY['air','road','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('ocean_freight', 'Ocean Freight', 'margin', 'freight', 100.0, ARRAY['sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('origin_other_charges', 'Origin - Other Charges', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('origin_documentation_fee', 'Origin Documentation Fee', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('origin_storage_warehousing', 'Origin Storage / Warehousing', 'disbursement', 'origin_exw', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('origin_terminal_handling', 'Origin Terminal Handling', 'margin', 'origin_exw', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('packaging', 'Packaging', 'margin', 'origin_exw', 100.0, ARRAY['warehouse']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('pallet_in_fee', 'Pallet in fee', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('pallet_out_fee', 'Pallet out fee', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('palletising_fee', 'Palletising Fee', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('peak_season_surcharge', 'Peak Season Surcharge', 'margin', 'freight', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('pga_fee', 'PGA Fee', 'margin', 'origin_exw', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('pier_pass_fee', 'Pier Pass Fee', 'margin', 'freight', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('port_additionals_port_dues_import', 'Port Additionals / Port Dues Import', 'margin', 'freight', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('port_congestion', 'Port Congestion', 'margin', 'freight', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('pre_pull', 'Pre-Pull', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('primary_screening', 'Primary Screening', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('profit_share_rebate', 'Profit Share / Rebate', 'margin', 'insurance_other', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('quay_rent_container_storage', 'Quay Rent / Container Storage', 'disbursement', 'destination_delivery', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('rail_freight', 'Rail Freight', 'margin', 'freight', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('road_freight', 'Road Freight', 'margin', 'freight', 100.0, ARRAY['road']::TEXT[], ARRAY['domestic','export','import']::TEXT[], 'cargowise', TRUE),
    ('secondary_screening', 'Secondary Screening', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('single_bond_fee', 'Single Bond Fee', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('special_equipment_fee', 'Special Equipment fee', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('stop_off_fee', 'Stop Off Fee', 'margin', 'destination_delivery', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('storage', 'Storage', 'disbursement', 'destination_delivery', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('tail_lift_delivery', 'Tail-lift Delivery', 'margin', 'destination_delivery', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('transit_disruption_surcharge', 'Transit Disruption Surcharge', 'margin', 'freight', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('value_protect_starter', 'Value Protect Starter', 'margin', 'insurance_other', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('vat_customs', 'VAT (Customs)', 'disbursement', 'destination_delivery', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('vgm_fee', 'VGM Fee', 'margin', 'origin_exw', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('waiting_time', 'Waiting Time', 'margin', 'destination_delivery', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('war_risk_surcharge', 'War Risk Surcharge', 'margin', 'freight', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('warehouse_handling_in', 'Warehouse Handling In', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('warehouse_handling_out', 'Warehouse Handling Out', 'margin', 'destination_delivery', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('warehouse_re_work', 'Warehouse Re-work', 'margin', 'origin_exw', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE),
    ('x_ray_fee', 'X-RAY fee', 'margin', 'origin_exw', 100.0, ARRAY['air','sea_fcl']::TEXT[], ARRAY['export','import']::TEXT[], 'cargowise', TRUE),
    ('yard_storage', 'Yard Storage', 'disbursement', 'destination_delivery', 100.0, ARRAY['sea_fcl','sea_lcl','air','road','rail']::TEXT[], ARRAY['import','export','crosstrade']::TEXT[], 'cargowise', TRUE)
ON CONFLICT (braiin_code) DO NOTHING;

-- ============================================================
-- tms.charge_code_map - CW code -> Braiin code translations
-- ============================================================
INSERT INTO tms.charge_code_map
    (provider_id, tms_code, braiin_code, tms_description, tms_metadata, is_active)
VALUES
    ('cargowise', 'ADMIN', 'administration_fee', 'ADMINISTRATION FEE', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'AGEFEE', 'agency_fee', 'AGENCY FEE', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'AFRT', 'air_freight', 'Air Freight', '{"departments": ["FEA", "FIA", "CEA", "CIA"]}'::JSONB, TRUE),
    ('cargowise', 'ACOL', 'airline_collection', 'Airline Collection', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'ADEL', 'airline_delivery', 'Airline Delivery', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'AHAN', 'airline_handling', 'Airline Handling', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'AMEND', 'amendment_fee', 'Amendment fee', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'AMS', 'ams_aci_fee', 'AMS/ACI FEE', '{"departments": ["FES", "FIS", "CES", "CIS", "FIA", "FEA"]}'::JSONB, TRUE),
    ('cargowise', 'BANK', 'bank_service_charge', 'Bank service charge', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'BOOK', 'booking_fee', 'Booking Fee', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'BAF', 'bunker_adjustment_factor', 'Bunker Adjustment Factor', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'CFEE', 'cancellation_fee_wasted_journey', 'Cancellation Fee / Wasted Journey', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'CLEAN', 'cleaning_fee', 'Cleaning Fee', '{"departments": ["FIS", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'COLL', 'collection', 'Collection', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'COLOAD', 'co_loader_costs', 'Co-Loader Costs', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'DEVAN', 'container_devan', 'Container Devan', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'INSPEC', 'container_inspection_fee', 'Container Inspection Fee', '{"departments": ["FEA", "FIA", "FIS", "FES"]}'::JSONB, TRUE),
    ('cargowise', 'CP1', 'container_protect_essential', 'Container Protect Essential', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'SHUNT', 'container_shunt', 'Container Shunt', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'CONBON', 'continuous_bond_fee', 'Continuous Bond Fee', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'CAF', 'currency_adjustment_factor', 'Currency Adjustment Factor', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'CURR', 'currency_exposure_fee', 'Currency Exposure Fee', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'CPCO', 'customs_port_costs_origin', 'Customs Port Costs - Origin', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'DEL', 'delivery', 'Delivery', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'DOF', 'delivery_order_fee', 'Delivery Order Fee', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'CDEM', 'demurrage', 'Demurrage', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'DNOTE', 'destination_other_charges', 'Destination - Other Charges', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'DAHAN', 'destination_airline_handling', 'Destination Airline Handling', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'DCS', 'destination_coordination_services', 'Destination Coordination Services', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'DDOC', 'destination_documentation_fee', 'Destination Documentation Fee', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'DSTM', 'destination_miscellaneous_charges', 'Destination Miscellaneous Charges', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'DSTOR', 'destination_storage_warehousing', 'Destination Storage / Warehousing', '{"departments": ["FEA", "FIA", "FES", "FIS"]}'::JSONB, TRUE),
    ('cargowise', 'DTHC', 'destination_terminal_handling_charges', 'Destination Terminal Handling Charges', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'DETN', 'detention', 'Detention', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'DGDOC', 'dg_documentation_fee', 'DG Documentation Fee', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'DEFER', 'disbursement_processing_fee_min_gbp_25_or_3_of_duty_vat_payable', 'Disbursement Processing Fee - (Min GBP 25 or 3% of Duty & VAT payable)', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'DISC', 'discount', 'Discount', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'DCOU', 'domestic_courier', 'Domestic Courier', '{"departments": ["FDA", "FEA", "FIA", "FIS", "FES", "FDR", "WFS"]}'::JSONB, TRUE),
    ('cargowise', 'DRS', 'driver_retention_surcharge', 'Driver Retention Surcharge', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'DROP', 'drop_fee', 'Drop Fee', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'DUT/FEE', 'duties_and_fees', 'DUTIES AND FEES', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'DUTY', 'duty_customs', 'Duty (Customs)', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'EMAN', 'e_manifest', 'E-Manifest', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'EMCS', 'emcs_entry', 'EMCS Entry', '{"departments": ["FES", "FIS", "CES", "CIS", "FIA", "FEA"]}'::JSONB, TRUE),
    ('cargowise', 'ECS', 'emergency_contingency_surcharge', 'Emergency Contingency Surcharge', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'EFAF', 'emergency_fuel_adjustment_factor', 'Emergency Fuel Adjustment Factor', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'ERS', 'emergency_risk_surcharge', 'Emergency Risk Surcharge', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'ECA', 'emission_control_areas', 'Emission Control Areas', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'EMS', 'emission_surcharge', 'Emission Surcharge', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'ENS', 'ens_fee', 'ENS FEE', '{"departments": ["FES", "FIS", "CES", "CIS", "FIA", "FEA"]}'::JSONB, TRUE),
    ('cargowise', 'ENTP', 'entry_prep', 'Entry Prep', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'EPSE', 'equipment_positioning_service_export_cy', 'Equipment Positioning Service Export (CY)', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'ECCLR', 'export_customs_clearance_fee', 'Export Customs Clearance Fee', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'EXWCH', 'exw_charges', 'EXW Charges', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'FFF', 'fossil_fuel_fee', 'Fossil Fuel Fee', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'FRI', 'free_in_service', 'Free In Service', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'FSC', 'fuel_surcharge', 'Fuel Surcharge', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'HAND', 'handling_fee', 'Handling Fee', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'AHAZ', 'hazardous_fee', 'Hazardous Fee', '{"departments": ["FEA", "FIA", "FES", "FIS"]}'::JSONB, TRUE),
    ('cargowise', 'IMOSUR', 'imo_surcharge', 'IMO Surcharge', '{"departments": ["FIS", "FES", "FDS"]}'::JSONB, TRUE),
    ('cargowise', 'ICCLR', 'import_customs_clearance_fee', 'Import Customs Clearance Fee', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'IMPR', 'importer_of_record', 'Importer of Record', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'COU', 'international_courier', 'International Courier', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'ISF', 'isf_filing', 'ISF Filing', '{"departments": ["FES", "FIS", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'ISPS', 'isps', 'ISPS', '{"departments": ["FES", "FIS", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'LABEL', 'labelling_fee', 'Labelling Fee', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'LOLO', 'lo_lo', 'LO/LO', '{"departments": ["FEA", "FIA", "FES", "FIS"]}'::JSONB, TRUE),
    ('cargowise', 'LSS', 'low_sulpher_surcharge_lss', 'Low Sulpher Surcharge (LSS)', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'INSUR', 'marine_insurance', 'Marine Insurance', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS", "FER"]}'::JSONB, TRUE),
    ('cargowise', 'INSURAD', 'marine_insurance_admin_fee', 'Marine Insurance Admin Fee', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS", "FER"]}'::JSONB, TRUE),
    ('cargowise', 'OFRT', 'ocean_freight', 'Ocean Freight', '{"departments": ["FES", "FIS", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'ONOTE', 'origin_other_charges', 'Origin - Other Charges', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'ODOC', 'origin_documentation_fee', 'Origin Documentation Fee', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'OSTOR', 'origin_storage_warehousing', 'Origin Storage / Warehousing', '{"departments": ["FEA", "FIA", "FES", "FIS"]}'::JSONB, TRUE),
    ('cargowise', 'OTHC', 'origin_terminal_handling', 'Origin Terminal Handling', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'PACKAGE', 'packaging', 'Packaging', '{"departments": ["WFS"]}'::JSONB, TRUE),
    ('cargowise', 'PLTIN', 'pallet_in_fee', 'Pallet in fee', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'PLTOT', 'pallet_out_fee', 'Pallet out fee', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'PALLET', 'palletising_fee', 'Palletising Fee', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'PSS', 'peak_season_surcharge', 'Peak Season Surcharge', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'PGAF', 'pga_fee', 'PGA Fee', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'PIER', 'pier_pass_fee', 'Pier Pass Fee', '{"departments": ["FES", "FIS", "CES", "CIS", "FIA", "FEA"]}'::JSONB, TRUE),
    ('cargowise', 'PAI', 'port_additionals_port_dues_import', 'Port Additionals / Port Dues Import', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'CONGEST', 'port_congestion', 'Port Congestion', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'PREPUL', 'pre_pull', 'Pre-Pull', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'PSCR', 'primary_screening', 'Primary Screening', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'PS', 'profit_share_rebate', 'Profit Share / Rebate', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'QRENT', 'quay_rent_container_storage', 'Quay Rent / Container Storage', '{"departments": ["FEA", "FIA", "FES", "FIS"]}'::JSONB, TRUE),
    ('cargowise', 'RAIL', 'rail_freight', 'Rail Freight', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'RFRT', 'road_freight', 'Road Freight', '{"departments": ["FIR", "FER", "FDR"]}'::JSONB, TRUE),
    ('cargowise', 'SSCR', 'secondary_screening', 'Secondary Screening', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'SINBON', 'single_bond_fee', 'Single Bond Fee', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'OSPEC', 'special_equipment_fee', 'Special Equipment fee', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'STOFF', 'stop_off_fee', 'Stop Off Fee', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'WSTG', 'storage', 'Storage', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'TAIL', 'tail_lift_delivery', 'Tail-lift Delivery', '{"departments": ["FEA", "FIA", "FES", "FIS", "CEA", "CIA", "CES", "CIS"]}'::JSONB, TRUE),
    ('cargowise', 'TDS', 'transit_disruption_surcharge', 'Transit Disruption Surcharge', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'VPS', 'value_protect_starter', 'Value Protect Starter', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'VAT', 'vat_customs', 'VAT (Customs)', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'VGM', 'vgm_fee', 'VGM Fee', '{"departments": ["FEA", "FIA", "FES", "FIS"]}'::JSONB, TRUE),
    ('cargowise', 'WAIT', 'waiting_time', 'Waiting Time', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'WAR', 'war_risk_surcharge', 'War Risk Surcharge', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'WHIN', 'warehouse_handling_in', 'Warehouse Handling In', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'WHOUT', 'warehouse_handling_out', 'Warehouse Handling Out', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'WRWRK', 'warehouse_re_work', 'Warehouse Re-work', '{"departments": ["ALL"]}'::JSONB, TRUE),
    ('cargowise', 'XRAY', 'x_ray_fee', 'X-RAY fee', '{"departments": ["FEA", "FIA", "FIS", "FES"]}'::JSONB, TRUE),
    ('cargowise', 'YSTG', 'yard_storage', 'Yard Storage', '{"departments": ["ALL"]}'::JSONB, TRUE)
ON CONFLICT (provider_id, tms_code) DO NOTHING;
