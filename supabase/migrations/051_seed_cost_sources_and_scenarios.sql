-- 051_seed_cost_sources_and_scenarios.sql
--
-- Seed Corten's initial cost source registry + the three counterfactual
-- scenarios (UK loaded, London agency, US team) for the /dev/costs
-- dashboard.
--
-- Tenant-gated to Corten's org_id. Future tenants get an empty registry
-- and pick their own sources via the dashboard.
--
-- Idempotent on (org_id, name) - re-running won't duplicate.
--
-- Manual: apply once after 050.

DO $$
DECLARE
    v_org_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM core.organisations WHERE id = v_org_id) THEN
        RAISE NOTICE 'Org % not found; skipping cost-source seed.', v_org_id;
        RETURN;
    END IF;

    -- ============ Usage sources (operational) ============
    INSERT INTO feedback.cost_sources
        (org_id, name, vendor, category, provenance, default_currency, recurring_monthly, started_at, notes)
    VALUES
        (v_org_id, 'Anthropic API', 'anthropic', 'usage', 'api', 'USD', NULL, '2026-04-11',
         'Production LLM calls. API key in ANTHROPIC_API_KEY env. Live-fetch via /api/costs/refresh-live.'),
        (v_org_id, 'Vercel', 'vercel', 'usage', 'api', 'USD', NULL, '2026-04-11',
         'Compute, bandwidth, function invocations. Live-fetch via Vercel usage API.'),
        (v_org_id, 'Supabase', 'supabase', 'usage', 'manual', 'USD', NULL, '2026-04-11',
         'DB, storage, egress. Set SUPABASE_MANAGEMENT_TOKEN to enable live fetch; until then update monthly from Supabase dashboard.'),
        (v_org_id, 'CloudMailin', 'cloudmailin', 'usage', 'manual', 'USD', NULL, '2026-04-11',
         'Inbound email. Currently on Pro plan. Manual monthly update.'),
        (v_org_id, 'Microsoft 365', 'microsoft365', 'usage', 'manual', 'GBP', NULL, '2026-04-11',
         'Per-user Outlook + Graph API access. Manual monthly entry.'),
        (v_org_id, 'Resend', 'resend', 'usage', 'manual', 'USD', NULL, '2026-04-11',
         'Transactional outbound email. Free tier currently.'),
        (v_org_id, 'Domain (braiin.app)', 'domain', 'usage', 'manual', 'USD', 1.50, '2026-04-11',
         'Annual ~$18 amortised monthly. Update on renewal.')
    ON CONFLICT (org_id, name) DO NOTHING;

    -- ============ Build sources (investment in building) ============
    INSERT INTO feedback.cost_sources
        (org_id, name, vendor, category, provenance, default_currency, recurring_monthly, pro_rate, started_at, notes)
    VALUES
        (v_org_id, 'Claude MAX 20x', 'claude-max', 'build', 'manual', 'USD', 200.00, 0.80, '2026-04-11',
         'Flat $200/mo subscription. pro_rate defaults to 0.80 (80% attributed to this project). Adjust the pro_rate field in /dev/costs > Sources to match actual usage split.'),
        (v_org_id, 'GitHub', 'github', 'build', 'manual', 'USD', 0.00, 1.0, '2026-04-11',
         'Free for public repos. Update if you switch to a paid plan.'),
        (v_org_id, 'Cursor / Copilot', 'cursor', 'build', 'manual', 'USD', NULL, 1.0, '2026-04-11',
         'IDE assistant subscription. Set recurring_monthly if you actually use one.')
    ON CONFLICT (org_id, name) DO NOTHING;

    RAISE NOTICE 'Seeded cost sources for Corten (org %)', v_org_id;

    -- ============ Counterfactual scenarios (3 for comparison) ============
    INSERT INTO feedback.counterfactual_scenarios
        (org_id, name, description, team_size, roles, region, velocity_multiplier, is_default)
    VALUES
        (v_org_id, '5-person UK team',
         'In-house UK team at fully-loaded day rates (salary + employer NI + benefits + overhead).',
         5,
         '[
            {"role":"Product Manager","count":1,"day_rate_gbp":800},
            {"role":"Senior Backend Engineer","count":1,"day_rate_gbp":900},
            {"role":"Senior Frontend Engineer","count":1,"day_rate_gbp":900},
            {"role":"Designer","count":0.5,"day_rate_gbp":700},
            {"role":"QA Engineer","count":0.5,"day_rate_gbp":600}
         ]'::jsonb,
         'UK', 7.0, TRUE),

        (v_org_id, '5-person London agency',
         'Contract via a Shoreditch / WeWork-style agency. Markup on top of contractor rates.',
         5,
         '[
            {"role":"Product Manager","count":1,"day_rate_gbp":1400},
            {"role":"Senior Backend Engineer","count":1,"day_rate_gbp":1500},
            {"role":"Senior Frontend Engineer","count":1,"day_rate_gbp":1500},
            {"role":"Designer","count":0.5,"day_rate_gbp":1200},
            {"role":"QA Engineer","count":0.5,"day_rate_gbp":1000}
         ]'::jsonb,
         'London-Agency', 7.0, FALSE),

        (v_org_id, '5-person US team',
         'US tech-hub (NYC/SF) team at market rates. Converted to GBP daily for display.',
         5,
         '[
            {"role":"Product Manager","count":1,"day_rate_gbp":960},
            {"role":"Senior Backend Engineer","count":1,"day_rate_gbp":1200},
            {"role":"Senior Frontend Engineer","count":1,"day_rate_gbp":1200},
            {"role":"Designer","count":0.5,"day_rate_gbp":960},
            {"role":"QA Engineer","count":0.5,"day_rate_gbp":800}
         ]'::jsonb,
         'US', 7.0, FALSE)
    ON CONFLICT (org_id, name) DO NOTHING;

    RAISE NOTICE 'Seeded 3 counterfactual scenarios for Corten';
END $$;
