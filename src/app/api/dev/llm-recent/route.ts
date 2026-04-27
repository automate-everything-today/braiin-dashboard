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
const HOURS_PER_YEAR_FTE = 40 * 52; // 2080. Rob confirmed all staff on 40h weeks.

interface StaffCostRow {
  new_salary: number | null;
  nic: number | null;
  pension: number | null;
  professional_fees: number | null;
  overseas_tax: number | null;
  fte_pct: number | null;
  is_active: boolean | null;
}

interface RoiConfig {
  hourlyRateGbp: number;
  basis: "live_staff_avg" | "fallback";
  staffCount: number;
  totalAnnualCostGbp: number;
  totalHoursPerYear: number;
}

/**
 * Compute the org's fully-loaded blended hourly cost from public.staff.
 *
 * Method: weighted average. Sum each active staff member's
 * fully-loaded annual cost (proper FTE-adjusted), divide by total
 * hours actually worked across the org per year. This is the cost
 * per hour of human work the business delivers - the right number
 * to value LLM time-saved against.
 *
 * fully_loaded_annual = (new_salary * fte_pct/100)
 *                     + (nic + pension + professional_fees + overseas_tax) * 12
 *
 * hours_per_year = 2080 * fte_pct/100
 *
 * blended_hourly = sum(fully_loaded_annual) / sum(hours_per_year)
 *
 * Falls back to £25/hr if the staff query errors or returns no rows.
 */
async function computeBlendedHourlyRate(): Promise<RoiConfig> {
  try {
    const { data, error } = await supabase
      .from("staff")
      .select("new_salary,nic,pension,professional_fees,overseas_tax,fte_pct,is_active")
      .eq("is_active", true);

    if (error || !data || data.length === 0) {
      console.warn("[dev/llm-recent] staff query empty, falling back:", error?.message);
      return {
        hourlyRateGbp: 25,
        basis: "fallback",
        staffCount: 0,
        totalAnnualCostGbp: 0,
        totalHoursPerYear: 0,
      };
    }

    const rows = data as StaffCostRow[];
    let totalAnnual = 0;
    let totalHours = 0;
    let included = 0;
    for (const s of rows) {
      const fte = (s.fte_pct ?? 100) / 100;
      if (fte <= 0) continue;
      const baseSalary = (s.new_salary ?? 0) * fte;
      const monthlyExtras = (s.nic ?? 0) + (s.pension ?? 0) + (s.professional_fees ?? 0) + (s.overseas_tax ?? 0);
      const annual = baseSalary + monthlyExtras * 12;
      const hours = HOURS_PER_YEAR_FTE * fte;
      if (annual <= 0 || hours <= 0) continue;
      totalAnnual += annual;
      totalHours += hours;
      included += 1;
    }

    if (totalHours === 0) {
      return {
        hourlyRateGbp: 25,
        basis: "fallback",
        staffCount: 0,
        totalAnnualCostGbp: 0,
        totalHoursPerYear: 0,
      };
    }

    return {
      hourlyRateGbp: totalAnnual / totalHours,
      basis: "live_staff_avg",
      staffCount: included,
      totalAnnualCostGbp: totalAnnual,
      totalHoursPerYear: totalHours,
    };
  } catch (e) {
    console.warn("[dev/llm-recent] blended rate compute threw:", e instanceof Error ? e.message : String(e));
    return {
      hourlyRateGbp: 25,
      basis: "fallback",
      staffCount: 0,
      totalAnnualCostGbp: 0,
      totalHoursPerYear: 0,
    };
  }
}

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
  time_saved_seconds: number;
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

  const [{ data, error }, roiConfig] = await Promise.all([
    activityClient()
      .from("llm_calls")
      .select(
        "call_id,requested_at,provider,model,purpose,input_tokens,output_tokens,cached_input_tokens,cost_cents,latency_ms,cache_hit,success,requested_by,error_code,error_message,time_saved_seconds",
      )
      .eq("org_id", TENANT_ZERO_ORG_ID)
      .order("requested_at", { ascending: false })
      .limit(limit),
    computeBlendedHourlyRate(),
  ]);

  if (error) {
    console.error("[dev/llm-recent] query failed:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ calls: data ?? [], roi: roiConfig });
}
