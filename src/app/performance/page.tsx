"use client";

import { useState, useMemo } from "react";
import { useClientPerformance } from "@/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { PageGuard } from "@/components/page-guard";

type MonthlyData = {
  month: string;
  label: string;
  fcl_jobs: number;
  fcl_teu: number;
  lcl_jobs: number;
  lcl_cbm: number;
  bbk_jobs: number;
  air_jobs: number;
  air_kg: number;
  total_jobs: number;
  profit_total: number;
  profit_fcl: number;
  profit_lcl: number;
  profit_air: number;
  profit_bbk: number;
  clients: number;
};

const MONTH_LABELS: Record<string, string> = {
  "2025-01":"Jan 25","2025-02":"Feb 25","2025-03":"Mar 25","2025-04":"Apr 25",
  "2025-05":"May 25","2025-06":"Jun 25","2025-07":"Jul 25","2025-08":"Aug 25",
  "2025-09":"Sep 25","2025-10":"Oct 25","2025-11":"Nov 25","2025-12":"Dec 25",
  "2026-01":"Jan 26","2026-02":"Feb 26","2026-03":"Mar 26","2026-04":"Apr 26",
  "2026-05":"May 26","2026-06":"Jun 26","2026-07":"Jul 26","2026-08":"Aug 26",
  "2026-09":"Sep 26","2026-10":"Oct 26","2026-11":"Nov 26","2026-12":"Dec 26",
  "2027-01":"Jan 27","2027-02":"Feb 27","2027-03":"Mar 27",
};

const formatGBP = (v: number) => new Intl.NumberFormat("en-GB", {
  style: "currency", currency: "GBP", maximumFractionDigits: 0
}).format(v);

type Period = "last_month" | "last_3" | "last_6" | "last_12" | "2025" | "2026" | "2027" | "2028" | "2029" | "2030" | "2031" | "all";

const PERIODS: { id: Period; label: string }[] = [
  { id: "last_month", label: "Last Month" },
  { id: "last_3", label: "Last 3 Months" },
  { id: "last_6", label: "Last 6 Months" },
  { id: "last_12", label: "Last 12 Months" },
  { id: "2025", label: "2025" },
  { id: "2026", label: "2026" },
  { id: "2027", label: "2027" },
  { id: "2028", label: "2028" },
  { id: "2029", label: "2029" },
  { id: "2030", label: "2030" },
  { id: "2031", label: "2031" },
  { id: "all", label: "All Time" },
];

function filterByPeriod(data: MonthlyData[], period: Period): MonthlyData[] {
  if (period === "all") return data;
  if (!data.length) return [];

  const allMonths = data.map((d) => d.month).sort();
  const latest = allMonths[allMonths.length - 1];

  if (period === "last_month") {
    return data.filter((d) => d.month === latest);
  }

  if (["2025","2026","2027","2028","2029","2030","2031"].includes(period)) {
    return data.filter((d) => d.month.startsWith(period));
  }

  // Calculate N months back from latest
  const n = period === "last_3" ? 3 : period === "last_6" ? 6 : 12;
  const [y, m] = latest.split("-").map(Number);
  let startYear = y;
  let startMonth = m - n + 1;
  while (startMonth <= 0) { startMonth += 12; startYear--; }
  const startStr = `${startYear}-${String(startMonth).padStart(2, "0")}`;

  return data.filter((d) => d.month >= startStr && d.month <= latest);
}

function sumPeriod(data: MonthlyData[]): MonthlyData | null {
  if (!data.length) return null;
  const sum: MonthlyData = {
    month: "", label: "Total",
    fcl_jobs: 0, fcl_teu: 0, lcl_jobs: 0, lcl_cbm: 0,
    bbk_jobs: 0, air_jobs: 0, air_kg: 0, total_jobs: 0,
    profit_total: 0, profit_fcl: 0, profit_lcl: 0, profit_air: 0, profit_bbk: 0,
    clients: 0,
  };
  for (const d of data) {
    sum.fcl_jobs += d.fcl_jobs; sum.fcl_teu += d.fcl_teu;
    sum.lcl_jobs += d.lcl_jobs; sum.lcl_cbm += d.lcl_cbm;
    sum.bbk_jobs += d.bbk_jobs; sum.air_jobs += d.air_jobs; sum.air_kg += d.air_kg;
    sum.total_jobs += d.total_jobs;
    sum.profit_total += d.profit_total; sum.profit_fcl += d.profit_fcl;
    sum.profit_lcl += d.profit_lcl; sum.profit_air += d.profit_air; sum.profit_bbk += d.profit_bbk;
    sum.clients = Math.max(sum.clients, d.clients);
  }
  return sum;
}

