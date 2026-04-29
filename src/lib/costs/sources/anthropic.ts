/**
 * Anthropic API usage fetcher.
 *
 * Anthropic does not currently expose a stable per-API-key usage endpoint
 * (the org-level usage report at /v1/organizations/{id}/usage_report
 * requires admin scope and the org_id, neither of which we have via the
 * standard ANTHROPIC_API_KEY). For v1 we surface a clear "needs admin
 * key" message and fall back to manual monthly entry from the Anthropic
 * console.
 *
 * When the admin key + org_id are configured (ANTHROPIC_ADMIN_KEY +
 * ANTHROPIC_ORG_ID), we'll fetch the per-day token usage and convert
 * to USD via Anthropic's published per-model pricing.
 */

import type { CostSource } from "@/lib/costs/types";
import type { FetchResult } from "@/lib/costs/sources/vercel";

export async function fetchAnthropicUsage(_source: CostSource): Promise<FetchResult> {
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY;
  const orgId = process.env.ANTHROPIC_ORG_ID;

  if (!adminKey || !orgId) {
    return {
      ok: false,
      inserted: 0,
      updated: 0,
      errors: ["ANTHROPIC_ADMIN_KEY / ANTHROPIC_ORG_ID not set"],
      notes: "Live Anthropic usage requires an admin-scope API key + org id (different from the API key the dashboard uses). Until configured, paste monthly totals from console.anthropic.com manually via /dev/costs > Usage > Anthropic API > Add entry.",
    };
  }

  // Real implementation when admin key arrives:
  //   GET https://api.anthropic.com/v1/organizations/{orgId}/usage_report
  //   ?ending_at=YYYY-MM-DD&starting_at=YYYY-MM-DD
  //   Authorization: Bearer ${adminKey}
  // Response includes per-day per-model token counts; multiply by current
  // pricing table to get USD. Insert one cost_entry per day.

  return {
    ok: false,
    inserted: 0,
    updated: 0,
    errors: ["Anthropic live fetch wiring is stubbed pending admin key. Manual entry available."],
  };
}
