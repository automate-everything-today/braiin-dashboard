/**
 * Supabase Management API "fetcher" - mostly a confirmation step.
 *
 * As of 2026-04-29 the Supabase Management API exposes:
 *   - /v1/organizations          (list orgs)
 *   - /v1/projects               (list projects)
 *   - /v1/projects/{ref}         (project details: region, status, db host)
 *   - /v1/projects/{ref}/api-keys (rotate keys)
 *   - ... and other project-management endpoints
 *
 * It does NOT expose billing/usage data. The endpoints
 *   /v1/projects/{ref}/usage
 *   /v1/organizations/{slug}/usage
 *   /v1/organizations/{slug}/billing/subscription
 * all return 404. Usage data is dashboard-only at the moment.
 *
 * So Supabase costs are manual entry, same as Anthropic. This fetcher:
 *   1. Pings /v1/projects/{ref} to confirm the token + ref are valid
 *      (so the operator gets a fast green light if they rotate)
 *   2. Returns a clear message asking for manual close-month entry
 *
 * If/when Supabase ships a usage endpoint, swap in the real fetch +
 * cost_entry insert and remove the manual-entry note.
 */

import type { CostSource } from "@/lib/costs/types";
import type { FetchResult } from "@/lib/costs/sources/vercel";

export async function fetchSupabaseUsage(_source: CostSource): Promise<FetchResult> {
  const token = process.env.SUPABASE_MANAGEMENT_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) {
    return {
      ok: false,
      inserted: 0,
      updated: 0,
      errors: ["SUPABASE_MANAGEMENT_TOKEN / SUPABASE_PROJECT_REF not set"],
      notes: "Set both env vars; even though usage isn't exposed yet, the token is needed for the validity check.",
    };
  }

  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return {
        ok: false,
        inserted: 0,
        updated: 0,
        errors: [`Supabase Management API ${r.status}: ${text.slice(0, 200)}`],
      };
    }
    const proj = (await r.json()) as { name?: string; region?: string; status?: string };
    return {
      ok: true,
      inserted: 0,
      updated: 0,
      errors: [],
      notes: `Token + project ref verified (${proj.name ?? ref}, ${proj.region ?? "?"}, ${proj.status ?? "?"}). Supabase Management API does not currently expose usage/billing data - use Close month modal to enter monthly figure from supabase.com dashboard.`,
    };
  } catch (e) {
    return {
      ok: false,
      inserted: 0,
      updated: 0,
      errors: [`Supabase fetch threw: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
}
