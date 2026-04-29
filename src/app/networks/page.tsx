"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Save, X, Trash2, ExternalLink } from "lucide-react";
import { PageGuard } from "@/components/page-guard";

type FreightNetwork = {
  id: number;
  name: string;
  primary_domain: string;
  additional_domains: string[];
  relationship: "member" | "non-member" | "prospect" | "declined";
  network_type: "general" | "project_cargo" | "specialised" | "association";
  annual_fee_amount: number | null;
  fee_currency: "GBP" | "USD" | "EUR";
  events_per_year: number | null;
  website: string | null;
  notes: string | null;
  parent_network_id: number | null;
  active: boolean;
};

const RELATIONSHIP_STYLE: Record<FreightNetwork["relationship"], string> = {
  member: "bg-emerald-50 text-emerald-700 border-emerald-200",
  prospect: "bg-blue-50 text-blue-700 border-blue-200",
  "non-member": "bg-zinc-100 text-zinc-600 border-zinc-200",
  declined: "bg-red-50 text-red-700 border-red-200",
};

const TYPE_LABEL: Record<FreightNetwork["network_type"], string> = {
  general: "General",
  project_cargo: "Project Cargo",
  specialised: "Specialised",
  association: "Trade Association",
};

const formatGBP = (v: number | null) =>
  v == null ? "-" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v);

const formatFee = (amount: number | null, currency: FreightNetwork["fee_currency"]) =>
  amount == null
    ? "-"
    : new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);

export default function NetworksPage() {
  return (
    <PageGuard pageId="networks">
      <NetworksInner />
    </PageGuard>
  );
}

