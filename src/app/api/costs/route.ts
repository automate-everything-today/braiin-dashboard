// Cost dashboard backend - aggregated read + manual entry write.
//
// GET returns everything the page needs in one round-trip:
//   - sources, entries (date-range filtered), work_sessions, scenarios
//   - computed counterfactual results across all active scenarios
//   - top-line project metrics for the methodology footer
//
// POST creates a manual cost entry (one-off or period). FX conversion
// happens server-side via geo.convert_amount.

import { z } from "zod";
import { supabase } from "@/services/base";
import { requireSuperAdmin } from "@/lib/api-auth";
import { getOrgId } from "@/lib/org";
import { convertToGbp } from "@/lib/costs/fx";
import { aggregateBySource, calendarDaysOfWork } from "@/lib/costs/aggregations";
import { calculateCounterfactual } from "@/lib/costs/counterfactual";
import type {
  CostEntry,
  CostSource,
  CounterfactualScenario,
  WorkSession,
} from "@/lib/costs/types";

const ROUTE = "/api/costs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

const entrySchema = z.object({
  source_id: z.string().uuid(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_type: z.enum(["daily", "weekly", "monthly", "annual", "one-off"]).default("monthly"),
  amount: z.number().min(0).max(10_000_000),
  currency: z.string().min(3).max(3).default("GBP"),
  description: z.string().max(2000).optional().nullable(),
});

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(ROUTE);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const fromDate = url.searchParams.get("from") ?? null;
  const toDate = url.searchParams.get("to") ?? null;
  const orgId = getOrgId();

  let entriesQuery = db
    .schema("feedback")
    .from("cost_entries")
    .select("*")
    .eq("org_id", orgId)
    .order("period_start", { ascending: false });
  if (fromDate) entriesQuery = entriesQuery.gte("period_start", fromDate);
  if (toDate) entriesQuery = entriesQuery.lte("period_end", toDate);

  const [sourcesRes, entriesRes, sessionsRes, scenariosRes] = await Promise.all([
    db.schema("feedback").from("cost_sources").select("*").eq("org_id", orgId).order("category"),
    entriesQuery,
    db.schema("feedback").from("work_sessions").select("*").eq("org_id", orgId).order("started_at", { ascending: false }),
    db.schema("feedback").from("counterfactual_scenarios").select("*").eq("org_id", orgId).eq("is_active", true).order("name"),
  ]);

  const sources = (sourcesRes.data ?? []) as CostSource[];
  const entries = (entriesRes.data ?? []) as CostEntry[];
  const sessions = (sessionsRes.data ?? []) as WorkSession[];
  const scenarios = (scenariosRes.data ?? []) as CounterfactualScenario[];

  // Aggregations
  const usageBySource = aggregateBySource(entries, sources, "usage");
  const buildBySource = aggregateBySource(entries, sources, "build");
  const totalUsageGbp = usageBySource.reduce((s, r) => s + r.total_gbp_attributed, 0);
  const totalBuildGbp = buildBySource.reduce((s, r) => s + r.total_gbp_attributed, 0);
  const totalActualGbp = totalUsageGbp + totalBuildGbp;

  // Calendar days
  const today = new Date().toISOString().slice(0, 10);
  const inception = "2026-04-11"; // first commit; surface as constant
  const days = calendarDaysOfWork(sessions, inception, today);

  // Counterfactual across all active scenarios
  const counterfactuals = scenarios.map((s) =>
    calculateCounterfactual(s, {
      actual_cost_gbp: totalActualGbp,
      actual_calendar_days: days.actual,
    }),
  );

  return Response.json({
    sources,
    entries,
    sessions,
    scenarios,
    aggregations: {
      usage_by_source: usageBySource,
      build_by_source: buildBySource,
      total_usage_gbp: totalUsageGbp,
      total_build_gbp: totalBuildGbp,
      total_actual_gbp: totalActualGbp,
    },
    project: {
      inception_date: inception,
      end_date: today,
      calendar_days: days.actual,
    },
    counterfactuals,
    fetched_at: new Date().toISOString(),
  });
}

export async function POST(req: Request) {
  const auth = await requireSuperAdmin(ROUTE);
  if (!auth.ok) return auth.response;

  const parsed = entrySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;
  const fx = await convertToGbp(body.amount, body.currency, body.period_start);

  const { data, error } = await db
    .schema("feedback")
    .from("cost_entries")
    .upsert(
      {
        org_id: getOrgId(),
        source_id: body.source_id,
        period_start: body.period_start,
        period_end: body.period_end,
        period_type: body.period_type,
        amount: body.amount,
        currency: body.currency,
        amount_gbp: fx.amount_gbp,
        fx_rate_used: fx.rate,
        fx_rate_date: fx.rate_date,
        description: body.description ?? null,
        fetched_at: new Date().toISOString(),
        fetched_by_email: auth.session.email,
      },
      { onConflict: "source_id,period_start,period_end,period_type" },
    )
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ entry: data });
}

const deleteSchema = z.object({ entry_id: z.string().uuid() });

export async function DELETE(req: Request) {
  const auth = await requireSuperAdmin(ROUTE);
  if (!auth.ok) return auth.response;

  const parsed = deleteSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "entry_id required" }, { status: 400 });
  }
  const { error } = await db
    .schema("feedback")
    .from("cost_entries")
    .delete()
    .eq("entry_id", parsed.data.entry_id)
    .eq("org_id", getOrgId());
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
