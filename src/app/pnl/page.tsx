"use client";

import { useState, useMemo } from "react";
import { useBudget } from "@/hooks/use-budget";
import { useClientPerformance } from "@/hooks/use-clients";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from "recharts";
import { PageGuard } from "@/components/page-guard";

const formatGBP = (v: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v);

const formatPct = (v: number) => `${(v * 100).toFixed(1)}%`;

const MONTH_LABELS: Record<string, string> = {
  "2025-01":"Jan 25","2025-02":"Feb 25","2025-03":"Mar 25","2025-04":"Apr 25",
  "2025-05":"May 25","2025-06":"Jun 25","2025-07":"Jul 25","2025-08":"Aug 25",
  "2025-09":"Sep 25","2025-10":"Oct 25","2025-11":"Nov 25","2025-12":"Dec 25",
  "2026-01":"Jan 26","2026-02":"Feb 26","2026-03":"Mar 26","2026-04":"Apr 26",
  "2026-05":"May 26","2026-06":"Jun 26","2026-07":"Jul 26","2026-08":"Aug 26",
  "2026-09":"Sep 26","2026-10":"Oct 26","2026-11":"Nov 26","2026-12":"Dec 26",
};

type FYPeriod = "2025" | "2026" | "h1_2025" | "h2_2025" | "h1_2026" | "h2_2026" | "ytd";

const FY_PERIODS: { id: FYPeriod; label: string }[] = [
  { id: "2025", label: "2025" },
  { id: "2026", label: "2026" },
  { id: "h1_2025", label: "H1 2025" },
  { id: "h2_2025", label: "H2 2025" },
  { id: "h1_2026", label: "H1 2026" },
  { id: "h2_2026", label: "H2 2026" },
  { id: "ytd", label: "YTD" },
];

function filterPeriods(periods: string[], fy: FYPeriod): string[] {
  const sorted = [...periods].sort();
  if (fy === "2025") return sorted.filter(p => p >= "2025-01" && p <= "2025-12");
  if (fy === "2026") return sorted.filter(p => p >= "2026-01" && p <= "2026-12");
  if (fy === "h1_2025") return sorted.filter(p => p >= "2025-01" && p <= "2025-06");
  if (fy === "h2_2025") return sorted.filter(p => p >= "2025-07" && p <= "2025-12");
  if (fy === "h1_2026") return sorted.filter(p => p >= "2026-01" && p <= "2026-06");
  if (fy === "h2_2026") return sorted.filter(p => p >= "2026-07" && p <= "2026-12");
  if (fy === "ytd") {
    const now = new Date().toISOString().slice(0, 7);
    return sorted.filter(p => p >= "2026-01" && p <= now);
  }
  return sorted;
}

