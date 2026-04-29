"use client";

/**
 * Costs dashboard - the founder's spend + counterfactual surface.
 *
 * Three tabs:
 *   1. Usage      - operational costs (Anthropic API, Vercel, Supabase, ...)
 *   2. Build      - investment in building (Claude MAX, GitHub, dev tools)
 *   3. Counterfactual - what a traditional team would have charged
 *
 * Plus a Sources management section at the bottom for adding/editing
 * cost sources, toggling pro-rate, and triggering live data refresh.
 *
 * Super_admin only - financial data.
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PageGuard } from "@/components/page-guard";
import {
  AlertTriangle,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  Factory,
  Gauge,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  TrendingUp,
  Users as UsersIcon,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { PILL_SM } from "@/lib/ui-constants";
import { BraiinLoader } from "@/components/braiin-loader";
import type {
  CostEntry,
  CostSource,
  CounterfactualScenario,
  WorkSession,
} from "@/lib/costs/types";

interface CounterfactualResult {
  scenario_id: string;
  scenario_name: string;
  region: string;
  team_size: number;
  team_day_rate_gbp: number;
  velocity_multiplier: number;
  actual_calendar_days: number;
  traditional_calendar_days: number;
  traditional_cost_gbp: number;
  actual_cost_gbp: number;
  savings_gbp: number;
  multiplier: number;
  per_role: Array<{ role: string; count: number; day_rate_gbp: number; subtotal_gbp: number }>;
}

interface AggregatedRow {
  source_id: string;
  source_name: string;
  category: "usage" | "build";
  vendor: string;
  pro_rate: number;
  total_gbp_raw: number;
  total_gbp_attributed: number;
  entry_count: number;
}

interface CostsResponse {
  sources: CostSource[];
  entries: CostEntry[];
  sessions: WorkSession[];
  scenarios: CounterfactualScenario[];
  aggregations: {
    usage_by_source: AggregatedRow[];
    build_by_source: AggregatedRow[];
    total_usage_gbp: number;
    total_build_gbp: number;
    total_actual_gbp: number;
  };
  project: { inception_date: string; end_date: string; calendar_days: number };
  counterfactuals: CounterfactualResult[];
  fetched_at: string;
}

type Tab = "usage" | "build" | "counterfactual";

function fmtGbp(n: number): string {
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtGbpCompact(n: number): string {
  if (n >= 1_000_000) return "£" + (n / 1_000_000).toFixed(1) + "m";
  if (n >= 10_000) return "£" + Math.round(n / 1000) + "k";
  if (n >= 1000) return "£" + (n / 1000).toFixed(1) + "k";
  return "£" + Math.round(n);
}

export default function CostsDashboardPage() {
  const [data, setData] = useState<CostsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("usage");
  const [refreshing, setRefreshing] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [addEntryFor, setAddEntryFor] = useState<CostSource | null>(null);
  const [closeMonthOpen, setCloseMonthOpen] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/costs");
      const json = (await r.json()) as CostsResponse & { error?: string };
      if (!r.ok) throw new Error(json.error ?? `Load failed (${r.status})`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function refreshLive() {
    setRefreshing(true);
    setError(null);
    try {
      const r = await fetch("/api/costs/refresh-live", { method: "POST" });
      const json = (await r.json()) as {
        results?: Array<{ name: string; result: { ok: boolean; errors: string[]; notes?: string } }>;
        error?: string;
      };
      if (!r.ok) throw new Error(json.error ?? `Refresh failed (${r.status})`);
      const summary = (json.results ?? [])
        .map((r) => `${r.name}: ${r.result.ok ? "ok" : r.result.errors.join("; ")}`)
        .join(" | ");
      setError(summary || "Refresh complete (no api-provenance sources configured)");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <PageGuard pageId="dev_costs">
      <div className="min-h-screen bg-zinc-50">
        <div className="border-b bg-white">
          <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Wallet className="size-5 text-emerald-600" />
              <h1 className="text-lg font-medium">Costs + counterfactual</h1>
              <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono`}>/costs</Badge>
              <Badge className={`${PILL_SM} bg-rose-100 text-rose-800 uppercase`}>super_admin</Badge>
            </div>
            <div className="flex items-center gap-2">
              {data && (
                <span className="text-[11px] text-zinc-500 inline-flex items-center gap-1">
                  <Clock className="size-3" />
                  fetched {new Date(data.fetched_at).toLocaleTimeString()}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCloseMonthOpen(true)}
              >
                <CalendarCheck className="size-3.5 mr-1.5" />
                Close month
              </Button>
              <Button
                size="sm"
                className="bg-violet-600 hover:bg-violet-700"
                onClick={refreshLive}
                disabled={refreshing}
              >
                <RefreshCw className={`size-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
                Pull live data
              </Button>
            </div>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
          {error && (
            <div className="border border-rose-300 bg-rose-50 text-rose-800 text-xs px-3 py-2 rounded flex items-start gap-2">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
              <button onClick={() => setError(null)} className="text-rose-700 hover:text-rose-900 text-[11px] underline">
                dismiss
              </button>
            </div>
          )}

          {loading && !data && <BraiinLoader label="Loading costs..." />}

          {data && (
            <>
              {/* Top stats */}
              <div className="grid grid-cols-4 gap-3">
                <Card>
                  <CardContent className="py-3 px-4">
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500">Total spend</div>
                    <div className="text-2xl font-medium mt-1 inline-flex items-center gap-1">
                      <DollarSign className="size-4 text-emerald-600" />
                      {fmtGbpCompact(data.aggregations.total_actual_gbp)}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-1">
                      since {data.project.inception_date}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-3 px-4">
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500">Usage</div>
                    <div className="text-2xl font-medium mt-1">
                      {fmtGbpCompact(data.aggregations.total_usage_gbp)}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-1">
                      operational, scales with traffic
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-3 px-4">
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500">Build</div>
                    <div className="text-2xl font-medium mt-1">
                      {fmtGbpCompact(data.aggregations.total_build_gbp)}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-1">
                      subscriptions + dev tools
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-3 px-4">
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500">Calendar days</div>
                    <div className="text-2xl font-medium mt-1 inline-flex items-center gap-1">
                      <Clock className="size-4 text-violet-600" />
                      {data.project.calendar_days}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-1">
                      {data.sessions.length} logged sessions
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 border rounded p-1 bg-white w-fit">
                {(
                  [
                    ["usage", Gauge, "Usage"],
                    ["build", Wrench, "Build"],
                    ["counterfactual", UsersIcon, "Counterfactual"],
                  ] as Array<[Tab, typeof Gauge, string]>
                ).map(([key, Icon, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`px-3 py-1.5 text-xs rounded inline-flex items-center gap-1.5 ${
                      tab === key ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
                    }`}
                  >
                    <Icon className="size-3.5" /> {label}
                  </button>
                ))}
              </div>

              {tab === "usage" && (
                <CategoryView
                  category="usage"
                  rows={data.aggregations.usage_by_source}
                  sources={data.sources.filter((s) => s.category === "usage")}
                  entries={data.entries}
                  onAddEntry={setAddEntryFor}
                  onChange={refresh}
                />
              )}

              {tab === "build" && (
                <CategoryView
                  category="build"
                  rows={data.aggregations.build_by_source}
                  sources={data.sources.filter((s) => s.category === "build")}
                  entries={data.entries}
                  onAddEntry={setAddEntryFor}
                  onChange={refresh}
                />
              )}

              {tab === "counterfactual" && (
                <CounterfactualView
                  results={data.counterfactuals}
                  totalActual={data.aggregations.total_actual_gbp}
                  calendarDays={data.project.calendar_days}
                />
              )}

              {/* Sources management */}
              <Card>
                <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowSources((v) => !v)}>
                  <CardTitle className="text-sm font-medium inline-flex items-center gap-2">
                    {showSources ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    <Factory className="size-4" />
                    Sources ({data.sources.length})
                  </CardTitle>
                </CardHeader>
                {showSources && (
                  <CardContent className="space-y-1">
                    {data.sources.map((s) => (
                      <SourceRow key={s.source_id} source={s} onChange={refresh} />
                    ))}
                  </CardContent>
                )}
              </Card>

              {/* Methodology footer */}
              <Card className="border-violet-200 bg-violet-50/40">
                <CardContent className="py-3 px-5 text-[11px] text-zinc-700 leading-relaxed">
                  <div className="font-medium text-violet-900 mb-1 inline-flex items-center gap-1.5">
                    <Sparkles className="size-3 text-violet-600" />
                    Methodology
                  </div>
                  <span className="font-medium">Costs:</span> entries in source currency converted to
                  GBP via geo.fx_rates (with approximate fallback for missing rates), pro-rated by each
                  source&apos;s `pro_rate` factor. Live data is fetched on demand from Vercel + Anthropic
                  (when admin keys configured); other sources are manual entry or CSV import.{" "}
                  <span className="font-medium">Counterfactual:</span> traditional-team cost = team day
                  rate × actual calendar days × velocity multiplier. Day rates and velocity are tunable
                  per scenario in counterfactual_scenarios. Velocity 7× reflects observed AI-assisted
                  velocity in the literature; tune to your taste.
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {addEntryFor && (
          <AddEntryPanel
            source={addEntryFor}
            onClose={() => setAddEntryFor(null)}
            onSaved={() => {
              setAddEntryFor(null);
              refresh();
            }}
          />
        )}

        {closeMonthOpen && (
          <CloseMonthPanel
            onClose={() => setCloseMonthOpen(false)}
            onSaved={() => {
              setCloseMonthOpen(false);
              refresh();
            }}
          />
        )}
      </div>
    </PageGuard>
  );
}

