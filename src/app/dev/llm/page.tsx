"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageGuard } from "@/components/page-guard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw } from "lucide-react";

interface LlmCall {
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

interface RoiConfig {
  hourlyRateGbp: number;
  basis: "live_staff_avg" | "fallback";
  staffCount: number;
  totalAnnualCostGbp: number;
  totalHoursPerYear: number;
}

const FALLBACK_HOURLY_RATE_GBP = 25; // used until /api/dev/llm-recent returns a live rate

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(0)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function isoStartOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function isoStartOfWeek(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // Sunday-based week start
  return d.toISOString();
}

function isoStartOfMonth(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d.toISOString();
}

interface Bucket {
  calls: number;
  costCents: number;
  cacheHits: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  timeSavedSeconds: number;
}

function emptyBucket(): Bucket {
  return {
    calls: 0,
    costCents: 0,
    cacheHits: 0,
    failures: 0,
    inputTokens: 0,
    outputTokens: 0,
    timeSavedSeconds: 0,
  };
}

function bucketFromRows(rows: LlmCall[], sinceIso: string): Bucket {
  const since = new Date(sinceIso).getTime();
  const out = emptyBucket();
  for (const r of rows) {
    if (new Date(r.requested_at).getTime() < since) continue;
    out.calls += 1;
    out.costCents += Number(r.cost_cents ?? 0);
    if (r.cache_hit) out.cacheHits += 1;
    if (!r.success) out.failures += 1;
    out.inputTokens += r.input_tokens;
    out.outputTokens += r.output_tokens;
    out.timeSavedSeconds += Number(r.time_saved_seconds ?? 0);
  }
  return out;
}

function fmtCents(c: number): string {
  if (c < 100) return `${c.toFixed(2)}c`;
  return `$${(c / 100).toFixed(2)}`;
}

function pct(n: number, d: number): string {
  if (d === 0) return "-";
  return `${((n / d) * 100).toFixed(0)}%`;
}

interface ByGroupRow {
  key: string;
  calls: number;
  costCents: number;
  avgLatencyMs: number;
  cacheHitPct: number;
}

function aggregateBy(rows: LlmCall[], pick: (r: LlmCall) => string): ByGroupRow[] {
  const map = new Map<
    string,
    { calls: number; costCents: number; latencySum: number; latencyN: number; cacheHits: number }
  >();
  for (const r of rows) {
    const k = pick(r);
    const cur = map.get(k) ?? {
      calls: 0,
      costCents: 0,
      latencySum: 0,
      latencyN: 0,
      cacheHits: 0,
    };
    cur.calls += 1;
    cur.costCents += Number(r.cost_cents ?? 0);
    if (r.latency_ms != null) {
      cur.latencySum += r.latency_ms;
      cur.latencyN += 1;
    }
    if (r.cache_hit) cur.cacheHits += 1;
    map.set(k, cur);
  }
  return Array.from(map.entries())
    .map(([key, v]) => ({
      key,
      calls: v.calls,
      costCents: v.costCents,
      avgLatencyMs: v.latencyN > 0 ? Math.round(v.latencySum / v.latencyN) : 0,
      cacheHitPct: v.calls > 0 ? Math.round((v.cacheHits / v.calls) * 100) : 0,
    }))
    .sort((a, b) => b.costCents - a.costCents);
}

export default function DevLlmPage() {
  const [calls, setCalls] = useState<LlmCall[]>([]);
  const [roi, setRoi] = useState<RoiConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/dev/llm-recent?limit=500");
      const d = (await r.json()) as { calls?: LlmCall[]; roi?: RoiConfig; error?: string };
      if (!r.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setCalls(d.calls ?? []);
      if (d.roi) setRoi(d.roi);
      setLastRefresh(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown fetch error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const today = useMemo(() => bucketFromRows(calls, isoStartOfToday()), [calls]);
  const week = useMemo(() => bucketFromRows(calls, isoStartOfWeek()), [calls]);
  const month = useMemo(() => bucketFromRows(calls, isoStartOfMonth()), [calls]);

  const byPurpose = useMemo(() => aggregateBy(calls, (r) => r.purpose), [calls]);
  const byModel = useMemo(() => aggregateBy(calls, (r) => r.model), [calls]);

  return (
    <PageGuard pageId="dev_llm">
      <div className="container mx-auto py-8 max-w-7xl px-4">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">LLM Gateway - Telemetry</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Last 500 calls from{" "}
              <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-xs">
                activity.llm_calls
              </code>
              . Auto-refreshes every 10s. All Braiin LLM calls flow through{" "}
              <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-xs">
                src/lib/llm-gateway/
              </code>
              .
            </p>
          </div>
          <Button onClick={refresh} disabled={loading} size="sm" variant="outline">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>

        {roi && (
          <div className="mb-6 text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded px-3 py-2">
            ROI valued at{" "}
            <span className="font-mono font-semibold text-zinc-700">
              £{roi.hourlyRateGbp.toFixed(2)}/hr
            </span>{" "}
            -{" "}
            {roi.basis === "live_staff_avg" ? (
              <>
                blended fully-loaded hourly cost across {roi.staffCount} active staff
                (£{(roi.totalAnnualCostGbp / 1000).toFixed(0)}k annual /{" "}
                {Math.round(roi.totalHoursPerYear).toLocaleString()} working hours).
                Live from <code className="bg-zinc-100 px-1 py-0.5 rounded">public.staff</code>.
              </>
            ) : (
              <>
                fallback (staff query failed or empty). Add staff records or check service-role
                permissions to compute the live blended rate.
              </>
            )}
          </div>
        )}

        {/* Period summary cards - cost + time-saved + ROI */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {(
            [
              { label: "Today", b: today },
              { label: "This week", b: week },
              { label: "This month", b: month },
            ] as const
          ).map(({ label, b }) => {
            const hourlyRate = roi?.hourlyRateGbp ?? FALLBACK_HOURLY_RATE_GBP;
            const valueGbp = (b.timeSavedSeconds / 3600) * hourlyRate;
            const costGbp = b.costCents / 100; // treat cents as pence; close enough for ROI display
            const roiMultiple = costGbp > 0 ? valueGbp / costGbp : null;
            return (
              <Card key={label}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-zinc-500 font-medium">
                    {label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-zinc-500">Time saved</div>
                      <div className="text-2xl font-bold text-emerald-600">
                        {fmtDuration(b.timeSavedSeconds)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-zinc-500">Spend</div>
                      <div className="text-2xl font-bold">{fmtCents(b.costCents)}</div>
                    </div>
                  </div>
                  {roiMultiple !== null && b.timeSavedSeconds > 0 && (
                    <div className="mt-3 pt-3 border-t text-xs text-zinc-600">
                      <span className="font-semibold text-emerald-700">
                        {roiMultiple.toFixed(0)}x ROI
                      </span>{" "}
                      <span className="text-zinc-400">
                        (≈£{valueGbp.toFixed(2)} of human time at £{hourlyRate.toFixed(2)}/hr)
                      </span>
                    </div>
                  )}
                  <div className="text-xs text-zinc-500 mt-3 space-y-0.5">
                    <div>{b.calls} calls</div>
                    <div>
                      cache hits {pct(b.cacheHits, b.calls)} · failures {b.failures}
                    </div>
                    <div>
                      {(b.inputTokens / 1000).toFixed(1)}k in /{" "}
                      {(b.outputTokens / 1000).toFixed(1)}k out
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4 text-sm">
            {error}
          </div>
        )}

        {/* Group breakdowns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">By purpose</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Purpose</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Avg ms</TableHead>
                    <TableHead className="text-right">Cache</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byPurpose.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-zinc-400 py-6 text-xs">
                        No calls yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {byPurpose.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="text-xs font-mono">{row.key}</TableCell>
                      <TableCell className="text-right text-xs">{row.calls}</TableCell>
                      <TableCell className="text-right text-xs">
                        {fmtCents(row.costCents)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-zinc-500">
                        {row.avgLatencyMs}
                      </TableCell>
                      <TableCell className="text-right text-xs text-zinc-500">
                        {row.cacheHitPct}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">By model</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Avg ms</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byModel.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-zinc-400 py-6 text-xs">
                        No calls yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {byModel.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="text-xs font-mono">{row.key}</TableCell>
                      <TableCell className="text-right text-xs">{row.calls}</TableCell>
                      <TableCell className="text-right text-xs">
                        {fmtCents(row.costCents)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-zinc-500">
                        {row.avgLatencyMs}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Recent feed */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recent calls</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">When</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">ms</TableHead>
                  <TableHead className="w-[80px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-zinc-400 py-12 text-xs">
                      No calls yet. Trigger a feature that calls the LLM gateway (classify-email,
                      research, deal-coach, etc.) to populate.
                    </TableCell>
                  </TableRow>
                )}
                {calls.slice(0, 100).map((c) => {
                  const rowCls = !c.success
                    ? "bg-red-50 hover:bg-red-100"
                    : c.cache_hit
                    ? "bg-green-50 hover:bg-green-100"
                    : "";
                  return (
                    <TableRow key={c.call_id} className={rowCls}>
                      <TableCell className="text-xs whitespace-nowrap align-top">
                        <div>{new Date(c.requested_at).toLocaleTimeString()}</div>
                        <div className="text-zinc-400">
                          {new Date(c.requested_at).toLocaleDateString()}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-mono align-top">{c.purpose}</TableCell>
                      <TableCell className="text-xs font-mono align-top">{c.model}</TableCell>
                      <TableCell className="text-xs align-top">{c.requested_by}</TableCell>
                      <TableCell className="text-right text-xs align-top">
                        {c.input_tokens.toLocaleString()}
                        {c.cached_input_tokens > 0 && (
                          <div className="text-green-600 text-[10px]">
                            ({c.cached_input_tokens.toLocaleString()} cached)
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs align-top">
                        {c.output_tokens.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-xs align-top">
                        {c.cost_cents != null ? fmtCents(Number(c.cost_cents)) : "-"}
                      </TableCell>
                      <TableCell className="text-right text-xs text-zinc-500 align-top">
                        {c.latency_ms ?? "-"}
                      </TableCell>
                      <TableCell className="align-top">
                        {c.success ? (
                          c.cache_hit ? (
                            <Badge variant="secondary" className="text-xs bg-green-100 text-green-800">
                              cache
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              ok
                            </Badge>
                          )
                        ) : (
                          <Badge variant="destructive" className="text-xs">
                            {c.error_code ?? "fail"}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {lastRefresh && (
          <div className="text-xs text-zinc-400 mt-4 text-right">
            Last refresh: {lastRefresh.toLocaleTimeString()}
          </div>
        )}
      </div>
    </PageGuard>
  );
}
