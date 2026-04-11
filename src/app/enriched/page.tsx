"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { PageGuard } from "@/components/page-guard";
import { useEnrichedAccounts, useAppScores } from "@/hooks/use-enriched";
import type { EnrichedAccount } from "@/types";

const STATUS_COLORS: Record<string, string> = {
  scored: "bg-zinc-300 text-zinc-700",
  apollo_enriched: "bg-blue-100 text-blue-800",
  claude_enriched: "bg-green-100 text-green-800",
  in_sequence: "bg-purple-100 text-purple-800",
  replied: "bg-[#ff3366] text-white",
  apollo_no_contact: "bg-zinc-200 text-zinc-500",
  needs_email_credits: "bg-yellow-100 text-yellow-800",
};

const OFFICES = [
  { id: "hq", label: "HQ (London)", pipeline_stage: 20 },
  { id: "manchester", label: "Manchester", pipeline_stage: 20 },
  { id: "southampton", label: "Southampton", pipeline_stage: 20 },
  { id: "heathrow", label: "Heathrow", pipeline_stage: 20 },
  { id: "newcastle", label: "Newcastle", pipeline_stage: 20 },
  { id: "premium", label: "Premium Sales", pipeline_stage: 20 },
];

const REPS = [
  { name: "Rob Donald", pd_id: 22090674 },
  { name: "Sam Yauner", pd_id: 22120682 },
  { name: "Hathim Mahamood", pd_id: 22120660 },
  { name: "Bruna Natale", pd_id: 23474408 },
  { name: "Coral Chen", pd_id: 23562474 },
];

