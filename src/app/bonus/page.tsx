"use client";

import { useState, useMemo } from "react";
import { useClientPerformance } from "@/hooks/use-clients";
import { useBudget } from "@/hooks/use-budget";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from "recharts";
import { PageGuard } from "@/components/page-guard";

const formatGBP = (v: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v);

const MONTH_LABELS: Record<string, string> = {
  "2025-01":"Jan 25","2025-02":"Feb 25","2025-03":"Mar 25","2025-04":"Apr 25",
  "2025-05":"May 25","2025-06":"Jun 25","2025-07":"Jul 25","2025-08":"Aug 25",
  "2025-09":"Sep 25","2025-10":"Oct 25","2025-11":"Nov 25","2025-12":"Dec 25",
  "2026-01":"Jan 26","2026-02":"Feb 26","2026-03":"Mar 26","2026-04":"Apr 26",
  "2026-05":"May 26","2026-06":"Jun 26","2026-07":"Jul 26","2026-08":"Aug 26",
  "2026-09":"Sep 26","2026-10":"Oct 26","2026-11":"Nov 26","2026-12":"Dec 26",
};

const EBIT_THRESHOLD = 300000;
const BONUS_PCT = 0.50;
const EQUITY_PCT = 0.075; // 7.5% each Rob & Sam

type YearPeriod = "2025" | "2026";

