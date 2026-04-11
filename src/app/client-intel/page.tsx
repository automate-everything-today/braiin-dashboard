"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { ClientIntelPanel } from "@/components/client-intel-panel";
import { EmailComposer } from "@/components/email-composer";
import { MessageCircle, Mail } from "lucide-react";
import { PageGuard } from "@/components/page-guard";
import { formatGBP, MONTH_LABELS, countryFlag } from "@/lib/utils";
import {
  useClientPerformance,
  useClientResearch,
  useClientNotes,
  useAddNote,
  useDeleteNote,
  useTradeMatches,
} from "@/hooks/use-clients";
import { useContacts, useUpdateContact, useDeleteContact } from "@/hooks/use-contacts";

const TIER_COLORS: Record<string, string> = {
  "Platinum": "bg-purple-600 text-white",
  "Gold": "bg-yellow-500 text-black",
  "Silver": "bg-zinc-400 text-white",
  "Bronze": "bg-orange-700 text-white",
  "Starter": "bg-zinc-200 text-zinc-600",
};

type Period = "last_month" | "last_3" | "last_6" | "last_12" | "all" | "2025" | "2026" | "2027" | "2028" | "2029" | "2030" | "2031";

const PERIODS: { id: Period; label: string }[] = [
  { id: "last_month", label: "Last Month" },
  { id: "last_3", label: "Last 3 Months" },
  { id: "last_6", label: "Last 6 Months" },
  { id: "last_12", label: "Last 12 Months" },
  { id: "all", label: "All Time" },
  { id: "2025", label: "2025" },
  { id: "2026", label: "2026" },
  { id: "2027", label: "2027" },
  { id: "2028", label: "2028" },
  { id: "2029", label: "2029" },
  { id: "2030", label: "2030" },
  { id: "2031", label: "2031" },
];

function filterMonths(months: string[], period: Period): string[] {
  if (period === "all") return months;
  const sorted = [...months].sort();
  if (sorted.length === 0) return [];

  if (["2025","2026","2027","2028","2029","2030","2031"].includes(period)) {
    return sorted.filter(m => m.startsWith(period));
  }

  if (period === "last_month") {
    return sorted.slice(-1);
  }

  const n = period === "last_3" ? 3 : period === "last_6" ? 6 : 12;
  return sorted.slice(-n);
}

