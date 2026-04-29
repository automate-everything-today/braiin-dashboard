-- 046_seed_audit_findings.sql
--
-- Seed today's security audit findings into feedback.security_findings so
-- they appear in the /dev/security dashboard for tracking.
--
-- Items already fixed in the same session were intentionally NOT seeded -
-- only the items left as open work go in here.
--
-- Source audit: 2026-04-29 post-build review (security-reviewer +
-- typescript-reviewer + code-reviewer in parallel).
--
-- Manual: apply once. Re-running is idempotent because each finding has
-- ON CONFLICT (finding_id) DO NOTHING via uuid_generate_v4 + an explicit
-- title-based pre-check.

DO $$
DECLARE
    v_org_id UUID;
    v_audit  TEXT := '2026-04-29-post-build';
BEGIN
    SELECT id INTO v_org_id FROM core.organisations LIMIT 1;
    IF v_org_id IS NULL THEN
        RAISE NOTICE 'No org configured; skipping seed.';
        RETURN;
    END IF;

    -- Skip if any finding for this audit already exists (idempotency).
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
    (
        v_org_id, v_audit, 'security-reviewer', 'high', 'open',
        'TOCTOU race on append_comment and append_attachment',
        'PATCH /api/change-requests does fetch-then-update for both comment and attachment appends without a transaction. Concurrent writes between the SELECT and UPDATE will silently lose either the first or second append. Low probability at current scale but architecturally wrong; will bite when the change-request widget gets used by multiple staff at once.',
        'Replace the inline append with a Postgres function (e.g. feedback.append_change_request_comment) that does the array concatenation atomically inside one statement, or normalise comments to a child table feedback.change_request_comments.',
        'src/app/api/change-requests/route.ts', 85,
        ARRAY['concurrency', 'change-requests']
    ),
    (
        v_org_id, v_audit, 'security-reviewer', 'medium', 'open',
        'Public storage bucket serves attachments without auth',
        'change-request-attachments is configured public-read so any uploaded screenshot is permanently readable at a guessable URL. If a user pastes a confidential screenshot, it is exposed forever. The upload route allowlist now blocks SVG (XSS) but the public-read default itself is the underlying issue.',
        'Switch the bucket to private and use Supabase signed URLs with a TTL (e.g. 24h) when rendering attachments in /dev/change-requests. Update src/components/change-request-widget.tsx and src/app/dev/change-requests/page.tsx to fetch a signed URL instead of using the publicUrl directly.',
        'supabase/migrations/041_change_requests.sql', 11,
        ARRAY['storage', 'change-requests']
    ),
    (
        v_org_id, v_audit, 'typescript-reviewer', 'medium', 'open',
        'margins/page.tsx is 1,440 lines with calculator logic duplicated from DB',
        'The page hosts MarginRule types, the seed RULES constant, the test calculator (which duplicates the DB-side margin precedence logic), MarginRuleEditPanel, and CsvParsing/UploadPreviewPanel. Real coupling problem - two implementations of the precedence calculation will drift.',
        'Extract margin-rule-types.ts (types + constants), margin-rule-calculator.ts (evaluateRule, rulePriority, fmtMarkup), MarginRuleEditPanel into its own file, TestCalculatorPanel into its own file, and a margin-csv-utils module. Page becomes ~200 lines of orchestration.',
        'src/app/dev/margins/page.tsx', NULL,
        ARRAY['refactor', 'maintainability']
    ),
    (
        v_org_id, v_audit, 'security-reviewer', 'medium', 'open',
        'No CSP header restricting img-src for attachment previews',
        'change-requests page renders attachment images via <img src={a.url} />. With the public-read bucket and the storage URL pattern, an attacker who managed to inject an attachment URL (via a different vector) could point img-src at a tracking pixel that runs from the user browser. Defence-in-depth - add a Content-Security-Policy header restricting img-src to self + the supabase storage host.',
        'Add a CSP header in next.config.ts (or middleware) restricting img-src to self plus the supabase project storage origin. Combine with the storage bucket privatisation above.',
        'src/app/dev/change-requests/page.tsx', 376,
        ARRAY['csp', 'storage']
    ),
    (
        v_org_id, v_audit, 'security-reviewer', 'medium', 'open',
        'Migrations 037-045 use service-role grants only, no RLS policies',
        'Every new table has REVOKE FROM PUBLIC + GRANT TO service_role. Correct for the current single-tenant API-routes-only architecture, but means there is zero RLS backstop if the anon key is ever accidentally used server-side. Document the trade-off and add a startup assertion that prevents the anon key from being used in route handlers.',
        'Add RLS policies on every new table (feedback.change_requests, feedback.build_log, feedback.roadmap_nodes, feedback.security_events, feedback.security_findings, quotes.charge_codes, quotes.margin_rules, partners.*) even if they only allow service_role. Belt-and-braces in case the anon key gets injected by mistake.',
        'supabase/migrations/', NULL,
        ARRAY['rls', 'database']
    ),
    (
        v_org_id, v_audit, 'security-reviewer', 'low', 'open',
        'DEFAULT_ORG_ID not documented in .env.example',
        'getOrgId() now throws at startup if DEFAULT_ORG_ID is missing (good), but new contributors cloning the repo will hit that error with no guidance on what value to set. Document the env var.',
        'Add DEFAULT_ORG_ID to .env.example with a comment pointing to the Settings -> API page in Supabase that surfaces the org ID.',
        '.env.example', NULL,
        ARRAY['docs', 'config']
    ),
    (
        v_org_id, v_audit, 'code-reviewer', 'low', 'open',
        'Duplicate orphan comment banners in charge-codes page',
        'src/app/dev/charge-codes/page.tsx has two consecutive section banners (// Page and // Edit / add slide-in) at lines 117-123 and again at 440-446. The "// Page" banner does not actually mark the page component (which starts at line 784).',
        'Delete the orphan banners or move them to where they belong.',
        'src/app/dev/charge-codes/page.tsx', 117,
        ARRAY['cleanup']
    ),
    (
        v_org_id, v_audit, 'security-reviewer', 'low', 'open',
        'Proxy-level auth failures not logged to security_events',
        'Next.js middleware (src/proxy.ts) runs on the edge runtime where the supabase JS client is not available, so the security event logger cannot run from there. Auth failures at the proxy layer (no cookie / invalid JWT / expired) get a console.warn but never land in feedback.security_events, so the dashboard cannot count them.',
        'Add /api/security/proxy-event allowlisted in the proxy itself, validated by an HMAC of (timestamp + event_type) using a PROXY_LOG_SECRET env var. Have proxy.ts fire-and-forget POST to it on each 401. Alternatively, switch proxy.ts to nodejs runtime if the cold-start cost is acceptable.',
        'src/proxy.ts', 28,
        ARRAY['observability', 'middleware']
    );

    RAISE NOTICE 'Seeded % findings for audit %', 8, v_audit;
END $$;
