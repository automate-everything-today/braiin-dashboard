"use client";

/**
 * /dev/voice
 *
 * Admin surface for the anti-AI writing style enforcement layer.
 * Tabbed by rule_type. Manager+ can add / disable / re-enable rules.
 *
 * The seed migration 057 populates this page on first load so it's never
 * empty. Edits made here take effect immediately - the linter cache
 * invalidates on every write via the API.
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageGuard } from "@/components/page-guard";
import { BraiinLoader } from "@/components/braiin-loader";
import { Plus, RefreshCw, ShieldOff, ShieldCheck, Search } from "lucide-react";

const RULE_TYPES = [
  "banned_word",
  "banned_phrase",
  "banned_structure",
  "banned_formatting",
  "banned_tone",
] as const;

type RuleType = (typeof RULE_TYPES)[number];
type Severity = "block" | "warn";
type Channel = "all" | "email" | "messaging" | "social";

interface VoiceRule {
  id: number;
  rule_type: RuleType;
  pattern: string;
  replacement: string;
  severity: Severity;
  channel: Channel;
  notes: string | null;
  added_by: string | null;
  active: boolean;
  catch_count: number;
  last_caught_at: string | null;
  created_at: string;
  updated_at: string;
}

const RULE_LABELS: Record<RuleType, string> = {
  banned_word: "Banned words",
  banned_phrase: "Banned phrases",
  banned_structure: "Banned structures",
  banned_formatting: "Banned formatting",
  banned_tone: "Banned tone",
};

const CHANNEL_TONE: Record<Channel, string> = {
  all: "bg-zinc-100 text-zinc-700",
  email: "bg-blue-100 text-blue-700",
  messaging: "bg-emerald-100 text-emerald-700",
  social: "bg-violet-100 text-violet-700",
};

const SEVERITY_TONE: Record<Severity, string> = {
  block: "bg-red-100 text-red-700",
  warn: "bg-amber-100 text-amber-700",
};

export default function VoicePage() {
  return (
    <PageGuard pageId="voice">
      <VoiceInner />
    </PageGuard>
  );
}

function VoiceInner() {
  const [rules, setRules] = useState<VoiceRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<RuleType>("banned_word");
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  async function load() {
    try {
      const res = await fetch(
        `/api/voice-rules?include_inactive=${showInactive}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setRules(data.rules || []);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setRules([]);
    }
  }

  useEffect(() => {
    load();
  }, [showInactive]);

  const counts = useMemo(() => {
    const c: Record<RuleType, { active: number; total: number; catches: number }> = {
      banned_word: { active: 0, total: 0, catches: 0 },
      banned_phrase: { active: 0, total: 0, catches: 0 },
      banned_structure: { active: 0, total: 0, catches: 0 },
      banned_formatting: { active: 0, total: 0, catches: 0 },
      banned_tone: { active: 0, total: 0, catches: 0 },
    };
    for (const r of rules ?? []) {
      c[r.rule_type].total += 1;
      if (r.active) c[r.rule_type].active += 1;
      c[r.rule_type].catches += r.catch_count;
    }
    return c;
  }, [rules]);

  const filtered = useMemo(() => {
    if (!rules) return [];
    const q = search.toLowerCase().trim();
    return rules
      .filter((r) => r.rule_type === activeTab)
      .filter((r) => {
        if (!q) return true;
        return (
          r.pattern.toLowerCase().includes(q) ||
          r.replacement.toLowerCase().includes(q) ||
          (r.notes ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.pattern.localeCompare(b.pattern);
      });
  }, [rules, activeTab, search]);

  async function toggleActive(rule: VoiceRule) {
    const newActive = !rule.active;
    setRules((rs) =>
      rs?.map((r) => (r.id === rule.id ? { ...r, active: newActive } : r)) ??
      null,
    );
    const res = await fetch("/api/voice-rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rule.id, active: newActive }),
    });
    if (!res.ok) {
      const d = await res.json();
      setError(d.error || "Toggle failed");
      load();
    }
  }

  if (rules === null) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <BraiinLoader />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Voice rules</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Anti-AI writing style. Every banned word, phrase, structure or tone marker
            here is paired with the human replacement to use instead. Loaded into the
            LLM system prompt at draft time + scanned post-generation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add rule
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-800">{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {RULE_TYPES.map((t) => {
          const c = counts[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              className={`text-left rounded-lg border p-3 transition ${
                activeTab === t
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-200 hover:border-zinc-400"
              }`}
            >
              <div className="text-xs uppercase tracking-wide opacity-80">
                {RULE_LABELS[t]}
              </div>
              <div className="text-2xl font-semibold mt-1">{c.active}</div>
              <div className={`text-xs mt-1 ${activeTab === t ? "opacity-80" : "text-zinc-500"}`}>
                {c.total - c.active} disabled · {c.catches} catches
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search pattern, replacement or notes..."
            className="w-full pl-8 pr-3 py-2 text-sm border rounded-md"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show disabled
        </label>
      </div>

      {adding && (
        <AddRuleForm
          ruleType={activeTab}
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">
            {RULE_LABELS[activeTab]} ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pattern</TableHead>
                <TableHead>Use instead</TableHead>
                <TableHead className="w-24">Channel</TableHead>
                <TableHead className="w-24">Severity</TableHead>
                <TableHead className="w-20 text-right">Catches</TableHead>
                <TableHead className="w-32"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id} className={!r.active ? "opacity-50" : ""}>
                  <TableCell className="font-medium">{r.pattern}</TableCell>
                  <TableCell className="text-sm text-zinc-700">{r.replacement}</TableCell>
                  <TableCell>
                    <Badge className={CHANNEL_TONE[r.channel]}>{r.channel}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={SEVERITY_TONE[r.severity]}>{r.severity}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {r.catch_count}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleActive(r)}
                    >
                      {r.active ? (
                        <>
                          <ShieldOff className="h-3 w-3 mr-1" /> Disable
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="h-3 w-3 mr-1" /> Enable
                        </>
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-zinc-500 py-6">
                    No rules match. Click &quot;Add rule&quot; to create one.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function AddRuleForm({
  ruleType,
  onCancel,
  onSaved,
}: {
  ruleType: RuleType;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [pattern, setPattern] = useState("");
  const [replacement, setReplacement] = useState("");
  const [severity, setSeverity] = useState<Severity>("block");
  const [channel, setChannel] = useState<Channel>("all");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!pattern.trim() || !replacement.trim()) {
      setErr("Pattern and replacement are required");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/voice-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rule_type: ruleType,
        pattern: pattern.trim(),
        replacement: replacement.trim(),
        severity,
        channel,
        notes: notes.trim() || null,
      }),
    });
    setSaving(false);
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error || "Save failed");
      return;
    }
    onSaved();
  }

  return (
    <Card className="border-zinc-900">
      <CardHeader className="py-3">
        <CardTitle className="text-base">Add a new {RULE_LABELS[ruleType].toLowerCase()} rule</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs uppercase tracking-wide text-zinc-500">Pattern (banned)</label>
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="e.g. circle back"
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-zinc-500">Use instead (replacement)</label>
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="e.g. follow up, name the day"
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-zinc-500">Channel</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as Channel)}
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md"
            >
              <option value="all">All channels</option>
              <option value="email">Email only</option>
              <option value="messaging">Messaging only</option>
              <option value="social">Social only</option>
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-zinc-500">Severity</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity)}
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md"
            >
              <option value="block">Block (regenerate draft)</option>
              <option value="warn">Warn (flag for review)</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-zinc-500">Notes (optional)</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why is this banned?"
            className="w-full mt-1 px-3 py-2 text-sm border rounded-md"
          />
        </div>
        {err && <div className="text-sm text-red-700">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Add rule"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
