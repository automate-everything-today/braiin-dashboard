-- 048_seed_historical_audit_findings.sql
--
-- Backfill into feedback.security_findings every still-open item from prior
-- audits that pre-date the security dashboard. Source of truth for these:
--   - memory/project_audit_2026-04-27_findings.md (2026-04-27 night audit)
--   - commit messages 39b3fb8, b19c2e3, 9223af9, d3257ce
--
-- Each item below was re-verified against the current codebase before
-- inclusion - items already fixed in subsequent commits were dropped.
-- The 2026-04-27 "proxy.ts not running" CRITICAL was a misreading of
-- pre-Next-16 docs; Next 16.2.2 renamed `middleware` -> `proxy` and
-- node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
-- confirms src/proxy.ts IS the correct file. That finding is therefore
-- NOT seeded.
--
-- Manual: apply once after 047.

DO $$
DECLARE
    v_org_id UUID;
    v_audit  TEXT := '2026-04-27-night-historical';
BEGIN
    SELECT id INTO v_org_id FROM core.organisations LIMIT 1;
    IF v_org_id IS NULL THEN
        RAISE NOTICE 'No org configured; skipping seed.';
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM feedback.security_findings
        WHERE source_audit = v_audit
    ) THEN
        RAISE NOTICE 'Audit % already seeded; skipping.', v_audit;
        RETURN;
    END IF;

    INSERT INTO feedback.security_findings (
        org_id, source_audit, source_reviewer, severity, status,
        title, description, recommendation, file_path, line_number, tags
    ) VALUES
    -- ============ HIGH ============
    (
        v_org_id, v_audit, 'database-reviewer', 'high', 'open',
        'TMS status columns lack CHECK constraints',
        'tms.events.status, tms.subscriptions.status, and tms.outbound_calls.status are all TEXT NOT NULL with the valid values listed only in inline comments. Without DB-level CHECK constraints, a typo (auth-error vs auth_error) silently slips through and breaks any partial index that filters on the canonical value (auth-error alerting in particular).',
        'Add a migration adding CHECK (status IN (...)) on each of the three columns. Match the comment-listed values exactly. Idempotent via DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT.',
        'supabase/migrations/035_tms_schema.sql', 156,
        ARRAY['database', 'tms', 'integrity']
    ),
    (
        v_org_id, v_audit, 'code-reviewer', 'high', 'open',
        'Cargo Visibility outbound calls bypass audit log',
        'cargo-visibility/client.ts has postUniversalXml, getCargoVisibility, deleteCargoVisibility making external HTTP calls but never write to tms.outbound_calls. This breaks the audit-attribution surface that the eDaptor side already populates correctly. Failures to CV are invisible to ops.',
        'Wrap each external call in a try/finally that calls logOutboundCall(...) with status, http_status, summary. Match the pattern used in src/lib/tms/cargowise/edaptor/queries.ts.',
        'src/lib/tms/cargowise/cargo-visibility/client.ts', NULL,
        ARRAY['observability', 'tms']
    ),
    (
        v_org_id, v_audit, 'code-reviewer', 'high', 'open',
        'IRA / IRJ events do not sync back to subscription state',
        'The inbound webhook persists IRA (acknowledge) and IRJ (reject) events into tms.events but never UPDATEs the matching tms.subscriptions row. The UI shows subscriptions as pending forever.',
        'In the inbound handler after persisting an IRA/IRJ event, match by client_reference and UPDATE tms.subscriptions SET status = (acknowledged|rejected), acknowledged_at|rejected_at = NOW(). Add a regression test using the sample IRA/IRJ XML payloads in test/fixtures.',
        'src/app/api/inbound/cargowise-events/route.ts', NULL,
        ARRAY['tms', 'webhook', 'data-integrity']
    ),
    -- ============ MEDIUM ============
    (
        v_org_id, v_audit, 'typescript-reviewer', 'medium', 'open',
        'TmsProviderId union collapses to plain string',
        'src/lib/tms/types.ts:9 declares `type TmsProviderId = "cargowise" | "magaya" | string;` - the | string suffix collapses the union to plain string, defeating exhaustive switches. Every code path that switches on providerId silently misses the would-be typo guard.',
        'Drop the | string suffix. Move any callsite that legitimately needs an open-ended provider (e.g. unknown future TMS) to a separate UnknownProviderId type so we keep TmsProviderId as a closed union.',
        'src/lib/tms/types.ts', 9,
        ARRAY['types', 'tms']
    ),
    (
        v_org_id, v_audit, 'code-reviewer', 'medium', 'open',
        'isManager() duplicated across 5+ API routes',
        'The same async isManager(email) helper is copy-pasted into tasks/route.ts, shorthand/terms/route.ts, ai-samples/recent/route.ts, ai-samples/route.ts, classify-batch/route.ts and probably more. A bug in one copy will not propagate fixes.',
        'Extract to src/lib/auth/is-manager.ts (or fold into the new src/lib/api-auth.ts as requireManager already does). Replace each duplicated copy with an import and delete the inlined version.',
        'src/app/api/tasks/route.ts', 60,
        ARRAY['dry', 'auth']
    ),
    (
        v_org_id, v_audit, 'code-reviewer', 'medium', 'open',
        'Adapter interface methods drop requestedBy attribution',
        'fetchShipment / listDocuments in the TMS adapter interface hardcode "service_role" instead of accepting the caller email. When called from a user-facing route, the audit log attributes the action to the system instead of the actual user.',
        'Add requestedBy: string (or staffId: number) to the adapter interface methods and thread the session email through from each route handler. Backfill the existing call sites.',
        'src/lib/tms/cargowise/cargo-visibility/client.ts', NULL,
        ARRAY['attribution', 'tms', 'observability']
    ),
    (
        v_org_id, v_audit, 'code-reviewer', 'medium', 'open',
        'import-unlocode.ts duplicates 165 lines of import-utils',
        'scripts/import-unlocode.ts (485 lines) re-implements the same CSV parsing / batching / progress reporting that lives in scripts/_lib/import-utils.ts. Maintenance liability.',
        'Refactor import-unlocode.ts to import from scripts/_lib/import-utils.ts. Delete the duplicate code blocks.',
        'scripts/import-unlocode.ts', NULL,
        ARRAY['dry', 'scripts']
    ),
    (
        v_org_id, v_audit, 'code-reviewer', 'medium', 'open',
        'Webhook callback URL derived from req.url instead of NEXT_PUBLIC_APP_URL',
        'Subscription registration uses req.url to compute the callback URL. If the request hits via a non-canonical hostname (e.g. preview deploy), the webhook subscribes the wrong URL.',
        'Read NEXT_PUBLIC_APP_URL at startup and use it for all webhook callback derivations. Throw at startup if missing in production.',
        'src/app/api/dev/cargowise-subscribe/route.ts', NULL,
        ARRAY['webhook', 'config']
    ),
    -- ============ LOW ============
    (
        v_org_id, v_audit, 'typescript-reviewer', 'low', 'open',
        'Typed Set narrowing missing in cargowise-subscribe',
        'cargowise-subscribe/route.ts casts validated strings via `as` because Set.has() does not narrow generic Set<string> to a literal union. Use a typed Set or a typed guard helper.',
        'Either Set<TmsSubscriptionRequest["tmsRefType"]>([...]) or extract a guard function: function isTmsRefType(s: string): s is TmsRefType { return REF_TYPES.includes(s as TmsRefType); }',
        'src/app/api/dev/cargowise-subscribe/route.ts', NULL,
        ARRAY['types']
    ),
    (
        v_org_id, v_audit, 'code-reviewer', 'low', 'open',
        'Stale eAdaptor placeholder comment in TMS index',
        'src/lib/tms/cargowise/index.ts:6-7 contains "eAdaptor placeholder, to be added" - eAdaptor IS now wired in (commit 4aa0a2c). Comment is misleading.',
        'Delete the placeholder comment.',
        'src/lib/tms/cargowise/index.ts', 6,
        ARRAY['cleanup']
    ),
    (
        v_org_id, v_audit, 'code-reviewer', 'low', 'open',
        'void cargowiseAdapter unused-import workaround',
        'cargowise-fetch-shipment/route.ts uses void cargowiseAdapter to silence the unused-import lint instead of underscore-prefixing or removing.',
        'Either remove the import if genuinely unused, or rename the destructured param with the _ prefix convention used elsewhere.',
        'src/app/api/dev/cargowise-fetch-shipment/route.ts', NULL,
        ARRAY['lint', 'cleanup']
    ),
    (
        v_org_id, v_audit, 'security-reviewer', 'low', 'open',
        'No size cap on /api/shorthand/terms metadata field',
        'The metadata JSONB column accepts arbitrary JSON of arbitrary size. Authenticated user could insert a multi-MB JSONB row.',
        'Cap JSON.stringify(metadata).length at 4096 chars in the route handler. Reject oversized payloads with 413.',
        'src/app/api/shorthand/terms/route.ts', NULL,
        ARRAY['input-validation']
    ),
    (
        v_org_id, v_audit, 'security-reviewer', 'low', 'open',
        'TmsAuthError messages may leak inner library detail',
        'TmsAuthError forwards the raw error message from the underlying jose / openid-client library. Some of these messages embed key format hints that are useful to an attacker.',
        'Sanitise the message to a stable taxonomy ("token_signature_invalid", "token_expired", etc.) before storing or returning.',
        'src/lib/tms/cargowise/edaptor/auth.ts', NULL,
        ARRAY['error-leak']
    ),
    (
        v_org_id, v_audit, 'database-reviewer', 'low', 'open',
        'Carrier-lookup data: EMCU and ESLU both resolve to Emirates Shipping Line',
        'Two distinct SCAC codes mapping to the same carrier name suggests stale or wrong reference data. Manual research needed - one of these likely belongs to a different carrier.',
        'Cross-check against the official SCAC registry (NMFTA) or Cargowise carrier dictionary. Update geo.carriers.',
        'supabase/migrations/034_aviation_carriers.sql', NULL,
        ARRAY['data-quality']
    ),
    (
        v_org_id, v_audit, 'database-reviewer', 'low', 'open',
        'Missing lower-name index on geo.locations',
        'geo.locations.name_no_diacritics could benefit from a functional index on lower(name_no_diacritics) if any fuzzy search hits this column with ILIKE.',
        'Add CREATE INDEX IF NOT EXISTS idx_geo_locations_name_lower ON geo.locations (lower(name_no_diacritics)) IF the search functions actually use it. Check pg_stat_user_indexes after a week to verify hit rate.',
        'supabase/migrations/031_geo_locations.sql', NULL,
        ARRAY['perf', 'index']
    ),
    (
        v_org_id, v_audit, 'code-reviewer', 'low', 'open',
        'Unit tests missing for pure helpers',
        'inferCarrierFromMbol, inferCarrierFromMawb, computeX5t, JWT cache eviction are pure functions with no test coverage. Easy regression vectors.',
        'Add unit tests under tests/lib/ covering happy path + edge cases. Aim for 80% line coverage on these helpers specifically.',
        'src/lib/tms/cargowise/', NULL,
        ARRAY['tests']
    ),
    (
        v_org_id, v_audit, 'code-reviewer', 'low', 'open',
        'quote-preview/page.tsx will need to split when wired to /quotes/[id]',
        '742 lines as a static mock, growing fast. When this becomes the real route, extract subcomponents (RecommendationCard, GridView, EmailDraftPanel).',
        'Track for the moment when /quotes/[id] is built - extract before adding more features.',
        'src/app/dev/quote-preview/page.tsx', NULL,
        ARRAY['refactor']
    );

    RAISE NOTICE 'Seeded % findings for audit %', 16, v_audit;
END $$;
