-- 042_build_log.sql
--
-- feedback.build_log - the running ledger of everything we have built /
-- shipped / decided on the Braiin project. Seeded from git history; kept
-- fresh by /api/build-log (called from scripts/log-build-item.sh on every
-- meaningful commit).

CREATE TABLE IF NOT EXISTS feedback.build_log (
    log_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id              UUID NOT NULL REFERENCES core.organisations(id) ON DELETE CASCADE,

    title               TEXT NOT NULL,
    summary             TEXT,                                       -- one-paragraph context

    -- What kind of artifact this is
    item_type           TEXT NOT NULL CHECK (item_type IN (
                            'migration', 'page', 'api', 'component',
                            'schema', 'decision', 'fix', 'refactor',
                            'docs', 'feature', 'wiring', 'devops', 'security'
                        )),

    -- Lifecycle
    status              TEXT NOT NULL DEFAULT 'shipped' CHECK (status IN (
                            'planned', 'in_progress', 'shipped',
                            'reverted', 'deprecated'
                        )),

    -- Categorisation
    project             TEXT NOT NULL DEFAULT 'braiin',                -- 'braiin' / 'corten-outbound' / etc
    area                TEXT,                                          -- 'quoting' / 'feedback' / 'inbox' / 'tms' / 'shorthand'
    tags                TEXT[] NOT NULL DEFAULT '{}',

    -- Provenance
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    commit_sha          TEXT,
    commit_message      TEXT,
    file_paths          TEXT[] NOT NULL DEFAULT '{}',                  -- repo paths touched
    pr_url              TEXT,
    deploy_url          TEXT,
    author              TEXT,                                          -- 'Rob' / 'Claude' / 'pair'

    -- Cross-linking to the change-request system
    linked_change_request UUID REFERENCES feedback.change_requests(request_id) ON DELETE SET NULL,

    -- Free-form annotations / decisions / next-actions
    notes               TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_build_log_occurred
    ON feedback.build_log (org_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_build_log_type
    ON feedback.build_log (org_id, item_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_build_log_area
    ON feedback.build_log (org_id, area, occurred_at DESC)
    WHERE area IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_build_log_commit
    ON feedback.build_log (commit_sha)
    WHERE commit_sha IS NOT NULL;

DROP TRIGGER IF EXISTS trg_build_log_touch ON feedback.build_log;
CREATE TRIGGER trg_build_log_touch
    BEFORE UPDATE ON feedback.build_log
    FOR EACH ROW EXECUTE FUNCTION feedback.touch_updated_at();

REVOKE ALL ON feedback.build_log FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON feedback.build_log TO service_role;
INSERT INTO feedback.build_log
    (org_id, title, item_type, status, area, tags, occurred_at, commit_sha, commit_message, author)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'feat(inbound): accept HTTP Basic Auth alongside Bearer', 'feature', 'shipped', 'inbound', ARRAY['inbound']::TEXT[], '2026-04-27 11:04:20 +0100', '759e2d0b95162f8fc654bb0f1599f9ea017c8f81', 'feat(inbound): accept HTTP Basic Auth alongside Bearer', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(dev): add /dev/activity smoke-test page', 'feature', 'shipped', 'ui', ARRAY['dev']::TEXT[], '2026-04-27 15:41:40 +0100', 'a2bbc78388f861011edba4d1914cb964e87bda96', 'feat(dev): add /dev/activity smoke-test page', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'fix(025): grant service_role on activity schema', 'schema', 'shipped', '025', ARRAY['025','schema']::TEXT[], '2026-04-27 16:05:10 +0100', '3a47db273d0879a4f4fd71e422bbdcb752818915', 'fix(025): grant service_role on activity schema', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'fix(025): replace invalid GRANT ON ALL TYPES with explicit per-type grants', 'fix', 'shipped', '025', ARRAY['025']::TEXT[], '2026-04-27 16:09:33 +0100', '46f6051f4c8d4aab974fa0046e8d6037e3fb55a3', 'fix(025): replace invalid GRANT ON ALL TYPES with explicit per-type grants', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'docs(rfc): draft engiine adoption mapping', 'docs', 'shipped', 'docs', ARRAY['rfc']::TEXT[], '2026-04-27 16:32:36 +0100', '5e1e0b37489b01996764bb6930520738412eb600', 'docs(rfc): draft engiine adoption mapping', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(llm-gateway): single LLM boundary with telemetry + cache', 'feature', 'shipped', 'llm-gateway', ARRAY['llm-gateway']::TEXT[], '2026-04-27 16:42:17 +0100', 'b8c1627d339d04f04dbb8e6a81f97dcc078998f9', 'feat(llm-gateway): single LLM boundary with telemetry + cache', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(dev): /dev/llm telemetry dashboard + sweep batch 1', 'feature', 'shipped', 'ui', ARRAY['dev']::TEXT[], '2026-04-27 16:57:14 +0100', '242f216197343d6041808328b09400d345eb815e', 'feat(dev): /dev/llm telemetry dashboard + sweep batch 1', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(llm-gateway): time-saved tracking + ROI on dashboard', 'feature', 'shipped', 'llm-gateway', ARRAY['llm-gateway']::TEXT[], '2026-04-27 17:00:56 +0100', 'b8c42d188e47348d95ca66cdf8a97b0978da5caf', 'feat(llm-gateway): time-saved tracking + ROI on dashboard', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(dev/llm): compute blended hourly rate from public.staff', 'feature', 'shipped', 'llm-gateway', ARRAY['dev_llm']::TEXT[], '2026-04-27 17:06:28 +0100', 'f5f3d821a03af0bf945941f9e031ab495af14ac8', 'feat(dev/llm): compute blended hourly rate from public.staff', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(llm-gateway): complete Messages-API sweep + multi-turn support', 'feature', 'shipped', 'llm-gateway', ARRAY['llm-gateway']::TEXT[], '2026-04-27 17:24:36 +0100', '7723f445dd884d08c1ebbb2e5510ad165efe2b13', 'feat(llm-gateway): complete Messages-API sweep + multi-turn support', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'ci(llm-gateway): guard against direct Anthropic API calls', 'devops', 'shipped', 'llm-gateway', ARRAY['llm-gateway']::TEXT[], '2026-04-27 17:28:33 +0100', 'ff80c0c47a409e3a950def501b1b21aedee75ebe', 'ci(llm-gateway): guard against direct Anthropic API calls', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(llm-gateway): decision-loop foundation (engiine RFC 3.2)', 'feature', 'shipped', 'llm-gateway', ARRAY['llm-gateway']::TEXT[], '2026-04-27 17:31:06 +0100', '9594b9ff4769bc9cab587d26b68c25355562d45e', 'feat(llm-gateway): decision-loop foundation (engiine RFC 3.2)', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(dev/llm): wire feedback buttons into dashboard', 'feature', 'shipped', 'llm-gateway', ARRAY['dev_llm','wired']::TEXT[], '2026-04-27 17:38:10 +0100', '48322661fd6797bc619d6eccb5846798d660aa7d', 'feat(dev/llm): wire feedback buttons into dashboard', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(shorthand): db-backed freight vocabulary (engiine RFC 3.4)', 'feature', 'shipped', 'shorthand', ARRAY['shorthand']::TEXT[], '2026-04-27 17:56:56 +0100', 'f6caff5a61709c0b252b3d51a0f5bbe6c6f3d42a', 'feat(shorthand): db-backed freight vocabulary (engiine RFC 3.4)', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(shorthand): expand vocab inline in classify-email + research', 'feature', 'shipped', 'shorthand', ARRAY['shorthand']::TEXT[], '2026-04-27 18:09:50 +0100', '44d4efc0d2248578360442491ee382a9cf393254', 'feat(shorthand): expand vocab inline in classify-email + research', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(geo): UN/LOCODE reference data for Cargowise integration', 'feature', 'shipped', 'reference-data', ARRAY['geo']::TEXT[], '2026-04-27 19:23:27 +0100', '9a28f4595593c038e0bafea571f8bd87185aa2dd', 'feat(geo): UN/LOCODE reference data for Cargowise integration', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(reference-data): currencies + HS codes + IATA + geo lookup API', 'feature', 'shipped', 'reference-data', ARRAY['reference-data']::TEXT[], '2026-04-27 19:45:28 +0100', '121cd8d6007daefca2d124dd47d2d2855900e0e7', 'feat(reference-data): currencies + HS codes + IATA + geo lookup API', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(tms): provider-agnostic TMS layer + Cargowise (Cargo Visibility) adapter', 'feature', 'shipped', 'tms', ARRAY['tms']::TEXT[], '2026-04-27 22:04:49 +0100', '10387043098ebb969f9adb426c452b256eaba7ad', 'feat(tms): provider-agnostic TMS layer + Cargowise (Cargo Visibility) adapter', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(cargowise): carrier auto-detect + booking/container ref types', 'feature', 'shipped', 'tms', ARRAY['cargowise']::TEXT[], '2026-04-27 22:16:04 +0100', '2d885936d8dda59e72362a876c3d72f3cdb8e71f', 'feat(cargowise): carrier auto-detect + booking/container ref types', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(tms): eAdaptor shipment query + BI mirror tables + outbound audit log', 'feature', 'shipped', 'tms', ARRAY['tms']::TEXT[], '2026-04-27 22:44:03 +0100', '4aa0a2ca6b100f5da8f662952edac55d9ab7f937', 'feat(tms): eAdaptor shipment query + BI mirror tables + outbound audit log', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(dev): visual mock-up of the quoting workspace', 'feature', 'shipped', 'ui', ARRAY['dev']::TEXT[], '2026-04-27 23:20:41 +0100', '195466276268322a910bad7bb1056060089345bb', 'feat(dev): visual mock-up of the quoting workspace', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'fix(security): urgent post-audit fixes', 'security', 'shipped', 'security', ARRAY['security']::TEXT[], '2026-04-27 23:32:42 +0100', 'd3257ce7a310790d6e4c8cf93962202e29f7d007', 'fix(security): urgent post-audit fixes', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(dev): visual mock-up of the RFQ inbox', 'feature', 'shipped', 'ui', ARRAY['dev']::TEXT[], '2026-04-28 08:19:58 +0100', 'e6980735442018e8ddbb6e0fdb923e5665bd1775', 'feat(dev): visual mock-up of the RFQ inbox', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(dev): inbox sibling-group rendering for multi-quote emails', 'feature', 'shipped', 'ui', ARRAY['dev']::TEXT[], '2026-04-28 08:25:03 +0100', '9ccc7658dbd0ffe96b6ba403539412406653a4aa', 'feat(dev): inbox sibling-group rendering for multi-quote emails', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(quotes): foundational schema + needs_input status', 'schema', 'shipped', 'quoting', ARRAY['quotes','schema']::TEXT[], '2026-04-28 08:35:27 +0100', '260e563ddc4558af89ba4b0a382478cac4951368', 'feat(quotes): foundational schema + needs_input status', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(dev): Provide input slide-out panel', 'feature', 'shipped', 'ui', ARRAY['dev','ui']::TEXT[], '2026-04-28 08:39:01 +0100', 'cde4876ae4719b382ae3e93cc83549c5631663c8', 'feat(dev): Provide input slide-out panel', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(dev): low-confidence sibling-split review screen', 'feature', 'shipped', 'ui', ARRAY['dev']::TEXT[], '2026-04-28 22:42:27 +0100', 'e9cd65109b0c856766460a5b091059648cb92af3', 'feat(dev): low-confidence sibling-split review screen', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(dev): inbox - action first, source demoted', 'feature', 'shipped', 'ui', ARRAY['dev']::TEXT[], '2026-04-28 22:48:17 +0100', '1491621d559e78a51e6343d97c5bf5bf75393a4c', 'feat(dev): inbox - action first, source demoted', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(dev): inbox - combine action + status, shrink pills', 'feature', 'shipped', 'ui', ARRAY['dev']::TEXT[], '2026-04-28 22:53:31 +0100', '01d88730452d801b7ea04e48548bc2a1d53ccedb', 'feat(dev): inbox - combine action + status, shrink pills', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(dev): PILL_SM applied to workspace + split-review', 'feature', 'shipped', 'ui', ARRAY['dev']::TEXT[], '2026-04-28 22:56:52 +0100', 'de491b18b619639bcbbc417d5daaf974282124a2', 'feat(dev): PILL_SM applied to workspace + split-review', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(quotes): partners + scorecards + carrier-add + breakdown panel', 'feature', 'shipped', 'quoting', ARRAY['quotes','ui']::TEXT[], '2026-04-28 23:11:01 +0100', 'b49ec18b4f3bf5105afb3c1f31d67964089d57ee', 'feat(quotes): partners + scorecards + carrier-add + breakdown panel', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(quotes): margin types, multi-currency, validity + editable cost+sell', 'feature', 'shipped', 'quoting', ARRAY['quotes']::TEXT[], '2026-04-28 23:30:00 +0100', 'b8c15fa8f023ca2c3fc5054227a83499ab9602fc', 'feat(quotes): margin types, multi-currency, validity + editable cost+sell', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'fix(dev): tighten breakdown panel header to one row', 'fix', 'shipped', 'ui', ARRAY['dev','ui']::TEXT[], '2026-04-28 23:36:35 +0100', '761f34c1ddb4eb230b713ec72a5d4f41a1d5af9d', 'fix(dev): tighten breakdown panel header to one row', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(dev): macro-group + per-currency breakdown + customer view toggles', 'feature', 'shipped', 'ui', ARRAY['dev']::TEXT[], '2026-04-28 23:43:10 +0100', '4ed04b0812a3c799772321033a021fb55eee0502', 'feat(dev): macro-group + per-currency breakdown + customer view toggles', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'fix(dev): customer view consolidates rows + always 2dp on money', 'fix', 'shipped', 'ui', ARRAY['dev']::TEXT[], '2026-04-28 23:46:32 +0100', 'a66847eddcedee40b32cca7c94b42d7732cae7ce', 'fix(dev): customer view consolidates rows + always 2dp on money', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(quotes): indicative charges + caveats + rollup-includes note', 'feature', 'shipped', 'quoting', ARRAY['quotes']::TEXT[], '2026-04-28 23:54:46 +0100', 'd59b1ec5e43725d3b9125d5e123041b679c7b2e8', 'feat(quotes): indicative charges + caveats + rollup-includes note', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(quotes): charge code dictionary + multi-TMS mapping + margin rules', 'feature', 'shipped', 'quoting', ARRAY['quotes']::TEXT[], '2026-04-29 00:11:48 +0100', 'dcd3ae1e904c08b27fe8fe4bad77db51b6da8cb2', 'feat(quotes): charge code dictionary + multi-TMS mapping + margin rules', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(dev): surface tms_origin on charge-codes page', 'feature', 'shipped', 'ui', ARRAY['dev']::TEXT[], '2026-04-29 00:19:28 +0100', 'a33a379b4698357992f47e9f3aa54adc58621bcc', 'feat(dev): surface tms_origin on charge-codes page', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(dev): editor slide-ins on charge-codes + margins pages', 'feature', 'shipped', 'ui', ARRAY['dev','ui']::TEXT[], '2026-04-29 00:25:25 +0100', 'b01b2eb82c843b754f85ee313e685d6a95e361bb', 'feat(dev): editor slide-ins on charge-codes + margins pages', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(dev): CSV template + upload + test calculator', 'feature', 'shipped', 'ui', ARRAY['csv','dev']::TEXT[], '2026-04-29 00:32:36 +0100', 'ca4d28b1973799326ce854e2d8be0f84f8f459ad', 'feat(dev): CSV template + upload + test calculator', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(dev): carriers CSV + min-charge floor in test calculator', 'feature', 'shipped', 'ui', ARRAY['csv','dev']::TEXT[], '2026-04-29 00:42:52 +0100', '47c6ece687363a838d1434cc0634167da60fc3db', 'feat(dev): carriers CSV + min-charge floor in test calculator', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(quotes): wire charge-codes + margins to live database', 'wiring', 'shipped', 'quoting', ARRAY['quotes','wired']::TEXT[], '2026-04-29 10:18:18 +0100', '170d73b03b2a6a5e3d4c172385433cb38e5a1931', 'feat(quotes): wire charge-codes + margins to live database', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(margins): charge code is now a dropdown filtered by section', 'feature', 'shipped', 'quoting', ARRAY['margins']::TEXT[], '2026-04-29 10:23:19 +0100', '4137a0da39f44cc05d4875053cd2fcf6356610cf', 'feat(margins): charge code is now a dropdown filtered by section', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'feat(feedback): change request system with floating widget + workflow', 'feature', 'shipped', 'feedback', ARRAY['feedback']::TEXT[], '2026-04-29 10:29:39 +0100', 'bdc25b07e0080df49869a401b63534d076aa8744', 'feat(feedback): change request system with floating widget + workflow', 'pair')
ON CONFLICT DO NOTHING;

INSERT INTO feedback.build_log
    (org_id, title, item_type, status, area, tags, occurred_at, notes, author)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'Migration 037 applied in Supabase', 'schema', 'shipped', 'quoting', ARRAY['schema','applied']::TEXT[], '2026-04-29 09:50:00', 'Drafts + sibling_groups + input_requests + display_id generator + status-transition trigger live in Supabase.', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'Migration 038 applied in Supabase', 'schema', 'shipped', 'quoting', ARRAY['schema','applied']::TEXT[], '2026-04-29 09:55:00', 'Partners (carriers + carrier_contacts + scorecards + scorecard_weights + lane_stats) + draft_carrier_selections live.', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'Migration 039 applied in Supabase', 'schema', 'shipped', 'quoting', ARRAY['schema','applied']::TEXT[], '2026-04-29 10:00:00', 'FX rates + geo.convert_amount + quote output currency / validity / charge_lines / direction live.', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'Migration 040 applied in Supabase', 'schema', 'shipped', 'quoting', ARRAY['schema','applied']::TEXT[], '2026-04-29 10:05:00', 'Charge codes + tms.charge_code_map + margin_rules + 107 CW seeds live. quotes + partners added to Exposed schemas.', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'Migration 041 applied in Supabase', 'schema', 'shipped', 'feedback', ARRAY['schema','applied']::TEXT[], '2026-04-29 10:30:00', 'Change request system live. feedback schema exposed. change-request-attachments storage bucket created.', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'Decision: charge codes seeded from Cargowise dictionary', 'decision', 'shipped', 'quoting', ARRAY['decision','cargowise']::TEXT[], '2026-04-29 09:00:00', 'Lifted 107 codes from CW Charge codes_CW(1)_UPDATED.xlsx. Each tagged tms_origin=''cargowise'' with direct mapping in tms.charge_code_map. Future TMS adapters drop in alongside.', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'Decision: 17 markup methods cover Wisor + Cargowise', 'decision', 'shipped', 'quoting', ARRAY['decision','margin']::TEXT[], '2026-04-29 09:00:00', 'pct / flat / per_cbm / per_kg / per_chargeable_weight / per_wm / per_container / per_container_20 / per_container_40 / per_pallet / per_bill / per_hs_code / per_shipment / pct_of_line / currency_conditional / override / on_cost.', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'Decision: macro-groups (Origin & EXW / Freight / Destination & Delivery / Insurance & Other)', 'decision', 'shipped', 'quoting', ARRAY['decision','ux']::TEXT[], '2026-04-28 23:00:00', 'Replaces granular per-category presentation on the customer-facing quote. Sub-groups by currency within each macro group.', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'Decision: cross-schema cast pattern for Supabase routes', 'decision', 'shipped', 'wiring', ARRAY['decision','wiring']::TEXT[], '2026-04-29 11:00:00', 'Generated Database type only knows public; we cast supabase to {schema: (s) => any} in API routes that hit quotes / partners / tms / feedback / geo. Saves regenerating types.', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'Memory updated: project_quoting_engine_v2_design.md (live status)', 'docs', 'shipped', 'memory', ARRAY['docs','memory']::TEXT[], '2026-04-29 14:00:00', 'All migrations 037-040 noted live. /dev/charge-codes + /dev/margins LIVE wired. Inbox + workspace still mock. Next-session candidates ranked.', 'pair'),
    ('00000000-0000-0000-0000-000000000001', 'Memory created: project_change_request_system.md', 'docs', 'shipped', 'memory', ARRAY['docs','memory']::TEXT[], '2026-04-29 14:00:00', 'Schema + API + widget + storage bucket documented. Workflow steps captured. Future enhancements listed.', 'pair');