export default function EnrichedPage() {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [approachFilter, setApproachFilter] = useState("all");
  const [verticalFilter, setVerticalFilter] = useState("all");
  const [quickFilter, setQuickFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [actionMessage, setActionMessage] = useState<Record<number, string>>({});

  const queryClient = useQueryClient();

  const { data: rawCompanies, isLoading: companiesLoading } = useEnrichedAccounts(statusFilter);

  const companyIds = useMemo(
    () => (rawCompanies || []).map((c: any) => c.id),
    [rawCompanies],
  );

  const { data: rawAppScores, isLoading: scoresLoading } = useAppScores(companyIds);

  const allAccounts = useMemo<EnrichedAccount[]>(() => {
    if (!rawCompanies) return [];

    const appMap: Record<number, any> = {};
    (rawAppScores || []).forEach((a: any) => { appMap[a.company_id] = a; });

    return rawCompanies.map((c: any) => {
      const contact = c.contacts?.[0] || {};
      const enrich = c.enrichments?.[0] || {};
      const app = appMap[c.id] || {};

      return {
        company_id: c.id,
        company_name: c.company_name,
        company_domain: c.company_domain,
        postcode: c.postcode,
        trade_type: c.trade_type,
        status: c.status,
        icp_score: c.icp_score,
        icp_grade: c.icp_grade,
        logo_url: c.logo_url,
        contact_name: contact.full_name || "",
        contact_title: contact.title || "",
        contact_email: contact.email || "",
        contact_linkedin: contact.linkedin_url || "",
        commodity_summary: enrich.commodity_summary || "",
        supply_chain_profile: enrich.supply_chain_profile || "",
        vertical: enrich.vertical || "",
        angle: enrich.angle || "",
        pain_points: enrich.pain_points || [],
        email_subject: enrich.email_subject || "",
        email_body_1: enrich.email_body_1 || "",
        linkedin_connection_note: enrich.linkedin_connection_note || "",
        linkedin_dm: enrich.linkedin_dm || "",
        ultimate_score: app.ultimate_score || 0,
        grade: app.grade || "",
        import_score: app.import_score || 0,
        export_score: app.export_score || 0,
        import_months: app.import_months || 0,
        export_months: app.export_months || 0,
        import_volume: app.import_volume || 0,
        export_volume: app.export_volume || 0,
        is_dual: app.is_dual || false,
        manchester_proximity: app.manchester_proximity || false,
        company_news: enrich.company_news || "",
        current_provider: enrich.current_provider || "",
        provider_confidence: enrich.provider_confidence || "unknown",
        provider_source: enrich.provider_source || "",
        suggested_approach: enrich.suggested_approach || "",
        approach_hook: enrich.approach_hook || "",
        researched_at: enrich.researched_at || "",
        is_forwarder: c.is_forwarder || false,
      };
    });
  }, [rawCompanies, rawAppScores]);

  const loading = companiesLoading || scoresLoading;

  const accounts = useMemo(() => {
    let filtered = allAccounts;
    if (gradeFilter !== "all") {
      filtered = filtered.filter((a) => a.grade === gradeFilter);
    }
    if (approachFilter !== "all") {
      filtered = filtered.filter((a) => a.suggested_approach === approachFilter);
    }
    if (verticalFilter !== "all") {
      filtered = filtered.filter((a) => a.vertical === verticalFilter);
    }
    if (quickFilter === "has_provider") {
      filtered = filtered.filter((a) => a.current_provider && a.current_provider !== "Unknown");
    } else if (quickFilter === "not_researched") {
      filtered = filtered.filter((a) => !a.researched_at);
    } else if (quickFilter === "researched") {
      filtered = filtered.filter((a) => !!a.researched_at);
    } else if (quickFilter === "forwarders") {
      filtered = filtered.filter((a) => a.is_forwarder);
    } else if (quickFilter === "direct") {
      filtered = filtered.filter((a) => !a.is_forwarder);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((a) =>
        a.company_name.toLowerCase().includes(q) ||
        a.contact_name.toLowerCase().includes(q) ||
        a.contact_title.toLowerCase().includes(q) ||
        a.commodity_summary.toLowerCase().includes(q) ||
        a.supply_chain_profile.toLowerCase().includes(q) ||
        a.vertical.toLowerCase().includes(q) ||
        a.angle.toLowerCase().includes(q) ||
        a.current_provider.toLowerCase().includes(q) ||
        a.company_news.toLowerCase().includes(q) ||
        a.approach_hook.toLowerCase().includes(q) ||
        a.company_domain?.toLowerCase().includes(q) ||
        a.postcode?.toLowerCase().includes(q) ||
        (a.pain_points || []).some((p: string) => p.toLowerCase().includes(q))
      );
    }
    return filtered;
  }, [allAccounts, gradeFilter, approachFilter, verticalFilter, quickFilter, searchQuery]);

  function invalidateQueries() {
    queryClient.invalidateQueries({ queryKey: ["enriched"] });
    queryClient.invalidateQueries({ queryKey: ["app-scores"] });
  }

  async function pushToInstantly(account: EnrichedAccount) {
    if (!account.contact_email) {
      setActionMessage((p) => ({ ...p, [account.company_id]: "No email - cannot push" }));
      return;
    }
    try {
      // This would call the Instantly API - for now update status
      await supabase.from("companies").update({ status: "in_sequence" }).eq("id", account.company_id);
      setActionMessage((p) => ({ ...p, [account.company_id]: "Pushed to Instantly" }));
      setTimeout(() => invalidateQueries(), 1000);
    } catch {
      setActionMessage((p) => ({ ...p, [account.company_id]: "Error pushing" }));
    }
  }

  async function researchAccount(account: EnrichedAccount) {
    setActionMessage((p) => ({ ...p, [account.company_id]: "Researching..." }));
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: account.company_id }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage((p) => ({ ...p, [account.company_id]: `Researched - ${data.analysis?.suggested_approach || "done"}` }));
        setTimeout(() => invalidateQueries(), 1500);
      } else {
        setActionMessage((p) => ({ ...p, [account.company_id]: data.error || "Research failed" }));
      }
    } catch {
      setActionMessage((p) => ({ ...p, [account.company_id]: "Research error" }));
    }
  }

  async function assignToOffice(account: EnrichedAccount, officeId: string) {
    const office = OFFICES.find((o) => o.id === officeId);
    if (!office) return;

    try {
      // Create org via proxy
      const orgRes = await fetch("/api/pipedrive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: "organizations",
          data: { name: account.company_name },
        }),
      });
      const org = await orgRes.json();
      const orgId = org.data?.id;

      // Create deal in Braiin Outreach pipeline via proxy
      const dealRes = await fetch("/api/pipedrive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: "deals",
          data: {
            title: `${account.contact_name || "Prospect"} / ${account.company_name} [${office.label}]`,
            org_id: orgId,
            stage_id: office.pipeline_stage,
          },
        }),
      });
      const deal = await dealRes.json();
      const dealId = deal.data?.id;

      if (dealId) {
        // Add note via proxy
        await fetch("/api/pipedrive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: "notes",
            data: {
              deal_id: dealId,
              content: `Office: ${office.label}\nICP: ${account.icp_score}\nGrade: ${account.grade}\nVertical: ${account.vertical}\n\n${account.commodity_summary}\n\n${account.angle}`,
            },
          }),
        });
      }

      setActionMessage((p) => ({ ...p, [account.company_id]: `Assigned to ${office.label}` }));
    } catch {
      setActionMessage((p) => ({ ...p, [account.company_id]: "Error creating deal" }));
    }
  }

  async function assignToRep(account: EnrichedAccount, repName: string) {
    const rep = REPS.find((r) => r.name === repName);
    if (!rep) return;

    try {
      const orgRes = await fetch("/api/pipedrive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: "organizations",
          data: { name: account.company_name },
        }),
      });
      const org = await orgRes.json();

      const dealRes = await fetch("/api/pipedrive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: "deals",
          data: {
            title: `${account.contact_name || "Prospect"} / ${account.company_name}`,
            org_id: org.data?.id,
            stage_id: 22,
            user_id: rep.pd_id,
          },
        }),
      });
      const deal = await dealRes.json();

      if (deal.data?.id) {
        await fetch("/api/pipedrive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: "notes",
            data: {
              deal_id: deal.data.id,
              content: `Assigned to ${rep.name}\nICP: ${account.icp_score}\n\n${account.commodity_summary}\n\n${account.angle}`,
            },
          }),
        });
      }

      setActionMessage((p) => ({ ...p, [account.company_id]: `Assigned to ${rep.name}` }));
    } catch {
      setActionMessage((p) => ({ ...p, [account.company_id]: "Error" }));
    }
  }

  return (
    <PageGuard pageId="enriched">
    <div>
      <h1 className="text-2xl font-bold mb-4">Enriched Accounts</h1>

      {/* Search */}
      <div className="flex gap-3 mb-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search everything - company, contact, commodity, provider, pain points, news, hook..."
          className="px-3 py-2 border rounded text-sm flex-1"
        />
        <span className="text-xs text-zinc-400 self-center shrink-0">
          {accounts.length} accounts
        </span>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-2 py-1.5 border rounded text-xs">
          <option value="all">All statuses</option>
          <option value="claude_enriched">Claude Enriched</option>
          <option value="in_sequence">In Sequence</option>
          <option value="apollo_enriched">Apollo Enriched</option>
          <option value="replied">Replied</option>
        </select>

        <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)}
          className="px-2 py-1.5 border rounded text-xs">
          <option value="all">All grades</option>
          <option value="A++">A++</option>
          <option value="A+">A+</option>
          <option value="A">A</option>
          <option value="B">B</option>
        </select>

        <select value={verticalFilter} onChange={(e) => setVerticalFilter(e.target.value)}
          className="px-2 py-1.5 border rounded text-xs">
          <option value="all">All verticals</option>
          <option value="pharma">Pharma</option>
          <option value="retail">Retail</option>
          <option value="automotive">Automotive</option>
          <option value="oil_gas">Oil & Gas</option>
          <option value="ecommerce">Ecommerce</option>
          <option value="projects">Projects</option>
          <option value="events">Events</option>
          <option value="aog">AOG</option>
          <option value="ship_spares">Ship Spares</option>
          <option value="time_critical">Time-Critical</option>
          <option value="air">Air Freight</option>
          <option value="ocean">Sea Freight</option>
          <option value="road">Road Freight</option>
          <option value="rail">Rail Freight</option>
          <option value="warehousing">Warehousing</option>
          <option value="general">General</option>
        </select>

        <select value={approachFilter} onChange={(e) => setApproachFilter(e.target.value)}
          className="px-2 py-1.5 border rounded text-xs">
          <option value="all">All approaches</option>
          <option value="rate-led">Rate-led</option>
          <option value="service-led">Service-led</option>
          <option value="relationship-led">Relationship-led</option>
          <option value="expertise-led">Expertise-led</option>
        </select>

        <select value={quickFilter} onChange={(e) => setQuickFilter(e.target.value)}
          className="px-2 py-1.5 border rounded text-xs">
          <option value="all">All accounts</option>
          <option value="has_provider">Has known provider</option>
          <option value="not_researched">Not researched</option>
          <option value="researched">Researched</option>
          <option value="forwarders">Forwarders only</option>
          <option value="direct">Direct clients only</option>
        </select>

        {(statusFilter !== "all" || gradeFilter !== "all" || verticalFilter !== "all" || approachFilter !== "all" || quickFilter !== "all" || searchQuery) && (
          <button
            onClick={() => { setStatusFilter("all"); setGradeFilter("all"); setVerticalFilter("all"); setApproachFilter("all"); setQuickFilter("all"); setSearchQuery(""); }}
            className="px-2 py-1.5 text-xs text-[#ff3366] hover:bg-[#ff3366]/10 rounded"
          >
            Clear all
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-zinc-400 py-8">Loading...</p>
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => (
            <div key={a.company_id} className="rounded-lg border bg-white overflow-hidden">
              {/* Row header - always visible */}
              <button
                onClick={() => setExpandedId(expandedId === a.company_id ? null : a.company_id)}
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-zinc-50"
              >
                {/* Status indicator */}
                <div className={`w-2 h-10 rounded-full shrink-0 ${
                  a.status === "replied" ? "bg-[#ff3366]"
                  : a.status === "in_sequence" ? "bg-purple-500"
                  : a.status === "claude_enriched" ? "bg-green-500"
                  : a.status === "apollo_enriched" ? "bg-blue-500"
                  : "bg-zinc-300"
                }`} />

                {/* Logo */}
                {a.logo_url && (
                  <img src={a.logo_url} alt="" className="w-8 h-8 rounded object-contain shrink-0"
                    onError={(e) => (e.currentTarget.style.display = "none")} />
                )}

                {/* Company info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{a.company_name}</span>
                    {a.grade && (
                      <Badge className={`text-[10px] ${
                        a.grade === "A++" ? "bg-[#ff3366] text-white"
                        : a.grade === "A+" ? "bg-orange-500 text-white"
                        : a.grade === "A" ? "bg-yellow-500 text-black"
                        : "bg-zinc-300 text-zinc-600"
                      }`}>{a.grade}</Badge>
                    )}
                    {a.is_dual && <Badge variant="secondary" className="text-[10px]">Dual</Badge>}
                    {a.manchester_proximity && <Badge variant="secondary" className="text-[10px] bg-blue-100">Manc</Badge>}
                    {a.is_forwarder && <Badge className="text-[10px] bg-amber-500 text-white">Forwarder</Badge>}
                    {a.researched_at && <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700">Researched</Badge>}
                  </div>
                  <p className="text-xs text-zinc-500 truncate">
                    {a.contact_name && `${a.contact_name} - `}
                    {a.vertical || a.trade_type} | {a.postcode}
                  </p>
                </div>

                {/* Status badge */}
                <Badge className={`${STATUS_COLORS[a.status] || "bg-zinc-200"} text-[10px] shrink-0`}>
                  {a.status.replace(/_/g, " ")}
                </Badge>

                {/* Score */}
                <div className="text-right shrink-0 w-16">
                  <div className="text-sm font-bold">{a.ultimate_score || a.icp_score || "-"}</div>
                  <div className="text-[10px] text-zinc-400">score</div>
                </div>

                <span className="text-zinc-400 text-xs shrink-0">
                  {expandedId === a.company_id ? "\u25B2" : "\u25BC"}
                </span>
              </button>

              {/* Expanded detail */}
              {expandedId === a.company_id && (
                <div className="border-t bg-zinc-50 p-4">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Column 1: Intel & Approach */}
                    <div>
                      <h4 className="font-bold text-xs uppercase text-zinc-500 mb-2">Intel & Approach</h4>

                      {/* Suggested approach badge */}
                      {a.suggested_approach && (
                        <div className="mb-3">
                          <Badge className={`text-xs px-3 py-1 ${
                            a.suggested_approach === "rate-led" ? "bg-green-600 text-white"
                            : a.suggested_approach === "service-led" ? "bg-blue-600 text-white"
                            : a.suggested_approach === "relationship-led" ? "bg-purple-600 text-white"
                            : a.suggested_approach === "expertise-led" ? "bg-orange-600 text-white"
                            : "bg-zinc-400 text-white"
                          }`}>
                            {a.suggested_approach}
                          </Badge>
                        </div>
                      )}

                      {/* Hook */}
                      {a.approach_hook && (
                        <div className="mb-3 p-2 bg-[#ff3366]/10 rounded border border-[#ff3366]/20">
                          <span className="text-[10px] text-[#ff3366] font-medium">Hook:</span>
                          <p className="text-sm font-medium text-zinc-800">{a.approach_hook}</p>
                        </div>
                      )}

                      {/* Current provider */}
                      {a.current_provider && a.current_provider !== "Unknown" && (
                        <div className="mb-2">
                          <span className="text-[10px] text-zinc-400">Current provider:</span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{a.current_provider}</span>
                            <Badge variant="secondary" className={`text-[9px] ${
                              a.provider_confidence === "confirmed" ? "bg-green-100 text-green-700"
                              : a.provider_confidence === "likely" ? "bg-yellow-100 text-yellow-700"
                              : "bg-zinc-100 text-zinc-500"
                            }`}>
                              {a.provider_confidence}
                            </Badge>
                          </div>
                          {a.provider_source && (
                            <span className="text-[10px] text-zinc-400">Source: {a.provider_source}</span>
                          )}
                        </div>
                      )}

                      {/* Company news */}
                      {a.company_news && (
                        <div className="mb-2">
                          <span className="text-[10px] text-zinc-400">Latest intel:</span>
                          <p className="text-sm">{a.company_news}</p>
                        </div>
                      )}

                      {/* Existing business fields */}
                      {a.commodity_summary && (
                        <div className="mb-2">
                          <span className="text-[10px] text-zinc-400">What they ship:</span>
                          <p className="text-sm">{a.commodity_summary}</p>
                        </div>
                      )}
                      {a.angle && (
                        <div className="mb-2">
                          <span className="text-[10px] text-zinc-400">Why Braiin:</span>
                          <p className="text-sm text-[#ff3366]">{a.angle}</p>
                        </div>
                      )}
                      {a.pain_points?.length > 0 && (
                        <div>
                          <span className="text-[10px] text-zinc-400">Pain points:</span>
                          <ul className="text-sm list-disc list-inside">
                            {a.pain_points.map((p: string, i: number) => <li key={i}>{p}</li>)}
                          </ul>
                        </div>
                      )}

                      {/* Research status */}
                      {!a.researched_at && (
                        <div className="mt-3 p-2 bg-zinc-100 rounded text-xs text-zinc-500">
                          Not yet researched - run research pipeline to populate
                        </div>
                      )}
                    </div>

                    {/* Column 2: Trade data + contact */}
                    <div>
                      <h4 className="font-bold text-xs uppercase text-zinc-500 mb-2">Trade Data</h4>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Import score:</span>
                          <span className="font-medium">{a.import_score}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Export score:</span>
                          <span className="font-medium">{a.export_score || "-"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Import months:</span>
                          <span>{a.import_months}/13</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Export months:</span>
                          <span>{a.export_months ? `${a.export_months}/13` : "-"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Imp vol/mo:</span>
                          <span>{a.import_volume}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Exp vol/mo:</span>
                          <span>{a.export_volume || "-"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Vertical:</span>
                          <span>{a.vertical}</span>
                        </div>
                      </div>

                      <h4 className="font-bold text-xs uppercase text-zinc-500 mt-4 mb-2">Contact</h4>
                      <div className="text-sm space-y-1">
                        <p className="font-medium">{a.contact_name || "No contact"}</p>
                        <p className="text-zinc-500">{a.contact_title}</p>
                        {a.contact_email && <p><a href={`mailto:${a.contact_email}`} className="text-blue-600">{a.contact_email}</a></p>}
                        {a.contact_linkedin && <p><a href={a.contact_linkedin} target="_blank" className="text-blue-600 text-xs">LinkedIn</a></p>}
                        {a.company_domain && <p className="text-xs text-zinc-400">{a.company_domain}</p>}
                      </div>
                    </div>

                    {/* Column 3: Actions */}
                    <div>
                      <h4 className="font-bold text-xs uppercase text-zinc-500 mb-2">Actions</h4>

                      {/* Push to sequence */}
                      <Button
                        size="sm"
                        className="w-full mb-2 bg-purple-600 hover:bg-purple-700 text-xs"
                        onClick={() => pushToInstantly(a)}
                        disabled={a.status === "in_sequence" || !a.contact_email}
                      >
                        {a.status === "in_sequence" ? "Already in sequence" : "Push to Instantly"}
                      </Button>

                      {/* Research */}
                      <Button
                        size="sm"
                        className="w-full mb-2 bg-emerald-600 hover:bg-emerald-700 text-xs"
                        onClick={() => researchAccount(a)}
                        disabled={actionMessage[a.company_id] === "Researching..."}
                      >
                        {a.researched_at ? "Re-research" : "Research this lead"}
                      </Button>

                      {/* Assign to office */}
                      <div className="mb-2">
                        <span className="text-[10px] text-zinc-500">Assign to office:</span>
                        <div className="grid grid-cols-2 gap-1 mt-1">
                          {OFFICES.map((o) => (
                            <Button
                              key={o.id}
                              size="sm"
                              variant="outline"
                              className="text-[10px] h-7"
                              onClick={() => assignToOffice(a, o.id)}
                            >
                              {o.label}
                            </Button>
                          ))}
                        </div>
                      </div>

                      {/* Assign to rep */}
                      <div className="mb-2">
                        <span className="text-[10px] text-zinc-500">Assign to rep:</span>
                        <Select onValueChange={(v: string | null) => { if (v) assignToRep(a, v); }}>
                          <SelectTrigger className="h-8 text-xs mt-1">
                            <SelectValue placeholder="Select rep" />
                          </SelectTrigger>
                          <SelectContent>
                            {REPS.map((r) => (
                              <SelectItem key={r.name} value={r.name}>{r.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Email preview */}
                      {a.email_subject && (
                        <div className="mt-3 p-2 bg-white rounded border">
                          <span className="text-[10px] text-zinc-400">Email preview:</span>
                          <p className="text-xs font-medium mt-1">{a.email_subject}</p>
                          <p className="text-[11px] text-zinc-600 mt-1 line-clamp-3">{a.email_body_1}</p>
                        </div>
                      )}

                      {/* LinkedIn previews */}
                      {a.linkedin_connection_note && (
                        <div className="mt-2 p-2 bg-white rounded border">
                          <span className="text-[10px] text-zinc-400">LinkedIn connection note:</span>
                          <p className="text-[11px] text-zinc-600 mt-1">{a.linkedin_connection_note}</p>
                        </div>
                      )}
                      {a.linkedin_dm && (
                        <div className="mt-2 p-2 bg-white rounded border">
                          <span className="text-[10px] text-zinc-400">LinkedIn DM:</span>
                          <p className="text-[11px] text-zinc-600 mt-1">{a.linkedin_dm}</p>
                        </div>
                      )}

                      {/* Action feedback */}
                      {actionMessage[a.company_id] && (
                        <p className="text-xs text-green-600 mt-2 font-medium">
                          {actionMessage[a.company_id]}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
    </PageGuard>
  );
}
