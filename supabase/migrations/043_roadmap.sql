-- 043_roadmap.sql
-- feedback.roadmap_nodes - CTO-only mind map of the Braiin project.
-- Self-referential tree with status + rationale per node.

CREATE TABLE IF NOT EXISTS feedback.roadmap_nodes (
    node_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,
    parent_id           UUID REFERENCES feedback.roadmap_nodes(node_id) ON DELETE CASCADE,

    title               TEXT NOT NULL,
    -- The "idea behind it" - why this exists, what it unlocks
    rationale           TEXT,

    status              TEXT NOT NULL DEFAULT 'idea' CHECK (status IN (
                            'idea',          -- captured, not committed to
                            'planned',       -- on the build queue
                            'brainstorming', -- actively being scoped
                            'in_progress',   -- being built right now
                            'shipped',       -- live in production
                            'parked',        -- paused
                            'rejected'       -- decided no
                        )),

    priority            TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN (
                            'low', 'medium', 'high', 'critical'
                        )),

    -- Free-form area tag for cross-cutting filters
    area                TEXT,

    -- Sibling ordering within the parent (manually set for stable display)
    position            INTEGER NOT NULL DEFAULT 0,

    -- Tags array for cross-cutting search
    tags                TEXT[] NOT NULL DEFAULT '{}',

    -- Cross-link to other systems
    linked_change_request UUID REFERENCES feedback.change_requests(request_id) ON DELETE SET NULL,
    linked_build_log_id   UUID REFERENCES feedback.build_log(log_id) ON DELETE SET NULL,

    notes               TEXT,
    eta                 TEXT,                            -- free-form: "next session", "Q2", "after Phase A"

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roadmap_parent
    ON feedback.roadmap_nodes (parent_id, position);

CREATE INDEX IF NOT EXISTS idx_roadmap_status
    ON feedback.roadmap_nodes (org_id, status, updated_at DESC);

DROP TRIGGER IF EXISTS trg_roadmap_touch ON feedback.roadmap_nodes;
CREATE TRIGGER trg_roadmap_touch
    BEFORE UPDATE ON feedback.roadmap_nodes
    FOR EACH ROW EXECUTE FUNCTION feedback.touch_updated_at();

REVOKE ALL ON feedback.roadmap_nodes FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON feedback.roadmap_nodes TO service_role;


-- ============================================================
-- Seed: current Braiin roadmap (Apr 2026 snapshot)
-- ============================================================
DO $$
DECLARE
    org_uuid UUID := '00000000-0000-0000-0000-000000000001';
    root_id UUID;
    qe_id UUID;
    inbox_id UUID;
    mock_id UUID;
    feedback_id UUID;
    engiine_id UUID;
    rates_id UUID;
    future_id UUID;