export default function PerformancePage() {
  const { data: rawData = [], isLoading: loading } = useClientPerformance();
  const [period, setPeriod] = useState<Period>("last_12");
  const [selectedClient, setSelectedClient] = useState("all");
  const [clientSearch, setClientSearch] = useState("");

  // Build unique client list from raw data
  const clientList = useMemo(() => {
    const clients: Record<string, string> = {};
    rawData.forEach((r: any) => { clients[r.account_code] = r.client_name; });
    return Object.entries(clients)
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rawData]);

  // Aggregate raw rows into monthly totals
  const allMonthly = useMemo(() => {
    const byMonth: Record<string, MonthlyData> = {};
    for (const row of rawData) {
      const m = (row as any).report_month;
      if (!byMonth[m]) {
        byMonth[m] = {
          month: m, label: MONTH_LABELS[m] || m,
          fcl_jobs: 0, fcl_teu: 0, lcl_jobs: 0, lcl_cbm: 0,
          bbk_jobs: 0, air_jobs: 0, air_kg: 0, total_jobs: 0,
          profit_total: 0, profit_fcl: 0, profit_lcl: 0, profit_air: 0, profit_bbk: 0,
          clients: 0
        };
      }
      byMonth[m].fcl_jobs += (row as any).fcl_jobs || 0;
      byMonth[m].fcl_teu += Number((row as any).fcl_teu) || 0;
      byMonth[m].lcl_jobs += (row as any).lcl_jobs || 0;
      byMonth[m].lcl_cbm += Number((row as any).lcl_cbm) || 0;
      byMonth[m].bbk_jobs += (row as any).bbk_jobs || 0;
      byMonth[m].air_jobs += (row as any).air_jobs || 0;
      byMonth[m].air_kg += Number((row as any).air_kg) || 0;
      byMonth[m].total_jobs += (row as any).total_jobs || 0;
      byMonth[m].profit_total += Number((row as any).profit_total) || 0;
      byMonth[m].profit_fcl += Number((row as any).profit_fcl) || 0;
      byMonth[m].profit_lcl += Number((row as any).profit_lcl) || 0;
      byMonth[m].profit_air += Number((row as any).profit_air) || 0;
      byMonth[m].profit_bbk += Number((row as any).profit_bbk) || 0;
      byMonth[m].clients += 1;
    }
    return Object.keys(byMonth).sort((a, b) => a.localeCompare(b)).map((m) => byMonth[m]);
  }, [rawData]);

  // Recompute monthly when client filter changes
  const filteredMonthly = useMemo(() => {
    if (selectedClient === "all") return allMonthly;

    const byMonth: Record<string, MonthlyData> = {};
    for (const row of rawData) {
      if ((row as any).account_code !== selectedClient) continue;
      const m = (row as any).report_month;
      if (!byMonth[m]) {
        byMonth[m] = {
          month: m, label: MONTH_LABELS[m] || m,
          fcl_jobs: 0, fcl_teu: 0, lcl_jobs: 0, lcl_cbm: 0,
          bbk_jobs: 0, air_jobs: 0, air_kg: 0, total_jobs: 0,
          profit_total: 0, profit_fcl: 0, profit_lcl: 0, profit_air: 0, profit_bbk: 0,
          clients: 0
        };
      }
      byMonth[m].fcl_jobs += (row as any).fcl_jobs || 0;
      byMonth[m].fcl_teu += Number((row as any).fcl_teu) || 0;
      byMonth[m].lcl_jobs += (row as any).lcl_jobs || 0;
      byMonth[m].lcl_cbm += Number((row as any).lcl_cbm) || 0;
      byMonth[m].bbk_jobs += (row as any).bbk_jobs || 0;
      byMonth[m].air_jobs += (row as any).air_jobs || 0;
      byMonth[m].air_kg += Number((row as any).air_kg) || 0;
      byMonth[m].total_jobs += (row as any).total_jobs || 0;
      byMonth[m].profit_total += Number((row as any).profit_total) || 0;
      byMonth[m].profit_fcl += Number((row as any).profit_fcl) || 0;
      byMonth[m].profit_lcl += Number((row as any).profit_lcl) || 0;
      byMonth[m].profit_air += Number((row as any).profit_air) || 0;
      byMonth[m].profit_bbk += Number((row as any).profit_bbk) || 0;
      byMonth[m].clients += 1;
    }
    return Object.keys(byMonth).sort().map((m) => byMonth[m]);
  }, [rawData, selectedClient, allMonthly]);

  // Filtered client list for search
  const filteredClientList = useMemo(() => {
    if (!clientSearch) return clientList;
    return clientList.filter((c) => c.name.toLowerCase().includes(clientSearch.toLowerCase()));
  }, [clientList, clientSearch]);

  if (loading) return <p className="text-zinc-400 py-12">Loading performance data...</p>;

  const monthly = filterByPeriod(filteredMonthly, period);
  const totals = sumPeriod(monthly);

  // Compute top clients for this period
  const periodMonths = new Set(monthly.map((m) => m.month));
  const periodClients: Record<string, any> = {};
  for (const row of rawData) {
    if (!periodMonths.has(row.report_month)) continue;
    const code = row.account_code;
    if (!periodClients[code]) {
      periodClients[code] = { code, name: row.client_name, profit: 0, jobs: 0, months: 0 };
    }
    periodClients[code].profit += Number(row.profit_total) || 0;
    periodClients[code].jobs += row.total_jobs || 0;
    periodClients[code].months += 1;
  }
  const topClients = Object.values(periodClients)
    .sort((a: any, b: any) => b.profit - a.profit)
    .slice(0, 20);

  const pctChange = (current: number, prev: number | undefined) => {
    if (!prev) return null;
    return Math.round(((current - prev) / Math.abs(prev)) * 100);
  };

  return (
    <PageGuard pageId="performance">
    <div>
      <h1 className="text-2xl font-bold mb-4">Performance</h1>

      {/* Period selector */}
      <div className="flex gap-1 mb-2 flex-wrap">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`px-3 py-1.5 rounded text-xs font-medium ${
              period === p.id ? "bg-[#ff3366] text-white" : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {/* Client filter */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-zinc-500">Client:</span>
        <div className="relative">
          <input
            type="text"
            placeholder="Search clients..."
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
            className="px-3 py-1.5 border rounded text-xs w-64"
          />
          {clientSearch && (
            <div className="absolute z-10 top-full left-0 w-64 mt-1 bg-white border rounded shadow-lg max-h-48 overflow-y-auto">
              <button
                onClick={() => { setSelectedClient("all"); setClientSearch(""); }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 font-medium"
              >
                All Clients
              </button>
              {filteredClientList.slice(0, 20).map((c) => (
                <button
                  key={c.code}
                  onClick={() => { setSelectedClient(c.code); setClientSearch(c.name); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {selectedClient !== "all" && (
          <button
            onClick={() => { setSelectedClient("all"); setClientSearch(""); }}
            className="text-xs text-[#ff3366] hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      {monthly.length > 0 && (
        <p className="text-xs text-zinc-500 mb-6">
          Showing: <strong>{monthly[0].label}</strong>
          {monthly.length > 1 && <> to <strong>{monthly[monthly.length - 1].label}</strong></>}
          {" "}({monthly.length} month{monthly.length !== 1 ? "s" : ""})
        </p>
      )}

      {/* Summary cards */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          {[
            { label: "Total Jobs", value: totals.total_jobs },
            { label: "Total Profit", value: formatGBP(totals.profit_total), raw: totals.profit_total },
            { label: "FCL Jobs", value: totals.fcl_jobs },
            { label: "FCL TEU", value: Math.round(totals.fcl_teu) },
            { label: "LCL Jobs", value: totals.lcl_jobs },
            { label: "Air Jobs", value: totals.air_jobs },
            { label: "Peak Clients", value: totals.clients },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="pt-4 pb-3">
                <p className="text-[10px] text-zinc-500 uppercase">{s.label}</p>
                <p className="text-xl font-bold">{typeof s.value === "number" ? s.value.toLocaleString() : s.value}</p>
                <p className="text-[10px] text-zinc-400">{monthly.length} month{monthly.length !== 1 ? "s" : ""}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Charts - only show if more than 1 month */}
      {monthly.length > 1 && (
        <>
          {/* Profit trend */}
          <Card className="mb-6">
            <CardHeader><CardTitle>Monthly Profit by Mode</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v) => formatGBP(Number(v))} />
                  <Legend />
                  <Bar dataKey="profit_fcl" name="FCL" fill="#3b82f6" stackId="a" />
                  <Bar dataKey="profit_lcl" name="LCL" fill="#8b5cf6" stackId="a" />
                  <Bar dataKey="profit_air" name="Air" fill="#f59e0b" stackId="a" />
                  <Bar dataKey="profit_bbk" name="BBK/Other" fill="#6b7280" stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <Card>
              <CardHeader><CardTitle>Jobs by Mode</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={monthly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="fcl_jobs" name="FCL" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="lcl_jobs" name="LCL" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="air_jobs" name="Air" stroke="#f59e0b" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="bbk_jobs" name="BBK" stroke="#6b7280" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Volume Trends</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={monthly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="fcl_teu" name="FCL TEU" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="air_kg" name="Air KG" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card className="mb-6">
            <CardHeader><CardTitle>Active Clients per Month</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="clients" name="Active Clients" fill="#ff3366" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}

      {/* Month-on-month table */}
      <Card className="mb-6">
        <CardHeader><CardTitle>Month-on-Month</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-zinc-100">
                <tr>
                  <th className="p-2 text-left">Month</th>
                  <th className="p-2 text-right">Jobs</th>
                  <th className="p-2 text-right">Profit</th>
                  <th className="p-2 text-right">FCL</th>
                  <th className="p-2 text-right">TEU</th>
                  <th className="p-2 text-right">LCL</th>
                  <th className="p-2 text-right">CBM</th>
                  <th className="p-2 text-right">Air</th>
                  <th className="p-2 text-right">Air KG</th>
                  <th className="p-2 text-right">BBK</th>
                  <th className="p-2 text-right">Clients</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((m, i) => {
                  const prev = i > 0 ? monthly[i - 1] : null;
                  const profitUp = prev ? m.profit_total >= prev.profit_total : true;
                  return (
                    <tr key={m.month} className="border-t hover:bg-zinc-50">
                      <td className="p-2 font-medium">{m.label}</td>
                      <td className="p-2 text-right">{m.total_jobs}</td>
                      <td className={`p-2 text-right font-medium ${profitUp ? "text-green-600" : "text-[#ff3366]"}`}>
                        {formatGBP(m.profit_total)}
                      </td>
                      <td className="p-2 text-right">{m.fcl_jobs}</td>
                      <td className="p-2 text-right">{Math.round(m.fcl_teu)}</td>
                      <td className="p-2 text-right">{m.lcl_jobs}</td>
                      <td className="p-2 text-right">{Math.round(m.lcl_cbm)}</td>
                      <td className="p-2 text-right">{m.air_jobs}</td>
                      <td className="p-2 text-right">{Math.round(m.air_kg).toLocaleString()}</td>
                      <td className="p-2 text-right">{m.bbk_jobs}</td>
                      <td className="p-2 text-right">{m.clients}</td>
                    </tr>
                  );
                })}
                {/* Totals row */}
                {totals && monthly.length > 1 && (
                  <tr className="border-t-2 border-zinc-300 bg-zinc-50 font-bold">
                    <td className="p-2">Total</td>
                    <td className="p-2 text-right">{totals.total_jobs}</td>
                    <td className="p-2 text-right">{formatGBP(totals.profit_total)}</td>
                    <td className="p-2 text-right">{totals.fcl_jobs}</td>
                    <td className="p-2 text-right">{Math.round(totals.fcl_teu)}</td>
                    <td className="p-2 text-right">{totals.lcl_jobs}</td>
                    <td className="p-2 text-right">{Math.round(totals.lcl_cbm)}</td>
                    <td className="p-2 text-right">{totals.air_jobs}</td>
                    <td className="p-2 text-right">{Math.round(totals.air_kg).toLocaleString()}</td>
                    <td className="p-2 text-right">{totals.bbk_jobs}</td>
                    <td className="p-2 text-right">{totals.clients}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Top clients */}
      <Card>
        <CardHeader><CardTitle>Top 20 Clients</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead className="bg-zinc-100">
              <tr>
                <th className="p-2 text-left">Code</th>
                <th className="p-2 text-left">Client</th>
                <th className="p-2 text-right">Total Profit</th>
                <th className="p-2 text-right">Total Jobs</th>
                <th className="p-2 text-right">Months</th>
                <th className="p-2 text-right">Avg/Month</th>
              </tr>
            </thead>
            <tbody>
              {topClients.map((c: any) => (
                <tr key={c.code} className="border-t hover:bg-zinc-50">
                  <td className="p-2 text-zinc-400">{c.code}</td>
                  <td className="p-2 font-medium">{c.name}</td>
                  <td className="p-2 text-right font-medium">{formatGBP(c.profit)}</td>
                  <td className="p-2 text-right">{c.jobs}</td>
                  <td className="p-2 text-right">{c.months}</td>
                  <td className="p-2 text-right">{formatGBP(c.profit / Math.max(c.months, 1))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
    </PageGuard>
  );
}
