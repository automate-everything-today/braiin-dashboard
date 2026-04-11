"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useCreateIncident } from "@/hooks/use-incidents";
import { INCIDENT_SEVERITIES } from "@/lib/validation";
import { AlertTriangle, Check, X, Loader2, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Props = {
  prefill?: {
    severity?: string;
    category?: string;
    title?: string;
    description?: string;
    account_code?: string;
    supplier_account_code?: string;
    job_reference?: string;
    source?: string;
    source_id?: string;
    responsible_party?: string;
    responsible_type?: string;
    root_cause?: string;
    financial_impact?: string;
  };
  emailContext?: {
    from: string;
    fromName: string;
    subject: string;
    preview: string;
    matchedCompany?: string;
  };
  onClose?: () => void;
};

const SEVERITY_LABELS: Record<string, { label: string; color: string }> = {
  amber: { label: "Amber - Operational delay/issue", color: "bg-amber-100 border-amber-300 text-amber-800" },
  red: { label: "Red - Significant failure", color: "bg-red-100 border-red-300 text-red-800" },
  black: { label: "Black - Major incident", color: "bg-zinc-900 text-white" },
};

type IncidentCategory = { name: string; label: string; group_name: string; severity_hint: string };

// Confirmable field - shows AI suggestion with tick/cross
function ConfirmField({ label, value, onChange, confirmed, onConfirm, onReject, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  confirmed: boolean | null; onConfirm: () => void; onReject: () => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[10px] text-zinc-400 font-medium uppercase">{label}</label>
      <div className="flex gap-1 mt-0.5">
        <input value={value} onChange={e => onChange(e.target.value)}
          className={`flex-1 px-2 py-1.5 border rounded text-xs ${confirmed === true ? "border-green-300 bg-green-50" : confirmed === false ? "border-red-300 bg-red-50" : ""}`}
          placeholder={placeholder} />
        {value && confirmed === null && (
          <div className="flex gap-0.5">
            <button onClick={onConfirm} className="p-1 hover:bg-green-50 rounded text-green-600" title="Confirm"><Check size={12} /></button>
            <button onClick={onReject} className="p-1 hover:bg-red-50 rounded text-red-600" title="Edit"><X size={12} /></button>
          </div>
        )}
        {confirmed === true && <span className="text-green-600 text-[9px] self-center">Confirmed</span>}
      </div>
    </div>
  );
}

export function IncidentForm({ prefill, emailContext, onClose }: Props) {
  const [form, setForm] = useState({
    severity: prefill?.severity || "amber",
    title: prefill?.title || "",
    description: prefill?.description || "",
    category: prefill?.category || "delay",
    account_code: prefill?.account_code || "",
    supplier_account_code: prefill?.supplier_account_code || "",
    job_reference: prefill?.job_reference || "",
    financial_impact: prefill?.financial_impact || "",
    branch: "",
    source: prefill?.source || "manual",
    source_id: prefill?.source_id || "",
    responsible_party: prefill?.responsible_party || "",
    responsible_type: prefill?.responsible_type || "",
    root_cause: prefill?.root_cause || "",
    incident_date: new Date().toISOString().split("T")[0],
    escalate_to_manager: false,
  });

  // Track which AI-filled fields the user has confirmed
  const [confirmed, setConfirmed] = useState<Record<string, boolean | null>>({
    title: prefill?.title ? null : null,
    category: prefill?.category ? null : null,
    account_code: prefill?.account_code ? null : null,
    supplier_account_code: prefill?.supplier_account_code ? null : null,
    responsible_party: prefill?.responsible_party ? null : null,
    root_cause: prefill?.root_cause ? null : null,
  });

  const [aiLoading, setAiLoading] = useState(false);
  const [categories, setCategories] = useState<IncidentCategory[]>([]);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  // Load categories from database
  useEffect(() => {
    supabase.from("incident_categories").select("name, label, group_name, severity_hint")
      .eq("is_active", true).order("usage_count", { ascending: false }).order("label")
      .then(({ data }) => setCategories(data || []));
  }, []);

  async function addNewCategory() {
    if (!newCategoryName.trim()) return;
    const name = newCategoryName.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const label = newCategoryName.trim();
    const { error } = await supabase.from("incident_categories").insert({ name, label, group_name: "other", severity_hint: form.severity });
    if (!error) {
      setCategories(prev => [...prev, { name, label, group_name: "other", severity_hint: form.severity }]);
      setForm({ ...form, category: name });
      setShowAddCategory(false);
      setNewCategoryName("");
    }
  }

  // Ask Braiin to fill in missing fields from email context
  useEffect(() => {
    if (emailContext && (!form.title || !form.responsible_party)) {
      setAiLoading(true);
      fetch("/api/braiin-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: `Analyse this email and extract incident details. Return ONLY a JSON object with these fields: title (short incident title), category (one of: delay, failed_collection, rolled, short_shipped, documentation_error, customs_hold, damage, lost_cargo, failed_to_fly, temperature_breach, contamination, claim, demurrage, theft, bankruptcy, failure_to_pay, staff_misconduct, regulatory_breach, hse, fraud, other), severity (amber, red, or black), responsible_party (company or person name), responsible_type (carrier, haulier, warehouse, customs_broker, port, internal, client, other), root_cause (brief), description (what happened), financial_impact (estimated GBP amount or empty string). JSON only, no markdown.`,
          context_type: "email",
          thread_summary: `From: ${emailContext.fromName} (${emailContext.from})\nSubject: ${emailContext.subject}\n${emailContext.preview}`,
          account_code: prefill?.account_code || "",
        }),
      })
        .then(r => r.json())
        .then(data => {
          try {
            // Try to parse AI response as JSON
            const text = data.answer || "";
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              setForm(prev => ({
                ...prev,
                title: parsed.title || prev.title,
                category: parsed.category || prev.category,
                severity: parsed.severity || prev.severity,
                responsible_party: parsed.responsible_party || prev.responsible_party,
                responsible_type: parsed.responsible_type || prev.responsible_type,
                root_cause: parsed.root_cause || prev.root_cause,
                description: parsed.description || prev.description,
                financial_impact: parsed.financial_impact || prev.financial_impact,
                supplier_account_code: parsed.responsible_party || prev.supplier_account_code,
              }));
              // Mark AI-filled fields as needing confirmation
              setConfirmed(prev => ({
                ...prev,
                title: parsed.title ? null : prev.title,
                category: parsed.category ? null : prev.category,
                responsible_party: parsed.responsible_party ? null : prev.responsible_party,
                root_cause: parsed.root_cause ? null : prev.root_cause,
              }));
            }
          } catch (e) { console.warn("[IncidentForm] Failed to parse AI response:", e); }
          setAiLoading(false);
        })
        .catch(() => setAiLoading(false));
    }
  }, []);

  const createIncident = useCreateIncident();

  function handleSubmit() {
    if (!form.title || !form.severity || !form.category) return;
    createIncident.mutate({
      ...form,
      financial_impact: form.financial_impact ? parseFloat(form.financial_impact) : null,
    }, {
      onSuccess: () => {
        // Increment usage count for the selected category
        supabase.from("incident_categories")
          .update({ usage_count: (categories.find(c => c.name === form.category) as any)?.usage_count + 1 || 1 })
          .eq("name", form.category);
        onClose?.();
      },
    });
  }

  const confirmField = (field: string) => setConfirmed(prev => ({ ...prev, [field]: true }));
  const rejectField = (field: string) => setConfirmed(prev => ({ ...prev, [field]: false }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} />
          <h3 className="text-sm font-semibold">Raise Exception</h3>
        </div>
        {aiLoading && (
          <div className="flex items-center gap-1 text-[10px] text-zinc-400">
            <Loader2 size={10} className="animate-spin" /> Braiin analysing...
          </div>
        )}
      </div>

      {/* When did it happen */}
      <div>
        <label className="text-[10px] text-zinc-400 font-medium uppercase">When did this happen?</label>
        <input type="date" value={form.incident_date} onChange={e => setForm({ ...form, incident_date: e.target.value })}
          className="w-full px-3 py-2 border rounded text-xs mt-0.5" />
      </div>

      {/* Severity - visual buttons */}
      <div>
        <label className="text-[10px] text-zinc-400 font-medium uppercase">Severity</label>
        <div className="flex gap-1.5 mt-0.5">
          {(INCIDENT_SEVERITIES as readonly string[]).map(s => (
            <button key={s} onClick={() => setForm({ ...form, severity: s })}
              className={`flex-1 px-3 py-2 rounded border text-xs font-medium capitalize transition-colors ${form.severity === s ? SEVERITY_LABELS[s].color : "hover:bg-zinc-50"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* AI-filled: Title with confirm */}
      <ConfirmField label="What happened?" value={form.title} onChange={v => setForm({ ...form, title: v })}
        confirmed={confirmed.title} onConfirm={() => confirmField("title")} onReject={() => rejectField("title")}
        placeholder="Short description of the incident" />

      {/* Category - dynamic from database */}
      <div>
        <label className="text-[10px] text-zinc-400 font-medium uppercase">Category</label>
        <div className="flex gap-1 mt-0.5">
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
            className={`flex-1 px-3 py-2 border rounded text-xs ${confirmed.category === true ? "border-green-300 bg-green-50" : ""}`}>
            {/* Group categories */}
            {["operational", "cargo", "financial", "compliance", "internal", "other"].map(group => {
              const groupCats = categories.filter(c => c.group_name === group);
              if (groupCats.length === 0) return null;
              return (
                <optgroup key={group} label={group.charAt(0).toUpperCase() + group.slice(1)}>
                  {groupCats.map(c => (
                    <option key={c.name} value={c.name}>{c.label}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <button onClick={() => setShowAddCategory(!showAddCategory)}
            className="px-2 py-1 border rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50" title="Add new category">
            <Plus size={12} />
          </button>
        </div>
        {showAddCategory && (
          <div className="flex gap-1 mt-1">
            <input value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addNewCategory(); }}
              placeholder="New category name..."
              className="flex-1 px-2 py-1 border rounded text-xs" autoFocus />
            <button onClick={addNewCategory} disabled={!newCategoryName.trim()}
              className="px-2 py-1 bg-zinc-900 text-white rounded text-[9px] disabled:opacity-30">Add</button>
          </div>
        )}
      </div>

      {/* Description */}
      <div>
        <label className="text-[10px] text-zinc-400 font-medium uppercase">Full details</label>
        <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
          className="w-full px-3 py-2 border rounded text-xs mt-0.5 min-h-[60px] resize-y"
          placeholder="Braiin will pre-fill from the email..." />
      </div>

      {/* Job ref + Client + Supplier in a row */}
      <div className="grid grid-cols-3 gap-2">
        <ConfirmField label="Job reference" value={form.job_reference} onChange={v => setForm({ ...form, job_reference: v })}
          confirmed={null} onConfirm={() => {}} onReject={() => {}} placeholder="SI00032457" />
        <ConfirmField label="Client" value={form.account_code} onChange={v => setForm({ ...form, account_code: v })}
          confirmed={confirmed.account_code} onConfirm={() => confirmField("account_code")} onReject={() => rejectField("account_code")} />
        <ConfirmField label="Supplier" value={form.supplier_account_code} onChange={v => setForm({ ...form, supplier_account_code: v })}
          confirmed={confirmed.supplier_account_code} onConfirm={() => confirmField("supplier_account_code")} onReject={() => rejectField("supplier_account_code")} />
      </div>

      {/* AI-filled: Responsible party */}
      <div className="grid grid-cols-2 gap-2">
        <ConfirmField label="Who is responsible?" value={form.responsible_party} onChange={v => setForm({ ...form, responsible_party: v })}
          confirmed={confirmed.responsible_party} onConfirm={() => confirmField("responsible_party")} onReject={() => rejectField("responsible_party")}
          placeholder="Company or person" />
        <div>
          <label className="text-[10px] text-zinc-400 font-medium uppercase">Type</label>
          <select value={form.responsible_type} onChange={e => setForm({ ...form, responsible_type: e.target.value })}
            className="w-full px-2 py-1.5 border rounded text-xs mt-0.5">
            <option value="">Select</option>
            <option value="carrier">Carrier</option>
            <option value="haulier">Haulier</option>
            <option value="warehouse">Warehouse</option>
            <option value="customs_broker">Customs broker</option>
            <option value="port">Port/Terminal</option>
            <option value="internal">Internal</option>
            <option value="client">Client</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      {/* Root cause */}
      <ConfirmField label="Root cause" value={form.root_cause} onChange={v => setForm({ ...form, root_cause: v })}
        confirmed={confirmed.root_cause} onConfirm={() => confirmField("root_cause")} onReject={() => rejectField("root_cause")}
        placeholder="What caused this?" />

      {/* Financial impact - always visible */}
      <div>
        <label className="text-[10px] text-zinc-400 font-medium uppercase">Estimated cost (GBP)</label>
        <input type="number" value={form.financial_impact} onChange={e => setForm({ ...form, financial_impact: e.target.value })}
          className="w-full px-3 py-2 border rounded text-xs mt-0.5" placeholder="0.00" />
      </div>

      {/* Escalation toggle */}
      <div className="flex items-center justify-between p-2 bg-zinc-50 rounded-lg">
        <div>
          <p className="text-xs font-medium">Escalate to manager</p>
          <p className="text-[9px] text-zinc-400">Notify branch manager immediately</p>
        </div>
        <button onClick={() => setForm({ ...form, escalate_to_manager: !form.escalate_to_manager })}
          className={`w-10 h-5 rounded-full transition-colors relative ${form.escalate_to_manager ? "bg-zinc-900" : "bg-zinc-300"}`}>
          <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform ${form.escalate_to_manager ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
      </div>

      {form.severity === "black" && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-[10px] text-red-700">
          Black incidents will notify all directors by email and blacklist the supplier/client account.
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button onClick={handleSubmit} disabled={!form.title || createIncident.isPending}
          className={`text-xs gap-1.5 ${form.severity === "black" ? "bg-red-600 hover:bg-red-700" : "bg-zinc-900 hover:bg-zinc-800"}`}>
          <AlertTriangle size={12} /> Raise {form.severity.charAt(0).toUpperCase() + form.severity.slice(1)} Exception
        </Button>
        {onClose && (
          <Button variant="outline" onClick={onClose} className="text-xs">Cancel</Button>
        )}
      </div>
    </div>
  );
}