BEGIN
    -- Root
    INSERT INTO feedback.roadmap_nodes (org_id, title, rationale, status, priority, area, position)
    VALUES (org_uuid, 'Braiin - Freight OS', 'The unified operating system for Corten Logistics. Replaces fragmented tools with a single conversational+visual surface that captures every interaction, learns from every decision, and automates the high-volume operator tasks.', 'in_progress', 'critical', 'meta', 0)
    RETURNING node_id INTO root_id;

    -- Quoting Engine v2
    INSERT INTO feedback.roadmap_nodes (org_id, parent_id, title, rationale, status, priority, area, position)
    VALUES (org_uuid, root_id, 'Quoting Engine v2', 'Conversational quoting that pulls from 5 rate sources, scores carriers on 5 axes, splits multi-quote emails, and pushes won jobs to Cargowise. Differentiator: dual-voice recommendations (internal candid + customer diplomatic).', 'in_progress', 'critical', 'quoting', 1)
    RETURNING node_id INTO qe_id;

    INSERT INTO feedback.roadmap_nodes (org_id, parent_id, title, rationale, status, priority, area, position) VALUES
    (org_uuid, qe_id, 'Phase A0 - RFQ inbox + slide-outs (mock)', 'Air-traffic-control view across all open RFQs. 3 slide-outs (Send RFQ, Ask for info, Provide input) capture every operator action. Mock shipped, awaits live data wiring.', 'shipped', 'high', 'quoting', 0),
    (org_uuid, qe_id, 'Phase A - Partners + scorecards', 'Carrier rolodex with 5-axis scoring (suitability/speed/accuracy/price/service). Migration 038 live. /dev/carriers page mock-shipped. Live wiring pending.', 'shipped', 'high', 'quoting', 1),
    (org_uuid, qe_id, 'Phase B - Customer + agent contracts', 'On-file sell-side rates with our clients + partner-to-partner agent agreements. NOT YET STARTED.', 'planned', 'high', 'quoting', 2),
    (org_uuid, qe_id, 'Phase C - Conversational requirements agent', 'Chat thread on the draft that asks operator/customer for missing fields, batched across siblings. Decision-loop captures overrides. NOT YET STARTED.', 'planned', 'high', 'quoting', 3),
    (org_uuid, qe_id, 'Phase D - Multi-source RFQ fan-out + multi-option extractor', 'Fans to on-file rates + carrier APIs + aggregators + spot RFQ via email in parallel. Recognises Express/Standard/Economy multi-product responses. NOT YET STARTED.', 'planned', 'high', 'quoting', 4),
    (org_uuid, qe_id, 'Phase E - Margin engine (rule precedence)', 'quotes.margin_rules with 17 markup methods + 10 scope fields + auto-computed rule_priority. Test calculator + matrix view live. Live wired.', 'shipped', 'high', 'quoting', 5),
    (org_uuid, qe_id, 'Phase F - Auto-pick + dual reasoning', 'Composite score per option using customer priority profile. Generates internal_reasoning + external_reasoning so customer email leads with evidence. NOT YET STARTED.', 'planned', 'high', 'quoting', 6),
    (org_uuid, qe_id, 'Phase Q - CargoWise Quotation push (won jobs only)', 'Closes the loop. quotes won -> CW Quotation via eAdaptor. Idempotent ClientReference. Lost stays in Braiin only. NOT YET STARTED.', 'planned', 'high', 'quoting', 7),
    (org_uuid, qe_id, 'Phase G - Contract intelligence alerts', 'Watch carrier contracts for expiry/renewal. NOT YET STARTED.', 'planned', 'medium', 'quoting', 8),
    (org_uuid, qe_id, 'Phase H-L - Aviation schedules + routing intelligence', 'aviation.schedules cache from CargoAI/Cargo.one + routing_intelligence learning per (origin,dest,carrier,routing). After 90 days the system answers "what FRA-routing pattern do customers actually pick?" NOT YET STARTED.', 'planned', 'medium', 'aviation', 9),
    (org_uuid, qe_id, 'Phase M-O - Carrier API adapters', 'Maersk Spot + MSC + CMA + ONE + Hapag + Evergreen + COSCO + ZIM. Each is days-to-weeks of carrier-side onboarding more than dev work. NOT YET STARTED.', 'planned', 'medium', 'quoting', 10),
    (org_uuid, qe_id, 'Phase P - Quote PDF + T&C library + email cover', 'Functional PDF first, styling iterates. quotes.terms_templates by mode/lane/client. Insurance section per Wisor pattern. NOT YET STARTED.', 'planned', 'medium', 'quoting', 11),
    (org_uuid, qe_id, 'Charge code dictionary', '107 canonical Braiin codes seeded from CW. Multi-TMS mapping table for Magaya/Descartes future. Live wired with /dev/charge-codes editor.', 'shipped', 'high', 'quoting', 12),
    (org_uuid, qe_id, 'Multi-currency + FX', 'Migration 039: geo.fx_rates + geo.convert_amount() with 7-day sliding window + inverse + USD triangulation. Quote output currency picker. XE.com fetch script NOT YET BUILT.', 'shipped', 'high', 'quoting', 13),
    (org_uuid, qe_id, 'Macro-group breakdown structure', 'Origin & EXW / Freight / Destination & Delivery / Insurance & Other. Per-currency subtotals within each. Customer-facing roll-up. Live in /dev/quote-preview breakdown panel.', 'shipped', 'high', 'quoting', 14),
    (org_uuid, qe_id, 'Indicative charges + caveats', 'Demurrage / detention / customs duty as caveats - shown but NOT in total. is_indicative flag + caveat_note text per line. Shipped.', 'shipped', 'medium', 'quoting', 15),
    (org_uuid, qe_id, 'XE.com FX fetcher daily cron', 'Schema ready (geo.fx_rates) but no fetch script yet. Need a cron that pulls daily mid-market rates. Next-session candidate.', 'planned', 'high', 'quoting', 16),
    (org_uuid, qe_id, 'Wire /dev/quote-inbox to live drafts', 'Inbox is currently mock. Read from quotes.drafts on mount, mutations persist. Next-session candidate #1.', 'planned', 'critical', 'quoting', 17),
    (org_uuid, qe_id, 'Connect classify-email to create draft rows', 'Inbound RFQ email -> classify-email extracts -> creates a quotes.drafts row. The actual end-to-end glue.', 'planned', 'critical', 'quoting', 18);

    -- Inbox / inbound
    INSERT INTO feedback.roadmap_nodes (org_id, parent_id, title, rationale, status, priority, area, position)
    VALUES (org_uuid, root_id, 'Inbound mail pipeline', 'CloudMailin Pro routes inbound to inbound.braiin.app, classify-email parses into typed conversations. Live since 2026-04-27.', 'shipped', 'critical', 'inbound', 2)
    RETURNING node_id INTO inbox_id;

    INSERT INTO feedback.roadmap_nodes (org_id, parent_id, title, rationale, status, priority, area, position) VALUES
    (org_uuid, inbox_id, 'CloudMailin Pro routing', 'Catch-all on inbound.braiin.app. Pro tier (Starter does NOT do catch-all despite the pricing page).', 'shipped', 'high', 'inbound', 0),
    (org_uuid, inbox_id, 'classify-email LLM gateway', 'Single LLM boundary. Routes via @/lib/llm-gateway. CI guard blocks direct Anthropic imports.', 'shipped', 'high', 'inbound', 1),
    (org_uuid, inbox_id, 'BCC intel handler', 'Pipedrive user matching + smart name parsing for the BCC funnel.', 'shipped', 'medium', 'inbound', 2),
    (org_uuid, inbox_id, 'Multi-quote-per-email split', 'classify-email splits one inbound RFQ into N drafts when the customer asks for multiple options. Low-confidence splits route through /dev/quote-split-review. Schema ready, AI prompt tuning still pending.', 'planned', 'high', 'inbound', 3);

    -- Engiine adoption
    INSERT INTO feedback.roadmap_nodes (org_id, parent_id, title, rationale, status, priority, area, position)
    VALUES (org_uuid, root_id, 'Engiine RFC adoption', 'Six borrowings from the engiine RFC: §3.1-3.6. Three shipped, three pending.', 'in_progress', 'high', 'engiine', 3)
    RETURNING node_id INTO engiine_id;

    INSERT INTO feedback.roadmap_nodes (org_id, parent_id, title, rationale, status, priority, area, position) VALUES
    (org_uuid, engiine_id, '§3.1 Single LLM boundary', 'All LLM calls through @/lib/llm-gateway. 14 features migrated. Content-hash cache. Time-saved tracking. CI guard.', 'shipped', 'critical', 'engiine', 0),
    (org_uuid, engiine_id, '§3.2 Decision + feedback loop foundation', 'activity.llm_feedback table + confirm/reject/flag buttons live on /dev/llm. Correct-shape (paired before/after textarea) deferred until quote drafting needs it.', 'shipped', 'high', 'engiine', 1),
    (org_uuid, engiine_id, '§3.3 Links table (typed directed edges)', 'New graph schema with graph.links table + connected-view projections. Estimated 5 days. NOT YET STARTED.', 'planned', 'medium', 'engiine', 2),
    (org_uuid, engiine_id, '§3.4 Domain shorthand vocabulary', 'DB-backed multilingual freight vocab. ~117 EN seed terms. Wired into classify-email + research prompts.', 'shipped', 'medium', 'engiine', 3),
    (org_uuid, engiine_id, '§3.5 Cheap-path-first lint rule', 'Half-day. Catches "calling LLM when a deterministic check would do". NOT YET STARTED.', 'planned', 'low', 'engiine', 4),
    (org_uuid, engiine_id, '§3.6 19-node-type naming catalogue', '1 hour, just a docs/naming.md reference codifying the 19 node types vs existing Postgres table mappings. NOT YET STARTED.', 'planned', 'low', 'engiine', 5);

    -- Reference data
    INSERT INTO feedback.roadmap_nodes (org_id, parent_id, title, rationale, status, priority, area, position)
    VALUES (org_uuid, root_id, 'Reference data', 'Single source of truth for places/currencies/codes. Critical for Cargowise interop.', 'shipped', 'high', 'reference-data', 4)
    RETURNING node_id INTO rates_id;

    INSERT INTO feedback.roadmap_nodes (org_id, parent_id, title, rationale, status, priority, area, position) VALUES
    (org_uuid, rates_id, 'UN/LOCODE (geo.locations) - 116k rows', 'Annual refresh via GitHub Actions cron.', 'shipped', 'high', 'reference-data', 0),
    (org_uuid, rates_id, 'Currencies (geo.currencies) - 307 rows', 'ISO 4217.', 'shipped', 'medium', 'reference-data', 1),
    (org_uuid, rates_id, 'HS codes (customs.hs_codes) - 6939 rows', 'WCO HS6.', 'shipped', 'medium', 'reference-data', 2),
    (org_uuid, rates_id, 'IATA carriers (aviation.carriers) - 6161 rows', 'OpenFlights + ICAO.', 'shipped', 'medium', 'reference-data', 3),
    (org_uuid, rates_id, 'CW reference data import', 'Shipping Lines (39), Airlines (80), CoLoaders (40), Agents/Hauliers (5 sub-sheets), Port codes (206), Volume Units (12). Import scripts NOT YET BUILT.', 'planned', 'medium', 'reference-data', 4);

    -- Feedback systems (this very session)
    INSERT INTO feedback.roadmap_nodes (org_id, parent_id, title, rationale, status, priority, area, position)
    VALUES (org_uuid, root_id, 'Feedback + visibility', 'Closed-loop product management. Anyone raises requests, CTO triages, ledger keeps history.', 'shipped', 'high', 'feedback', 5)
    RETURNING node_id INTO feedback_id;

    INSERT INTO feedback.roadmap_nodes (org_id, parent_id, title, rationale, status, priority, area, position) VALUES
    (org_uuid, feedback_id, 'Change request system', 'Floating widget on every /dev/* page. Paste screenshot. CTO surface at /dev/change-requests with 8-state workflow + brainstorm + comments.', 'shipped', 'high', 'feedback', 0),
    (org_uuid, feedback_id, 'Build log', 'feedback.build_log + /dev/build-log timeline. 44 commits + 11 milestones seeded. helper script logs new commits.', 'shipped', 'high', 'feedback', 1),
    (org_uuid, feedback_id, 'Roadmap (this view)', 'feedback.roadmap_nodes tree + /dev/roadmap. CTO-only mind map of everything.', 'shipped', 'high', 'feedback', 2),
    (org_uuid, feedback_id, 'Notification on CR status change', 'Email/Slack ping when a request moves through pipeline. NOT YET STARTED.', 'planned', 'low', 'feedback', 3),
    (org_uuid, feedback_id, 'Auto-link shipped CR to build_log entry', 'When a change request flips to shipped, auto-create a build_log row pointing back. NOT YET STARTED.', 'planned', 'medium', 'feedback', 4);

    -- Mock-up surfaces
    INSERT INTO feedback.roadmap_nodes (org_id, parent_id, title, rationale, status, priority, area, position)
    VALUES (org_uuid, root_id, 'Mock-up surfaces - design contracts ahead of build', 'Pattern: ship a /dev/* visual contract first, react to it, then build the schema and wire live. Several still mock.', 'in_progress', 'high', 'ui', 6)
    RETURNING node_id INTO mock_id;

    INSERT INTO feedback.roadmap_nodes (org_id, parent_id, title, rationale, status, priority, area, position) VALUES
    (org_uuid, mock_id, '/dev/quote-inbox (mock)', 'RFQ triage with 3 slide-outs + sibling groups + needs_input. Wire to live drafts pending.', 'shipped', 'high', 'ui', 0),
    (org_uuid, mock_id, '/dev/quote-preview (mock)', 'Per-quote workspace with breakdown panel: macro-groups + per-currency + 17 margin types + indicative charges. Wire to live charge_lines pending.', 'shipped', 'high', 'ui', 1),
    (org_uuid, mock_id, '/dev/quote-split-review (mock)', 'Low-confidence sibling split review with side-by-side email + proposed splits.', 'shipped', 'medium', 'ui', 2),
    (org_uuid, mock_id, '/dev/carriers (mock)', 'Rolodex with 5-axis scorecards. Wire pending.', 'shipped', 'medium', 'ui', 3),
    (org_uuid, mock_id, '/dev/charge-codes (LIVE)', 'Wired to quotes.charge_codes + tms.charge_code_map.', 'shipped', 'high', 'ui', 4),
    (org_uuid, mock_id, '/dev/margins (LIVE)', 'Wired to quotes.margin_rules with test calculator.', 'shipped', 'high', 'ui', 5);

    -- Future / parked ideas
    INSERT INTO feedback.roadmap_nodes (org_id, parent_id, title, rationale, status, priority, area, position)
    VALUES (org_uuid, root_id, 'Future / parked', 'Real ideas captured but not yet committed to.', 'idea', 'medium', 'future', 7)
    RETURNING node_id INTO future_id;

    INSERT INTO feedback.roadmap_nodes (org_id, parent_id, title, rationale, status, priority, area, position) VALUES
    (org_uuid, future_id, 'Calendar / diary', 'Important, not yet designed.', 'idea', 'high', 'future', 0),
    (org_uuid, future_id, 'Centralised task manager', 'Siloed, seniority-visible, AI-suggested actions.', 'idea', 'high', 'future', 1),
    (org_uuid, future_id, 'Email cleanup / todo list', 'Partial. What is done and what is remaining.', 'idea', 'medium', 'future', 2),
    (org_uuid, future_id, 'Contact reassociation', 'Domain mismatch detection - flag when someone changes jobs.', 'idea', 'medium', 'future', 3),
    (org_uuid, future_id, 'Projects / Roadmap feature in Braiin (customer-facing)', 'For Corten clients to see their planned shipments, not the internal roadmap above.', 'idea', 'low', 'future', 4),
    (org_uuid, future_id, 'Networks ROI metrics', 'Tied to /networks and future /events into the CRM. High-priority, deferred.', 'idea', 'high', 'future', 5),
    (org_uuid, future_id, 'AI-first freight ops capabilities', 'Per project_freight_ops_ai_roi.md memory: ~1.5 FTE/year saved at 23 people. STRATEGIC.', 'idea', 'high', 'future', 6),
    (org_uuid, future_id, 'Crosstrade direction support', 'Origin AND destination both abroad. Schema column added in 040; UI flow not yet built.', 'idea', 'medium', 'future', 7);
END $$;
