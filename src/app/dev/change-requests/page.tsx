"use client";

/**
 * Central change request workflow.
 * Reads feedback.change_requests via /api/change-requests.
 * Status pipeline: new -> reviewing -> brainstorming -> approved -> in_build -> shipped
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PageGuard } from "@/components/page-guard";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Paperclip,
  Search,
  Sparkles,
  X,
} from "lucide-react";

const PILL_SM =
  "text-[10px] px-1.5 py-0 leading-[18px] h-[18px] font-normal tracking-normal";

type Status =
  | "new"
  | "reviewing"
  | "brainstorming"
  | "approved"
  | "in_build"
  | "shipped"
  | "rejected"
  | "parked";

type Priority = "low" | "medium" | "high" | "urgent";

interface Attachment {
  url: string;
  filename: string;
  content_type: string;
  size: number;
}

interface Comment {
  id: string;
  body: string;
  kind: string;
  by_name?: string;
  at: string;
}

interface Request {
  request_id: string;
  source_page: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  tags: string[];
  raised_by_name?: string;
  cto_decision_note?: string;
  brainstorm_notes?: string;
  comments: Comment[];
  attachments: Attachment[];
  created_at: string;
  cto_decided_at?: string;
  shipped_at?: string;
}

const STATUS_LABEL: Record<Status, string> = {
  new: "New",
  reviewing: "Reviewing",
  brainstorming: "Brainstorming",
  approved: "Approved",
  in_build: "In build",
  shipped: "Shipped",
  rejected: "Rejected",
  parked: "Parked",
};
const STATUS_TONE: Record<Status, string> = {
  new: "bg-zinc-100 text-zinc-700",
  reviewing: "bg-amber-100 text-amber-800",
  brainstorming: "bg-violet-100 text-violet-800",
  approved: "bg-sky-100 text-sky-800",
  in_build: "bg-indigo-100 text-indigo-800",
  shipped: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
  parked: "bg-zinc-200 text-zinc-500",
};
const STATUS_ORDER: Status[] = [
  "new",
  "reviewing",
  "brainstorming",
  "approved",
  "in_build",
  "shipped",
  "parked",
  "rejected",
];

const PRIORITY_TONE: Record<Priority, string> = {
  low: "bg-zinc-100 text-zinc-600",
  medium: "bg-sky-100 text-sky-800",
  high: "bg-amber-100 text-amber-800",
  urgent: "bg-rose-100 text-rose-800",
};

function fmtDate(iso?: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString();
}

export default function ChangeRequestsPage() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"open" | "all" | Status>("open");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch("/api/change-requests");
      const data = await r.json();
      setRequests(data.requests ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function toggle(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function patchRequest(req: Request, patch: Record<string, unknown>) {
    const r = await fetch("/api/change-requests", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request_id: req.request_id, ...patch }),
    });
    if (r.ok) {
      const data = await r.json();
      setRequests((list) =>
        list.map((x) => (x.request_id === req.request_id ? data.request : x)),
      );
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests.filter((r) => {
      if (filter === "open") {
        if (r.status === "shipped" || r.status === "rejected" || r.status === "parked")
          return false;
      } else if (filter !== "all" && r.status !== filter) {
        return false;
      }
      if (q) {
        const hay = [r.title, r.description, r.source_page, ...r.tags]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [requests, query, filter]);

  const counts = useMemo(() => {
    const c: Partial<Record<Status, number>> = {};
    for (const r of requests) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [requests]);

  return (
    <PageGuard pageId="dev_change_requests">
      <div className="min-h-screen bg-zinc-50">
        <div className="border-b bg-white">
          <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Lightbulb className="size-5 text-violet-600" />
              <h1 className="text-lg font-medium">Change requests</h1>
              <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono`}>
                /change-requests
              </Badge>
            </div>
            <Button variant="outline" size="sm" onClick={refresh}>
              Refresh
            </Button>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-4">
          {/* KPI strip */}
          <div className="grid grid-cols-7 gap-2 text-xs">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`text-left rounded border px-3 py-2 hover:border-zinc-400 transition-colors ${
                  filter === s ? "border-zinc-900 ring-1 ring-zinc-200" : "border-zinc-200 bg-white"
                }`}
              >
                <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                  {STATUS_LABEL[s]}
                </div>
                <div className="text-lg font-mono">{counts[s] ?? 0}</div>
              </button>
            ))}
          </div>

          {/* Filter */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 border rounded p-1 bg-white">
              <button
                onClick={() => setFilter("open")}
                className={`px-3 py-1 text-xs rounded ${
                  filter === "open"
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                Open
              </button>
              <button
                onClick={() => setFilter("all")}
                className={`px-3 py-1 text-xs rounded ${
                  filter === "all"
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                All
              </button>
            </div>
            <div className="relative flex-1 max-w-md">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Search title, description, source page..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full h-9 pl-8 pr-3 rounded border border-zinc-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
            </div>
          </div>

          {/* Requests */}
          {loading && (
            <div className="text-xs text-zinc-500 italic">Loading...</div>
          )}
          {!loading && filtered.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center text-sm text-zinc-500">
                No change requests yet. Pop into any{" "}
                <span className="font-mono">/dev/*</span> page and click the{" "}
                <span className="text-violet-700 font-medium">Suggest a change</span>{" "}
                button bottom-right.
              </CardContent>
            </Card>
          )}
          {filtered.map((r) => (
            <RequestCard
              key={r.request_id}
              req={r}
              expanded={expanded.has(r.request_id)}
              onToggle={() => toggle(r.request_id)}
              onPatch={(patch) => patchRequest(r, patch)}
            />
          ))}
        </div>
      </div>
    </PageGuard>
  );
}

function RequestCard({
  req,
  expanded,
  onToggle,
  onPatch,
}: {
  req: Request;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [ctoNote, setCtoNote] = useState(req.cto_decision_note ?? "");
  const [brainstorm, setBrainstorm] = useState(req.brainstorm_notes ?? "");
  const [newComment, setNewComment] = useState("");
  const [commentKind, setCommentKind] = useState<
    "insight" | "question" | "decision" | "update"
  >("insight");
  const [commentBy, setCommentBy] = useState("");

  return (
    <Card>
      <CardHeader className="pb-2 cursor-pointer" onClick={onToggle}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button className="text-zinc-400 hover:text-zinc-700">
                {expanded ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
              </button>
              <CardTitle className="text-sm font-medium">{req.title}</CardTitle>
              <Badge className={`${PILL_SM} ${STATUS_TONE[req.status]}`}>
                {STATUS_LABEL[req.status]}
              </Badge>
              <Badge className={`${PILL_SM} ${PRIORITY_TONE[req.priority]} uppercase tracking-wide`}>
                {req.priority}
              </Badge>
              {req.tags.map((t) => (
                <Badge
                  key={t}
                  className={`${PILL_SM} bg-zinc-100 text-zinc-600`}
                >
                  {t}
                </Badge>
              ))}
              {req.attachments.length > 0 && (
                <span className="text-[11px] text-zinc-500 inline-flex items-center gap-0.5">
                  <Paperclip className="size-3" />
                  {req.attachments.length}
                </span>
              )}
            </div>
            <div className="text-[11px] text-zinc-500 mt-1 inline-flex items-center gap-2">
              <span className="font-mono">{req.source_page}</span>
              <span>·</span>
              <span>raised {fmtDate(req.created_at)}</span>
              {req.raised_by_name && (
                <>
                  <span>·</span>
                  <span>by {req.raised_by_name}</span>
                </>
              )}
              <span>·</span>
              <span>{req.comments.length} comments</span>
            </div>
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-4 pt-0">
          <div className="text-sm text-zinc-700 whitespace-pre-wrap leading-relaxed">
            {req.description}
          </div>

          {req.attachments.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {req.attachments.map((a, i) => (
                <a
                  key={i}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="border rounded overflow-hidden hover:ring-2 hover:ring-violet-200"
                >
                  {a.content_type.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.url}
                      alt={a.filename}
                      className="w-full h-32 object-cover"
                    />
                  ) : (
                    <div className="h-32 flex items-center justify-center text-zinc-500 text-xs">
                      <Paperclip className="size-4 mr-1" /> {a.filename}
                    </div>
                  )}
                </a>
              ))}
            </div>
          )}

          <Separator />

          {/* Status pipeline */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">
              Move through the pipeline
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  onClick={() => onPatch({ status: s })}
                  className={`px-2 py-1 rounded text-[11px] border ${
                    req.status === s
                      ? "border-zinc-900 bg-zinc-900 text-white"
                      : "border-zinc-200 hover:bg-zinc-50"
                  }`}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Brainstorm */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">
              <Sparkles className="size-3 inline mr-1 text-violet-600" />
              Brainstorm notes (scope, approach, open questions)
            </div>
            <textarea
              value={brainstorm}
              onChange={(e) => setBrainstorm(e.target.value)}
              onBlur={() =>
                brainstorm !== (req.brainstorm_notes ?? "") &&
                onPatch({ brainstorm_notes: brainstorm })
              }
              rows={3}
              placeholder="Sketch the approach. Edge cases. Risks. What does the customer-facing change look like?"
              className="w-full px-2 py-2 rounded border border-zinc-300 text-xs leading-relaxed bg-white resize-none focus:outline-none focus:ring-2 focus:ring-violet-200"
            />
          </div>

          {/* CTO decision */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1 inline-flex items-center gap-1">
              CTO decision
              {req.cto_decided_at && (
                <span className="text-zinc-400">· decided {fmtDate(req.cto_decided_at)}</span>
              )}
            </div>
            <textarea
              value={ctoNote}
              onChange={(e) => setCtoNote(e.target.value)}
              onBlur={() =>
                ctoNote !== (req.cto_decision_note ?? "") &&
                onPatch({ cto_decision_note: ctoNote })
              }
              rows={2}
              placeholder="Decision rationale. Approve / reject / park - and why."
              className="w-full px-2 py-2 rounded border border-zinc-300 text-xs leading-relaxed bg-white resize-none focus:outline-none focus:ring-2 focus:ring-emerald-200"
            />
            <div className="flex items-center gap-1 mt-2">
              <Button
                size="sm"
                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                onClick={() => onPatch({ status: "approved", cto_decision_note: ctoNote })}
              >
                <Check className="size-3 mr-1" /> Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => onPatch({ status: "parked", cto_decision_note: ctoNote })}
              >
                Park
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-rose-700"
                onClick={() => onPatch({ status: "rejected", cto_decision_note: ctoNote })}
              >
                <X className="size-3 mr-1" /> Reject
              </Button>
            </div>
          </div>

          <Separator />

          {/* Comments */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-2">
              Discussion ({req.comments.length})
            </div>
            <div className="space-y-2">
              {req.comments.map((c) => (
                <div
                  key={c.id}
                  className="border-l-2 border-l-violet-200 bg-violet-50/30 pl-3 py-1.5 rounded-r"
                >
                  <div className="text-[10px] text-zinc-500 inline-flex items-center gap-2">
                    <Badge className={`${PILL_SM} bg-violet-100 text-violet-700`}>
                      {c.kind}
                    </Badge>
                    {c.by_name && <span>{c.by_name}</span>}
                    <span>· {fmtDate(c.at)}</span>
                  </div>
                  <div className="text-xs text-zinc-700 mt-0.5 whitespace-pre-wrap">
                    {c.body}
                  </div>
                </div>
              ))}
              <div className="border rounded p-2 bg-zinc-50 space-y-1.5">
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={commentKind}
                    onChange={(e) =>
                      setCommentKind(
                        e.target.value as
                          | "insight"
                          | "question"
                          | "decision"
                          | "update",
                      )
                    }
                    className="h-7 px-1 text-[11px] rounded border border-zinc-300 bg-white"
                  >
                    <option value="insight">Insight</option>
                    <option value="question">Question</option>
                    <option value="decision">Decision</option>
                    <option value="update">Update</option>
                  </select>
                  <input
                    type="text"
                    value={commentBy}
                    onChange={(e) => setCommentBy(e.target.value)}
                    placeholder="Your name (optional)"
                    className="h-7 px-2 text-[11px] rounded border border-zinc-300 bg-white"
                  />
                </div>
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  rows={2}
                  placeholder="Add insight, ask a question, log a decision..."
                  className="w-full px-2 py-1.5 text-xs rounded border border-zinc-300 bg-white resize-none focus:outline-none focus:ring-1 focus:ring-violet-200"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!newComment.trim()}
                    onClick={async () => {
                      await onPatch({
                        append_comment: {
                          body: newComment.trim(),
                          kind: commentKind,
                          by_name: commentBy.trim() || null,
                        },
                      });
                      setNewComment("");
                    }}
                  >
                    <ArrowRight className="size-3 mr-1" />
                    Add
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
