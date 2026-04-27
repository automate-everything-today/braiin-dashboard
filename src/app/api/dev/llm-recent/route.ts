/**
 * Dev telemetry feed for the LLM gateway.
 *
 * GET /api/dev/llm-recent?limit=200
 *
 * Returns the last N rows from activity.llm_calls for the current
 * tenant, ordered requested_at DESC. The /dev/llm page aggregates
 * client-side: total spend, per-purpose / per-model breakdown,
 * cache hit rate, failures.
 *
 * Auth: cookie session (proxy.ts gates /api/* with the global
 * session middleware). Service-role on the schema query because
 * activity.* is service-role-only.
 */

import { supabase } from "@/services/base";

const TENANT_ZERO_ORG_ID = "00000000-0000-0000-0000-000000000001";

interface LlmCallRow {
  call_id: string;
  requested_at: string;
  provider: string;
  model: string;
  purpose: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cost_cents: number | null;
  latency_ms: number | null;
  cache_hit: boolean;
  success: boolean;
  requested_by: string;
  error_code: string | null;
  error_message: string | null;
}

interface ActivityClient {
  from(table: string): {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        order: (col: string, opts: { ascending: boolean }) => {
          limit: (n: number) => Promise<{ data: LlmCallRow[] | null; error: { message: string } | null }>;
        };
      };
    };
  };
}

function activityClient(): ActivityClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).schema("activity") as ActivityClient;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit") ?? 200);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 200, 1), 1000);

  const { data, error } = await activityClient()
    .from("llm_calls")
    .select(
      "call_id,requested_at,provider,model,purpose,input_tokens,output_tokens,cached_input_tokens,cost_cents,latency_ms,cache_hit,success,requested_by,error_code,error_message",
    )
    .eq("org_id", TENANT_ZERO_ORG_ID)
    .order("requested_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[dev/llm-recent] query failed:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ calls: data ?? [] });
}
