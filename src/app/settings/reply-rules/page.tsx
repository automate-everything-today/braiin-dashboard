"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Save, X, Power, Trash2 } from "lucide-react";
import { PageGuard } from "@/components/page-guard";

type ReplyRule = {
  id: number;
  scope_type: "user" | "category" | "mode" | "department" | "branch" | "global";
  scope_value: string;
  instruction: string;
  source: "learned" | "set";
  created_by: string | null;
  active: boolean;
  usage_count: number;
  created_at: string;
  last_used_at: string | null;
};

const SCOPES: ReplyRule["scope_type"][] = [
  "global",
  "branch",
  "department",
  "mode",
  "category",
  "user",
];

const SCOPE_LABEL: Record<ReplyRule["scope_type"], string> = {
  global: "Global (Corten-wide)",
  branch: "Branch",
  department: "Department",
  mode: "Business unit (mode)",
  category: "Email category",
  user: "Individual user",
};

const SCOPE_HINT: Record<ReplyRule["scope_type"], string> = {
  global: "Applies to everyone. Use for overall house style.",
  branch: "e.g. London, Manchester",
  department: "e.g. Ops, Sales, Accounts",
  mode: "Air, Road, Sea, or Warehousing",
  category: "e.g. quote_request, rfq, internal",
  user: "Email address of the individual staff member",
};

const PLACEHOLDER: Record<ReplyRule["scope_type"], string> = {
  global: "global",
  branch: "e.g. London",
  department: "e.g. Sales",
  mode: "Air",
  category: "quote_request",
  user: "name@corten.com",
};

export default function ReplyRulesPage() {
  return (
    <PageGuard pageId="settings">
      <ReplyRulesInner />
    </PageGuard>
  );
}

