-- 049_seed_corten_margin_rules.sql
--
-- Populate quotes.margin_rules with the 22-rule starting set for
-- Corten Logistics. Mirrors the hardcoded RULES array in
-- src/app/dev/margins/page.tsx so the dashboard shows live data instead
-- of seed-data fallback.
--
-- TENANT GATING: this migration is GATED to Corten's specific org_id
-- (the sentinel UUID 00000000-0000-0000-0000-000000000001). Future
-- tenants get an empty quotes.margin_rules table on onboarding and
-- can either seed from CSV via /dev/margins, add rules via the UI, or
-- copy this migration's pattern with their own org_id.
--
-- IDEMPOTENCY: skips entirely if quotes.margin_rules already has any
-- rows for the target org. Re-running is safe.
--
-- Manual: apply once after 048.

DO $$
DECLARE
    v_org_id UUID := '00000000-0000-0000-0000-000000000001';  -- Corten only
BEGIN
    -- Guard: only seed if the target org actually exists.
    IF NOT EXISTS (SELECT 1 FROM core.organisations WHERE id = v_org_id) THEN
        RAISE NOTICE 'Org % not found; skipping margin-rule seed.', v_org_id;
        RETURN;
    END IF;

    -- Idempotency: skip if this org already has rules.
    IF EXISTS (SELECT 1 FROM quotes.margin_rules WHERE org_id = v_org_id) THEN
        RAISE NOTICE 'Org % already has margin rules; skipping seed.', v_org_id;
        RETURN;
    END IF;

    INSERT INTO quotes.margin_rules
        (org_id, name, description, mode, direction, macro_group, charge_code,
         markup_method, markup_value, markup_currency, currency_rates,
         min_charge_amount, min_charge_currency, is_active)
    VALUES
    -- ============ Default catch-all ============
    (v_org_id, 'Default - all charges', 'Catch-all 100% markup across the board',
     NULL, NULL, NULL, NULL,
     'pct', 100, 'GBP', NULL, NULL, NULL, TRUE),

    -- ============ FCL ============
    (v_org_id, 'FCL Export - Collection', NULL,
     'sea_fcl', 'export', NULL, 'collection',
     'flat', 50, 'GBP', NULL, NULL, NULL, TRUE),

    (v_org_id, 'FCL Crosstrade - Collection', NULL,
     'sea_fcl', 'crosstrade', NULL, 'collection',
     'pct', 15, 'GBP', NULL, NULL, NULL, TRUE),

    (v_org_id, 'FCL Export - Export Customs Clearance', 'Per BL, currency-conditional',
     'sea_fcl', 'export', NULL, 'export_customs_clearance_fee',
     'currency_conditional', 0, 'GBP', '{"GBP":10,"USD":15,"EUR":15}'::jsonb, NULL, NULL, TRUE),

    (v_org_id, 'FCL Export - VGM', NULL,
     'sea_fcl', 'export', NULL, 'vgm_fee',
     'per_container', 36, 'GBP', NULL, NULL, NULL, TRUE),

    (v_org_id, 'FCL EXW', NULL,
     'sea_fcl', NULL, NULL, 'exw_charges',
     'pct', 10, 'GBP', NULL, NULL, NULL, TRUE),

    (v_org_id, 'FCL - Ocean freight', NULL,
     'sea_fcl', NULL, NULL, 'ocean_freight',
     'per_container', 100, 'USD', NULL, NULL, NULL, TRUE),

    (v_org_id, 'FCL Import - Import Customs Clearance', NULL,
     'sea_fcl', 'import', NULL, 'import_customs_clearance_fee',
     'flat', 10, 'GBP', NULL, NULL, NULL, TRUE),

    (v_org_id, 'FCL Import - DDOC', NULL,
     'sea_fcl', 'import', NULL, 'destination_documentation_fee',
     'override', 60, 'GBP', NULL, NULL, NULL, TRUE),

    (v_org_id, 'FCL Import - LO/LO', NULL,
     'sea_fcl', 'import', NULL, 'lo_lo',
     'override', 95, 'GBP', NULL, NULL, NULL, TRUE),

    (v_org_id, 'FCL - Destination charges', NULL,
     'sea_fcl', NULL, 'destination_delivery', NULL,
     'pct', 10, 'GBP', NULL, NULL, NULL, TRUE),

    (v_org_id, 'FCL Import - Delivery', NULL,
     'sea_fcl', 'import', NULL, 'delivery',
     'per_container', 50, 'GBP', NULL, NULL, NULL, TRUE),

    -- ============ LCL ============
    (v_org_id, 'LCL Export - Export Customs Clearance', NULL,
     'sea_lcl', 'export', NULL, 'export_customs_clearance_fee',
     'override', 55, 'GBP', NULL, NULL, NULL, TRUE),

    (v_org_id, 'LCL - Freight (W/M)', NULL,
     'sea_lcl', NULL, NULL, 'ocean_freight',
     'per_wm', 10, 'GBP', NULL, NULL, NULL, TRUE),

    (v_org_id, 'LCL Import - Coloader Admin Fee', '10% on top, min GBP 35',
     'sea_lcl', 'import', NULL, 'co_loader_costs',
     'pct', 10, 'GBP', NULL, 35, 'GBP', TRUE),

    -- ============ Air ============
    (v_org_id, 'Air Export - Export Customs Clearance', NULL,
     'air', 'export', NULL, 'export_customs_clearance_fee',
     'override', 25, 'GBP', NULL, NULL, NULL, TRUE),

    (v_org_id, 'Air Export - AMS', NULL,
     'air', 'export', NULL, 'ams_aci_fee',
     'override', 30, 'GBP', NULL, NULL, NULL, TRUE),

    (v_org_id, 'Air Export - Primary Screening', '0.13 GBP/kg, min GBP 35',
     'air', 'export', NULL, 'primary_screening',
     'per_chargeable_weight', 0.13, 'GBP', NULL, 35, 'GBP', TRUE),

    (v_org_id, 'Air Import - Airline handling', '0.38/kg, min 80 GBP',
     'air', 'import', NULL, 'airline_handling',
     'per_kg', 0.38, 'GBP', NULL, 80, 'GBP', TRUE),

    (v_org_id, 'Air Import - Delivery', NULL,
     'air', 'import', NULL, 'delivery',
     'flat', 60, 'GBP', NULL, NULL, NULL, TRUE),

    -- ============ Customer-specific override ============
    -- ABC Manufacturing - customer_id stays NULL until the customer record
    -- exists in core.customers. Match-by-name lookup happens in the
    -- evaluator until then.
    (v_org_id, 'ABC Manufacturing - Freight discount',
     'Strategic account; freight at 8% on top regardless of mode. customer_id will be backfilled when ABC Manufacturing Ltd is created in core.customers.',
     NULL, NULL, 'freight', NULL,
     'pct', 8, 'GBP', NULL, NULL, NULL, TRUE),

    -- ============ Disbursements ============
    (v_org_id, 'All disbursements - on cost',
     'DUTY, VAT, demurrage, detention, storage charged at cost',
     NULL, NULL, NULL, NULL,
     'on_cost', 0, 'GBP', NULL, NULL, NULL, TRUE);

    RAISE NOTICE 'Seeded 22 margin rules for Corten (org %)', v_org_id;
END $$;