export default function BonusPage() {
  const [year, setYear] = useState<YearPeriod>("2026");

  const { data: perfData = [], isLoading: perfLoading } = useClientPerformance();
  const { data: budgetData = [], isLoading: budgetLoading } = useBudget();
  const loading = perfLoading || budgetLoading;

  // Aggregate actuals by month
  const actuals = useMemo(() => {
    const byMonth: Record<string, { gp: number; jobs: number }> = {};
    for (const row of perfData) {
      const m = (row as any).report_month;
      if (!byMonth[m]) byMonth[m] = { gp: 0, jobs: 0 };
      byMonth[m].gp += Number((row as any).profit_total) || 0;
      byMonth[m].jobs += (row as any).total_jobs || 0;
    }
    return Object.entries(byMonth).map(([period, d]) => ({ period, ...d }));
  }, [perfData]);

  const data = useMemo(() => {
    const budgetMap: Record<string, any> = {};
    budgetData.forEach((b: any) => { budgetMap[b.period] = b; });

    const actualMap: Record<string, any> = {};
    actuals.forEach(a => { actualMap[a.period] = a; });

    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

    let runningGP = 0;
    let runningBudgetGP = 0;
    let runningEBIT = 0;

    return months.map(period => {
      const actual = actualMap[period];
      const bud = budgetMap[period];

      const monthGP = actual?.gp || 0;
      const monthBudgetGP = Number(bud?.gp_total) || 0;
      const monthEBIT = Number(bud?.ebit) || 0;
      const monthOverheads = Number(bud?.overheads_total) || 0;

      runningGP += monthGP;
      runningBudgetGP += monthBudgetGP;
      runningEBIT += monthEBIT;

      // Actual EBIT estimate = actual GP - budget overheads
      const actualEBIT = monthGP - monthOverheads;

      const overThreshold = false; // calculated from totals

      return {
        period,
        label: MONTH_LABELS[period] || period,
        actual_gp: monthGP,
        budget_gp: monthBudgetGP,
        ytd_gp: runningGP,
        ytd_budget_gp: runningBudgetGP,
        budget_ebit: monthEBIT,
        actual_ebit: actualEBIT,
        ytd_ebit: runningEBIT,
        overheads: monthOverheads,
        over_threshold: overThreshold,
      };
    });
  }, [actuals, budgetData, year]);

  // Calculate bonus
  const totals = useMemo(() => {
    const totalGP = data.reduce((s, d) => s + d.actual_gp, 0);
    const totalBudgetGP = data.reduce((s, d) => s + d.budget_gp, 0);
    const totalOverheads = data.reduce((s, d) => s + d.overheads, 0);
    const totalEBIT = totalGP - totalOverheads;
    const totalBudgetEBIT = data.reduce((s, d) => s + d.budget_ebit, 0);

    const ebitOverThreshold = Math.max(0, totalEBIT - EBIT_THRESHOLD);
    const qualifies = totalEBIT > EBIT_THRESHOLD;
    const bonusPool = ebitOverThreshold * BONUS_PCT;
    const bonusPerPerson = bonusPool / 2;

    // Equity dividends - 7.5% each of ALL EBIT (not just above threshold)
    const equityDividendEach = Math.max(0, totalEBIT) * EQUITY_PCT;

    // Total earnings per person
    const totalPerPerson = bonusPerPerson + equityDividendEach;

    return {
      totalGP,
      totalBudgetGP,
      totalOverheads,
      totalEBIT,
      totalBudgetEBIT,
      ebitOverThreshold,
      qualifies,
      bonusPool,
      bonusPerPerson,
      equityDividendEach,
      totalPerPerson,
      ebitToThreshold: EBIT_THRESHOLD - totalEBIT,
      pctToThreshold: totalEBIT / EBIT_THRESHOLD * 100,
    };
  }, [data]);

  if (loading) return <p className="text-zinc-400 py-12">Loading bonus tracker...</p>;

  return (
    <PageGuard pageId="bonus">
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Bonus Tracker</h1>
          <p className="text-xs text-zinc-400">Rob & Sam - 50% of EBIT above £300k threshold (paid directly, split evenly)</p>
        </div>
        <Badge className="bg-zinc-900 text-white text-xs">Confidential - Super Admin Only</Badge>
      </div>

      {/* Year selector */}
      <div className="flex gap-2 mb-4">
        {(["2025", "2026"] as YearPeriod[]).map(y => (
          <button key={y} onClick={() => setYear(y)}
            className={`px-3 py-1.5 rounded text-xs font-medium ${year === y ? "bg-[#ff3366] text-white" : "bg-zinc-100 text-zinc-600"}`}>
            {y}
          </button>
        ))}
      </div>

      {/* Threshold progress */}
      <Card className="mb-4">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">EBIT Progress to £300k Threshold</span>
            {totals.qualifies ? (
              <Badge className="bg-green-600 text-white">Threshold Met - Bonus Active</Badge>
            ) : (
              <Badge variant="secondary">{formatGBP(Math.abs(totals.ebitToThreshold))} to go</Badge>
            )}
          </div>
          <div className="w-full bg-zinc-200 rounded-full h-4 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${totals.qualifies ? "bg-green-500" : "bg-[#ff3366]"}`}
              style={{ width: `${Math.min(100, Math.max(0, totals.pctToThreshold))}%` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-zinc-400">
            <span>{formatGBP(totals.totalEBIT)} YTD EBIT</span>
            <span>Threshold: {formatGBP(EBIT_THRESHOLD)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Bonus KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Card>
          <CardContent className="pt-3 pb-2">
            <p className="text-[10px] text-zinc-400">YTD Gross Profit</p>
            <p className="text-lg font-bold">{formatGBP(totals.totalGP)}</p>
            <p className="text-[10px] text-zinc-400">Budget: {formatGBP(totals.totalBudgetGP)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2">
            <p className="text-[10px] text-zinc-400">Est. EBIT</p>
            <p className={`text-lg font-bold ${totals.totalEBIT >= 0 ? "text-green-700" : "text-red-600"}`}>
              {formatGBP(totals.totalEBIT)}
            </p>
            <p className="text-[10px] text-zinc-400">Budget: {formatGBP(totals.totalBudgetEBIT)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2">
            <p className="text-[10px] text-zinc-400">EBIT Above £300k</p>
            <p className={`text-lg font-bold ${totals.ebitOverThreshold > 0 ? "text-green-700" : "text-zinc-400"}`}>
              {formatGBP(totals.ebitOverThreshold)}
            </p>
            <p className="text-[10px] text-zinc-400">{totals.qualifies ? "Bonus active" : "Below threshold"}</p>
          </CardContent>
        </Card>
        <Card className={totals.qualifies ? "border-green-300 bg-green-50" : ""}>
          <CardContent className="pt-3 pb-2">
            <p className="text-[10px] text-green-600 font-medium">Bonus Pool (50%)</p>
            <p className="text-lg font-bold text-green-700">{formatGBP(totals.bonusPool)}</p>
            <p className="text-[10px] text-zinc-400">Above £300k EBIT</p>
          </CardContent>
        </Card>
      </div>

      {/* Earnings breakdown */}
      <Card className="mb-4">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Earnings Summary (Per Person - Rob / Sam)</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h4 className="text-xs font-bold text-zinc-500 uppercase mb-3">From Braiin HQ</h4>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b">
                    <td className="py-2 text-zinc-500">Salary</td>
                    <td className="py-2 text-right font-medium">Per contract</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 text-zinc-500">Equity dividend (7.5% of EBIT)</td>
                    <td className="py-2 text-right font-medium">{formatGBP(totals.equityDividendEach)}</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 text-zinc-500">Bonus (25% of EBIT above £300k)</td>
                    <td className={`py-2 text-right font-medium ${totals.bonusPerPerson > 0 ? "text-green-700" : ""}`}>{formatGBP(totals.bonusPerPerson)}</td>
                  </tr>
                  <tr className="bg-zinc-50">
                    <td className="py-2 font-bold">Total from HQ (excl. salary)</td>
                    <td className="py-2 text-right font-bold text-green-700">{formatGBP(totals.totalPerPerson)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <h4 className="text-xs font-bold text-zinc-500 uppercase mb-3">Braiin Ownership Split</h4>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b">
                    <td className="py-2 text-zinc-500">Voyfai (85%)</td>
                    <td className="py-2 text-right font-medium">{formatGBP(Math.max(0, totals.totalEBIT) * 0.85)}</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 text-zinc-500">Rob (7.5%)</td>
                    <td className="py-2 text-right font-medium">{formatGBP(totals.equityDividendEach)}</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 text-zinc-500">Sam (7.5%)</td>
                    <td className="py-2 text-right font-medium">{formatGBP(totals.equityDividendEach)}</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 text-zinc-500">Bonus to R&S (above £300k)</td>
                    <td className="py-2 text-right font-medium text-green-700">{formatGBP(totals.bonusPool)}</td>
                  </tr>
                  <tr className="bg-zinc-50">
                    <td className="py-2 font-bold">Total EBIT</td>
                    <td className="py-2 text-right font-bold">{formatGBP(totals.totalEBIT)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="text-[10px] text-zinc-400 mt-2">Note: bonus is deducted before dividend distribution. Voyfai 85% applies to EBIT after bonus.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* GP YTD cumulative chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">EBIT Cumulative YTD vs £300k Threshold</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.map((d, i) => ({
                ...d,
                ytd_ebit_actual: data.slice(0, i + 1).reduce((s, x) => s + x.actual_ebit, 0),
                ytd_ebit_budget: data.slice(0, i + 1).reduce((s, x) => s + x.budget_ebit, 0),
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `${Math.round(v/1000)}k`} />
                <Tooltip formatter={(v) => formatGBP(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <ReferenceLine y={EBIT_THRESHOLD} stroke="#ff3366" strokeDasharray="5 5" label={{ value: "£300k", fontSize: 10, fill: "#ff3366" }} />
                <Line type="monotone" dataKey="ytd_ebit_actual" name="Est. EBIT YTD" stroke="#22c55e" strokeWidth={2} dot={{ fill: "#22c55e", r: 3 }} />
                <Line type="monotone" dataKey="ytd_ebit_budget" name="Budget EBIT YTD" stroke="#93c5fd" strokeWidth={2} strokeDasharray="5 5" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly GP - Actual vs Budget</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `${Math.round(v/1000)}k`} />
                <Tooltip formatter={(v) => formatGBP(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="actual_gp" name="Actual GP" fill="#22c55e" />
                <Bar dataKey="budget_gp" name="Budget GP" fill="#93c5fd" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Monthly breakdown table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly Breakdown</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead className="bg-zinc-100">
              <tr>
                <th className="p-2 text-left">Month</th>
                <th className="p-2 text-right">Actual GP</th>
                <th className="p-2 text-right">Budget GP</th>
                <th className="p-2 text-right">Variance</th>
                <th className="p-2 text-right">YTD GP</th>
                <th className="p-2 text-right">Overheads</th>
                <th className="p-2 text-right">Est. EBIT</th>
                <th className="p-2 text-right">Threshold</th>
              </tr>
            </thead>
            <tbody>
              {data.map(d => {
                const variance = d.actual_gp - d.budget_gp;
                return (
                  <tr key={d.period} className={`border-t hover:bg-zinc-50 ${d.over_threshold ? "bg-green-50" : ""}`}>
                    <td className="p-2 font-medium">{d.label}</td>
                    <td className="p-2 text-right">{formatGBP(d.actual_gp)}</td>
                    <td className="p-2 text-right text-zinc-500">{formatGBP(d.budget_gp)}</td>
                    <td className={`p-2 text-right font-medium ${variance >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {variance >= 0 ? "+" : ""}{formatGBP(variance)}
                    </td>
                    <td className={`p-2 text-right font-medium ${d.ytd_gp >= EBIT_THRESHOLD ? "text-green-700" : ""}`}>
                      {formatGBP(d.ytd_gp)}
                    </td>
                    <td className="p-2 text-right text-zinc-500">{formatGBP(d.overheads)}</td>
                    <td className={`p-2 text-right font-medium ${d.actual_ebit >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatGBP(d.actual_ebit)}
                    </td>
                    <td className="p-2 text-right">
                      {d.over_threshold ? (
                        <Badge className="bg-green-100 text-green-700 text-[9px]">Above</Badge>
                      ) : (
                        <span className="text-zinc-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* How bonus is calculated */}
      <Card className="mt-4">
        <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-500">How the Bonus Works</CardTitle></CardHeader>
        <CardContent className="text-xs text-zinc-500 space-y-1">
          <p>1. Track cumulative EBIT through the calendar year (Jan-Dec)</p>
          <p>2. EBIT = Actual Gross Profit minus Overheads</p>
          <p>3. Once EBIT exceeds £300,000 threshold, bonus activates</p>
          <p>4. 50% of EBIT above £300k paid directly to Rob & Sam, split evenly</p>
          <p>5. First £300k EBIT goes to Voyfai</p>
          <p>6. Fractal Investments receives dividends from branch ownership (15%) only</p>
          <p className="text-zinc-400 mt-2">Note: EBIT is estimated using actual GP minus budgeted overheads until actual overhead data is available.</p>
        </CardContent>
      </Card>
    </div>
    </PageGuard>
  );
}