function ReplyRulesInner() {
  const [rules, setRules] = useState<ReplyRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editInstruction, setEditInstruction] = useState("");
  const [form, setForm] = useState<{
    scope_type: ReplyRule["scope_type"];
    scope_value: string;
    instruction: string;
  }>({ scope_type: "global", scope_value: "global", instruction: "" });

  async function load() {
    try {
      const r = await fetch("/api/reply-rules");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to load rules");
      setRules(d.rules || []);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load rules");
      setRules([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const grouped = useMemo(() => {
    const g: Record<ReplyRule["scope_type"], ReplyRule[]> = {
      global: [],
      branch: [],
      department: [],
      mode: [],
      category: [],
      user: [],
    };
    for (const r of rules || []) g[r.scope_type].push(r);
    return g;
  }, [rules]);

  async function createRule() {
    const scope_value =
      form.scope_type === "global" ? "global" : form.scope_value.trim();
    if (!scope_value || !form.instruction.trim()) {
      setError("Scope value and instruction are required");
      return;
    }
    try {
      const r = await fetch("/api/reply-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope_type: form.scope_type,
          scope_value,
          instruction: form.instruction.trim(),
          source: "set",
          active: true,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to create rule");
      setAdding(false);
      setForm({ scope_type: "global", scope_value: "global", instruction: "" });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create rule");
    }
  }

  async function saveEdit(id: number) {
    if (!editInstruction.trim()) return;
    try {
      const r = await fetch("/api/reply-rules", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, instruction: editInstruction.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to update rule");
      setEditingId(null);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update rule");
    }
  }

  async function toggleActive(rule: ReplyRule) {
    try {
      const r = await fetch("/api/reply-rules", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: rule.id, active: !rule.active }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to toggle rule");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to toggle rule");
    }
  }

  async function deleteRule(rule: ReplyRule) {
    if (!confirm(`Delete rule: "${rule.instruction}"?`)) return;
    try {
      const r = await fetch(`/api/reply-rules?id=${rule.id}`, {
        method: "DELETE",
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to delete rule");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete rule");
    }
  }

  if (rules === null) return <p className="text-zinc-400 py-12">Loading reply rules...</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Reply Rules</h1>
          <p className="text-xs text-zinc-400">
            Hierarchical voice rules applied to every AI reply draft. More specific scopes take priority.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setAdding(true)}
          className="bg-[#ff3366] hover:bg-[#e6004d] text-xs gap-1.5"
        >
          <Plus size={14} /> New rule
        </Button>
      </div>

      {error && (
        <div className="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      {adding && (
        <Card className="mb-4 border-green-300 bg-green-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">New rule</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="text-[10px] text-zinc-500">Scope</label>
                <select
                  value={form.scope_type}
                  onChange={(e) => {
                    const scope_type = e.target.value as ReplyRule["scope_type"];
                    setForm({
                      ...form,
                      scope_type,
                      scope_value: scope_type === "global" ? "global" : "",
                    });
                  }}
                  className="w-full px-2 py-1.5 border rounded text-sm"
                >
                  {SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {SCOPE_LABEL[s]}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-zinc-500 mt-1">{SCOPE_HINT[form.scope_type]}</p>
              </div>
              <div>
                <label className="text-[10px] text-zinc-500">Scope value</label>
                <input
                  value={form.scope_value}
                  onChange={(e) => setForm({ ...form, scope_value: e.target.value })}
                  disabled={form.scope_type === "global"}
                  placeholder={PLACEHOLDER[form.scope_type]}
                  className="w-full px-2 py-1.5 border rounded text-sm disabled:bg-zinc-100"
                />
              </div>
              <div>
                <label className="text-[10px] text-zinc-500">Instruction</label>
                <input
                  value={form.instruction}
                  onChange={(e) => setForm({ ...form, instruction: e.target.value })}
                  placeholder="e.g. Always sign off with the team name, not just my name"
                  className="w-full px-2 py-1.5 border rounded text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={createRule}
                disabled={!form.instruction.trim() || !form.scope_value.trim()}
                className="bg-green-600 hover:bg-green-700 text-xs gap-1"
              >
                <Save size={12} /> Create
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAdding(false);
                  setForm({ scope_type: "global", scope_value: "global", instruction: "" });
                }}
                className="text-xs"
              >
                <X size={12} /> Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {SCOPES.map((scope) => {
        const bucket = grouped[scope];
        if (bucket.length === 0) return null;
        return (
          <Card key={scope} className="mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                {SCOPE_LABEL[scope]}
                <span className="text-[10px] text-zinc-400 font-normal">
                  {bucket.length} rule{bucket.length === 1 ? "" : "s"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {bucket.map((rule) => (
                  <div
                    key={rule.id}
                    className={`border rounded-lg p-3 ${rule.active ? "bg-white" : "bg-zinc-50 opacity-60"}`}
                  >
                    {editingId === rule.id ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                          <Badge variant="secondary" className="text-[10px]">
                            {rule.scope_value}
                          </Badge>
                          <span>·</span>
                          <span>{rule.source}</span>
                        </div>
                        <textarea
                          value={editInstruction}
                          onChange={(e) => setEditInstruction(e.target.value)}
                          className="w-full px-2 py-1.5 border rounded text-sm min-h-[60px]"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => saveEdit(rule.id)}
                            className="bg-green-600 hover:bg-green-700 text-xs gap-1"
                          >
                            <Save size={12} /> Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingId(null)}
                            className="text-xs"
                          >
                            <X size={12} /> Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <Badge variant="secondary" className="text-[10px]">
                              {rule.scope_value}
                            </Badge>
                            <Badge
                              className={
                                rule.source === "set"
                                  ? "bg-blue-100 text-blue-700 text-[10px]"
                                  : "bg-amber-100 text-amber-700 text-[10px]"
                              }
                            >
                              {rule.source}
                            </Badge>
                            {!rule.active && (
                              <Badge className="bg-red-100 text-red-700 text-[10px]">
                                Inactive
                              </Badge>
                            )}
                            <span className="text-[10px] text-zinc-400">
                              used {rule.usage_count}×
                            </span>
                          </div>
                          <p className="text-sm text-zinc-800">{rule.instruction}</p>
                          {rule.created_by && (
                            <p className="text-[10px] text-zinc-400 mt-1">
                              by {rule.created_by}
                              {rule.last_used_at
                                ? ` · last used ${new Date(rule.last_used_at).toLocaleDateString("en-GB")}`
                                : ""}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingId(rule.id);
                              setEditInstruction(rule.instruction);
                            }}
                            className="text-xs h-7"
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => toggleActive(rule)}
                            title={rule.active ? "Disable" : "Enable"}
                            className={`text-xs h-7 ${rule.active ? "text-red-600" : "text-green-600"}`}
                          >
                            <Power size={12} />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => deleteRule(rule)}
                            title="Delete"
                            className="text-xs h-7 text-red-600"
                          >
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {(rules || []).length === 0 && !adding && (
        <div className="border border-dashed rounded-lg p-8 text-center text-sm text-zinc-400">
          No reply rules yet. Create one to shape how AI drafts replies across the business.
        </div>
      )}
    </div>
  );
}
