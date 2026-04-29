"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageGuard } from "@/components/page-guard";
import { AlertTriangle, History, Search } from "lucide-react";
import { PILL_SM } from "@/lib/ui-constants";
import { BraiinLoader } from "@/components/braiin-loader";

interface Entry {
  log_id: string;
  title: string;
  summary?: string;
  item_type: string;
  status: string;
  area?: string;
  tags: string[];
  occurred_at: string;
  commit_sha?: string;
  commit_message?: string;
  notes?: string;
  author?: string;
}

const TYPE_TONE: Record<string, string> = {
  migration: "bg-violet-100 text-violet-800",
  schema: "bg-violet-100 text-violet-800",
  page: "bg-emerald-100 text-emerald-800",
  api: "bg-cyan-100 text-cyan-800",
  wiring: "bg-cyan-100 text-cyan-800",
  component: "bg-sky-100 text-sky-800",
  feature: "bg-emerald-100 text-emerald-800",
  fix: "bg-rose-100 text-rose-800",
  refactor: "bg-amber-100 text-amber-800",
  decision: "bg-zinc-200 text-zinc-800",
  docs: "bg-zinc-100 text-zinc-700",
  devops: "bg-indigo-100 text-indigo-800",
  security: "bg-rose-100 text-rose-800",
};

const STATUS_TONE: Record<string, string> = {
  shipped: "bg-emerald-100 text-emerald-800",
  planned: "bg-zinc-100 text-zinc-600",
  in_progress: "bg-amber-100 text-amber-800",
  reverted: "bg-rose-100 text-rose-800",
  deprecated: "bg-zinc-200 text-zinc-500",
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function BuildLogPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/build-log")
      .then(async (r) => {
        const d = (await r.json()) as { entries?: Entry[]; error?: string };
        if (!r.ok) throw new Error(d.error ?? `Load failed (${r.status})`);
        return d;
      })
      .then((d) => {
        if (cancelled) return;
        setEntries(d.entries ?? []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Load failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const areas = useMemo(() => Array.from(new Set(entries.map((e) => e.area).filter(Boolean))) as string[], [entries]);
  const types = useMemo(() => Array.from(new Set(entries.map((e) => e.item_type))).sort(), [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (areaFilter !== "all" && e.area !== areaFilter) return false;
      if (typeFilter !== "all" && e.item_type !== typeFilter) return false;
      // Filter optional fields - empty defaults instead of relying on
      // join() converting `undefined` to the string "undefined", which
      // would make any search for the literal "undefined" match every row.
      if (q) {
        const hay = [
          e.title ?? "",
          e.summary ?? "",
          e.notes ?? "",
          e.commit_message ?? "",
          ...(e.tags ?? []),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, query, areaFilter, typeFilter]);

  // Group by date (yyyy-mm-dd)
  const grouped = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of filtered) {
      const day = e.occurred_at.slice(0, 10);
      const list = m.get(day) ?? [];
      list.push(e);
      m.set(day, list);
    }
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of entries) c[e.item_type] = (c[e.item_type] ?? 0) + 1;
    return c;
  }, [entries]);

  return (
    <PageGuard pageId="dev_build_log">
      <div className="min-h-screen bg-zinc-50">
        <div className="border-b bg-white">
          <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <History className="size-5 text-zinc-600" />
              <h1 className="text-lg font-medium">Build log</h1>
              <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono`}>/build-log</Badge>
            </div>
            <div className="text-[11px] text-zinc-500">
              {entries.length} entries · running ledger of everything shipped
            </div>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-4">
          {/* Type counts */}
          <div className="flex flex-wrap gap-2 text-xs">
            {types.map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(typeFilter === t ? "all" : t)}
                className={`px-2 py-1 rounded border ${
                  typeFilter === t ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white hover:border-zinc-400"
                }`}
              >
                <Badge className={`${PILL_SM} ${TYPE_TONE[t] ?? "bg-zinc-100 text-zinc-700"} mr-1.5`}>{t}</Badge>
                {counts[t] ?? 0}
              </button>
            ))}
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-md">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Search title, summary, commit message, tags..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full h-9 pl-8 pr-3 rounded border border-zinc-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
            </div>
            <select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} className="h-9 px-2 rounded border border-zinc-300 bg-white text-sm">
              <option value="all">All areas</option>
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-9 px-2 rounded border border-zinc-300 bg-white text-sm">
              <option value="all">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {error && (
            <div className="border border-rose-300 bg-rose-50 text-rose-800 text-xs px-3 py-2 rounded flex items-start gap-2">
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
          {loading && <BraiinLoader label="Loading build log..." />}

          {grouped.map(([day, list]) => (
            <div key={day}>
              <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2 font-mono">{day}</div>
              <div className="space-y-1.5">
                {list.map((e) => (
                  <Card key={e.log_id} className="hover:bg-zinc-50">
                    <CardContent className="py-2.5 px-4">
                      <div className="flex items-start gap-2 flex-wrap">
                        <Badge className={`${PILL_SM} ${TYPE_TONE[e.item_type] ?? "bg-zinc-100"}`}>{e.item_type}</Badge>
                        <Badge className={`${PILL_SM} ${STATUS_TONE[e.status] ?? "bg-zinc-100"}`}>{e.status}</Badge>
                        {e.area && <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-700`}>{e.area}</Badge>}
                        <div className="text-sm flex-1 min-w-0">
                          <span className="font-medium">{e.title}</span>
                          {e.commit_sha && (
                            <span className="text-[10px] text-zinc-400 font-mono ml-2">{e.commit_sha.slice(0, 7)}</span>
                          )}
                        </div>
                        <span className="text-[10px] text-zinc-400 font-mono shrink-0">{fmtDate(e.occurred_at)}</span>
                      </div>
                      {e.summary && <div className="text-xs text-zinc-600 mt-1">{e.summary}</div>}
                      {e.notes && <div className="text-xs text-zinc-600 italic mt-1">{e.notes}</div>}
                      {e.tags && e.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {e.tags.map((t) => (
                            <Badge key={t} className={`${PILL_SM} bg-zinc-100 text-zinc-500 text-[9px]`}>#{t}</Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageGuard>
  );
}
