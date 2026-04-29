"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageGuard } from "@/components/page-guard";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Map as MapIcon,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { PILL_SM } from "@/lib/ui-constants";
import { BraiinLoader } from "@/components/braiin-loader";

interface RoadmapNode {
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

interface NodeRowProps {
  node: RoadmapNode;
  depth: number;
  tree: Map<string | null, RoadmapNode[]>;
  expanded: Set<string>;
  editing: string | null;
  addingChildOf: string | null;
  draft: Partial<RoadmapNode>;
  pendingDeleteId: string | null;
  onToggle: (id: string) => void;
  onSetDraft: (patch: Partial<RoadmapNode>) => void;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSave: (id: string) => void;
  onStartAddChild: (parentId: string) => void;
  onCancelAddChild: () => void;
  onAddChild: (parentId: string) => void;
  onRequestDelete: (id: string) => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

// Lifted out of RoadmapPage so React doesn't recreate the component on every
// parent render - that was causing every node to unmount + remount on every
// keystroke and losing inline edit state.
function NodeRow(props: NodeRowProps) {
  const {
    node: n,
    depth,
    tree,
    expanded,
    editing,
    addingChildOf,
    draft,
    pendingDeleteId,
    onToggle,
    onSetDraft,
    onStartEdit,
    onCancelEdit,
    onSave,
    onStartAddChild,
    onCancelAddChild,
    onAddChild,
    onRequestDelete,
    onConfirmDelete,
    onCancelDelete,
  } = props;

  const children = tree.get(n.node_id) ?? [];
  const isOpen = expanded.has(n.node_id);
  const isEditing = editing === n.node_id;
  const isPendingDelete = pendingDeleteId === n.node_id;
  const childCount = children.length;

  return (
    <div>
      <div
        className="group flex items-start gap-2 py-2 hover:bg-zinc-50 rounded px-2"
        style={{ marginLeft: depth * 20 }}
      >
        <button
          onClick={() => onToggle(n.node_id)}
          className={`text-zinc-400 mt-0.5 ${childCount === 0 ? "invisible" : ""}`}
        >
          {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="space-y-1">
              <input
                type="text"
                defaultValue={n.title}
                onChange={(e) => onSetDraft({ title: e.target.value })}
                className="w-full h-7 px-2 rounded border border-zinc-300 text-sm bg-white"
              />
              <textarea
                defaultValue={n.rationale ?? ""}
                onChange={(e) => onSetDraft({ rationale: e.target.value })}
                rows={2}
                placeholder="Rationale - why does this exist, what does it unlock?"
                className="w-full px-2 py-1 rounded border border-zinc-300 text-xs bg-white resize-none"
              />
              <div className="flex items-center gap-2">
                <select
                  defaultValue={n.status}
                  onChange={(e) => onSetDraft({ status: e.target.value })}
                  className="h-7 px-1 text-[11px] rounded border border-zinc-300 bg-white"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  defaultValue={n.priority}
                  onChange={(e) => onSetDraft({ priority: e.target.value })}
                  className="h-7 px-1 text-[11px] rounded border border-zinc-300 bg-white"
                >
                  {["low", "medium", "high", "critical"].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  defaultValue={n.area ?? ""}
                  onChange={(e) => onSetDraft({ area: e.target.value })}
                  placeholder="area"
                  className="h-7 px-2 rounded border border-zinc-300 text-[11px] bg-white w-28"
                />
                <input
                  type="text"
                  defaultValue={n.eta ?? ""}
                  onChange={(e) => onSetDraft({ eta: e.target.value })}
                  placeholder="ETA / next session / Q2"
                  className="h-7 px-2 rounded border border-zinc-300 text-[11px] bg-white flex-1"
                />
                <Button
                  size="sm"
                  className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => onSave(n.node_id)}
                >
                  <Save className="size-3 mr-1" /> Save
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancelEdit}>
                  <X className="size-3" />
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{n.title}</span>
                <Badge className={`${PILL_SM} ${STATUS_TONE[n.status]}`}>{n.status}</Badge>
                <Badge
                  className={`${PILL_SM} ${PRIORITY_TONE[n.priority]} uppercase tracking-wide`}
                >
                  {n.priority}
                </Badge>
                {n.area && <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600`}>{n.area}</Badge>}
                {n.eta && <span className="text-[10px] text-zinc-500 italic">eta: {n.eta}</span>}
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 ml-auto">
                  <button
                    onClick={() => onStartEdit(n.node_id)}
                    className="text-[10px] text-zinc-500 hover:text-zinc-900 px-1.5 py-0.5"
                  >
                    edit
                  </button>
                  <button
                    onClick={() => onStartAddChild(n.node_id)}
                    className="text-[10px] text-violet-700 hover:bg-violet-50 px-1.5 py-0.5 rounded inline-flex items-center gap-0.5"
                  >
                    <Plus className="size-2.5" /> child
                  </button>
                  <button
                    onClick={() => onRequestDelete(n.node_id)}
                    className="text-[10px] text-rose-700 hover:bg-rose-50 px-1.5 py-0.5 rounded"
                  >
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
              {isPendingDelete && (
                <div className="mt-2 p-2 border border-rose-300 rounded bg-rose-50 text-xs text-rose-800 flex items-center justify-between gap-2">
                  <span>
                    Delete <span className="font-medium">{n.title}</span>
                    {childCount > 0
                      ? ` and its ${childCount} child${childCount === 1 ? "" : "ren"} (cascading)?`
                      : "?"}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-rose-600 hover:bg-rose-700"
                      onClick={onConfirmDelete}
                    >
                      Delete
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={onCancelDelete}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
          {addingChildOf === n.node_id && (
            <div className="mt-2 p-2 border rounded bg-violet-50/30 space-y-1">
              <input
                type="text"
                placeholder="New child node title"
                onChange={(e) => onSetDraft({ title: e.target.value })}
                autoFocus
                className="w-full h-7 px-2 rounded border border-zinc-300 text-sm bg-white"
              />
              <textarea
                rows={2}
                placeholder="Rationale (optional)"
                onChange={(e) => onSetDraft({ rationale: e.target.value })}
                className="w-full px-2 py-1 rounded border border-zinc-300 text-xs bg-white resize-none"
              />
              <div className="flex items-center gap-1.5">
                <select
                  onChange={(e) => onSetDraft({ status: e.target.value })}
                  defaultValue="idea"
                  className="h-7 px-1 text-[11px] rounded border border-zinc-300 bg-white"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <Button size="sm" className="h-7 text-xs" onClick={() => onAddChild(n.node_id)}>
                  Create
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancelAddChild}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      {isOpen &&
        children.map((c) => (
          <NodeRow
            key={c.node_id}
            {...props}
            node={c}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

export default function RoadmapPage() {
  const [nodes, setNodes] = useState<RoadmapNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<RoadmapNode>>({});
  const [addingChildOf, setAddingChildOf] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/roadmap");
      const d = (await r.json()) as { nodes?: RoadmapNode[]; error?: string };
      if (!r.ok) throw new Error(d.error ?? `Load failed (${r.status})`);
      setNodes(d.nodes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const tree = useMemo<Map<string | null, RoadmapNode[]>>(() => {
    const byParent: Map<string | null, RoadmapNode[]> = new Map();
    for (const n of nodes) {
      const list = byParent.get(n.parent_id) ?? [];
      list.push(n);
      byParent.set(n.parent_id, list);
    }
    for (const v of byParent.values()) {
      v.sort((a, b) => a.position - b.position);
    }
    return byParent;
  }, [nodes]);

  // Default-expand top 2 levels on first load. Guard prevents this from
  // re-running once the operator has interacted; `expanded` is in deps so
  // future code changes can't introduce a stale-closure bug.
  useEffect(() => {
    if (nodes.length > 0 && expanded.size === 0) {
      const top = nodes.filter((n) => !n.parent_id);
      const lvl1 = nodes.filter((n) => top.some((t) => t.node_id === n.parent_id));
      setExpanded(new Set([...top, ...lvl1].map((n) => n.node_id)));
    }
  }, [nodes, expanded]);

  function toggle(id: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function save(id: string) {
    try {
      const r = await fetch("/api/roadmap", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ node_id: id, ...draft }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Save failed (${r.status})`);
      }
      setEditing(null);
      setDraft({});
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? `Save failed: ${e.message}` : "Save failed");
    }
  }

  async function addChild(parent_id: string | null) {
    if (!draft.title) return;
    try {
      const r = await fetch("/api/roadmap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parent_id, ...draft }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Add failed (${r.status})`);
      }
      setAddingChildOf(null);
      setDraft({});
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? `Add failed: ${e.message}` : "Add failed");
    }
  }

  async function performDelete(id: string) {
    try {
      const r = await fetch("/api/roadmap", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ node_id: id }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Delete failed (${r.status})`);
      }
      setPendingDeleteId(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? `Delete failed: ${e.message}` : "Delete failed");
    }
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
            <Button
              size="sm"
              onClick={() => {
                setAddingChildOf("__root__");
                setDraft({});
              }}
            >
              <Plus className="size-3.5 mr-1" /> Add top-level
            </Button>
          </div>
        </div>
        <div className="max-w-[1400px] mx-auto px-6 py-6">
          {error && (
            <div className="mb-4 border border-rose-300 bg-rose-50 text-rose-800 text-xs px-3 py-2 rounded flex items-start gap-2">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
              <button
                onClick={() => setError(null)}
                className="text-rose-700 hover:text-rose-900 text-[11px] underline"
              >
                dismiss
              </button>
            </div>
          )}
          {loading && <BraiinLoader label="Loading roadmap..." />}
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
                    type="text"
                    placeholder="New top-level node title"
                    onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                    autoFocus
                    className="w-full h-7 px-2 rounded border border-zinc-300 text-sm bg-white"
                  />
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" className="h-7 text-xs" onClick={() => addChild(null)}>
                      Create
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => {
                        setAddingChildOf(null);
                        setDraft({});
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {!loading && roots.length === 0 && (
                <div className="text-sm text-zinc-500 italic py-6 text-center">
                  No roadmap nodes yet. Apply migration 043 to seed the current Braiin roadmap.
                </div>
              )}
              {roots.map((n) => (
                <NodeRow
                  key={n.node_id}
                  node={n}
                  depth={0}
                  tree={tree}
                  expanded={expanded}
                  editing={editing}
                  addingChildOf={addingChildOf}
                  draft={draft}
                  pendingDeleteId={pendingDeleteId}
                  onToggle={toggle}
                  onSetDraft={(patch) => setDraft((d) => ({ ...d, ...patch }))}
                  onStartEdit={(id) => {
                    setEditing(id);
                    setDraft({});
                  }}
                  onCancelEdit={() => {
                    setEditing(null);
                    setDraft({});
                  }}
                  onSave={save}
                  onStartAddChild={(parentId) => {
                    setAddingChildOf(parentId);
                    setDraft({});
                  }}
                  onCancelAddChild={() => {
                    setAddingChildOf(null);
                    setDraft({});
                  }}
                  onAddChild={addChild}
                  onRequestDelete={(id) => setPendingDeleteId(id)}
                  onConfirmDelete={() => {
                    if (pendingDeleteId) performDelete(pendingDeleteId);
                  }}
                  onCancelDelete={() => setPendingDeleteId(null)}
                />
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageGuard>
  );
}
