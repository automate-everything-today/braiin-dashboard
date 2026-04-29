-- 047_seed_remaining_findings.sql
--
-- Second pass over the 2026-04-29 audit reports. After 046 seeded the
-- 8 most material remaining items, this migration sweeps in every other
-- finding from the security-reviewer, typescript-reviewer, and
-- code-reviewer reports that was not fixed in the same session - so the
-- /dev/security tracker shows the COMPLETE outstanding punch list, not
-- just the headline items.
--
-- Idempotent: skips if any finding from this audit run already exists
-- under the v_audit identifier below.
--
-- Manual: apply once after 046.

DO $$
DECLARE
    v_org_id UUID;
    v_audit  TEXT := '2026-04-29-post-build-pass-2';
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
        v_org_id, v_audit, 'security-reviewer', 'high', 'open',
        'NEXT_PUBLIC_DEFAULT_ORG_ID env var still readable by the helper',
        'getOrgId() throws on missing env (good) but still accepts NEXT_PUBLIC_DEFAULT_ORG_ID as a fallback. NEXT_PUBLIC_ vars are bundled into the client JS. Org ID is not strictly secret but the naming convention signals intent to expose to clients, and we never want callers to be able to derive the active org without a server round-trip.',
        'In src/lib/org.ts drop the NEXT_PUBLIC_DEFAULT_ORG_ID fallback - require DEFAULT_ORG_ID only. Document the change in .env.example. Audit any client-side reads of NEXT_PUBLIC_DEFAULT_ORG_ID and remove them.',
        'src/lib/org.ts', 17,
        ARRAY['env', 'config']
    ),
    (
        v_org_id, v_audit, 'security-reviewer', 'high', 'open',
        'Rate limiter not wired into new endpoints',
        'src/lib/rate-limit.ts now logs hits to security_events (just added) but none of the six new API routes actually CALL checkRateLimit. The upload route in particular needs it - a single authenticated session can spam the storage bucket up to its 10 MB cap repeatedly with no throttle.',
        'Wire checkRateLimit into the upload route (per-IP or per-session, e.g. 20 uploads / 10 min) and the change-requests POST handler (e.g. 30 / hour). Also wire it into the security PATCH so finding mutations are bounded.',
        'src/lib/rate-limit.ts', 15,
        ARRAY['rate-limit', 'upload', 'change-requests']
    ),
    -- ============ MEDIUM ============
    (
        v_org_id, v_audit, 'code-reviewer', 'medium', 'open',
        'Pre-existing silent .catch swallows in /email page',
        'Two .catch(() => {}) calls in src/app/email/page.tsx (lines 725, 1383) predate the audit and were left out of the post-build sweep because they sit outside the change scope. Same fail-loud rule applies - the AI-feedback POST and the other affected fetch should surface their errors via setError or a toast, not pretend they succeeded.',
        'Replace both .catch(() => {}) blocks with surfaced errors. Match the pattern used in /dev/charge-codes and /dev/margins.',
        'src/app/email/page.tsx', 725,
        ARRAY['fail-loud', 'email']
    ),
    (
        v_org_id, v_audit, 'typescript-reviewer', 'medium', 'open',
        'const inside bare switch case in margins page',
        'case "currency_conditional": const r = ... breaks strict-mode linting and shares scope with the whole switch. Wrap in braces.',
        'Wrap the case body in braces: case "currency_conditional": { const r = rule.currencyRates?.[t.costCurrency] ?? 0; sell = t.costAmount + r; break; }',
        'src/app/dev/margins/page.tsx', 1357,
        ARRAY['code-quality', 'margins']
    ),
    (
        v_org_id, v_audit, 'code-reviewer', 'medium', 'open',
        'PATCH vs POST verb inconsistency across new APIs',
        'charge-codes POST handles single upsert and PATCH handles bulk; margin-rules POST also handles single upsert and PATCH bulk. Within each route the convention is consistent, but the dashboard has no shared rule that says "POST = single, PATCH = bulk". A future contributor will pick the wrong verb without that rule documented.',
        'Document the convention in a short docs/api-conventions.md and link it from each route handler comment, OR consolidate to POST handling both modes via a {mode: "single"|"bulk"} field. Document is lower-effort.',
        'src/app/api/charge-codes/route.ts', NULL,
        ARRAY['api-design', 'docs']
    ),
    -- ============ LOW ============
    (
        v_org_id, v_audit, 'typescript-reviewer', 'low', 'open',
        'CSV parser BOM stripping uses literal byte',
        'src/lib/csv.ts uses a literal U+FEFF in the regex which is invisible to readers. Replace with an explicit ﻿ escape for legibility.',
        'Change input.replace(/^﻿/, "") - functionally identical, source-readable.',
        'src/lib/csv.ts', 28,
        ARRAY['readability', 'csv']
    ),
    (
        v_org_id, v_audit, 'typescript-reviewer', 'low', 'open',
        'CSV parser does not handle mid-cell quote opening',
        'A field like unquoted "embedded" would cause the parser to flip into inQuotes mode at the wrong byte. No well-formed CSV producer emits this, but worth a unit test.',
        'Add a unit test in src/lib/csv.test.ts that asserts the parser either rejects this input or treats the entire cell as raw text. Decide which behaviour you want and document it.',
        'src/lib/csv.ts', NULL,
        ARRAY['edge-case', 'csv']
    ),
    (
        v_org_id, v_audit, 'security-reviewer', 'low', 'open',
        'Attachment img tags use raw <img> instead of next/image',
        'change-requests page and the widget render attachment previews with <img src={a.url} /> + an eslint-disable. Acceptable for user-uploaded content with unknown dimensions, but worth documenting the trade-off and noting we cannot use next/image because remote hosts must be configured in next.config.ts.',
        'If you ever switch to private signed URLs from a known supabase storage host, add that host to images.remotePatterns in next.config.ts and convert the <img> tags to next/image for performance.',
        'src/app/dev/change-requests/page.tsx', 376,
        ARRAY['perf', 'images']
    ),
    (
        v_org_id, v_audit, 'code-reviewer', 'low', 'open',
        'CHANGELOG.md historical entries still contain em-dashes in narrative text',
        'New entries comply with the hyphen-only rule; older paragraphs retain em-dashes from before the rule was codified. Cosmetic, but worth a sweep when next someone touches the CHANGELOG.',
        'Run the same em/en dash sweep over CHANGELOG.md as we did over src/. Single replace operation.',
        'CHANGELOG.md', NULL,
        ARRAY['docs', 'cleanup']
    ),
    (
        v_org_id, v_audit, 'security-reviewer', 'low', 'open',
        'Rate limiter still allows unidentified callers through',
        'checkRateLimit returns true (allows) for callers it cannot identify (bucket === "unknown"). Now that we log a security event on rate-limit hits, also log + throttle unidentified callers on mutation endpoints to make spoofing the IP harder.',
        'Either return false from checkRateLimit when bucket === "unknown" on mutation endpoints, or require getClientIp() to find a non-unknown source before any mutation handler runs.',
        'src/lib/rate-limit.ts', 20,
        ARRAY['rate-limit', 'spoofing']
    );

    RAISE NOTICE 'Seeded % findings for audit %', 10, v_audit;
END $$;