export default function ClientIntelPage() {
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [period, setPeriod] = useState<Period>("last_12");
  const [newNote, setNewNote] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  // --- React Query hooks for data fetching ---
  const { data: allPerf = [], isLoading: perfLoading } = useClientPerformance();
  const { data: researchData = [], isLoading: researchLoading } = useClientResearch();
  const accountCodes = useMemo(
    () => [...new Set(allPerf.map((p: any) => p.account_code))],
    [allPerf]
  );
  const { data: tradeData, isLoading: tradeLoading } = useTradeMatches(accountCodes);

  // Per-client hooks (enabled when a client is selected)
  const { data: notes = [], isLoading: notesLoading } = useClientNotes(selectedCode);
  const { data: contacts = [], isLoading: contactsLoading } = useContacts(selectedCode);

  // Mutation hooks
  const addNoteMutation = useAddNote();
  const deleteNoteMutation = useDeleteNote();
  const deleteContactMutation = useDeleteContact();
  const updateContactMutation = useUpdateContact();

  const loading = perfLoading || researchLoading || tradeLoading;

  // Derive research map
  const researchMap = useMemo(() => {
    const rMap: Record<string, any> = {};
    researchData.forEach((r: any) => { rMap[r.account_code] = r; });
    return rMap;
  }, [researchData]);

  // Derive trade/score/logo maps
  const tradeScoreMap = useMemo(() => {
    const tMap: Record<string, any> = {};
    const logoMap: Record<string, string> = {};
    const sMap: Record<number, any> = {};

    const companyLinks = tradeData?.companyLinks || [];
    const appScores = tradeData?.appScores || [];

    companyLinks.forEach((c: any) => {
      if (!tMap[c.account_code]) tMap[c.account_code] = { importer: null, exporter: null };
      tMap[c.account_code][c.trade_type] = c;
      if (c.logo_url && !logoMap[c.account_code]) logoMap[c.account_code] = c.logo_url;
    });

    appScores.forEach((s: any) => { sMap[s.company_id] = s; });

    // Override logoMap with research logos
    researchData.forEach((r: any) => {
      if (r.logo_url) logoMap[r.account_code] = r.logo_url;
    });

    return { tradeMap: tMap, scoreMap: sMap, logoMap };
  }, [tradeData, researchData]);

  // Build client list with period filtering
  const clients = useMemo(() => {
    if (!allPerf.length) return [];

    // Get all unique months and filter by period
    const allMonths = [...new Set(allPerf.map((r: any) => r.report_month))].sort();
    const activeMonths = new Set(filterMonths(allMonths, period));

    const byClient: Record<string, any> = {};
    for (const row of allPerf) {
      if (!activeMonths.has(row.report_month)) continue;
      const code = row.account_code;
      if (!byClient[code]) {
        byClient[code] = {
          code, name: row.client_name,
          totalProfit: 0, totalJobs: 0, months: 0, lastMonth: "",
          fcl_jobs: 0, lcl_jobs: 0, air_jobs: 0, bbk_jobs: 0,
          fcl_profit: 0, lcl_profit: 0, air_profit: 0, bbk_profit: 0,
          total_teu: 0, total_air_kg: 0, total_bbk_cbm: 0,
          monthly: [] as any[],
        };
      }
      const c = byClient[code];
      c.totalProfit += Number(row.profit_total) || 0;
      c.totalJobs += row.total_jobs || 0;
      c.months += 1;
      if (row.report_month > c.lastMonth) c.lastMonth = row.report_month;
      c.fcl_jobs += row.fcl_jobs || 0;
      c.lcl_jobs += row.lcl_jobs || 0;
      c.air_jobs += row.air_jobs || 0;
      c.bbk_jobs += row.bbk_jobs || 0;
      c.fcl_profit += Number(row.profit_fcl) || 0;
      c.lcl_profit += Number(row.profit_lcl) || 0;
      c.air_profit += Number(row.profit_air) || 0;
      c.bbk_profit += Number(row.profit_bbk) || 0;
      c.total_teu += Number(row.fcl_teu) || 0;
      c.total_air_kg += Number(row.air_kg) || 0;
      c.total_bbk_cbm += Number(row.bbk_cbm) || 0;

      c.monthly.push({
        month: row.report_month,
        label: MONTH_LABELS[row.report_month] || row.report_month,
        profit: Number(row.profit_total) || 0,
        fcl: row.fcl_jobs || 0, lcl: row.lcl_jobs || 0,
        air: row.air_jobs || 0, bbk: row.bbk_jobs || 0,
        teu: Number(row.fcl_teu) || 0,
        air_kg: Number(row.air_kg) || 0,
        bbk_cbm: Number(row.bbk_cbm) || 0,
      });
    }

    const { tradeMap, scoreMap, logoMap } = tradeScoreMap;

    return Object.values(byClient).map((c: any) => {
      const avgMonthly = c.totalProfit / Math.max(c.months, 1);
      const tier = avgMonthly >= 10000 ? "Platinum"
        : avgMonthly >= 5000 ? "Gold"
        : avgMonthly >= 2000 ? "Silver"
        : avgMonthly >= 500 ? "Bronze"
        : "Starter";

      const research = researchMap[c.code];
      const trade = tradeMap[c.code];
      const importMatch = trade?.importer;
      const exportMatch = trade?.exporter;
      const importScore = importMatch ? scoreMap[importMatch.id] : null;

      // Upsell opportunities
      const upsell: string[] = [];
      if (c.fcl_jobs > 0 && c.air_jobs === 0) upsell.push("No air freight - potential for urgent/high-value shipments");
      if (c.air_jobs > 0 && c.fcl_jobs === 0) upsell.push("Air only - could FCL save them money on regular lanes?");
      if (c.fcl_jobs > 0 && c.lcl_jobs === 0) upsell.push("No LCL - may have smaller shipments going by air unnecessarily");
      if (!exportMatch && importMatch) upsell.push("Import only with Braiin - do they export? Could handle both directions");
      if (c.bbk_jobs > 0 && c.fcl_jobs === 0) upsell.push("Breakbulk/project cargo only - could consolidate into FCL?");
      if (importScore?.is_dual && !exportMatch) upsell.push("Trade data shows they export too - we only handle imports");
      if (avgMonthly > 1000 && tier !== "Platinum") upsell.push("Growing account - potential to upgrade to " + (tier === "Gold" ? "Platinum" : "Gold"));

      return {
        code: c.code,
        name: c.name,
        totalProfit: Math.round(c.totalProfit),
        totalJobs: c.totalJobs,
        months: c.months,
        avgMonthly: Math.round(avgMonthly),
        lastMonth: c.lastMonth,
        tier,
        monthly: c.monthly.sort((a: any, b: any) => a.month.localeCompare(b.month)),
        modes: { fcl: c.fcl_jobs, lcl: c.lcl_jobs, air: c.air_jobs, bbk: c.bbk_jobs },
        modeProfits: { fcl: Math.round(c.fcl_profit), lcl: Math.round(c.lcl_profit), air: Math.round(c.air_profit), bbk: Math.round(c.bbk_profit) },
        logoUrl: logoMap[c.code] || "",
        totalTeu: Math.round(c.total_teu),
        totalAirKg: Math.round(c.total_air_kg),
        totalBbkCbm: Math.round(c.total_bbk_cbm),
        tradeMatch: importScore || null,
        upsellOpportunities: upsell,
        clientNews: research?.client_news || "",
        growthSignals: research?.growth_signals || [],
        retentionRisks: research?.retention_risks || [],
        competitorIntel: research?.competitor_intel || "",
        recommendedAction: research?.recommended_action || "",
        accountHealth: research?.account_health || "",
        researched: !!research,
        isForwarder: research?.is_forwarder || false,
        country: research?.country || "",
        sourceLinks: research?.source_links || [],
        researchDate: research?.research_date || "",
        insight: research?.insight || "",
        ffNetworks: research?.ff_networks || [],
      };
    }).sort((a: any, b: any) => b.totalProfit - a.totalProfit);
  }, [allPerf, period, researchMap, tradeScoreMap]);

  const filteredClients = useMemo(() => {
    let list = clients;
    if (searchTerm) list = list.filter((c: any) => c.name.toLowerCase().includes(searchTerm.toLowerCase()));
    if (tierFilter !== "all") list = list.filter((c: any) => c.tier === tierFilter);
    return list;
  }, [clients, searchTerm, tierFilter]);

  const selected = clients.find((c: any) => c.code === selectedCode);

  const tierCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    clients.forEach((c: any) => { counts[c.tier] = (counts[c.tier] || 0) + 1; });
    return counts;
  }, [clients]);

  // Mutation wrappers
  function handleDeleteContact(id: number) {
    deleteContactMutation.mutate(id);
  }

  function startEditContact(c: any) {
    setEditingContact(c.id);
    setEditForm({ contact_name: c.contact_name, job_title: c.job_title, email: c.email, phone: c.phone, city: c.city });
  }

  function handleSaveContact() {
    if (!editingContact) return;
    updateContactMutation.mutate(
      { id: editingContact, updates: editForm },
      { onSuccess: () => setEditingContact(null) }
    );
  }

  function handleAddNote() {
    if (!newNote.trim() || !selectedCode) return;
    addNoteMutation.mutate(
      { accountCode: selectedCode, note: newNote.trim(), author: "Rob" },
      { onSuccess: () => setNewNote("") }
    );
  }

  function handleDeleteNote(id: number) {
    deleteNoteMutation.mutate(id);
  }

  if (loading) return <p className="text-zinc-400 py-12">Loading client data...</p>;

  return (
    <PageGuard pageId="client-intel">
    <div>
      <h1 className="text-2xl font-bold mb-4">Client Intelligence</h1>

      {/* Period selector + Tier filter */}
      <div className="flex gap-2 mb-2 flex-wrap">
        {PERIODS.map(p => (
          <button key={p.id} onClick={() => setPeriod(p.id)}
            className={`px-2.5 py-1 rounded text-[11px] font-medium ${period === p.id ? "bg-[#ff3366] text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTierFilter("all")}
          className={`px-3 py-1.5 rounded text-xs font-medium ${tierFilter === "all" ? "bg-[#ff3366] text-white" : "bg-zinc-200"}`}>
          All ({clients.length})
        </button>
        {["Platinum", "Gold", "Silver", "Bronze", "Starter"].map(t => (
          <button key={t} onClick={() => setTierFilter(t)}
            className={`px-3 py-1.5 rounded text-xs font-medium ${tierFilter === t ? TIER_COLORS[t] : "bg-zinc-200 text-zinc-600"}`}>
            {t} ({tierCounts[t] || 0})
          </button>
        ))}
      </div>

      <div className="flex gap-4 h-[calc(100vh-200px)]">
        {/* Left: Client list */}
        <div className="w-72 shrink-0 flex flex-col">
          <input
            placeholder="Search clients..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-3 py-2 border rounded text-sm mb-2"
          />
          <div className="overflow-y-auto space-y-1 flex-1">
            {filteredClients.map((c: any) => (
              <button key={c.code} onClick={() => setSelectedCode(c.code)}
                className={`w-full text-left p-2.5 rounded-lg border text-xs ${
                  selectedCode === c.code ? "border-[#ff3366] bg-[#ff3366]/5" : "border-zinc-200 bg-white hover:bg-zinc-50"
                }`}>
                <div className="flex items-center gap-2">
                  {c.logoUrl && (
                    <img src={c.logoUrl} alt="" className="w-6 h-6 rounded object-contain shrink-0"
                      onError={(e) => (e.currentTarget.style.display = "none")} />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{c.name}</p>
                    <p className="text-[10px] text-zinc-400">{formatGBP(c.avgMonthly)}/mo | {c.totalJobs} jobs</p>
                  </div>
                  {c.isForwarder
                    ? <Badge className="text-[9px] bg-amber-500 text-white shrink-0">FF</Badge>
                    : <Badge variant="secondary" className="text-[9px] bg-blue-50 text-blue-600 shrink-0">Direct</Badge>
                  }
                  <span className="text-[11px] shrink-0" title={c.country || "UK"}>{countryFlag(c.country || "UK")}</span>
                  <Badge className={`${TIER_COLORS[c.tier]} text-[9px] shrink-0`}>{c.tier}</Badge>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {c.upsellOpportunities.length > 0 && (
                    <span className="text-[9px] bg-yellow-100 text-yellow-700 px-1 rounded">
                      {c.upsellOpportunities.length} opportunities
                    </span>
                  )}
                  {c.researched && (
                    <span className={`text-[9px] px-1 rounded ${
                      c.accountHealth === "growing" ? "bg-green-100 text-green-700"
                      : c.accountHealth === "at_risk" ? "bg-red-100 text-red-700"
                      : "bg-blue-50 text-blue-600"
                    }`}>
                      {c.accountHealth || "researched"}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: Detail */}
        {selected ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header - sticky */}
            <div className="shrink-0 bg-white border-b pb-3 mb-0 z-10">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  {selected.logoUrl && (
                    <img src={selected.logoUrl} alt="" className="w-8 h-8 rounded object-contain"
                      onError={(e) => (e.currentTarget.style.display = "none")} />
                  )}
                  <h2 className="text-xl font-bold">{selected.name}</h2>
                  <Badge className={TIER_COLORS[selected.tier]}>{selected.tier}</Badge>
                  {selected.accountHealth && (
                    <Badge className={`text-[10px] ${
                      selected.accountHealth === "growing" ? "bg-green-100 text-green-700"
                      : selected.accountHealth === "at_risk" ? "bg-red-100 text-red-700"
                      : "bg-blue-100 text-blue-600"
                    }`}>
                      {selected.accountHealth}
                    </Badge>
                  )}
                  {selected.isForwarder
                    ? <Badge className="text-[10px] bg-amber-500 text-white">Freight Forwarder</Badge>
                    : <Badge variant="secondary" className="text-[10px] bg-blue-50 text-blue-600">Direct Client</Badge>
                  }
                  <span className="text-sm" title={selected.country || "UK"}>{countryFlag(selected.country || "UK")} {selected.country || "UK"}</span>
                  {selected.researched && <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700">Researched</Badge>}
                  <Button
                    size="sm"
                    onClick={() => setEmailOpen(true)}
                    className="bg-green-600 hover:bg-green-700 text-xs gap-1.5 ml-2"
                  >
                    <Mail size={14} />
                    Email
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setPanelOpen(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-xs gap-1.5"
                  >
                    <MessageCircle size={14} />
                    Account Assistant
                  </Button>
                </div>
                <p className="text-xs text-zinc-400 mt-1">Account: {selected.code} | Last active: {MONTH_LABELS[selected.lastMonth] || selected.lastMonth}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold">{formatGBP(selected.totalProfit)}</p>
                <p className="text-xs text-zinc-400">{formatGBP(selected.avgMonthly)}/mo avg | {selected.months} months</p>
              </div>
            </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto space-y-4 pt-4">

            {/* KPIs */}
            <div className="grid grid-cols-4 lg:grid-cols-7 gap-3">
              <Card><CardContent className="pt-3 pb-2">
                <p className="text-[10px] text-zinc-400">Total Jobs</p>
                <p className="text-lg font-bold">{selected.totalJobs}</p>
              </CardContent></Card>
              <Card><CardContent className="pt-3 pb-2">
                <p className="text-[10px] text-zinc-400">FCL</p>
                <p className="text-lg font-bold text-blue-600">{selected.modes.fcl}</p>
                <p className="text-[10px] text-zinc-400">{formatGBP(selected.modeProfits.fcl)}</p>
              </CardContent></Card>
              <Card className="border-blue-200 bg-blue-50/30"><CardContent className="pt-3 pb-2">
                <p className="text-[10px] text-blue-500 font-medium">Total TEU</p>
                <p className="text-lg font-bold text-blue-700">{selected.totalTeu.toLocaleString()}</p>
                <p className="text-[10px] text-zinc-400">{selected.months > 0 ? Math.round(selected.totalTeu / selected.months) : 0}/mo avg</p>
              </CardContent></Card>
              <Card><CardContent className="pt-3 pb-2">
                <p className="text-[10px] text-zinc-400">LCL</p>
                <p className="text-lg font-bold text-purple-600">{selected.modes.lcl}</p>
                <p className="text-[10px] text-zinc-400">{formatGBP(selected.modeProfits.lcl)}</p>
              </CardContent></Card>
              <Card><CardContent className="pt-3 pb-2">
                <p className="text-[10px] text-zinc-400">Air Jobs</p>
                <p className="text-lg font-bold text-yellow-600">{selected.modes.air}</p>
                <p className="text-[10px] text-zinc-400">{formatGBP(selected.modeProfits.air)}</p>
              </CardContent></Card>
              <Card className="border-yellow-200 bg-yellow-50/30"><CardContent className="pt-3 pb-2">
                <p className="text-[10px] text-yellow-600 font-medium">Total Air KG</p>
                <p className="text-lg font-bold text-yellow-700">{selected.totalAirKg.toLocaleString()}</p>
                <p className="text-[10px] text-zinc-400">{selected.months > 0 ? Math.round(selected.totalAirKg / selected.months).toLocaleString() : 0} kg/mo</p>
              </CardContent></Card>
              <Card><CardContent className="pt-3 pb-2">
                <p className="text-[10px] text-zinc-400">Road/BBK</p>
                <p className="text-lg font-bold text-zinc-600">{selected.modes.bbk}</p>
                <p className="text-[10px] text-zinc-400">{formatGBP(selected.modeProfits.bbk)}</p>
              </CardContent></Card>
              <Card className="border-zinc-300 bg-zinc-50/50"><CardContent className="pt-3 pb-2">
                <p className="text-[10px] text-zinc-500 font-medium">Road CBM</p>
                <p className="text-lg font-bold text-zinc-700">{selected.totalBbkCbm.toLocaleString()}</p>
                <p className="text-[10px] text-zinc-400">{selected.months > 0 ? Math.round(selected.totalBbkCbm / selected.months).toLocaleString() : 0} cbm/mo</p>
              </CardContent></Card>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly Profit</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={selected.monthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `${Math.round(v/1000)}k`} />
                      <Tooltip formatter={(v) => formatGBP(Number(v))} />
                      <Bar dataKey="profit" fill="#ff3366" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Jobs by Mode</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={selected.monthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 9 }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="fcl" name="FCL" fill="#3b82f6" stackId="a" />
                      <Bar dataKey="lcl" name="LCL" fill="#8b5cf6" stackId="a" />
                      <Bar dataKey="air" name="Air" fill="#f59e0b" stackId="a" />
                      <Bar dataKey="bbk" name="BBK" fill="#6b7280" stackId="a" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Volume Trackers */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-blue-700">TEU Tracker</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={selected.monthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="label" tick={{ fontSize: 8 }} />
                      <YAxis tick={{ fontSize: 8 }} />
                      <Tooltip formatter={(v) => [`${v} TEU`, "TEU"]} />
                      <Line type="monotone" dataKey="teu" stroke="#2563eb" strokeWidth={2} dot={{ fill: "#2563eb", r: 3 }} name="TEU" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-yellow-700">Air Freight Tracker (KG)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={selected.monthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="label" tick={{ fontSize: 8 }} />
                      <YAxis tick={{ fontSize: 8 }} tickFormatter={(v) => v >= 1000 ? `${Math.round(v/1000)}t` : `${v}kg`} />
                      <Tooltip formatter={(v) => [`${Number(v).toLocaleString()} kg`, "Air KG"]} />
                      <Line type="monotone" dataKey="air_kg" stroke="#d97706" strokeWidth={2} dot={{ fill: "#d97706", r: 3 }} name="Air KG" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-zinc-700">Road/BBK Tracker (CBM)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={selected.monthly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="label" tick={{ fontSize: 8 }} />
                      <YAxis tick={{ fontSize: 8 }} tickFormatter={(v) => v >= 1000 ? `${Math.round(v/1000)}k` : `${v}`} />
                      <Tooltip formatter={(v) => [`${Number(v).toLocaleString()} CBM`, "Road CBM"]} />
                      <Line type="monotone" dataKey="bbk_cbm" stroke="#4b5563" strokeWidth={2} dot={{ fill: "#4b5563", r: 3 }} name="Road CBM" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Contacts */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Contacts ({contacts.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {contactsLoading ? (
                  <p className="text-xs text-zinc-400">Loading...</p>
                ) : contacts.length === 0 ? (
                  <p className="text-xs text-zinc-400">No contacts on file for this account</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-100">
                      <tr>
                        <th className="p-2 text-left">Name</th>
                        <th className="p-2 text-left">Title</th>
                        <th className="p-2 text-left">Email</th>
                        <th className="p-2 text-left">Phone</th>
                        <th className="p-2 text-left">City</th>
                        <th className="p-2 text-right w-24"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map((c: any) => (
                        editingContact === c.id ? (
                          <tr key={c.id} className="border-t bg-blue-50">
                            <td className="p-1"><input value={editForm.contact_name} onChange={(e) => setEditForm({...editForm, contact_name: e.target.value})} className="w-full px-1.5 py-1 border rounded text-xs" /></td>
                            <td className="p-1"><input value={editForm.job_title} onChange={(e) => setEditForm({...editForm, job_title: e.target.value})} className="w-full px-1.5 py-1 border rounded text-xs" /></td>
                            <td className="p-1"><input value={editForm.email} onChange={(e) => setEditForm({...editForm, email: e.target.value})} className="w-full px-1.5 py-1 border rounded text-xs" /></td>
                            <td className="p-1"><input value={editForm.phone} onChange={(e) => setEditForm({...editForm, phone: e.target.value})} className="w-full px-1.5 py-1 border rounded text-xs" /></td>
                            <td className="p-1"><input value={editForm.city} onChange={(e) => setEditForm({...editForm, city: e.target.value})} className="w-full px-1.5 py-1 border rounded text-xs" /></td>
                            <td className="p-1 text-right">
                              <button onClick={handleSaveContact} className="text-green-600 hover:underline text-[10px] mr-2">Save</button>
                              <button onClick={() => setEditingContact(null)} className="text-zinc-400 hover:underline text-[10px]">Cancel</button>
                            </td>
                          </tr>
                        ) : (
                          <tr key={c.id} className="border-t hover:bg-zinc-50 group">
                            <td className="p-2 font-medium">
                              {c.contact_name}
                              {c.is_default && <span className="ml-1.5 text-[9px] bg-blue-100 text-blue-600 px-1 rounded">Default</span>}
                            </td>
                            <td className="p-2 text-zinc-500">{c.job_title || "-"}</td>
                            <td className="p-2">{c.email ? <a href={`mailto:${c.email}`} className="text-blue-600 hover:underline">{c.email}</a> : "-"}</td>
                            <td className="p-2">
                              {c.phone ? (
                                <span className="flex items-center gap-1.5">
                                  <span>{c.phone}</span>
                                  <a href={`tel:${c.phone}`} title="Call" className="text-green-600 hover:text-green-700">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>
                                  </a>
                                  <a href={`https://teams.microsoft.com/l/call/0/0?users=4:${c.phone}`} target="_blank" title="Teams call" className="text-blue-500 hover:text-blue-600">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19.5 3h-3.8c-.4-1.2-1.5-2-2.8-2h-1.8c-1.3 0-2.4.8-2.8 2H4.5C3.1 3 2 4.1 2 5.5v13C2 19.9 3.1 21 4.5 21h15c1.4 0 2.5-1.1 2.5-2.5v-13C22 4.1 20.9 3 19.5 3zM12 4c.6 0 1 .4 1 1s-.4 1-1 1-1-.4-1-1 .4-1 1-1zm0 5c2.2 0 4 1.8 4 4s-1.8 4-4 4-4-1.8-4-4 1.8-4 4-4z"/></svg>
                                  </a>
                                </span>
                              ) : "-"}
                            </td>
                            <td className="p-2 text-zinc-500">{c.city || "-"}</td>
                            <td className="p-2 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => startEditContact(c)} className="text-blue-600 hover:underline text-[10px] mr-2">Edit</button>
                              <button onClick={() => handleDeleteContact(c.id)} className="text-[#ff3366] hover:underline text-[10px]">Delete</button>
                            </td>
                          </tr>
                        )
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            {/* Account Notes */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Account Notes</CardTitle>
              </CardHeader>
              <CardContent>
                {/* Add note input */}
                <div className="flex gap-2 mb-3">
                  <input
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddNote(); }}
                    placeholder="Add insight, meeting note, or update..."
                    className="flex-1 px-3 py-2 border rounded text-sm"
                  />
                  <Button size="sm" onClick={handleAddNote} disabled={!newNote.trim()}
                    className="bg-[#ff3366] hover:bg-[#e6004d] text-xs">
                    Add
                  </Button>
                </div>

                {/* Notes list */}
                {notesLoading ? (
                  <p className="text-xs text-zinc-400">Loading...</p>
                ) : notes.length === 0 ? (
                  <p className="text-xs text-zinc-400">No notes yet - add your first insight above</p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {notes.map((n: any) => (
                      <div key={n.id} className="flex items-start gap-2 p-2 bg-zinc-50 rounded group">
                        <div className="flex-1">
                          <p className="text-sm">{n.note}</p>
                          <p className="text-[10px] text-zinc-400 mt-1">
                            {n.author && `${n.author} - `}
                            {new Date(n.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDeleteNote(n.id)}
                          className="text-zinc-300 hover:text-[#ff3366] text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Trade data match */}
            {selected.tradeMatch && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">UK Trade Data</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-[10px] text-zinc-400">A++ Score</span>
                      <p className="font-bold text-lg">{selected.tradeMatch.ultimate_score}</p>
                      <Badge className="text-[9px]">{selected.tradeMatch.grade}</Badge>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-400">Import Vol/mo</span>
                      <p className="font-bold">{selected.tradeMatch.import_volume}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-400">Export Vol/mo</span>
                      <p className="font-bold">{selected.tradeMatch.export_volume || "-"}</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-400">Dual Trader</span>
                      <p className="font-bold">{selected.tradeMatch.is_dual ? "Yes" : "No"}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Upsell opportunities */}
            {selected.upsellOpportunities.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-yellow-600">Upsell Opportunities</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {selected.upsellOpportunities.map((o: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="text-yellow-500 mt-0.5">*</span>
                        <span>{o}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Monthly detail table */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly Breakdown</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-xs">
                  <thead className="bg-zinc-100">
                    <tr>
                      <th className="p-2 text-left">Month</th>
                      <th className="p-2 text-right">Profit</th>
                      <th className="p-2 text-right">FCL</th>
                      <th className="p-2 text-right">TEU</th>
                      <th className="p-2 text-right">LCL</th>
                      <th className="p-2 text-right">Air</th>
                      <th className="p-2 text-right">BBK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.monthly.map((m: any) => (
                      <tr key={m.month} className="border-t hover:bg-zinc-50">
                        <td className="p-2">{m.label}</td>
                        <td className="p-2 text-right font-medium">{formatGBP(m.profit)}</td>
                        <td className="p-2 text-right">{m.fcl || "-"}</td>
                        <td className="p-2 text-right">{m.teu || "-"}</td>
                        <td className="p-2 text-right">{m.lcl || "-"}</td>
                        <td className="p-2 text-right">{m.air || "-"}</td>
                        <td className="p-2 text-right">{m.bbk || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-400">Select a client</div>
        )}
      </div>

      {/* Email Composer */}
      {emailOpen && selected && (
        <EmailComposer
          accountCode={selected.code}
          clientName={selected.name}
          onClose={() => setEmailOpen(false)}
        />
      )}

      {/* Account Assistant Panel */}
      {panelOpen && selected && (
        <ClientIntelPanel
          accountCode={selected.code}
          clientName={selected.name}
          isForwarder={selected.isForwarder}
          research={{
            clientNews: selected.clientNews,
            growthSignals: selected.growthSignals,
            retentionRisks: selected.retentionRisks,
            competitorIntel: selected.competitorIntel,
            recommendedAction: selected.recommendedAction,
            accountHealth: selected.accountHealth,
            sourceLinks: selected.sourceLinks || [],
            researchDate: selected.researchDate || "",
            insight: selected.insight || "",
            ffNetworks: selected.ffNetworks || [],
          }}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
    </PageGuard>
  );
}
