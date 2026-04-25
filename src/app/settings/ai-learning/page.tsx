"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { PageGuard } from "@/components/page-guard";
import { toast } from "sonner";

type StaffPref = {
  email: string;
  name: string | null;
  department: string | null;
  is_manager: boolean | null;
  ai_learning_enabled: boolean;
  ai_learning_share_team: boolean;
};

type Sample = {
  id: number;
  user_email: string;
  sender_name: string;
  sender_department: string | null;
  original_email_subject: string;
  original_email_from: string | null;
  actual_reply: string;
  ai_suggested_reply: string | null;
  used_suggestion: boolean | null;
  created_at: string;
};

export default function AILearningReviewPage() {
  return (
    <PageGuard pageId="settings">
      <Inner />
    </PageGuard>
  );
}

function Inner() {
  const [staff, setStaff] = useState<StaffPref[] | null>(null);
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [filterSender, setFilterSender] = useState("");
  const [filterQ, setFilterQ] = useState("");
  const [filterDays, setFilterDays] = useState(30);
  const [offset, setOffset] = useState(0);
  const limit = 50;

  async function loadStaff() {
    try {
      const r = await fetch("/api/staff-ai-prefs");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to load staff");
      setStaff(d.staff || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load staff");
    }
  }

  async function loadSamples() {
    try {
      const params = new URLSearchParams({
        days: String(filterDays),
        limit: String(limit),
        offset: String(offset),
      });
      if (filterSender) params.set("sender", filterSender);
      if (filterQ) params.set("q", filterQ);
      const r = await fetch(`/api/ai-samples?${params}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to load samples");
      setSamples(d.samples || []);
      setTotal(d.total || 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load samples");
      setSamples([]);
    }
  }

  useEffect(() => {
    loadStaff();
  }, []);

  useEffect(() => {
    loadSamples();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSender, filterQ, filterDays, offset]);

  async function togglePref(target: StaffPref, key: "ai_learning_enabled" | "ai_learning_share_team") {
    const next = !target[key];
    setStaff((prev) =>
      (prev || []).map((s) => (s.email === target.email ? { ...s, [key]: next } : s)),
    );
    try {
      const r = await fetch("/api/staff-ai-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: target.email, [key]: next }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      toast.success(`Updated ${target.name || target.email}`);
    } catch (e: unknown) {
      // Rollback
      setStaff((prev) =>
        (prev || []).map((s) => (s.email === target.email ? { ...s, [key]: !next } : s)),
      );
      toast.error(`Update failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  async function deleteSample(id: number) {
    if (!confirm("Delete this sample from the AI corpus? It won't be used in future suggestions.")) return;
    try {
      const r = await fetch(`/api/ai-samples?id=${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      setSamples((prev) => (prev || []).filter((s) => s.id !== id));
      setTotal((t) => Math.max(0, t - 1));
      toast.success("Sample removed");
    } catch (e: unknown) {
      toast.error(`Delete failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  const senderOptions = useMemo(() => {
    if (!staff) return [];
    return staff.filter((s) => s.email).map((s) => ({ email: s.email, label: s.name || s.email }));
  }, [staff]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">AI Learning Review</h1>
        <p className="text-xs text-zinc-400">
          Manager view of the writing-voice corpus. Override individual staff toggles or delete specific samples that shouldn&apos;t be used as patterns.
        </p>
      </div>

      {error && (
        <div className="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Per-staff overrides</CardTitle>
          <p className="text-[11px] text-zinc-500">
            Capture = whether their replies are stored. Share = whether other staff&apos;s AI can use them.
          </p>
        </CardHeader>
        <CardContent>
          {staff === null ? (
            <p className="text-[11px] text-zinc-400">Loading...</p>
          ) : staff.length === 0 ? (
            <p className="text-[11px] text-zinc-400">No active staff.</p>
          ) : (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-zinc-400">
                  <th className="py-1.5 font-medium">Staff</th>
                  <th className="py-1.5 font-medium">Department</th>
                  <th className="py-1.5 font-medium text-center">Capture</th>
                  <th className="py-1.5 font-medium text-center">Share with team</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.email} className="border-t border-zinc-100">
                    <td className="py-1.5">
                      <span className="font-medium">{s.name || s.email}</span>
                      {s.is_manager && <Badge className="ml-1.5 text-[9px] bg-zinc-100 text-zinc-600">manager</Badge>}
                      <p className="text-[10px] text-zinc-400">{s.email}</p>
                    </td>
                    <td className="py-1.5 text-zinc-500">{s.department || "-"}</td>
                    <td className="py-1.5 text-center">
                      <Toggle on={s.ai_learning_enabled} onClick={() => togglePref(s, "ai_learning_enabled")} />
                    </td>
                    <td className="py-1.5 text-center">
                      <Toggle on={s.ai_learning_share_team && s.ai_learning_enabled} onClick={() => togglePref(s, "ai_learning_share_team")} disabled={!s.ai_learning_enabled} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-sm">Captured samples</CardTitle>
              <p className="text-[11px] text-zinc-500">
                {total} samples in the last {filterDays} days. Delete any that shouldn&apos;t be a pattern.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={filterSender}
                onChange={(e) => { setOffset(0); setFilterSender(e.target.value); }}
                className="px-2 py-1.5 border rounded text-xs"
              >
                <option value="">All senders</option>
                {senderOptions.map((o) => (
                  <option key={o.email} value={o.email}>{o.label}</option>
                ))}
              </select>
              <select
                value={filterDays}
                onChange={(e) => { setOffset(0); setFilterDays(parseInt(e.target.value)); }}
                className="px-2 py-1.5 border rounded text-xs"
              >
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>1 year</option>
              </select>
              <input
                value={filterQ}
                onChange={(e) => { setOffset(0); setFilterQ(e.target.value); }}
                placeholder="Search subject..."
                className="px-2 py-1.5 border rounded text-xs w-48"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {samples === null ? (
            <p className="text-[11px] text-zinc-400">Loading...</p>
          ) : samples.length === 0 ? (
            <p className="text-[11px] text-zinc-400 py-8 text-center">No samples match these filters.</p>
          ) : (
            <div className="space-y-2">
              {samples.map((s) => (
                <div key={s.id} className="border rounded p-2.5 text-[11px]">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium">{s.sender_name}</span>
                        {s.sender_department && <Badge variant="secondary" className="text-[9px]">{s.sender_department}</Badge>}
                        {s.used_suggestion && <Badge className="bg-emerald-100 text-emerald-700 text-[9px]">used AI suggestion</Badge>}
                        <span className="text-[10px] text-zinc-400">
                          {new Date(s.created_at).toLocaleDateString("en-GB")} {new Date(s.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-700 truncate mt-0.5">RE: {s.original_email_subject || "(no subject)"}{s.original_email_from ? ` - to ${s.original_email_from}` : ""}</p>
                      <p className="text-[11px] text-zinc-600 mt-1 whitespace-pre-wrap line-clamp-3">{s.actual_reply}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => deleteSample(s.id)} className="text-xs h-7 text-red-600 shrink-0" title="Remove from corpus">
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {total > limit && (
            <div className="flex items-center justify-between mt-3 text-[11px]">
              <span className="text-zinc-500">
                Showing {offset + 1}-{Math.min(offset + limit, total)} of {total}
              </span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))} className="text-xs h-7">Prev</Button>
                <Button size="sm" variant="outline" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)} className="text-xs h-7">Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-9 h-4.5 rounded-full transition-colors relative ${on ? "bg-zinc-900" : "bg-zinc-300"} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
      style={{ width: 36, height: 18 }}
    >
      <div
        className={`absolute top-0.5 transition-transform bg-white rounded-full`}
        style={{
          width: 14,
          height: 14,
          transform: on ? "translateX(20px)" : "translateX(2px)",
        }}
      />
    </button>
  );
}