interface CloseMonthRow {
  source_id: string;
  name: string;
  vendor: string;
  category: "usage" | "build";
  provenance: "manual" | "api";
  default_currency: string;
  recurring_monthly: number | null;
  pro_rate: number;
  notes: string | null;
  auto_recurring: boolean;
  existing_amount: number | null;
  existing_currency: string | null;
  existing_amount_gbp: number | null;
  existing_entry_id: string | null;
}

interface CloseMonthResponse {
  period: string;
  period_start: string;
  period_end: string;
  rows: CloseMonthRow[];
}

function CloseMonthPanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    const prior = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return prior.toISOString().slice(0, 7);
  });
  const [data, setData] = useState<CloseMonthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { amount: string; currency: string }>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/costs/close-month?period=${period}`)
      .then(async (r) => {
        const json = (await r.json()) as CloseMonthResponse & { error?: string };
        if (!r.ok) throw new Error(json.error ?? `Load failed (${r.status})`);
        return json;
      })
      .then((json) => {
        if (cancelled) return;
        setData(json);
        const initial: Record<string, { amount: string; currency: string }> = {};
        for (const r of json.rows) {
          if (r.auto_recurring) continue;
          initial[r.source_id] = {
            amount: r.existing_amount != null ? r.existing_amount.toString() : "",
            currency: r.existing_currency ?? r.default_currency,
          };
        }
        setDrafts(initial);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Load failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  async function save() {
    if (!data) return;
    const items = Object.entries(drafts)
      .filter(([, v]) => v.amount.trim() !== "" && Number(v.amount) >= 0)
      .map(([source_id, v]) => ({
        source_id,
        amount: Number(v.amount),
        currency: v.currency,
      }));
    if (items.length === 0) {
      setError("Enter at least one figure to save.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/costs/close-month", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ period, items }),
      });
      const json = (await r.json()) as { error?: string; inserted_count?: number };
      if (!r.ok) throw new Error(json.error ?? `Save failed (${r.status})`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const manualRows = data?.rows.filter((r) => !r.auto_recurring) ?? [];
  const autoRows = data?.rows.filter((r) => r.auto_recurring) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-zinc-900/30 backdrop-blur-[1px]" onClick={onClose} />
      <div className="w-[640px] bg-white border-l flex flex-col shadow-2xl">
        <div className="border-b px-5 py-4 flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-violet-700 inline-flex items-center gap-1.5">
              <CalendarCheck className="size-3" /> Close month
            </div>
            <div className="font-medium mt-1">
              Period{" "}
              <input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="ml-1 h-7 px-2 rounded border border-zinc-300 text-sm bg-white"
              />
            </div>
            {data && (
              <div className="text-[11px] text-zinc-500 mt-1 font-mono">
                {data.period_start} to {data.period_end}
              </div>
            )}
          </div>
          <button onClick={onClose} className="size-7 inline-flex items-center justify-center rounded hover:bg-zinc-100 text-zinc-500">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-sm">
          {loading && <BraiinLoader label="Loading sources..." />}
          {error && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          {data && (
            <>
              {manualRows.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-medium">
                    Manual entry needed ({manualRows.length})
                  </div>
                  {manualRows.map((r) => {
                    const draft = drafts[r.source_id] ?? { amount: "", currency: r.default_currency };
                    const filled = draft.amount.trim() !== "" && Number(draft.amount) >= 0;
                    return (
                      <div
                        key={r.source_id}
                        className={`border rounded p-2.5 ${filled ? "border-emerald-200 bg-emerald-50/30" : "border-zinc-200 bg-white"}`}
                      >
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <span className="text-sm font-medium">{r.name}</span>
                          <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono`}>{r.vendor}</Badge>
                          <Badge
                            className={`${PILL_SM} ${r.category === "usage" ? "bg-emerald-100 text-emerald-800" : "bg-violet-100 text-violet-800"}`}
                          >
                            {r.category}
                          </Badge>
                          {r.existing_entry_id && (
                            <Badge className={`${PILL_SM} bg-amber-100 text-amber-800`}>updating existing</Badge>
                          )}
                        </div>
                        {r.notes && <div className="text-[11px] text-zinc-500 mb-2">{r.notes}</div>}
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={draft.amount}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [r.source_id]: { ...draft, amount: e.target.value } }))
                            }
                            placeholder="0.00"
                            className="flex-1 h-8 px-2 rounded border border-zinc-300 text-sm bg-white font-mono"
                          />
                          <select
                            value={draft.currency}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [r.source_id]: { ...draft, currency: e.target.value } }))
                            }
                            className="h-8 px-2 rounded border border-zinc-300 text-sm bg-white"
                          >
                            <option value="GBP">GBP</option>
                            <option value="USD">USD</option>
                            <option value="EUR">EUR</option>
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {autoRows.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-medium">
                    Auto-recurring ({autoRows.length}) - filled by cron on the 1st
                  </div>
                  {autoRows.map((r) => (
                    <div
                      key={r.source_id}
                      className="border border-zinc-200 bg-zinc-50/50 rounded p-2 flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-medium">{r.name}</span>{" "}
                        <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600`}>{r.vendor}</Badge>
                      </div>
                      <div className="font-mono text-zinc-700">
                        {r.default_currency} {r.recurring_monthly?.toFixed(2) ?? "0"}
                        {r.existing_entry_id && (
                          <span className="text-emerald-700 ml-1">[done]</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {data.rows.length === 0 && (
                <div className="text-xs text-zinc-500 italic py-4 text-center">
                  No active cost sources for this org. Add some in the Sources section.
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t px-5 py-3 flex items-center justify-between bg-zinc-50">
          <div className="text-[11px] text-zinc-500">
            {Object.values(drafts).filter((d) => d.amount.trim() !== "").length} of {manualRows.length} filled
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-violet-600 hover:bg-violet-700"
              disabled={saving || loading}
              onClick={save}
            >
              {saving ? "Saving..." : "Save all"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoryView({
  category,
  rows,
  sources,
  entries,
  onAddEntry,
  onChange,
}: {
  category: "usage" | "build";
  rows: AggregatedRow[];
  sources: CostSource[];
  entries: CostEntry[];
  onAddEntry: (s: CostSource) => void;
  onChange: () => void;
}) {
  const sourceById = useMemo(() => new Map(sources.map((s) => [s.source_id, s])), [sources]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            {category === "usage" ? "Operational spend by source" : "Build spend by source"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {sources.length === 0 && (
            <div className="text-xs text-zinc-500 italic py-2">No {category} sources yet.</div>
          )}
          {sources.map((s) => {
            const row = rows.find((r) => r.source_id === s.source_id);
            const total = row?.total_gbp_attributed ?? 0;
            return (
              <div
                key={s.source_id}
                className="flex items-center gap-3 py-2 border-b border-zinc-100 last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium inline-flex items-center gap-2">
                    {s.name}
                    <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono`}>{s.vendor}</Badge>
                    {s.provenance === "api" && (
                      <Badge className={`${PILL_SM} bg-violet-100 text-violet-800`}>live</Badge>
                    )}
                    {s.pro_rate < 1 && (
                      <Badge className={`${PILL_SM} bg-amber-100 text-amber-800`}>
                        {Math.round(s.pro_rate * 100)}% pro-rated
                      </Badge>
                    )}
                  </div>
                  {s.notes && <div className="text-[11px] text-zinc-500 mt-0.5">{s.notes}</div>}
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono">{fmtGbp(total)}</div>
                  <div className="text-[10px] text-zinc-400">{row?.entry_count ?? 0} entries</div>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onAddEntry(s)}>
                  <Plus className="size-3 mr-1" />
                  Entry
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Recent {category} entries</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-zinc-500 border-b">
              <tr>
                <th className="text-left py-2">Source</th>
                <th className="text-left py-2">Period</th>
                <th className="text-right py-2">Amount</th>
                <th className="text-right py-2">GBP</th>
                <th className="text-left py-2">Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries
                .filter((e) => sourceById.get(e.source_id)?.category === category)
                .slice(0, 30)
                .map((e) => (
                  <EntryRow
                    key={e.entry_id}
                    entry={e}
                    source={sourceById.get(e.source_id)}
                    onDelete={onChange}
                  />
                ))}
              {entries.filter((e) => sourceById.get(e.source_id)?.category === category).length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-zinc-500 py-4 italic">
                    No entries yet. Click +Entry next to a source above to add one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function EntryRow({ entry, source, onDelete }: { entry: CostEntry; source?: CostSource; onDelete: () => void }) {
  async function handleDelete() {
    if (!confirm("Delete this entry?")) return;
    await fetch("/api/costs", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entry_id: entry.entry_id }),
    });
    onDelete();
  }
  return (
    <tr className="border-b border-zinc-100 hover:bg-zinc-50">
      <td className="py-1.5">{source?.name ?? "Unknown"}</td>
      <td className="py-1.5 font-mono text-[11px] text-zinc-600">
        {entry.period_start} -&gt; {entry.period_end}
      </td>
      <td className="py-1.5 text-right font-mono">
        {entry.currency} {entry.amount.toFixed(2)}
      </td>
      <td className="py-1.5 text-right font-mono">
        {entry.amount_gbp != null ? fmtGbp(entry.amount_gbp) : "-"}
      </td>
      <td className="py-1.5 text-zinc-600">{entry.description ?? ""}</td>
      <td className="py-1.5 text-right">
        <button onClick={handleDelete} className="text-rose-600 hover:text-rose-800">
          <Trash2 className="size-3" />
        </button>
      </td>
    </tr>
  );
}

