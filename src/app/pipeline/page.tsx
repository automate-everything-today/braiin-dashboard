"use client";

import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, X, Save, Clock, AlertTriangle } from "lucide-react";
import { IntelSection } from "@/components/intel-section";
import { PageGuard } from "@/components/page-guard";
import { toast } from "sonner";
import { formatGBP } from "@/lib/utils";
import * as dealService from "@/services/deals";
import type { Deal } from "@/services/deals";
import { useStaff } from "@/hooks/use-staff";
import { supabase } from "@/lib/supabase";
import { DealWorkspace } from "@/components/deal-workspace";

const SOURCES = ["cold_call", "cold_email", "linkedin", "web_enquiry", "email_inbound", "agent_request", "internal_referral", "event", "referral", "enrichment"];

export default function PipelinePage() {
  const qc = useQueryClient();
  const [selectedPipeline, setSelectedPipeline] = useState<number | null>(null);
  const [showNewDeal, setShowNewDeal] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [newDeal, setNewDeal] = useState({ company_name: "", contact_name: "", contact_email: "", website: "", description: "", value: 0, source: "", assigned_to: "", notes: "", account_code: "", company_id: 0 });
  const [companySuggestions, setCompanySuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  async function searchCompany(query: string) {
    if (query.length < 2) { setCompanySuggestions([]); return; }
    // Search companies, client_performance, and cargowise_contacts
    const [{ data: companies }, { data: clients }] = await Promise.all([
      supabase.from("companies").select("id, company_name, company_domain, account_code, logo_url, icp_score")
        .ilike("company_name", `%${query}%`).limit(5),
      supabase.from("client_performance").select("account_code, client_name")
        .ilike("client_name", `%${query}%`).limit(5),
    ]);
    const results: any[] = [];
    const seen = new Set<string>();
    (clients || []).forEach((c: any) => {
      if (!seen.has(c.account_code)) {
        seen.add(c.account_code);
        results.push({ name: c.client_name, account_code: c.account_code, type: "client" });
      }
    });
    (companies || []).forEach((c: any) => {
      const key = c.account_code || `id-${c.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ name: c.company_name, company_id: c.id, account_code: c.account_code, domain: c.company_domain, type: c.icp_score ? "prospect" : "company" });
      }
    });
    setCompanySuggestions(results.slice(0, 8));
    setShowSuggestions(results.length > 0);
  }

  function selectCompany(suggestion: any) {
    setNewDeal(prev => ({
      ...prev,
      company_name: suggestion.name,
      account_code: suggestion.account_code || "",
      company_id: suggestion.company_id || 0,
      website: suggestion.domain || prev.website,
    }));
    setShowSuggestions(false);
  }

  // Queries
  const { data: staffList = [] } = useStaff();
  const { data: pipelineTypes = [] } = useQuery({ queryKey: ["pipeline-types"], queryFn: dealService.getPipelineTypes });
  const { data: allStages = [] } = useQuery({ queryKey: ["pipeline-stages"], queryFn: () => dealService.getPipelineStages() });
  const { data: deals = [], isLoading } = useQuery({ queryKey: ["deals", selectedPipeline], queryFn: () => dealService.getDeals(selectedPipeline || undefined) });
  // Set default pipeline
  useEffect(() => {
    if (pipelineTypes.length > 0 && !selectedPipeline) {
      setSelectedPipeline(pipelineTypes[0].id);
    }
  }, [pipelineTypes, selectedPipeline]);

  // Mutations
  const createDeal = useMutation({
    mutationFn: (deal: Partial<Deal>) => dealService.createDeal(deal),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["deals"] }); toast.success("Deal created"); },
    onError: () => toast.error("Failed to create deal"),
  });

  // Current pipeline stages
  const stages = useMemo(() => {
    if (!selectedPipeline) return [];
    return allStages.filter(s => s.pipeline_type_id === selectedPipeline).sort((a, b) => a.position - b.position);
  }, [allStages, selectedPipeline]);

  // Deals grouped by stage
  const dealsByStage = useMemo(() => {
    const grouped: Record<number, Deal[]> = {};
    stages.forEach(s => { grouped[s.id] = []; });
    deals.forEach(d => {
      if (d.stage_id && grouped[d.stage_id]) {
        grouped[d.stage_id].push(d);
      } else if (stages.length > 0) {
        // Deals without stage_id go to first stage
        grouped[stages[0].id]?.push(d);
      }
    });
    return grouped;
  }, [deals, stages]);

  // Pipeline stats
  const totalValue = deals.reduce((s, d) => s + (d.value || 0), 0);
  const weightedValue = deals.reduce((s, d) => s + (d.value || 0) * ((d.probability || 0) / 100), 0);
  const staleCount = deals.filter(d => d.is_stale).length;

  async function handleCreateDeal() {
    if ((!newDeal.contact_name && !newDeal.company_name) || !selectedPipeline || stages.length === 0) return;
    const title = [newDeal.contact_name, newDeal.company_name].filter(Boolean).join(" | ");
    await createDeal.mutateAsync({
      title,
      company_name: newDeal.company_name,
      contact_name: newDeal.contact_name,
      contact_email: newDeal.contact_email,
      website: newDeal.website,
      description: newDeal.description,
      account_code: newDeal.account_code,
      company_id: newDeal.company_id || undefined,
      value: newDeal.value,
      source: newDeal.source,
      assigned_to: newDeal.assigned_to,
      notes: newDeal.notes,
      pipeline_type_id: selectedPipeline,
      stage_id: stages[0].id,
      stage: stages[0].name,
      probability: stages[0].probability,
    });
    setShowNewDeal(false);
    setNewDeal({ company_name: "", contact_name: "", contact_email: "", website: "", description: "", value: 0, source: "", assigned_to: "", notes: "", account_code: "", company_id: 0 });
  }

  if (isLoading) return <p className="text-zinc-400 py-12">Loading pipeline...</p>;

  return (
    <PageGuard pageId="pipeline">
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Pipeline</h1>
        <Button size="sm" onClick={() => setShowNewDeal(true)} className="bg-[#ff3366] hover:bg-[#e6004d] text-xs gap-1.5">
          <Plus size={14} /> New Deal
        </Button>
      </div>

      {/* Pipeline type selector */}
      <div className="flex gap-2 mb-2">
        {pipelineTypes.map(pt => (
          <button key={pt.id} onClick={() => setSelectedPipeline(pt.id)}
            className={`px-3 py-1.5 rounded text-xs font-medium ${selectedPipeline === pt.id ? "bg-[#1B2A4A] text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}>
            {pt.name}
          </button>
        ))}
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 mb-4 text-xs text-zinc-500">
        <span>{deals.length} deals</span>
        <span>Total: {formatGBP(totalValue)}</span>
        <span>Weighted: {formatGBP(weightedValue)}</span>
        {staleCount > 0 && <span className="text-red-600 font-medium">{staleCount} stale</span>}
      </div>

      {/* New deal form */}
      {showNewDeal && (
        <Card className="mb-4 border-green-300">
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <div><label className="text-[10px] text-zinc-500">Contact Name *</label>
                <input value={newDeal.contact_name} onChange={e => setNewDeal({ ...newDeal, contact_name: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" placeholder="e.g. John Smith" /></div>
              <div className="relative"><label className="text-[10px] text-zinc-500">Company *</label>
                <input value={newDeal.company_name} onChange={e => { setNewDeal({ ...newDeal, company_name: e.target.value }); searchCompany(e.target.value); }}
                  onFocus={() => companySuggestions.length > 0 && setShowSuggestions(true)}
                  className="w-full px-2 py-1.5 border rounded text-sm" placeholder="Start typing to search..." />
                {showSuggestions && companySuggestions.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {companySuggestions.map((s, i) => (
                      <button key={i} onClick={() => selectCompany(s)}
                        className="w-full text-left px-3 py-2 hover:bg-zinc-50 border-b last:border-0 text-sm">
                        <span className="font-medium">{s.name}</span>
                        <div className="flex gap-1.5 mt-0.5">
                          <Badge className={`text-[8px] ${s.type === "client" ? "bg-green-100 text-green-700" : s.type === "prospect" ? "bg-blue-100 text-blue-700" : "bg-zinc-100 text-zinc-500"}`}>
                            {s.type}
                          </Badge>
                          {s.account_code && <span className="text-[10px] text-zinc-400">{s.account_code}</span>}
                          {s.domain && <span className="text-[10px] text-zinc-400">{s.domain}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}</div>
              <div><label className="text-[10px] text-zinc-500">Email</label>
                <input type="email" value={newDeal.contact_email} onChange={e => setNewDeal({ ...newDeal, contact_email: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" placeholder="john@company.com" /></div>
              <div><label className="text-[10px] text-zinc-500">Website</label>
                <input value={newDeal.website} onChange={e => setNewDeal({ ...newDeal, website: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" placeholder="company.com" /></div>
              <div className="col-span-2"><label className="text-[10px] text-zinc-500">What's the deal?</label>
                <input value={newDeal.description} onChange={e => setNewDeal({ ...newDeal, description: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" placeholder="e.g. FCL Ocean from Shanghai, 2x 40HQ per month" /></div>
              <div><label className="text-[10px] text-zinc-500">Est. Value (£)</label>
                <input type="number" value={newDeal.value} onChange={e => setNewDeal({ ...newDeal, value: Number(e.target.value) })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
              <div><label className="text-[10px] text-zinc-500">Source</label>
                <select value={newDeal.source} onChange={e => setNewDeal({ ...newDeal, source: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm">
                  <option value="">Select source</option>
                  {SOURCES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                </select></div>
              <div><label className="text-[10px] text-zinc-500">Assigned To</label>
                <select value={newDeal.assigned_to} onChange={e => setNewDeal({ ...newDeal, assigned_to: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm">
                  <option value="">Unassigned</option>
                  {staffList.filter((s: any) => s.department === "Sales" || s.department === "Management").map((s: any) => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select></div>
              <div className="col-span-2"><label className="text-[10px] text-zinc-500">Notes</label>
                <input value={newDeal.notes} onChange={e => setNewDeal({ ...newDeal, notes: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreateDeal} disabled={!newDeal.contact_name && !newDeal.company_name} className="bg-green-600 hover:bg-green-700 text-xs gap-1"><Save size={12} /> Create Deal</Button>
              <Button size="sm" variant="outline" onClick={() => setShowNewDeal(false)} className="text-xs"><X size={12} /> Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Kanban board */}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.filter(s => s.name !== "Won" && s.name !== "Lost" && s.name !== "Active" && s.name !== "Dormant").map(stage => {
          const stageDeals = dealsByStage[stage.id] || [];
          const stageValue = stageDeals.reduce((s, d) => s + (d.value || 0), 0);

          return (
            <div key={stage.id} className="min-w-[260px] w-[260px] shrink-0">
              {/* Stage header */}
              <div className="flex items-center justify-between mb-2 px-1">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
                  <span className="text-xs font-bold text-zinc-700">{stage.name}</span>
                  <Badge variant="secondary" className="text-[9px]">{stageDeals.length}</Badge>
                </div>
                <span className="text-[10px] text-zinc-400">{formatGBP(stageValue)}</span>
              </div>

              {/* Deal cards */}
              <div className="space-y-2">
                {stageDeals.map(deal => (
                  <div key={deal.id}
                    onClick={() => setSelectedDeal(deal)}
                    className={`bg-white rounded-lg border p-3 cursor-pointer hover:shadow-md transition-shadow ${deal.is_stale ? "border-red-300" : "border-zinc-200"}`}>
                    <div className="flex items-start justify-between mb-1">
                      <span className="text-sm font-medium leading-tight">{deal.title}</span>
                      {deal.is_stale && <AlertTriangle size={12} className="text-red-500 shrink-0 mt-0.5" />}
                    </div>
                    {deal.company_name && <p className="text-xs text-zinc-500">{deal.company_name}</p>}
                    <div className="flex items-center justify-between mt-2">
                      {deal.value > 0 && <span className="text-xs font-bold text-[#ff3366]">{formatGBP(deal.value)}</span>}
                      <div className="flex items-center gap-1 text-[10px] text-zinc-400">
                        <Clock size={10} />
                        <span>{deal.days_in_stage}d</span>
                      </div>
                    </div>
                    {deal.assigned_to && <p className="text-[10px] text-zinc-400 mt-1">{deal.assigned_to}</p>}
                    {deal.source && <Badge variant="secondary" className="text-[8px] mt-1">{deal.source.replace(/_/g, " ")}</Badge>}
                  </div>
                ))}

                {stageDeals.length === 0 && (
                  <div className="border-2 border-dashed border-zinc-200 rounded-lg p-4 text-center text-xs text-zinc-400">
                    No deals
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Won/Lost/Active/Dormant summary columns */}
        {stages.filter(s => ["Won", "Lost", "Active", "Dormant"].includes(s.name)).map(stage => {
          const stageDeals = dealsByStage[stage.id] || [];
          return (
            <div key={stage.id} className="min-w-[180px] w-[180px] shrink-0">
              <div className="flex items-center gap-2 mb-2 px-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
                <span className="text-xs font-bold text-zinc-700">{stage.name}</span>
                <Badge variant="secondary" className="text-[9px]">{stageDeals.length}</Badge>
              </div>
              <div className="bg-zinc-50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold">{stageDeals.length}</p>
                <p className="text-[10px] text-zinc-400">{formatGBP(stageDeals.reduce((s, d) => s + (d.value || 0), 0))}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Deal Workspace */}
      {selectedDeal && (
        <DealWorkspace
          deal={selectedDeal}
          stages={stages}
          onClose={() => setSelectedDeal(null)}
          onUpdate={() => qc.invalidateQueries({ queryKey: ["deals"] })}
        />
      )}
    </div>
    </PageGuard>
  );
}
