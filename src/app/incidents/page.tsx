"use client";

import { useState } from "react";
import { useIncidents, useUpdateIncident } from "@/hooks/use-incidents";
import { IncidentForm } from "@/components/incident-form";
import { MessageThread } from "@/components/message-thread";
import { PageGuard } from "@/components/page-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Plus, X } from "lucide-react";
import type { Incident } from "@/types";

const SEVERITY_COLORS: Record<string, string> = {
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  black: "bg-zinc-900 text-white",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-50 text-blue-700",
  investigating: "bg-purple-50 text-purple-700",
  resolved: "bg-green-50 text-green-700",
  escalated: "bg-red-50 text-red-700",
};

export default function IncidentsPage() {
  const [severityFilter, setSeverityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<Incident | null>(null);

  const { data: incidents } = useIncidents({
    severity: severityFilter || undefined,
    status: statusFilter || undefined,
  });
  const updateIncident = useUpdateIncident();

  const allIncidents = (incidents || []) as Incident[];
  const openCounts = {
    amber: allIncidents.filter(i => i.severity === "amber" && i.status !== "resolved").length,
    red: allIncidents.filter(i => i.severity === "red" && i.status !== "resolved").length,
    black: allIncidents.filter(i => i.severity === "black" && i.status !== "resolved").length,
  };

  return (
    <PageGuard pageId="incidents">
    <div className="h-[calc(100vh-48px)] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-3">
          <AlertTriangle size={18} />
          <h1 className="text-lg font-semibold">Incidents</h1>
          <div className="flex gap-2 ml-4">
            {openCounts.amber > 0 && <Badge className="bg-amber-100 text-amber-800 text-[10px]">Amber: {openCounts.amber}</Badge>}
            {openCounts.red > 0 && <Badge className="bg-red-100 text-red-800 text-[10px]">Red: {openCounts.red}</Badge>}
            {openCounts.black > 0 && <Badge className="bg-zinc-900 text-white text-[10px]">Black: {openCounts.black}</Badge>}
          </div>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} className="bg-zinc-900 hover:bg-zinc-800 text-xs gap-1">
          <Plus size={12} /> Raise Incident
        </Button>
      </div>

      {/* Filters */}
      <div className="px-4 py-2 border-b flex gap-2">
        <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}
          className="px-2 py-1 border rounded text-xs">
          <option value="">All severities</option>
          <option value="amber">Amber</option>
          <option value="red">Red</option>
          <option value="black">Black</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-2 py-1 border rounded text-xs">
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="investigating">Investigating</option>
          <option value="escalated">Escalated</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Incident list */}
        <div className="w-[480px] border-r overflow-y-auto shrink-0">
          {showCreate ? (
            <div className="p-4">
              <IncidentForm onClose={() => setShowCreate(false)} />
            </div>
          ) : allIncidents.length === 0 ? (
            <p className="text-sm text-zinc-400 p-4">No incidents</p>
          ) : (
            allIncidents.map(inc => (
              <button key={inc.id} onClick={() => { setSelected(inc); setShowCreate(false); }}
                className={`w-full text-left px-4 py-3 border-b hover:bg-zinc-50 ${selected?.id === inc.id ? "bg-zinc-50" : ""}`}>
                <div className="flex items-start gap-2">
                  <Badge className={`${SEVERITY_COLORS[inc.severity]} text-[9px] shrink-0 mt-0.5`}>
                    {inc.severity.toUpperCase()}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{inc.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge className={`${STATUS_COLORS[inc.status]} text-[8px]`}>{inc.status}</Badge>
                      {inc.account_code && <span className="text-[10px] text-zinc-400">{inc.account_code}</span>}
                      {inc.job_reference && <span className="text-[10px] text-zinc-400">{inc.job_reference}</span>}
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-0.5">
                      {inc.raised_by_name} - {new Date(inc.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Incident detail + thread */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selected ? (
            <>
              <div className="p-4 border-b shrink-0">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={`${SEVERITY_COLORS[selected.severity]} text-[9px]`}>
                        {selected.severity.toUpperCase()}
                      </Badge>
                      <Badge className={`${STATUS_COLORS[selected.status]} text-[9px]`}>
                        {selected.status}
                      </Badge>
                    </div>
                    <h2 className="text-sm font-semibold">{selected.title}</h2>
                    {selected.description && <p className="text-xs text-zinc-600 mt-1">{selected.description}</p>}
                  </div>
                  <button onClick={() => setSelected(null)} className="p-1 hover:bg-zinc-100 rounded">
                    <X size={14} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[10px] text-zinc-400">
                  {selected.account_code && <span>Client: <strong className="text-zinc-600">{selected.account_code}</strong></span>}
                  {selected.supplier_account_code && <span>Supplier: <strong className="text-zinc-600">{selected.supplier_account_code}</strong></span>}
                  {selected.job_reference && <span>Job: <strong className="text-zinc-600">{selected.job_reference}</strong></span>}
                  {(selected as any).responsible_party && <span>Responsible: <strong className="text-zinc-600">{(selected as any).responsible_party}</strong> ({(selected as any).responsible_type || "unknown"})</span>}
                  {selected.financial_impact && <span>Impact: <strong className="text-red-600">{selected.financial_impact.toLocaleString("en-GB", { style: "currency", currency: "GBP" })}</strong></span>}
                  {(selected as any).cost_claimed && <span>Claimed: {Number((selected as any).cost_claimed).toLocaleString("en-GB", { style: "currency", currency: "GBP" })}</span>}
                  {(selected as any).cost_recovered && <span>Recovered: <strong className="text-green-600">{Number((selected as any).cost_recovered).toLocaleString("en-GB", { style: "currency", currency: "GBP" })}</strong></span>}
                  {(selected as any).cost_written_off && <span>Written off: {Number((selected as any).cost_written_off).toLocaleString("en-GB", { style: "currency", currency: "GBP" })}</span>}
                  <span>Raised by {selected.raised_by_name}</span>
                </div>
                {(selected as any).root_cause && (
                  <div className="mt-2 text-[10px] text-zinc-500">Root cause: {(selected as any).root_cause}</div>
                )}
                {selected.status !== "resolved" && (
                  <div className="flex gap-1.5 mt-3">
                    {selected.status === "open" && (
                      <Button size="sm" variant="outline" className="text-[10px]"
                        onClick={() => updateIncident.mutate({ id: selected.id, status: "investigating" })}>
                        Start investigating
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="text-[10px]"
                      onClick={() => updateIncident.mutate({ id: selected.id, status: "resolved" })}>
                      Resolve
                    </Button>
                  </div>
                )}
                {selected.resolution_notes && (
                  <div className="mt-2 p-2 bg-green-50 rounded text-xs text-green-700">
                    Resolved: {selected.resolution_notes}
                  </div>
                )}
                {(selected as any).preventive_action && (
                  <div className="mt-1 p-2 bg-blue-50 rounded text-xs text-blue-700">
                    Preventive action: {(selected as any).preventive_action}
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-hidden">
                <MessageThread
                  contextType="incident"
                  contextId={String(selected.id)}
                  contextSummary={`${selected.severity.toUpperCase()}: ${selected.title}`}
                  contextUrl={`/incidents?id=${selected.id}`}
                />
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
              Select an incident to view details
            </div>
          )}
        </div>
      </div>
    </div>
    </PageGuard>
  );
}