export default function PnLPage() {
  const { data: budget = [], isLoading: budgetLoading } = useBudget();
  const { data: perfData = [], isLoading: perfLoading } = useClientPerformance();
  const loading = budgetLoading || perfLoading;

  const [period, setPeriod] = useState<FYPeriod>("2026");
  const [expandOverheads, setExpandOverheads] = useState(false);

  // Aggregate actuals by month
  const actuals = useMemo(() => {
    const byMonth: Record<string, any> = {};
    for (const row of perfData) {
      const m = row.report_month;
      if (!byMonth[m]) {
        byMonth[m] = { period: m, jobs: 0, revenue: 0, gp: 0, fcl: 0, lcl: 0, air: 0, road: 0, gp_fcl: 0, gp_lcl: 0, gp_air: 0, gp_road: 0 };
      }
      byMonth[m].jobs += row.total_jobs || 0;
      byMonth[m].gp += Number(row.profit_total) || 0;
      byMonth[m].fcl += (row.fcl_jobs || 0);
      byMonth[m].lcl += (row.lcl_jobs || 0);
      byMonth[m].air += (row.air_jobs || 0);
      byMonth[m].road += (row.bbk_jobs || 0);
      byMonth[m].gp_fcl += Number(row.profit_fcl) || 0;
      byMonth[m].gp_lcl += Number(row.profit_lcl) || 0;
      byMonth[m].gp_air += Number(row.profit_air) || 0;
      byMonth[m].gp_road += Number(row.profit_bbk) || 0;
    }
    return Object.values(byMonth);
  }, [perfData]);

  // Merge budget + actuals
  const data = useMemo(() => {
    const budgetMap: Record<string, any> = {};
    budget.forEach(b => { budgetMap[b.period] = b; });

    const actualMap: Record<string, any> = {};
    actuals.forEach(a => { actualMap[a.period] = a; });

    const allPeriods = [...new Set([...budget.map(b => b.period), ...actuals.map(a => a.period)])].sort();
    const filtered = filterPeriods(allPeriods, period);

    return filtered.map(p => {
      const b = budgetMap[p] || {};
      const a = actualMap[p] || {};
      return {
        period: p,
        label: MONTH_LABELS[p] || p,
        // Budget
        budget_gp: Number(b.gp_total) || 0,
        budget_revenue: Number(b.revenue_total) || 0,
        budget_jobs: Number(b.jobs_total) || 0,
        budget_ebit: Number(b.ebit) || 0,
        budget_overheads: Number(b.overheads_total) || 0,
        budget_gp_pct: Number(b.gp_pct) || 0,
        budget_gp_per_job: Number(b.gp_per_job) || 0,
        // Budget by mode
        budget_gp_sea: (Number(b.gp_sea_import) || 0) + (Number(b.gp_sea_export) || 0),
        budget_gp_air: (Number(b.gp_air_import) || 0) + (Number(b.gp_air_export) || 0),
        budget_gp_road: Number(b.gp_road) || 0,
        // Budget overheads detail
        budget_oh_hr: Number(b.oh_hr) || 0,
        budget_oh_marketing: Number(b.oh_marketing) || 0,
        budget_oh_travel: Number(b.oh_travel) || 0,
        budget_oh_professional: Number(b.oh_professional) || 0,
        budget_oh_admin: Number(b.oh_general_admin) || 0,
        budget_oh_repairs: Number(b.oh_repairs) || 0,
        budget_oh_depreciation: Number(b.oh_depreciation) || 0,
        budget_oh_finance: Number(b.oh_finance) || 0,
        // Actuals
        actual_gp: a.gp || 0,
        actual_jobs: a.jobs || 0,
        actual_gp_sea: (a.gp_fcl || 0) + (a.gp_lcl || 0),
        actual_gp_air: a.gp_air || 0,
        actual_gp_road: a.gp_road || 0,
        actual_jobs_sea: (a.fcl || 0) + (a.lcl || 0),
        actual_jobs_air: a.air || 0,
        actual_jobs_road: a.road || 0,
      };
    });
  }, [budget, actuals, period]);

  // Totals
  const totals = useMemo(() => {
    const t = {
      budget_gp: 0, budget_jobs: 0, budget_ebit: 0, budget_overheads: 0, budget_revenue: 0,
      actual_gp: 0, actual_jobs: 0,
      budget_gp_sea: 0, budget_gp_air: 0, budget_gp_road: 0,
      actual_gp_sea: 0, actual_gp_air: 0, actual_gp_road: 0,
    };
    data.forEach(d => {
      t.budget_gp += d.budget_gp;
      t.budget_jobs += d.budget_jobs;
      t.budget_ebit += d.budget_ebit;
      t.budget_overheads += d.budget_overheads;
      t.budget_revenue += d.budget_revenue;
      t.actual_gp += d.actual_gp;
      t.actual_jobs += d.actual_jobs;
      t.budget_gp_sea += d.budget_gp_sea;
      t.budget_gp_air += d.budget_gp_air;
      t.budget_gp_road += d.budget_gp_road;
      t.actual_gp_sea += d.actual_gp_sea;
      t.actual_gp_air += d.actual_gp_air;
      t.actual_gp_road += d.actual_gp_road;
    });
    return t;
  }, [data]);

  const variance = totals.actual_gp - totals.budget_gp;
  const variancePct = totals.budget_gp > 0 ? (variance / totals.budget_gp) * 100 : 0;

  if (loading) return <p className="text-zinc-400 py-12">Loading P&L data...</p>;

  return (
    <PageGuard pageId="pnl">
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Profit & Loss</h1>
        <Badge variant="secondary" className="text-xs">HQ London</Badge>
      </div>

      {/* Period selector */}
      <div className="flex gap-2 mb-4">
        {FY_PERIODS.map(p => (
          <button key={p.id} onClick={() => setPeriod(p.id)}
            className={`px-3 py-1.5 rounded text-xs font-medium ${period === p.id ? "bg-[#ff3366] text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <Card>
          <CardContent className="pt-3 pb-2">
            <p className="text-[10px] text-zinc-400">Gross Profit</p>
            <p className="text-lg font-bold">{formatGBP(totals.actual_gp)}</p>
            <p className="text-[10px] text-zinc-400">Budget: {formatGBP(totals.budget_gp)}</p>
            <p className={`text-[10px] font-medium ${variance >= 0 ? "text-green-600" : "text-red-600"}`}>
              {variance >= 0 ? "+" : ""}{formatGBP(variance)} ({variancePct >= 0 ? "+" : ""}{variancePct.toFixed(1)}%)
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2">
            <p className="text-[10px] text-zinc-400">Revenue</p>
            <p className="text-lg font-bold">{formatGBP(totals.budget_revenue)}</p>
            <p className="text-[10px] text-zinc-400">Budget</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2">
            <p className="text-[10px] text-zinc-400">EBIT</p>
            <p className={`text-lg font-bold ${totals.budget_ebit >= 0 ? "text-green-700" : "text-red-600"}`}>{formatGBP(totals.budget_ebit)}</p>
            <p className="text-[10px] text-zinc-400">Budget</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2">
            <p className="text-[10px] text-zinc-400">Jobs</p>
            <p className="text-lg font-bold">{Math.round(totals.actual_jobs).toLocaleString()}</p>
            <p className="text-[10px] text-zinc-400">Budget: {Math.round(totals.budget_jobs).toLocaleString()}</p>
            <p className={`text-[10px] font-medium ${totals.actual_jobs >= totals.budget_jobs ? "text-green-600" : "text-red-600"}`}>
              {totals.actual_jobs >= totals.budget_jobs ? "+" : ""}{Math.round(totals.actual_jobs - totals.budget_jobs)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2">
            <p className="text-[10px] text-zinc-400">GP/Job</p>
            <p className="text-lg font-bold">{formatGBP(totals.actual_jobs > 0 ? totals.actual_gp / totals.actual_jobs : 0)}</p>
            <p className="text-[10px] text-zinc-400">Budget: {formatGBP(totals.budget_jobs > 0 ? totals.budget_gp / totals.budget_jobs : 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2">
            <p className="text-[10px] text-zinc-400">Overheads</p>
            <p className="text-lg font-bold text-zinc-600">{formatGBP(totals.budget_overheads)}</p>
            <p className="text-[10px] text-zinc-400">Budget</p>
          </CardContent>
        </Card>
      </div>

      {/* GP vs Budget chart + EBIT tracker */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Gross Profit vs Budget</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `${Math.round(v/1000)}k`} />
                <Tooltip formatter={(v) => formatGBP(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="actual_gp" name="Actual GP" fill="#ff3366" />
                <Bar dataKey="budget_gp" name="Budget GP" fill="#93c5fd" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">EBIT Tracker (Budget)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `${Math.round(v/1000)}k`} />
                <Tooltip formatter={(v) => formatGBP(Number(v))} />
                <ReferenceLine y={0} stroke="#000" strokeDasharray="3 3" />
                <Bar dataKey="budget_ebit" name="EBIT" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Mode Performance */}
      <Card className="mb-4">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Performance by Mode</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {/* Sea */}
            <div className="border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold text-sm text-blue-700">Sea Freight</h4>
                <Badge variant="secondary" className="text-[9px]">FCL + LCL</Badge>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-500">GP Actual:</span>
                  <span className="font-medium">{formatGBP(totals.actual_gp_sea)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">GP Budget:</span>
                  <span>{formatGBP(totals.budget_gp_sea)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Variance:</span>
                  <span className={totals.actual_gp_sea >= totals.budget_gp_sea ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                    {totals.actual_gp_sea >= totals.budget_gp_sea ? "+" : ""}{formatGBP(totals.actual_gp_sea - totals.budget_gp_sea)}
                  </span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={data}>
                  <XAxis dataKey="label" tick={false} />
                  <YAxis tick={false} />
                  <Bar dataKey="actual_gp_sea" fill="#2563eb" />
                  <Bar dataKey="budget_gp_sea" fill="#dbeafe" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Air */}
            <div className="border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold text-sm text-yellow-700">Air Freight</h4>
                <Badge variant="secondary" className="text-[9px]">Import + Export</Badge>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-500">GP Actual:</span>
                  <span className="font-medium">{formatGBP(totals.actual_gp_air)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">GP Budget:</span>
                  <span>{formatGBP(totals.budget_gp_air)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Variance:</span>
                  <span className={totals.actual_gp_air >= totals.budget_gp_air ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                    {totals.actual_gp_air >= totals.budget_gp_air ? "+" : ""}{formatGBP(totals.actual_gp_air - totals.budget_gp_air)}
                  </span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={data}>
                  <XAxis dataKey="label" tick={false} />
                  <YAxis tick={false} />
                  <Bar dataKey="actual_gp_air" fill="#d97706" />
                  <Bar dataKey="budget_gp_air" fill="#fef3c7" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Road */}
            <div className="border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold text-sm text-zinc-700">Road Freight</h4>
                <Badge variant="secondary" className="text-[9px]">BBK / European</Badge>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-500">GP Actual:</span>
                  <span className="font-medium">{formatGBP(totals.actual_gp_road)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">GP Budget:</span>
                  <span>{formatGBP(totals.budget_gp_road)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Variance:</span>
                  <span className={totals.actual_gp_road >= totals.budget_gp_road ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                    {totals.actual_gp_road >= totals.budget_gp_road ? "+" : ""}{formatGBP(totals.actual_gp_road - totals.budget_gp_road)}
                  </span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={data}>
                  <XAxis dataKey="label" tick={false} />
                  <YAxis tick={false} />
                  <Bar dataKey="actual_gp_road" fill="#4b5563" />
                  <Bar dataKey="budget_gp_road" fill="#e5e7eb" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Overheads */}
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Overheads</CardTitle>
            <button onClick={() => setExpandOverheads(!expandOverheads)}
              className="text-[10px] text-blue-600 hover:underline">
              {expandOverheads ? "Collapse" : "Expand by category"}
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {expandOverheads ? (
            <table className="w-full text-xs">
              <thead className="bg-zinc-100">
                <tr>
                  <th className="p-2 text-left">Category</th>
                  {data.map(d => <th key={d.period} className="p-2 text-right">{d.label}</th>)}
                  <th className="p-2 text-right font-bold">Total</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { key: "budget_oh_hr", label: "HR / Payroll" },
                  { key: "budget_oh_marketing", label: "Marketing" },
                  { key: "budget_oh_travel", label: "Travel & Entertaining" },
                  { key: "budget_oh_professional", label: "Professional Fees" },
                  { key: "budget_oh_admin", label: "General Admin" },
                  { key: "budget_oh_repairs", label: "Repairs & Maintenance" },
                  { key: "budget_oh_depreciation", label: "Depreciation" },
                  { key: "budget_oh_finance", label: "Finance" },
                ].map(cat => (
                  <tr key={cat.key} className="border-t hover:bg-zinc-50">
                    <td className="p-2 font-medium">{cat.label}</td>
                    {data.map(d => (
                      <td key={d.period} className="p-2 text-right">{formatGBP((d as any)[cat.key])}</td>
                    ))}
                    <td className="p-2 text-right font-bold">
                      {formatGBP(data.reduce((s, d) => s + ((d as any)[cat.key] || 0), 0))}
                    </td>
                  </tr>
                ))}
                <tr className="border-t bg-zinc-50 font-bold">
                  <td className="p-2">Total Overheads</td>
                  {data.map(d => (
                    <td key={d.period} className="p-2 text-right">{formatGBP(d.budget_overheads)}</td>
                  ))}
                  <td className="p-2 text-right">{formatGBP(totals.budget_overheads)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `${Math.round(v/1000)}k`} />
                <Tooltip formatter={(v) => formatGBP(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="budget_oh_hr" name="HR" fill="#3b82f6" stackId="a" />
                <Bar dataKey="budget_oh_repairs" name="Repairs" fill="#8b5cf6" stackId="a" />
                <Bar dataKey="budget_oh_professional" name="Professional" fill="#f59e0b" stackId="a" />
                <Bar dataKey="budget_oh_admin" name="Admin" fill="#6b7280" stackId="a" />
                <Bar dataKey="budget_oh_travel" name="Travel" fill="#10b981" stackId="a" />
                <Bar dataKey="budget_oh_marketing" name="Marketing" fill="#ef4444" stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Monthly P&L Table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly P&L</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-zinc-100">
                <tr>
                  <th className="p-2 text-left sticky left-0 bg-zinc-100">Line</th>
                  {data.map(d => <th key={d.period} className="p-2 text-right min-w-[80px]">{d.label}</th>)}
                  <th className="p-2 text-right min-w-[90px] font-bold">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="p-2 font-medium sticky left-0 bg-white">Revenue (Budget)</td>
                  {data.map(d => <td key={d.period} className="p-2 text-right">{formatGBP(d.budget_revenue)}</td>)}
                  <td className="p-2 text-right font-bold">{formatGBP(totals.budget_revenue)}</td>
                </tr>
                <tr className="border-t bg-green-50">
                  <td className="p-2 font-bold sticky left-0 bg-green-50">GP (Actual)</td>
                  {data.map(d => <td key={d.period} className="p-2 text-right font-medium">{formatGBP(d.actual_gp)}</td>)}
                  <td className="p-2 text-right font-bold">{formatGBP(totals.actual_gp)}</td>
                </tr>
                <tr className="border-t">
                  <td className="p-2 font-medium sticky left-0 bg-white">GP (Budget)</td>
                  {data.map(d => <td key={d.period} className="p-2 text-right">{formatGBP(d.budget_gp)}</td>)}
                  <td className="p-2 text-right font-bold">{formatGBP(totals.budget_gp)}</td>
                </tr>
                <tr className="border-t">
                  <td className="p-2 font-medium sticky left-0 bg-white">GP Variance</td>
                  {data.map(d => {
                    const v = d.actual_gp - d.budget_gp;
                    return <td key={d.period} className={`p-2 text-right font-medium ${v >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {v >= 0 ? "+" : ""}{formatGBP(v)}
                    </td>;
                  })}
                  <td className={`p-2 text-right font-bold ${variance >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {variance >= 0 ? "+" : ""}{formatGBP(variance)}
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="p-2 font-medium sticky left-0 bg-white">Overheads (Budget)</td>
                  {data.map(d => <td key={d.period} className="p-2 text-right">{formatGBP(d.budget_overheads)}</td>)}
                  <td className="p-2 text-right font-bold">{formatGBP(totals.budget_overheads)}</td>
                </tr>
                <tr className="border-t bg-blue-50">
                  <td className="p-2 font-bold sticky left-0 bg-blue-50">EBIT (Budget)</td>
                  {data.map(d => (
                    <td key={d.period} className={`p-2 text-right font-bold ${d.budget_ebit >= 0 ? "text-green-700" : "text-red-600"}`}>
                      {formatGBP(d.budget_ebit)}
                    </td>
                  ))}
                  <td className={`p-2 text-right font-bold ${totals.budget_ebit >= 0 ? "text-green-700" : "text-red-600"}`}>
                    {formatGBP(totals.budget_ebit)}
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="p-2 font-medium sticky left-0 bg-white">Jobs (Actual)</td>
                  {data.map(d => <td key={d.period} className="p-2 text-right">{Math.round(d.actual_jobs)}</td>)}
                  <td className="p-2 text-right font-bold">{Math.round(totals.actual_jobs)}</td>
                </tr>
                <tr className="border-t">
                  <td className="p-2 font-medium sticky left-0 bg-white">Jobs (Budget)</td>
                  {data.map(d => <td key={d.period} className="p-2 text-right">{Math.round(d.budget_jobs)}</td>)}
                  <td className="p-2 text-right font-bold">{Math.round(totals.budget_jobs)}</td>
                </tr>
                <tr className="border-t">
                  <td className="p-2 font-medium sticky left-0 bg-white">GP/Job (Actual)</td>
                  {data.map(d => <td key={d.period} className="p-2 text-right">{d.actual_jobs > 0 ? formatGBP(d.actual_gp / d.actual_jobs) : "-"}</td>)}
                  <td className="p-2 text-right font-bold">{totals.actual_jobs > 0 ? formatGBP(totals.actual_gp / totals.actual_jobs) : "-"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
    </PageGuard>
  );
}
