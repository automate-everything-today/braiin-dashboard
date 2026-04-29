/**
 * Period aggregation helpers for the costs dashboard.
 *
 * Groups raw cost_entries into daily / weekly / monthly buckets and
 * applies each source's pro_rate factor at read time.
 */

import type { CostEntry, CostSource, PeriodTotals } from "@/lib/costs/types";

export type GroupBy = "day" | "week" | "month";

export interface AggregatedRow {
  source_id: string;
  source_name: string;
  category: "usage" | "build";
  vendor: string;
  pro_rate: number;
  total_gbp_raw: number;
  total_gbp_attributed: number;
  entry_count: number;
}

function startOfWeekIso(d: Date): Date {
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

function bucketLabel(date: Date, groupBy: GroupBy): string {
  if (groupBy === "day") return date.toISOString().slice(0, 10);
  if (groupBy === "week") return startOfWeekIso(date).toISOString().slice(0, 10);
  return date.toISOString().slice(0, 7);
}

function bucketRange(label: string, groupBy: GroupBy): { start: string; end: string } {
  if (groupBy === "day") return { start: label, end: label };
  if (groupBy === "week") {
    const monday = new Date(label + "T00:00:00Z");
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return { start: label, end: sunday.toISOString().slice(0, 10) };
  }
  const start = label + "-01";
  const startDate = new Date(start + "T00:00:00Z");
  const endDate = new Date(startDate);
  endDate.setUTCMonth(startDate.getUTCMonth() + 1);
  endDate.setUTCDate(0);
  return { start, end: endDate.toISOString().slice(0, 10) };
}

export function aggregateByPeriod(
  entries: CostEntry[],
  sources: CostSource[],
  groupBy: GroupBy,
): PeriodTotals[] {
  const sourceById = new Map(sources.map((s) => [s.source_id, s]));
  const buckets = new Map<string, PeriodTotals>();

  for (const e of entries) {
    const source = sourceById.get(e.source_id);
    const proRate = source?.pro_rate ?? 1.0;
    const gbp = (e.amount_gbp ?? e.amount) * proRate;
    const label = bucketLabel(new Date(e.period_start + "T00:00:00Z"), groupBy);

    if (!buckets.has(label)) {
      const range = bucketRange(label, groupBy);
      buckets.set(label, {
        period_label: label,
        period_start: range.start,
        period_end: range.end,
        total_gbp: 0,
        by_source: [],
      });
    }
    const bucket = buckets.get(label)!;
    bucket.total_gbp += gbp;
    const existing = bucket.by_source.find((b) => b.source_id === e.source_id);
    if (existing) {
      existing.amount_gbp += gbp;
    } else {
      bucket.by_source.push({
        source_id: e.source_id,
        name: source?.name ?? "Unknown",
        amount_gbp: gbp,
      });
    }
  }

  return Array.from(buckets.values()).sort((a, b) => b.period_label.localeCompare(a.period_label));
}

export function aggregateBySource(
  entries: CostEntry[],
  sources: CostSource[],
  category?: "usage" | "build",
): AggregatedRow[] {
  const sourceById = new Map(sources.map((s) => [s.source_id, s]));
  const totals = new Map<string, AggregatedRow>();

  for (const e of entries) {
    const source = sourceById.get(e.source_id);
    if (!source) continue;
    if (category && source.category !== category) continue;
    const gbpRaw = e.amount_gbp ?? e.amount;
    const proRate = source.pro_rate;
    const row = totals.get(source.source_id) ?? {
      source_id: source.source_id,
      source_name: source.name,
      category: source.category,
      vendor: source.vendor,
      pro_rate: proRate,
      total_gbp_raw: 0,
      total_gbp_attributed: 0,
      entry_count: 0,
    };
    row.total_gbp_raw += gbpRaw;
    row.total_gbp_attributed += gbpRaw * proRate;
    row.entry_count += 1;
    totals.set(source.source_id, row);
  }

  return Array.from(totals.values()).sort(
    (a, b) => b.total_gbp_attributed - a.total_gbp_attributed,
  );
}

/**
 * Estimate calendar days of work for the counterfactual. Based on
 * unique days that have at least one work_session entry. Falls back
 * to elapsed days between min and max session if work_sessions is empty.
 */
export function calendarDaysOfWork(
  workSessions: Array<{ started_at: string }>,
  fallbackInceptionDate: string,
  endDate: string,
): { actual: number; total_attributed_minutes: number } {
  if (workSessions.length === 0) {
    const start = new Date(fallbackInceptionDate + "T00:00:00Z").getTime();
    const end = new Date(endDate + "T23:59:59Z").getTime();
    const days = Math.max(1, Math.ceil((end - start) / (24 * 60 * 60 * 1000)));
    return { actual: days, total_attributed_minutes: 0 };
  }
  const days = new Set(workSessions.map((s) => s.started_at.slice(0, 10)));
  return { actual: days.size, total_attributed_minutes: 0 };
}
