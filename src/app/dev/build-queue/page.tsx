"use client";

/**
 * Build queue + personal tokens. Super_admin only.
 * Manual push form + queue list + token generator.
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PageGuard } from "@/components/page-guard";
import { AlertTriangle, Hammer, Key, Plus, Trash2 } from "lucide-react";
import { PILL_SM } from "@/lib/ui-constants";
import { BraiinLoader } from "@/components/braiin-loader";

interface QueueItem {
  queue_id: string;
  source_type: string;
  source_id: string | null;
  title: string;
  prompt: string;
  target_repo: string | null;
  working_dir: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  status: "queued" | "claimed" | "done" | "cancelled";
  claimed_at: string | null;
  claimed_by: string | null;
  claimed_machine: string | null;
  completed_at: string | null;
  completed_commit_sha: string | null;
  created_at: string;
  created_by_email: string | null;
  notes: string | null;
}

interface PersonalToken {
  token_id: string;
  user_email: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

const STATUS_TONE: Record<string, string> = {
  queued: "bg-sky-100 text-sky-800",
  claimed: "bg-amber-100 text-amber-800",
  done: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-zinc-200 text-zinc-600",
};
const PRIORITY_TONE: Record<string, string> = {
  urgent: "bg-rose-100 text-rose-800",
  high: "bg-amber-100 text-amber-800",
  medium: "bg-sky-100 text-sky-800",
  low: "bg-zinc-100 text-zinc-600",
};

export default function BuildQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [tokens, setTokens] = useState<PersonalToken[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPush, setShowPush] = useState(false);
  const [showTokens, setShowTokens] = useState(false);
  // Push form
  const [pTitle, setPTitle] = useState("");
  const [pPrompt, setPPrompt] = useState("");
  const [pPriority, setPPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [pWorkingDir, setPWorkingDir] = useState("/Users/robdonald-agent/ai-projects/Corten Outreach/dashboard");
  // Token form
  const [tLabel, setTLabel] = useState("");

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [qRes, tRes] = await Promise.all([
        fetch("/api/build-queue"),
        fetch("/api/personal-tokens"),
      ]);
      const qJson = (await qRes.json()) as { items?: QueueItem[]; error?: string };
      const tJson = (await tRes.json()) as { tokens?: PersonalToken[]; error?: string };
      if (!qRes.ok) throw new Error(qJson.error ?? "queue load failed");
      if (!tRes.ok) throw new Error(tJson.error ?? "tokens load failed");
      setItems(qJson.items ?? []);
      setTokens(tJson.tokens ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  async function pushItem() {
    if (!pTitle.trim() || !pPrompt.trim()) return;
    try {
      const r = await fetch("/api/build-queue", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: pTitle, prompt: pPrompt, priority: pPriority, working_dir: pWorkingDir, source_type: "manual" }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "push failed");
      setPTitle(""); setPPrompt(""); setShowPush(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "push failed");
    }
  }

  async function generateToken() {
    if (!tLabel.trim()) return;
    try {
      const r = await fetch("/api/personal-tokens", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: tLabel }),
      });
      const j = (await r.json()) as { token?: string; error?: string };
      if (!r.ok || !j.token) throw new Error(j.error ?? "token gen failed");
      setNewToken(j.token);
      setTLabel("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "token gen failed");
    }
  }

  async function revokeToken(token_id: string) {
    if (!confirm("Revoke this token? Any helper script using it will stop working.")) return;
    await fetch("/api/personal-tokens", {
      method: "DELETE", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token_id }),
    });
    await refresh();
  }

  async function setStatus(queue_id: string, status: "done" | "cancelled") {
    await fetch("/api/build-queue", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ queue_id, status }),
    });
    await refresh();
  }

  const queued = items.filter((i) => i.status === "queued");
  const claimed = items.filter((i) => i.status === "claimed");
  const done = items.filter((i) => i.status === "done").slice(0, 20);

  return (
    <PageGuard pageId="dev_build_queue">
      <div className="min-h-screen bg-zinc-50">
        <div className="border-b bg-white">
          <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Hammer className="size-5 text-violet-600" />
              <h1 className="text-lg font-medium">Build queue</h1>
              <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono`}>/build-queue</Badge>
              <Badge className={`${PILL_SM} bg-rose-100 text-rose-800 uppercase`}>super_admin</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowTokens((v) => !v)}>
                <Key className="size-3.5 mr-1.5" />Tokens ({tokens.length})
              </Button>
              <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={() => setShowPush(true)}>
                <Plus className="size-3.5 mr-1.5" />Push to queue
              </Button>
            </div>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-4">
          {error && (
            <div className="border border-rose-300 bg-rose-50 text-rose-800 text-xs px-3 py-2 rounded flex items-start gap-2">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
              <button onClick={() => setError(null)} className="text-rose-700 hover:text-rose-900 text-[11px] underline">dismiss</button>
            </div>
          )}
          {loading && !items.length && <BraiinLoader label="Loading queue..." />}

          {newToken && (
            <Card className="border-emerald-300 bg-emerald-50">
              <CardContent className="py-3 px-4 space-y-2">
                <div className="text-xs font-medium text-emerald-900">Save this token now - it won&apos;t be shown again:</div>
                <code className="block p-2 bg-white border rounded text-xs font-mono break-all">{newToken}</code>
                <div className="text-[11px] text-zinc-700">Add to <code className="font-mono">~/.zshrc</code>:</div>
                <code className="block p-2 bg-white border rounded text-xs font-mono">export BRAIIN_PERSONAL_TOKEN={newToken}</code>
                <button onClick={() => setNewToken(null)} className="text-xs text-emerald-700 underline">dismiss</button>
              </CardContent>
            </Card>
          )}

          {showTokens && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Personal tokens</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2">
                  <input type="text" value={tLabel} onChange={(e) => setTLabel(e.target.value)} placeholder="label (e.g. macbook-pro)"
                    className="flex-1 h-8 px-2 rounded border border-zinc-300 text-sm bg-white" />
                  <Button size="sm" onClick={generateToken} disabled={!tLabel.trim()}>Generate</Button>
                </div>
                {tokens.length === 0 && <div className="text-xs text-zinc-500 italic">No tokens yet.</div>}
                {tokens.map((t) => (
                  <div key={t.token_id} className="flex items-center gap-2 py-1 border-b border-zinc-100 last:border-0 text-xs">
                    <span className="font-medium">{t.label}</span>
                    <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600`}>{t.user_email}</Badge>
                    <span className="text-[10px] text-zinc-500 ml-auto">last used: {t.last_used_at ?? "never"}</span>
                    <button onClick={() => revokeToken(t.token_id)} className="text-rose-600 hover:text-rose-800"><Trash2 className="size-3" /></button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {showPush && (
            <Card className="border-violet-300">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Push new build item</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <input type="text" value={pTitle} onChange={(e) => setPTitle(e.target.value)} placeholder="Title (short)"
                  className="w-full h-8 px-2 rounded border border-zinc-300 text-sm bg-white" />
                <textarea value={pPrompt} onChange={(e) => setPPrompt(e.target.value)} placeholder="Full prompt for Claude Code..." rows={6}
                  className="w-full px-2 py-1.5 rounded border border-zinc-300 text-xs font-mono bg-white resize-y" />
                <div className="flex items-center gap-2">
                  <select value={pPriority} onChange={(e) => setPPriority(e.target.value as typeof pPriority)} className="h-8 px-2 rounded border border-zinc-300 text-xs bg-white">
                    <option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="urgent">urgent</option>
                  </select>
                  <input type="text" value={pWorkingDir} onChange={(e) => setPWorkingDir(e.target.value)} placeholder="working_dir"
                    className="flex-1 h-8 px-2 rounded border border-zinc-300 text-xs font-mono bg-white" />
                  <Button size="sm" variant="outline" onClick={() => setShowPush(false)}>Cancel</Button>
                  <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={pushItem} disabled={!pTitle.trim() || !pPrompt.trim()}>Push</Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Separator />

          <Section title={`Queued (${queued.length})`} items={queued} onCancel={(id) => setStatus(id, "cancelled")} />
          <Section title={`Claimed in progress (${claimed.length})`} items={claimed} onComplete={(id) => setStatus(id, "done")} onCancel={(id) => setStatus(id, "cancelled")} />
          <Section title={`Recently done (${done.length})`} items={done} muted />
        </div>
      </div>
    </PageGuard>
  );
}

function Section({ title, items, onComplete, onCancel, muted }: { title: string; items: QueueItem[]; onComplete?: (id: string) => void; onCancel?: (id: string) => void; muted?: boolean }) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {items.map((i) => (
          <div key={i.queue_id} className={`border rounded p-2 ${muted ? "opacity-70" : ""}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{i.title}</span>
              <Badge className={`${PILL_SM} ${PRIORITY_TONE[i.priority]} uppercase`}>{i.priority}</Badge>
              <Badge className={`${PILL_SM} ${STATUS_TONE[i.status]}`}>{i.status}</Badge>
              <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono`}>{i.source_type}</Badge>
              {i.claimed_by && <span className="text-[10px] text-zinc-500">claimed by {i.claimed_by} on {i.claimed_machine}</span>}
              <span className="text-[10px] text-zinc-400 ml-auto font-mono">{i.created_at.slice(0, 16).replace("T", " ")}</span>
            </div>
            <div className="text-[11px] text-zinc-600 mt-1 font-mono whitespace-pre-wrap line-clamp-3">{i.prompt}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-zinc-500 font-mono">{i.working_dir}</span>
              {onComplete && <button onClick={() => onComplete(i.queue_id)} className="text-[11px] text-emerald-700 underline">mark done</button>}
              {onCancel && i.status !== "done" && <button onClick={() => onCancel(i.queue_id)} className="text-[11px] text-rose-600 underline">cancel</button>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
