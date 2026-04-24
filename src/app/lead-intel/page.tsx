"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { CUSTOMER } from "@/config/customer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageGuard } from "@/components/page-guard";

const URGENCY_COLORS: Record<string, string> = {
  high: "bg-[#ff3366] text-white",
  medium: "bg-yellow-500 text-black",
  low: "bg-zinc-400 text-white",
};

const REPS = [
  { name: "Rob Donald", pd_id: 22090674 },
  { name: "Sam Yauner", pd_id: 22120682 },
  { name: "Hathim Mahamood", pd_id: 22120660 },
  { name: "Bruna Natale", pd_id: 23474408 },
  { name: "Coral Chen", pd_id: 23562474 },
];

const OFFICES = ["HQ (London)", "Manchester", "Southampton", "Heathrow", "Premium Sales"];

function EditableField({ label, value, field, onSave, multiline = false }: {
  label: string; value: string; field: string; onSave: (field: string, value: string) => void; multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  useEffect(() => { setDraft(value || ""); }, [value]);

  if (editing) {
    return (
      <div className="mb-3">
        <label className="text-[10px] text-zinc-400 uppercase font-medium">{label}</label>
        {multiline ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full mt-1 px-2 py-1.5 border rounded text-sm min-h-[60px]"
            autoFocus
          />
        ) : (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full mt-1 px-2 py-1.5 border rounded text-sm"
            autoFocus
          />
        )}
        <div className="flex gap-1 mt-1">
          <button onClick={() => { onSave(field, draft); setEditing(false); }}
            className="text-[10px] bg-[#ff3366] text-white px-2 py-0.5 rounded">Save</button>
          <button onClick={() => { setDraft(value || ""); setEditing(false); }}
            className="text-[10px] text-zinc-500 px-2 py-0.5">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3 group cursor-pointer" onClick={() => setEditing(true)}>
      <label className="text-[10px] text-zinc-400 uppercase font-medium">{label}</label>
      <p className={`text-sm mt-0.5 ${value ? "" : "text-zinc-300 italic"} group-hover:bg-yellow-50 rounded px-1 -mx-1`}>
        {value || "Click to add..."}
      </p>
    </div>
  );
}

function EditableList({ label, items, field, onSave, color = "bg-zinc-100" }: {
  label: string; items: string[]; field: string; onSave: (field: string, value: string) => void; color?: string;
}) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState("");

  const list = items || [];

  function saveEdit(idx: number) {
    const updated = [...list];
    updated[idx] = editDraft;
    onSave(field, JSON.stringify(updated.filter(l => l.trim())));
    setEditingIdx(null);
  }

  function deleteItem(idx: number) {
    const updated = list.filter((_, i) => i !== idx);
    onSave(field, JSON.stringify(updated));
  }

  function addItem() {
    if (!addDraft.trim()) return;
    onSave(field, JSON.stringify([...list, addDraft.trim()]));
    setAddDraft("");
    setAdding(false);
  }

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-zinc-400 uppercase font-medium">{label}</label>
        <button onClick={() => setAdding(true)} className="text-[10px] text-[#ff3366] hover:underline">+ Add</button>
      </div>

      <ul className="mt-1 space-y-1">
        {list.map((item, i) => (
          <li key={i} className={`text-xs rounded ${color} flex items-start gap-1`}>
            {editingIdx === i ? (
              <div className="flex-1 flex gap-1 p-1">
                <input value={editDraft} onChange={(e) => setEditDraft(e.target.value)}
                  className="flex-1 px-1 py-0.5 border rounded text-xs" autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") saveEdit(i); if (e.key === "Escape") setEditingIdx(null); }}
                />
                <button onClick={() => saveEdit(i)} className="text-[9px] bg-[#ff3366] text-white px-1.5 rounded">OK</button>
                <button onClick={() => setEditingIdx(null)} className="text-[9px] text-zinc-400 px-1">X</button>
              </div>
            ) : (
              <>
                <span className="flex-1 px-2 py-1.5 cursor-pointer hover:bg-white/50 rounded"
                  onClick={() => { setEditingIdx(i); setEditDraft(item); }}>
                  {item}
                </span>
                <button onClick={() => deleteItem(i)}
                  className="text-[9px] text-zinc-400 hover:text-[#ff3366] px-1.5 py-1.5 shrink-0">
                  ×
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <div className="flex gap-1 mt-1">
          <input value={addDraft} onChange={(e) => setAddDraft(e.target.value)}
            placeholder="New item..."
            className="flex-1 px-2 py-1 border rounded text-xs" autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") addItem(); if (e.key === "Escape") setAdding(false); }}
          />
          <button onClick={addItem} className="text-[10px] bg-[#ff3366] text-white px-2 rounded">Add</button>
          <button onClick={() => setAdding(false)} className="text-[10px] text-zinc-400 px-1">X</button>
        </div>
      )}

      {list.length === 0 && !adding && (
        <p className="text-xs text-zinc-300 italic mt-1 cursor-pointer hover:text-zinc-400"
          onClick={() => setAdding(true)}>
          No items yet - click + Add
        </p>
      )}
    </div>
  );
}

export default function LeadIntelPage() {
  const [leads, setLeads] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase
      .from("bcc_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setLeads(data || []);
    if (data?.length && !selectedId) setSelectedId(data[0].id);
  }

  const selected = leads.find((l) => l.id === selectedId);

  async function saveField(field: string, value: string) {
    if (!selectedId) return;
    setSaving(true);

    let updateData: Record<string, any> = {};

    // Handle array fields
    if (["missing_info", "buying_signals"].includes(field)) {
      try {
        updateData[field] = JSON.parse(value);
      } catch {
        updateData[field] = value.split("\n").filter((l: string) => l.trim());
      }
    } else {
      updateData[field] = value;
    }

    await supabase.from("bcc_log").update(updateData).eq("id", selectedId);
    await load();
    setSaving(false);
  }

  async function assignToRep(repName: string) {
    if (!selected || selectedId == null) return;
    const rep = REPS.find((r) => r.name === repName);
    if (!rep) return;

    if (selected.pipedrive_deal_id) {
      await fetch("/api/pipedrive", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: `deals/${selected.pipedrive_deal_id}`,
          data: { user_id: rep.pd_id },
        }),
      });
    }
    await supabase.from("bcc_log").update({ rep_email: repName }).eq("id", selectedId);
    await load();
  }

  return (
    <PageGuard pageId="lead-intel">
    <div>
      <h1 className="text-2xl font-bold mb-4">Lead Intel</h1>

      <div className="flex gap-4 h-[calc(100vh-120px)]">
        {/* Left: Lead list */}
        <div className="w-72 shrink-0 overflow-y-auto space-y-1">
          {leads.map((l) => (
            <button
              key={l.id}
              onClick={() => setSelectedId(l.id)}
              className={`w-full text-left p-3 rounded-lg border text-sm ${
                selectedId === l.id ? "border-[#ff3366] bg-[#ff3366]/5" : "border-zinc-200 bg-white hover:bg-zinc-50"
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{l.company_name || l.domain}</p>
                  <p className="text-[10px] text-zinc-400 truncate">{l.subject}</p>
                </div>
                {l.urgency && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${URGENCY_COLORS[l.urgency] || "bg-zinc-200"}`}>
                    {l.urgency}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-zinc-400 mt-1">
                {new Date(l.created_at).toLocaleDateString()} | {l.freight_mode || "no mode"}
              </p>
            </button>
          ))}
          {leads.length === 0 && (
            <p className="text-zinc-400 text-sm p-4">No lead intel yet</p>
          )}
        </div>

        {/* Right: Detail panel */}
        {selected ? (
          <div className="flex-1 overflow-y-auto">
            {/* Header */}
            <div className={`p-4 rounded-t-lg ${
              selected.urgency === "high" ? "bg-[#ff3366]"
              : selected.urgency === "medium" ? "bg-yellow-500"
              : "bg-zinc-600"
            } text-white`}>
              <h2 className="text-xl font-bold">{selected.company_name || selected.domain}</h2>
              <p className="text-sm opacity-90">{selected.enquiry_summary || selected.subject}</p>
              <div className="flex gap-3 mt-2 text-xs opacity-80">
                <span>ICP: {selected.icp_score || "Not in DB"}</span>
                <span>Domain: {selected.domain}</span>
                <span>{new Date(selected.created_at).toLocaleString()}</span>
                {saving && <span className="animate-pulse">Saving...</span>}
              </div>
            </div>

            <div className="bg-white border border-t-0 rounded-b-lg p-5">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Column 1: Opportunity */}
                <div>
                  <h3 className="font-bold text-sm uppercase text-zinc-500 mb-4 border-b pb-2">The Opportunity</h3>

                  <EditableField label="Enquiry Summary" value={selected.enquiry_summary} field="enquiry_summary" onSave={saveField} multiline />
                  <EditableField label="Freight Mode" value={selected.freight_mode} field="freight_mode" onSave={saveField} />

                  <div className="grid grid-cols-2 gap-2">
                    <EditableField label="Volume" value={selected.volume} field="volume" onSave={saveField} />
                    <EditableField label="Estimated Value" value={selected.estimated_value} field="estimated_value" onSave={saveField} />
                  </div>

                  <EditableField label="Origin" value={selected.origin} field="origin" onSave={saveField} multiline />
                  <EditableField label="Destination" value={selected.destination} field="destination" onSave={saveField} />
                  <EditableField label="Commodity" value={selected.commodity} field="commodity" onSave={saveField} />

                  <div className="mb-3">
                    <label className="text-[10px] text-zinc-400 uppercase font-medium">Urgency</label>
                    <div className="flex gap-1 mt-1">
                      {["high", "medium", "low"].map((u) => (
                        <button
                          key={u}
                          onClick={() => saveField("urgency", u)}
                          className={`text-xs px-3 py-1 rounded ${
                            selected.urgency === u ? URGENCY_COLORS[u] : "bg-zinc-100 text-zinc-500"
                          }`}
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                  </div>

                  <EditableField label="Competitive Intel" value={selected.competitive_intel} field="competitive_intel" onSave={saveField} multiline />
                </div>

                {/* Column 2: Company & Contacts */}
                <div>
                  <h3 className="font-bold text-sm uppercase text-zinc-500 mb-4 border-b pb-2">Company & Contacts</h3>

                  <EditableField label="Company Name" value={selected.company_name} field="company_name" onSave={saveField} />
                  <EditableField label="Company Summary" value={selected.company_summary} field="company_summary" onSave={saveField} multiline />

                  <div className="grid grid-cols-2 gap-2">
                    <EditableField label="Contact Name" value={selected.contact_name} field="contact_name" onSave={saveField} />
                    <EditableField label="Contact Email" value={selected.contact_email} field="contact_email" onSave={saveField} />
                  </div>

                  <div className="mb-3">
                    <label className="text-[10px] text-zinc-400 uppercase font-medium">ICP Score</label>
                    <p className={`text-2xl font-bold mt-1 ${
                      (selected.icp_score || 0) >= 70 ? "text-green-600"
                      : (selected.icp_score || 0) >= 40 ? "text-yellow-600"
                      : "text-zinc-400"
                    }`}>
                      {selected.icp_score || "N/A"}
                    </p>
                  </div>

                  <EditableList label="Buying Signals" items={selected.buying_signals} field="buying_signals" onSave={saveField} color="bg-green-50 text-green-700" />

                  {selected.is_existing_client && (
                    <div className="p-2 bg-green-50 rounded border border-green-200 mb-3">
                      <span className="text-xs text-green-700 font-medium">Existing Client</span>
                    </div>
                  )}
                </div>

                {/* Column 3: Actions & Missing Info */}
                <div>
                  <h3 className="font-bold text-sm uppercase text-zinc-500 mb-4 border-b pb-2">Actions & Gaps</h3>

                  <EditableField label="Recommended Action" value={selected.recommended_action} field="recommended_action" onSave={saveField} multiline />

                  <EditableList label="Missing Information" items={selected.missing_info} field="missing_info" onSave={saveField} color="bg-[#ff3366]/5 text-[#ff3366]" />

                  {/* Assign */}
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="text-[10px] text-zinc-400 uppercase font-medium">Assign to Rep</label>
                      <Select onValueChange={(v: string | null) => { if (v) assignToRep(v); }}>
                        <SelectTrigger className="mt-1 h-8 text-xs">
                          <SelectValue placeholder="Select rep" />
                        </SelectTrigger>
                        <SelectContent>
                          {REPS.map((r) => (
                            <SelectItem key={r.name} value={r.name}>{r.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="text-[10px] text-zinc-400 uppercase font-medium">Assign to Office</label>
                      <div className="grid grid-cols-2 gap-1 mt-1">
                        {OFFICES.map((o) => (
                          <Button key={o} variant="outline" size="sm" className="text-[10px] h-7">
                            {o}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Pipedrive link */}
                  {selected.pipedrive_deal_id && CUSTOMER.pipedriveSubdomain && (
                    <a
                      href={`https://${CUSTOMER.pipedriveSubdomain}.pipedrive.com/deal/${selected.pipedrive_deal_id}`}
                      target="_blank"
                      className="inline-block mt-4 text-xs text-blue-600 hover:underline"
                    >
                      Open in Pipedrive
                    </a>
                  )}

                  {/* Brief */}
                  {selected.brief && (
                    <div className="mt-4">
                      <label className="text-[10px] text-zinc-400 uppercase font-medium">Full Brief</label>
                      <div className="mt-1 p-3 bg-zinc-50 rounded border text-xs whitespace-pre-wrap max-h-64 overflow-y-auto">
                        {selected.brief}
                      </div>
                    </div>
                  )}

                  {/* Meta */}
                  <div className="mt-4 pt-3 border-t text-[10px] text-zinc-400 space-y-1">
                    <p>From: {selected.from_email}</p>
                    <p>To: {selected.to_email}</p>
                    <p>Subject: {selected.subject}</p>
                    <p>Created: {new Date(selected.created_at).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-400">
            Select a lead from the list
          </div>
        )}
      </div>
    </div>
    </PageGuard>
  );
}
