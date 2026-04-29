// Monthly close cron - runs at 09:00 UTC on the 1st of every month.
//
// Two jobs:
//   1. Auto-create cost entries for the PRIOR MONTH for every cost_source
//      that has a recurring_monthly value set (Claude MAX, Cursor, MS 365,
//      domains, anything with a flat monthly figure). Idempotent on
//      (source_id, period_start, period_end, period_type).
//   2. Create one task per org in public.tasks reminding the operator
//      to close out variable-cost manual sources via /dev/costs.
//
// Auth: shared CRON_SECRET in the Authorization Bearer header (matches
// the pattern used by /api/cron/enrich and other cron routes).

import { supabase } from "@/services/base";
import { convertToGbp } from "@/lib/costs/fx";
import type { CostSource } from "@/lib/costs/types";

const ROUTE = "/api/cron/close-month-recurring";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

function priorMonthRange(): { period_start: string; period_end: string; label: string } {
  const now = new Date();
  const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const firstOfPriorMonth = new Date(firstOfThisMonth);
  firstOfPriorMonth.setUTCMonth(firstOfThisMonth.getUTCMonth() - 1);
  const lastOfPriorMonth = new Date(firstOfThisMonth);
  lastOfPriorMonth.setUTCDate(0);
  return {
    period_start: firstOfPriorMonth.toISOString().slice(0, 10),
    period_end: lastOfPriorMonth.toISOString().slice(0, 10),
    label: firstOfPriorMonth.toISOString().slice(0, 7),
  };
}

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error(`[${ROUTE}] CRON_SECRET not set`);
    return Response.json({ error: "Server misconfigured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const range = priorMonthRange();
  const results: Array<{ org_id: string; recurring_inserted: number; manual_remaining: number; task_id?: number }> = [];

  // Iterate all orgs that have any cost_sources at all (multi-tenant safe).
  const { data: orgRows, error: orgErr } = await db
    .schema("feedback")
    .from("cost_sources")
    .select("org_id")
    .eq("is_active", true);
  if (orgErr) return Response.json({ error: orgErr.message }, { status: 500 });

  const orgIds = Array.from(new Set(((orgRows ?? []) as Array<{ org_id: string }>).map((r) => r.org_id)));

  for (const orgId of orgIds) {
    const { data: sources } = await db
      .schema("feedback")
      .from("cost_sources")
      .select("*")
      .eq("org_id", orgId)
      .eq("is_active", true);

    const allSources = (sources ?? []) as CostSource[];
    const recurring = allSources.filter((s) => s.recurring_monthly != null && s.recurring_monthly > 0);
    const manualVariable = allSources.filter(
      (s) => s.provenance === "manual" && (s.recurring_monthly == null || s.recurring_monthly === 0),
    );

    let inserted = 0;
    for (const src of recurring) {
      const fx = await convertToGbp(src.recurring_monthly!, src.default_currency, range.period_start);
      const { error } = await db
        .schema("feedback")
        .from("cost_entries")
        .upsert(
          {
            org_id: orgId,
            source_id: src.source_id,
            period_start: range.period_start,
            period_end: range.period_end,
            period_type: "monthly",
            amount: src.recurring_monthly,
            currency: src.default_currency,
            amount_gbp: fx.amount_gbp,
            fx_rate_used: fx.rate,
            fx_rate_date: fx.rate_date,
            description: `Auto-created monthly recurring for ${range.label}`,
            fetched_at: new Date().toISOString(),
            fetched_by_email: "cron@close-month-recurring",
          },
          { onConflict: "source_id,period_start,period_end,period_type" },
        );
      if (!error) inserted += 1;
    }

    // Find the org's primary admin to assign the task to.
    const { data: admin } = await supabase
      .from("staff")
      .select("email")
      .eq("access_role", "super_admin")
      .order("id")
      .limit(1)
      .maybeSingle();

    let taskId: number | undefined;
    if (manualVariable.length > 0 && admin?.email) {
      const sourceList = manualVariable.map((s) => s.name).join(", ");
      const { data: task } = await supabase
        .from("tasks")
        .insert({
          title: `Close cost month ${range.label} - ${sourceList}`,
          description: `Auto-recurring sources already filled. Variable-cost manual sources need your monthly figure: ${sourceList}.\n\nOpen /dev/costs and click "Close month" to fill in one shot.`,
          assigned_to: admin.email,
          priority: "medium",
          source_type: "ai",
          source_url: "/dev/costs",
          status: "open",
        })
        .select("id")
        .single();
      taskId = (task as { id?: number } | null)?.id;
    }

    // Build-log entry so the timeline shows the cron firing.
    await db
      .schema("feedback")
      .from("build_log")
      .insert({
        org_id: orgId,
        title: `Monthly cost close ${range.label}`,
        summary: `Auto-created ${inserted} recurring entries; ${manualVariable.length} manual sources flagged for review.`,
        item_type: "chore",
        status: "shipped",
        area: "costs",
        tags: ["cron", "costs"],
        occurred_at: new Date().toISOString(),
        author: "cron",
        notes: `Period ${range.period_start} -> ${range.period_end}. Manual sources: ${manualVariable.map((s) => s.name).join(", ") || "(none)"}.`,
      });

    results.push({
      org_id: orgId,
      recurring_inserted: inserted,
      manual_remaining: manualVariable.length,
      task_id: taskId,
    });
  }

  return Response.json({
    ok: true,
    period: range,
    orgs_processed: results.length,
    results,
  });
}