function NetworksInner() {
  const [networks, setNetworks] = useState<FreightNetwork[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<FreightNetwork> & { additional_domains_text?: string }>({
    name: "",
    primary_domain: "",
    additional_domains_text: "",
    relationship: "non-member",
    network_type: "general",
    active: true,
  });

  async function load() {
    try {
      const r = await fetch("/api/networks");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to load");
      setNetworks(d.networks || []);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setNetworks([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(n: FreightNetwork) {
    setEditingId(n.id);
    setAdding(false);
    setForm({
      ...n,
      additional_domains_text: (n.additional_domains || []).join(", "),
    });
  }

  async function save() {
    try {
      const additional_domains = (form.additional_domains_text || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const payload = {
        ...(editingId ? { id: editingId } : {}),
        name: form.name,
        primary_domain: form.primary_domain,
        additional_domains,
        relationship: form.relationship,
        network_type: form.network_type,
        annual_fee_amount: form.annual_fee_amount ?? null,
        fee_currency: form.fee_currency ?? "GBP",
        events_per_year: form.events_per_year ?? null,
        website: form.website ?? null,
        notes: form.notes ?? null,
        parent_network_id: form.parent_network_id ?? null,
        active: form.active ?? true,
      };
      const res = await fetch("/api/networks", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Save failed");
      setAdding(false);
      setEditingId(null);
      setForm({ name: "", primary_domain: "", additional_domains_text: "", relationship: "non-member", network_type: "general", active: true });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function remove(n: FreightNetwork) {
    if (!confirm(`Delete network "${n.name}"?`)) return;
    try {
      const res = await fetch(`/api/networks?id=${n.id}`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Delete failed");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const totals = useMemo(() => {
    if (!networks) return { count: 0, members: 0, annualSpendGbp: 0 };
    let members = 0;
    let annualSpendGbp = 0;
    for (const n of networks) {
      if (n.relationship === "member") {
        members++;
        // Sum in GBP only when fee_currency is GBP. Cross-currency conversion
        // for the header total happens server-side in a future pass; for now
        // the dashboard total is GBP-only and a USD/EUR fee shows as
        // currency-tagged on its row.
        if (n.fee_currency === "GBP") annualSpendGbp += n.annual_fee_amount ?? 0;
      }
    }
    return { count: networks.length, members, annualSpendGbp };
  }, [networks]);

  if (networks === null) return <p className="text-zinc-400 py-12">Loading networks...</p>;

  return (
    <div>
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Freight Networks</h1>
          <p className="text-xs text-zinc-400">
            {totals.count} known networks - {totals.members} active memberships - {formatGBP(totals.annualSpendGbp)} annual fees (GBP only)
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setAdding(true);
            setEditingId(null);
            setForm({ name: "", primary_domain: "", additional_domains_text: "", relationship: "non-member", network_type: "general", active: true });
          }}
          className="bg-[#ff3366] hover:bg-[#e6004d] text-xs gap-1.5"
        >
          <Plus size={14} /> Add network
        </Button>
      </div>

      {error && (
        <div className="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      {(adding || editingId !== null) && (
        <Card className="mb-4 border-blue-300 bg-blue-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{editingId ? "Edit network" : "New network"}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
              <Field label="Name" value={form.name || ""} onChange={(v) => setForm({ ...form, name: v })} placeholder="e.g. WCA World" />
              <Field label="Primary domain" value={form.primary_domain || ""} onChange={(v) => setForm({ ...form, primary_domain: v })} placeholder="wcaworld.com" />
              <Field label="Additional domains (comma separated)" value={form.additional_domains_text || ""} onChange={(v) => setForm({ ...form, additional_domains_text: v })} placeholder="wca-network.com, wcalogistics.com" />
              <SelectField label="Relationship" value={form.relationship || "non-member"} onChange={(v) => setForm({ ...form, relationship: v as FreightNetwork["relationship"] })} options={["member", "non-member", "prospect", "declined"]} />
              <SelectField label="Type" value={form.network_type || "general"} onChange={(v) => setForm({ ...form, network_type: v as FreightNetwork["network_type"] })} options={["general", "project_cargo", "specialised", "association"]} />
              <Field label="Website" value={form.website || ""} onChange={(v) => setForm({ ...form, website: v })} placeholder="https://www.wcaworld.com" />
              <NumField
                label={`Annual fee (${form.fee_currency || "GBP"})`}
                value={form.annual_fee_amount ?? null}
                onChange={(v) => setForm({ ...form, annual_fee_amount: v })}
              />
              <SelectField
                label="Fee currency"
                value={form.fee_currency || "GBP"}
                onChange={(v) => setForm({ ...form, fee_currency: v as FreightNetwork["fee_currency"] })}
                options={["GBP", "USD", "EUR"]}
              />
              <NumField label="Events per year" value={form.events_per_year ?? null} onChange={(v) => setForm({ ...form, events_per_year: v })} />
            </div>
            <div className="mb-3">
              <label className="text-[10px] text-zinc-500">Notes</label>
              <textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm min-h-[60px]" placeholder="Anything internal we should remember" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={!form.name || !form.primary_domain} className="bg-green-600 hover:bg-green-700 text-xs gap-1">
                <Save size={12} /> {editingId ? "Save" : "Create"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setAdding(false); setEditingId(null); }} className="text-xs">
                <X size={12} /> Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {networks.map((n) => (
          <div key={n.id} className={`border rounded-lg p-3 bg-white ${n.active ? "" : "opacity-60"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{n.name}</span>
                  <Badge className={`text-[10px] border ${RELATIONSHIP_STYLE[n.relationship]}`}>{n.relationship}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{TYPE_LABEL[n.network_type]}</Badge>
                  {!n.active && <Badge className="bg-red-100 text-red-700 text-[10px]">Inactive</Badge>}
                </div>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  {n.primary_domain}
                  {n.additional_domains.length > 0 && ` · also ${n.additional_domains.join(", ")}`}
                </p>
                {(n.annual_fee_amount != null || n.events_per_year != null) && (
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    {n.annual_fee_amount != null && (
                      <>Fee: {formatFee(n.annual_fee_amount, n.fee_currency)}</>
                    )}
                    {n.annual_fee_amount != null && n.events_per_year != null && " · "}
                    {n.events_per_year != null && <>{n.events_per_year} events/year</>}
                    {n.parent_network_id != null && " · sub-network"}
                  </p>
                )}
                {n.notes && <p className="text-[11px] text-zinc-600 mt-1">{n.notes}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {n.website && (
                  <a href={n.website} target="_blank" rel="noopener noreferrer" className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded hover:bg-zinc-100" title="Visit website">
                    <ExternalLink size={13} />
                  </a>
                )}
                <Button size="sm" variant="outline" onClick={() => startEdit(n)} className="text-xs h-7">Edit</Button>
                <Button size="sm" variant="outline" onClick={() => remove(n)} className="text-xs h-7 text-red-600" title="Delete">
                  <Trash2 size={12} />
                </Button>
              </div>
            </div>
          </div>
        ))}
        {networks.length === 0 && !adding && (
          <div className="border border-dashed rounded-lg p-8 text-center text-sm text-zinc-400">
            No networks yet. Click &quot;Add network&quot; to start the directory.
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-[10px] text-zinc-500">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full px-2 py-1.5 border rounded text-sm" />
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div>
      <label className="text-[10px] text-zinc-500">{label}</label>
      <input
        type="number"
        value={value == null ? "" : value}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="w-full px-2 py-1.5 border rounded text-sm"
      />
    </div>
  );
}

function SelectField<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: T[] }) {
  return (
    <div>
      <label className="text-[10px] text-zinc-500">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="w-full px-2 py-1.5 border rounded text-sm capitalize">
        {options.map((o) => (
          <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
        ))}
      </select>
    </div>
  );
}
