"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageGuard } from "@/components/page-guard";
import { ChevronDown, ChevronRight, Map as MapIcon, Plus, Save, Trash2, X } from "lucide-react";

const PILL_SM = "text-[10px] px-1.5 py-0 leading-[18px] h-[18px] font-normal tracking-normal";

interface Node {
  node_id: string;
  parent_id: string | null;
  title: string;
  rationale?: string;
  status: string;
  priority: string;
  area?: string;
  position: number;
  tags: string[];
  notes?: string;
  eta?: string;
  updated_at: string;
}

const STATUS_TONE: Record<string, string> = {
  idea: "bg-zinc-100 text-zinc-600",
  planned: "bg-sky-100 text-sky-800",
  brainstorming: "bg-violet-100 text-violet-800",
  in_progress: "bg-amber-100 text-amber-800",
  shipped: "bg-emerald-100 text-emerald-800",
  parked: "bg-zinc-200 text-zinc-500",
  rejected: "bg-rose-100 text-rose-800",
};
const PRIORITY_TONE: Record<string, string> = {
  low: "bg-zinc-100 text-zinc-600",
  medium: "bg-sky-100 text-sky-800",
  high: "bg-amber-100 text-amber-800",
  critical: "bg-rose-100 text-rose-800",
};
const STATUSES = ["idea", "planned", "brainstorming", "in_progress", "shipped", "parked", "rejected"];