function CounterfactualView({
  results,
  totalActual,
  calendarDays,
}: {
  results: CounterfactualResult[];
  totalActual: number;
  calendarDays: number;
}) {
  if (results.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-zinc-500 italic">
          No active scenarios. Apply migration 051 to seed the three default scenarios.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-emerald-300 bg-emerald-50/40">
        <CardContent className="py-4 px-5">
          <div className="text-[10px] uppercase tracking-wide text-emerald-700 mb-1 inline-flex items-center gap-1.5">
            <TrendingUp className="size-3" />
            Headline
          </div>
          <div className="text-sm text-zinc-800 leading-relaxed">
            You shipped this in <span className="font-medium">{calendarDays}</span> calendar days at a
            real cost of <span className="font-medium">{fmtGbp(totalActual)}</span>. Across the{" "}
            {results.length} traditional-team scenarios below, the equivalent build would have cost{" "}
            <span className="font-medium">{fmtGbpCompact(Math.min(...results.map((r) => r.traditional_cost_gbp)))}</span>{" "}
            -{" "}
            <span className="font-medium">{fmtGbpCompact(Math.max(...results.map((r) => r.traditional_cost_gbp)))}</span>{" "}
            and taken{" "}
            <span className="font-medium">
              {Math.round(Math.min(...results.map((r) => r.traditional_calendar_days)))}-
              {Math.round(Math.max(...results.map((r) => r.traditional_calendar_days)))}
            </span>{" "}
            calendar days.
          </div>
        </CardContent>
      </Card>

      <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${results.length}, minmax(0, 1fr))` }}>
        {results.map((r) => (
          <Card key={r.scenario_id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{r.scenario_name}</CardTitle>
              <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600 w-fit`}>{r.region}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">Traditional cost</div>
                <div className="text-2xl font-medium font-mono">{fmtGbpCompact(r.traditional_cost_gbp)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">Calendar days</div>
                <div className="text-base font-mono">{Math.round(r.traditional_calendar_days)} days</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-emerald-700">Savings</div>
                <div className="text-base font-mono text-emerald-700">{fmtGbpCompact(r.savings_gbp)}</div>
                <div className="text-[10px] text-zinc-500">{r.multiplier.toFixed(1)}× cost multiplier</div>
              </div>
              <Separator />
              <div>
                <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Team breakdown</div>
                <div className="space-y-0.5 text-[11px]">
                  {r.per_role.map((p) => (
                    <div key={p.role} className="flex items-center justify-between">
                      <span className="text-zinc-700">
                        {p.role} <span className="text-zinc-400">×{p.count}</span>
                      </span>
                      <span className="font-mono text-zinc-600">{fmtGbpCompact(p.subtotal_gbp)}</span>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-zinc-400 mt-1">
                  Day rate: £{r.team_day_rate_gbp.toLocaleString()} · velocity {r.velocity_multiplier}×
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SourceRow({ source, onChange }: { source: CostSource; onChange: () => void }) {
  const [proRate, setProRate] = useState(source.pro_rate);
  const [recurring, setRecurring] = useState(source.recurring_monthly?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/costs/sources", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_id: source.source_id,
          pro_rate: proRate,
          recurring_monthly: recurring === "" ? null : Number(recurring),
        }),
      });
      onChange();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-3 py-2 border-b border-zinc-100 last:border-0 text-xs">
      <div className="flex-1 min-w-0">
        <div className="font-medium inline-flex items-center gap-2">
          {source.name}
          <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono`}>{source.vendor}</Badge>
          <Badge
            className={`${PILL_SM} ${source.category === "usage" ? "bg-emerald-100 text-emerald-800" : "bg-violet-100 text-violet-800"}`}
          >
            {source.category}
          </Badge>
          {source.provenance === "api" && (
            <Badge className={`${PILL_SM} bg-sky-100 text-sky-800`}>{source.provenance}</Badge>
          )}
        </div>
        {source.notes && <div className="text-[10px] text-zinc-500 mt-0.5">{source.notes}</div>}
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[10px] text-zinc-500">
          pro-rate
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={proRate}
            onChange={(e) => setProRate(Number(e.target.value))}
            className="ml-1 h-6 w-16 px-1 text-[11px] rounded border border-zinc-300 bg-white"
          />
        </label>
        <label className="text-[10px] text-zinc-500">
          mo {source.default_currency}
          <input
            type="number"
            min={0}
            step={1}
            value={recurring}
            onChange={(e) => setRecurring(e.target.value)}
            placeholder="0"
            className="ml-1 h-6 w-20 px-1 text-[11px] rounded border border-zinc-300 bg-white"
          />
        </label>
        <Button size="sm" className="h-6 text-[11px]" onClick={save} disabled={saving}>
          Save
        </Button>
      </div>
    </div>
  );
}

function AddEntryPanel({
  source,
  onClose,
  onSaved,
}: {
  source: CostSource;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + "-01";
  const [periodStart, setPeriodStart] = useState(monthStart);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [periodType, setPeriodType] = useState<"daily" | "weekly" | "monthly" | "annual" | "one-off">("monthly");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(source.default_currency);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setSaving(true);
    try {
      const r = await fetch("/api/costs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_id: source.source_id,
          period_start: periodStart,
          period_end: periodEnd,
          period_type: periodType,
          amount: Number(amount),
          currency,
          description: description || null,
        }),
      });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(data.error ?? `Save failed (${r.status})`);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-zinc-900/30 backdrop-blur-[1px]" onClick={onClose} />
      <div className="w-[480px] bg-white border-l flex flex-col shadow-2xl">
        <div className="border-b px-5 py-4">
          <div className="text-xs uppercase tracking-wide text-emerald-700 inline-flex items-center gap-1.5">
            <Plus className="size-3" /> Add cost entry
          </div>
          <div className="font-medium mt-1">{source.name}</div>
          <div className="text-[11px] text-zinc-500">{source.notes ?? source.vendor}</div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-zinc-600 block">
              Period start
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="w-full h-8 px-2 mt-0.5 rounded border border-zinc-300 text-sm bg-white"
              />
            </label>
            <label className="text-[11px] text-zinc-600 block">
              Period end
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="w-full h-8 px-2 mt-0.5 rounded border border-zinc-300 text-sm bg-white"
              />
            </label>
          </div>
          <label className="text-[11px] text-zinc-600 block">
            Period type
            <select
              value={periodType}
              onChange={(e) => setPeriodType(e.target.value as typeof periodType)}
              className="w-full h-8 px-2 mt-0.5 rounded border border-zinc-300 text-sm bg-white"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
              <option value="one-off">One-off</option>
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-[11px] text-zinc-600 block col-span-2">
              Amount
              <input
                type="number"
                min={0}
                step={0.01}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full h-8 px-2 mt-0.5 rounded border border-zinc-300 text-sm bg-white font-mono"
              />
            </label>
            <label className="text-[11px] text-zinc-600 block">
              Currency
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full h-8 px-2 mt-0.5 rounded border border-zinc-300 text-sm bg-white"
              >
                <option value="GBP">GBP</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </label>
          </div>
          <label className="text-[11px] text-zinc-600 block">
            Description (optional)
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. invoice #1234, manual paste from console"
              className="w-full h-8 px-2 mt-0.5 rounded border border-zinc-300 text-sm bg-white"
            />
          </label>
          {err && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{err}</div>
          )}
        </div>
        <div className="border-t px-5 py-3 flex items-center justify-end gap-2 bg-zinc-50">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            disabled={saving || !amount}
            onClick={save}
          >
            {saving ? "Saving..." : "Save entry"}
          </Button>
        </div>
      </div>
    </div>
  );
}
