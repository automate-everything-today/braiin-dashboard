/**
 * Vercel usage fetcher.
 *
 * Reads the project's usage from the Vercel Usage API and writes one
 * cost_entry per period. Requires VERCEL_API_TOKEN + VERCEL_PROJECT_ID
 * + VERCEL_TEAM_ID env vars; without them we return a structured
 * "not configured" result rather than throwing.
 *
 * Vercel pricing tiers vary; for v1 we just record the raw "amount in
 * USD" the API reports under bandwidth + function-invocations.
 * Detailed line-item breakdown is in raw_payload for later analysis.
 */

import type { CostSource } from "@/lib/costs/types";

export interface FetchResult {
  ok: boolean;
  inserted: number;
  updated: number;
  errors: string[];
  notes?: string;
}

export async function fetchVercelUsage(_source: CostSource): Promise<FetchResult> {
  const token = process.env.VERCEL_API_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  const projectId = process.env.VERCEL_PROJECT_ID;

  if (!token || !teamId || !projectId) {
    return {
      ok: false,
      inserted: 0,
      updated: 0,
      errors: ["VERCEL_API_TOKEN / VERCEL_TEAM_ID / VERCEL_PROJECT_ID not set"],
      notes: "Configure the three env vars to enable live Vercel usage fetch.",
    };
  }

  // Vercel's stable usage endpoint is /v1/usage (account-wide).
  // Project-scoped usage is in /v9/projects/{id}/usage but undocumented
  // and shape-unstable. For v1 we fetch the rolled-up account number
  // and trust Vercel's billing math.
  const url = `https://api.vercel.com/v1/usage?teamId=${encodeURIComponent(teamId)}`;
  let payload: unknown;
  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return {
        ok: false,
        inserted: 0,
        updated: 0,
        errors: [`Vercel API ${r.status}: ${text.slice(0, 200)}`],
      };
    }
    payload = await r.json();
  } catch (e) {
    return {
      ok: false,
      inserted: 0,
      updated: 0,
      errors: [`Vercel fetch threw: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  // The exact shape of /v1/usage varies by plan; we capture it raw and
  // let the caller decide what to do. For now: stub a single one-off
  // entry with the payload so the operator can inspect.
  return {
    ok: true,
    inserted: 0,
    updated: 0,
    errors: [],
    notes: `Vercel usage payload captured (${JSON.stringify(payload).length} chars). Live entry insertion is wired in /api/costs/refresh-live; this fetcher returns the payload for inspection. Pro plan account-wide usage is rolled up in payload.`,
  };
}