export default function RoadmapPage() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Node>>({});
  const [addingChildOf, setAddingChildOf] = useState<string | null>(null);

  async function refresh() {
    const r = await fetch("/api/roadmap");
    const d = await r.json();
    setNodes(d.nodes ?? []);
  }
  useEffect(() => { refresh(); }, []);

  const tree = useMemo<Map<string | null, Node[]>>(() => {
    const byParent: Map<string | null, Node[]> = new Map();
    for (const n of nodes) {
      const list = byParent.get(n.parent_id) ?? [];
      list.push(n);
      byParent.set(n.parent_id, list);
    }
    for (const v of byParent.values()) {
      v.sort((a: Node, b: Node) => a.position - b.position);
    }
    return byParent;
  }, [nodes]);

  // Default-expand top 2 levels
  useEffect(() => {
    if (nodes.length > 0 && expanded.size === 0) {
      const top = nodes.filter((n) => !n.parent_id);
      const lvl1 = nodes.filter((n) => top.some((t) => t.node_id === n.parent_id));
      setExpanded(new Set([...top, ...lvl1].map((n) => n.node_id)));
    }
  }, [nodes]);

  function toggle(id: string) {
    setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function save(id: string) {
    await fetch("/api/roadmap", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ node_id: id, ...draft }),
    });
    setEditing(null); setDraft({}); refresh();
  }

  async function addChild(parent_id: string | null) {
    if (!draft.title) return;
    await fetch("/api/roadmap", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ parent_id, ...draft }),
    });
    setAddingChildOf(null); setDraft({}); refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this node and all children?")) return;
    await fetch("/api/roadmap", {
      method: "DELETE", headers: { "content-type": "application/json" },
      body: JSON.stringify({ node_id: id }),
    });
    refresh();
  }

  function NodeRow({ n, depth }: { n: Node; depth: number }) {
    const children = tree.get(n.node_id) ?? [];
    const isOpen = expanded.has(n.node_id);
    const isEditing = editing === n.node_id;
    return (
      <div>
        <div
          className="group flex items-start gap-2 py-2 hover:bg-zinc-50 rounded px-2"
          style={{ marginLeft: depth * 20 }}
        >
          <button
            onClick={() => toggle(n.node_id)}
            className={`text-zinc-400 mt-0.5 ${children.length === 0 ? "invisible" : ""}`}
          >
            {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="space-y-1">
                <input
                  type="text"
                  defaultValue={n.title}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  className="w-full h-7 px-2 rounded border border-zinc-300 text-sm bg-white"
                />
                <textarea
                  defaultValue={n.rationale ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, rationale: e.target.value }))}
                  rows={2}
                  placeholder="Rationale - why does this exist, what does it unlock?"
                  className="w-full px-2 py-1 rounded border border-zinc-300 text-xs bg-white resize-none"
                />
                <div className="flex items-center gap-2">
                  <select
                    defaultValue={n.status}
                    onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
                    className="h-7 px-1 text-[11px] rounded border border-zinc-300 bg-white"
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select
                    defaultValue={n.priority}
                    onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}
                    className="h-7 px-1 text-[11px] rounded border border-zinc-300 bg-white"
                  >
                    {["low","medium","high","critical"].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <input
                    type="text" defaultValue={n.area ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, area: e.target.value }))}
                    placeholder="area"
                    className="h-7 px-2 rounded border border-zinc-300 text-[11px] bg-white w-28"
                  />
                  <input
                    type="text" defaultValue={n.eta ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, eta: e.target.value }))}
                    placeholder="ETA / next session / Q2"
                    className="h-7 px-2 rounded border border-zinc-300 text-[11px] bg-white flex-1"
                  />
                  <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => save(n.node_id)}>
                    <Save className="size-3 mr-1" /> Save
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={() => { setEditing(null); setDraft({}); }}>
                    <X className="size-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{n.title}</span>
                  <Badge className={`${PILL_SM} ${STATUS_TONE[n.status]}`}>{n.status}</Badge>
                  <Badge className={`${PILL_SM} ${PRIORITY_TONE[n.priority]} uppercase tracking-wide`}>
                    {n.priority}
                  </Badge>
                  {n.area && <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600`}>{n.area}</Badge>}
                  {n.eta && <span className="text-[10px] text-zinc-500 italic">eta: {n.eta}</span>}
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 ml-auto">
                    <button onClick={() => { setEditing(n.node_id); setDraft({}); }}
                      className="text-[10px] text-zinc-500 hover:text-zinc-900 px-1.5 py-0.5">edit</button>
                    <button onClick={() => { setAddingChildOf(n.node_id); setDraft({}); }}
                      className="text-[10px] text-violet-700 hover:bg-violet-50 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5">
                      <Plus className="size-2.5" /> child
                    </button>
                    <button onClick={() => remove(n.node_id)}
                      className="text-[10px] text-rose-700 hover:bg-rose-50 px-1.5 py-0.5 rounded">
                      <Trash2 className="size-2.5" />
                    </button>
                  </div>
                </div>
                {n.rationale && (
                  <div className="text-xs text-zinc-600 mt-1 leading-relaxed">{n.rationale}</div>
                )}
                {n.notes && (
                  <div className="text-[11px] text-zinc-500 italic mt-0.5">note: {n.notes}</div>
                )}
              </>
            )}
            {addingChildOf === n.node_id && (
              <div className="mt-2 p-2 border rounded bg-violet-50/30 space-y-1">
                <input
                  type="text" placeholder="New child node title"
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  autoFocus
                  className="w-full h-7 px-2 rounded border border-zinc-300 text-sm bg-white"
                />
                <textarea
                  rows={2} placeholder="Rationale (optional)"
                  onChange={(e) => setDraft((d) => ({ ...d, rationale: e.target.value }))}
                  className="w-full px-2 py-1 rounded border border-zinc-300 text-xs bg-white resize-none"
                />
                <div className="flex items-center gap-1.5">
                  <select onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
                    defaultValue="idea"
                    className="h-7 px-1 text-[11px] rounded border border-zinc-300 bg-white">
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <Button size="sm" className="h-7 text-xs"
                    onClick={() => addChild(n.node_id)}>Create</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={() => { setAddingChildOf(null); setDraft({}); }}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        </div>
        {isOpen && children.map((c) => <NodeRow key={c.node_id} n={c} depth={depth + 1} />)}
      </div>
    );
  }

  const roots = tree.get(null) ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of nodes) c[n.status] = (c[n.status] ?? 0) + 1;
    return c;
  }, [nodes]);

  return (
    <PageGuard pageId="dev_roadmap">
      <div className="min-h-screen bg-zinc-50">
        <div className="border-b bg-white">
          <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MapIcon className="size-5 text-violet-600" />
              <h1 className="text-lg font-medium">Roadmap (CTO mind map)</h1>
              <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono`}>/roadmap</Badge>
              <Badge className={`${PILL_SM} bg-rose-100 text-rose-800 uppercase`}>private</Badge>
            </div>
            <Button size="sm" onClick={() => { setAddingChildOf("__root__"); setDraft({}); }}>
              <Plus className="size-3.5 mr-1" /> Add top-level
            </Button>
          </div>
        </div>
        <div className="max-w-[1400px] mx-auto px-6 py-6">
          <div className="flex flex-wrap gap-2 mb-4 text-[11px]">
            {STATUSES.map((s) => (
              <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 rounded border bg-white">
                <Badge className={`${PILL_SM} ${STATUS_TONE[s]}`}>{s}</Badge>
                <span className="font-mono text-zinc-600">{counts[s] ?? 0}</span>
              </span>
            ))}
            <span className="text-zinc-500 ml-2">· {nodes.length} nodes total</span>
          </div>
          <Card>
            <CardContent className="py-3 px-3">
              {addingChildOf === "__root__" && (
                <div className="mb-3 p-2 border rounded bg-violet-50/30 space-y-1">
                  <input
                    type="text" placeholder="New top-level node title"
                    onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                    autoFocus
                    className="w-full h-7 px-2 rounded border border-zinc-300 text-sm bg-white"
                  />
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" className="h-7 text-xs"
                      onClick={() => addChild(null)}>Create</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs"
                      onClick={() => { setAddingChildOf(null); setDraft({}); }}>Cancel</Button>
                  </div>
                </div>
              )}
              {roots.length === 0 && (
                <div className="text-sm text-zinc-500 italic py-6 text-center">
                  No roadmap nodes yet. Apply migration 043 to seed the current Braiin roadmap.
                </div>
              )}
              {roots.map((n) => <NodeRow key={n.node_id} n={n} depth={0} />)}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageGuard>
  );
}
