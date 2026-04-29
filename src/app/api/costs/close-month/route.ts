// Close-month batch endpoint backing the modal in /dev/costs.
//
// GET ?period=YYYY-MM returns:
//   - period range (first + last day of the requested month)
//   - one row per manual-provenance cost_source with the entry for that
//     month if it already exists (so the modal can show what's done +
//     what's outstanding)
//
// POST accepts an array of { source_id, amount, currency } and upserts
// one cost_entry per item with the period set to the requested month.
// Used by the "Close month" submit button.

import { z } from "zod";
import { supabase } from "@/services/base";
import { requireSuperAdmin } from "@/lib/api-auth";
import { getOrgId } from "@/lib/org";
import { convertToGbp } from "@/lib/costs/fx";
import type { CostSource, CostEntry } from "@/lib/costs/types";

const ROUTE = "/api/costs/close-month";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

function monthRange(period: string): { period_start: string; period_end: string } {
  const start = new Date(period + "-01T00:00:00Z");
  const end = new Date(start);
  end.setUTCMonth(start.getUTCMonth() + 1);
  end.setUTCDate(0);
  return {
    period_start: start.toISOString().slice(0, 10),
    period_end: end.toISOString().slice(0, 10),
  };
}

function priorMonthLabel(): string {
  const now = new Date();
  const prior = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return prior.toISOString().slice(0, 7);
}

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(ROUTE);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const period = url.searchParams.get("period") ?? priorMonthLabel();
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return Response.json({ error: "period must be YYYY-MM" }, { status: 400 });
  }
  const range = monthRange(period);
  const orgId = getOrgId();

  const [sourcesRes, entriesRes] = await Promise.all([
    db
      .schema("feedback")
      .from("cost_sources")
      .select("*")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("category"),
    db
      .schema("feedback")
      .from("cost_entries")
      .select("*")
      .eq("org_id", orgId)
      .eq("period_start", range.period_start)
      .eq("period_end", range.period_end)
      .eq("period_type", "monthly"),
  ]);

  const sources = (sourcesRes.data ?? []) as CostSource[];
  const entries = (entriesRes.data ?? []) as CostEntry[];
  const entryBySource = new Map(entries.map((e) => [e.source_id, e]));

  const rows = sources.map((s) => {
    const entry = entryBySource.get(s.source_id);
    const isAutoRecurring = s.recurring_monthly != null && s.recurring_monthly > 0;
    return {
      source_id: s.source_id,
      name: s.name,
      vendor: s.vendor,
      category: s.category,
      provenance: s.provenance,
      default_currency: s.default_currency,
      recurring_monthly: s.recurring_monthly,
      pro_rate: s.pro_rate,
      notes: s.notes,
      // Auto-recurring sources are pre-filled by the cron; the modal can
      // skip them or just display read-only.
      auto_recurring: isAutoRecurring,
      existing_amount: entry?.amount ?? null,
      existing_currency: entry?.currency ?? null,
      existing_amount_gbp: entry?.amount_gbp ?? null,
      existing_entry_id: entry?.entry_id ?? null,
    };
  });

  return Response.json({
    period,
    period_start: range.period_start,
    period_end: range.period_end,
    rows,
  });
}

const itemSchema = z.object({
  source_id: z.string().uuid(),
  amount: z.number().min(0).max(10_000_000),
  currency: z.string().min(3).max(3),
  description: z.string().max(2000).optional().nullable(),
});

const postSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  items: z.array(itemSchema).min(1).max(100),
});

export async function POST(req: Request) {
  const auth = await requireSuperAdmin(ROUTE);
  if (!auth.ok) return auth.response;

  const parsed = postSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const range = monthRange(parsed.data.period);
  const orgId = getOrgId();
  const inserted: string[] = [];
  const errors: Array<{ source_id: string; error: string }> = [];

  for (const item of parsed.data.items) {
    const fx = await convertToGbp(item.amount, item.currency, range.period_start);
    const { error } = await db
      .schema("feedback")
      .from("cost_entries")
      .upsert(
        {
          org_id: orgId,
          source_id: item.source_id,
          period_start: range.period_start,
          period_end: range.period_end,
          period_type: "monthly",
          amount: item.amount,
          currency: item.currency,
          amount_gbp: fx.amount_gbp,
          fx_rate_used: fx.rate,
          fx_rate_date: fx.rate_date,
          description: item.description ?? `Closed via Close month ${parsed.data.period}`,
          fetched_at: new Date().toISOString(),
          fetched_by_email: auth.session.email,
        },
        { onConflict: "source_id,period_start,period_end,period_type" },
      );
    if (error) errors.push({ source_id: item.source_id, error: error.message });
    else inserted.push(item.source_id);
  }

  return Response.json({
    period: parsed.data.period,
    inserted_count: inserted.length,
    error_count: errors.length,
    errors,
  });
}
