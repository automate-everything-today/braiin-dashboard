// Trigger live-data fetch for every api-provenance cost source.
//
// Iterates active sources where provenance = 'api' and calls the matching
// fetcher. Returns a per-source result map so the dashboard can show
// which sources updated, which need configuration, and which errored.

import { supabase } from "@/services/base";
import { requireSuperAdmin } from "@/lib/api-auth";
import { getOrgId } from "@/lib/org";
import { fetchAnthropicUsage } from "@/lib/costs/sources/anthropic";
import { fetchVercelUsage } from "@/lib/costs/sources/vercel";
import type { CostSource } from "@/lib/costs/types";
import type { FetchResult } from "@/lib/costs/sources/vercel";

const ROUTE = "/api/costs/refresh-live";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

const FETCHERS: Record<string, (s: CostSource) => Promise<FetchResult>> = {
  anthropic: fetchAnthropicUsage,
  vercel: fetchVercelUsage,
};

export async function POST() {
  const auth = await requireSuperAdmin(ROUTE);
  if (!auth.ok) return auth.response;

  const { data, error } = await db
    .schema("feedback")
    .from("cost_sources")
    .select("*")
    .eq("org_id", getOrgId())
    .eq("provenance", "api")
    .eq("is_active", true);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const sources = (data ?? []) as CostSource[];
  const results: Array<{ source_id: string; name: string; vendor: string; result: FetchResult }> = [];

  for (const source of sources) {
    const fetcher = FETCHERS[source.vendor];
    if (!fetcher) {
      results.push({
        source_id: source.source_id,
        name: source.name,
        vendor: source.vendor,
        result: {
          ok: false,
          inserted: 0,
          updated: 0,
          errors: [`No fetcher registered for vendor "${source.vendor}"`],
        },
      });
      continue;
    }
    try {
      const result = await fetcher(source);
      results.push({ source_id: source.source_id, name: source.name, vendor: source.vendor, result });
    } catch (e) {
      results.push({
        source_id: source.source_id,
        name: source.name,
        vendor: source.vendor,
        result: {
          ok: false,
          inserted: 0,
          updated: 0,
          errors: [e instanceof Error ? e.message : String(e)],
        },
      });
    }
  }

  return Response.json({ results, refreshed_at: new Date().toISOString() });
}
