"use client";

/**
 * Security dashboard - the live posture surface.
 *
 * Sections:
 *   1. Posture cards: env health, auth gate counts, RLS hint
 *   2. Open findings: security audit punch list, click to transition
 *   3. Recent events: live stream from feedback.security_events
 *   4. Route inventory: every API route + its detected gate
 *
 * Super_admin only - the API enforces this server-side; PageGuard is the
 * UX shortcut.
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PageGuard } from "@/components/page-guard";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Lock,
  LogOut,
  ShieldCheck,
  ShieldAlert,
  Shield,
  Unlock,
  XCircle,
} from "lucide-react";
import { PILL_SM } from "@/lib/ui-constants";
import { BraiinLoader } from "@/components/braiin-loader";
import { PushToBuildQueueButton, buildPromptForFinding } from "@/components/push-to-build-queue";

type Severity = "critical" | "high" | "medium" | "low";
type FindingStatus = "open" | "acknowledged" | "resolved" | "wontfix";

interface Finding {
  finding_id: string;
  source_audit: string;
  source_reviewer: string | null;
  severity: Severity;
  status: FindingStatus;
  title: string;
  description: string;
  recommendation: string | null;
  file_path: string | null;
  line_number: number | null;
  tags: string[];
  history: Array<{ at: string; by_email: string; from_status: string; to_status: string; note?: string | null }>;
  resolved_at: string | null;
  resolved_commit_sha: string | null;
  created_at: string;
}

interface SecurityEvent {
  event_id: number;
  event_type: string;
  severity: Severity;
  route: string | null;
  user_email: string | null;
  user_role: string | null;
  ip: string | null;
  details: Record<string, unknown>;
  occurred_at: string;
}

interface EnvCheck {
  name: string;
  present: boolean;
  ok: boolean;
  note: string;
}

interface RoutePosture {
  route: string;
  verbs: string[];
  gates: Record<string, string>;
  concern: "ok" | "info" | "warn" | "critical";
  notes: string[];
}

interface SecurityResponse {
  env: EnvCheck[];
  routes: RoutePosture[];
  routes_summary: {
    total: number;
    super_admin_gated: number;
    manager_gated: number;
    auth_only: number;
    no_gate: number;
  };
  events: SecurityEvent[];
  events_error: string | null;
  findings: Finding[];
  findings_error: string | null;
  fetched_at: string;
}

const SEVERITY_TONE: Record<Severity, string> = {
  critical: "bg-rose-100 text-rose-800 border-rose-300",
  high: "bg-amber-100 text-amber-800 border-amber-300",
  medium: "bg-sky-100 text-sky-800 border-sky-300",
  low: "bg-zinc-100 text-zinc-700 border-zinc-300",
};
const SEVERITY_BORDER: Record<Severity, string> = {
  critical: "border-l-rose-500",
  high: "border-l-amber-500",
  medium: "border-l-sky-500",
  low: "border-l-zinc-300",
};
const STATUS_TONE: Record<FindingStatus, string> = {
  open: "bg-rose-100 text-rose-800",
  acknowledged: "bg-amber-100 text-amber-800",
  resolved: "bg-emerald-100 text-emerald-800",
  wontfix: "bg-zinc-200 text-zinc-600",
};
const EVENT_TONE: Record<string, string> = {
  auth_failure: "bg-amber-100 text-amber-800",
  session_expired: "bg-zinc-100 text-zinc-700",
  role_denied: "bg-rose-100 text-rose-800",
  upload_rejected: "bg-rose-100 text-rose-800",
  rate_limit_hit: "bg-amber-100 text-amber-800",
  csrf_failure: "bg-rose-100 text-rose-800",
  input_validation_failed: "bg-amber-100 text-amber-800",
  service_key_missing: "bg-rose-100 text-rose-800",
  unusual_activity: "bg-violet-100 text-violet-800",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function severityRank(s: Severity): number {
  return s === "critical" ? 4 : s === "high" ? 3 : s === "medium" ? 2 : 1;
}

export default function SecurityDashboardPage() {
  const [data, setData] = useState<SecurityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);
  const [routesExpanded, setRoutesExpanded] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/security?finding_status=${showResolved ? "all" : "open_or_ack"}&event_limit=200`,
      );
      const json = (await r.json()) as SecurityResponse & { error?: string };
      if (!r.ok) throw new Error(json.error ?? `Load failed (${r.status})`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResolved]);

  async function transitionFinding(
    finding: Finding,
    nextStatus: FindingStatus,
    note?: string,
  ) {
    try {
      const r = await fetch("/api/security", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          finding_id: finding.finding_id,
          status: nextStatus,
          resolved_note: note,
        }),
      });
      const json = (await r.json()) as { finding?: Finding; error?: string };
      if (!r.ok) throw new Error(json.error ?? `Update failed (${r.status})`);
      // Re-fetch so counts and ordering update.
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? `Update failed: ${e.message}` : "Update failed");
    }
  }

  const findings = data?.findings ?? [];
  const events = data?.events ?? [];
  const env = data?.env ?? [];
  const routes = data?.routes ?? [];
  const summary = data?.routes_summary;

  const findingsBySeverity = useMemo(() => {
    const groups: Record<Severity, Finding[]> = { critical: [], high: [], medium: [], low: [] };
    for (const f of findings) groups[f.severity].push(f);
    return groups;
  }, [findings]);

  const envOk = env.every((e) => e.ok);

  return (
    <PageGuard pageId="dev_security">
      <div className="min-h-screen bg-zinc-50">
        <div className="border-b bg-white">
          <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-5 text-emerald-600" />
              <h1 className="text-lg font-medium">Security dashboard</h1>
              <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono`}>
                /security
              </Badge>
              <Badge className={`${PILL_SM} bg-rose-100 text-rose-800 uppercase`}>
                super_admin
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {data && (
                <span className="text-[11px] text-zinc-500 inline-flex items-center gap-1">
                  <Clock className="size-3" />
                  fetched {fmtTime(data.fetched_at)}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={refresh}>
                Refresh
              </Button>
            </div>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
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

          {loading && !data && <BraiinLoader label="Loading security posture..." />}

          {/* Posture cards */}
          {data && (
            <div className="grid grid-cols-4 gap-3">
              <Card className={envOk ? "border-emerald-200" : "border-rose-300"}>
                <CardContent className="py-3 px-4">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                    Environment
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {envOk ? (
                      <CheckCircle2 className="size-4 text-emerald-600" />
                    ) : (
                      <ShieldAlert className="size-4 text-rose-600" />
                    )}
                    <span className="text-lg font-medium">{envOk ? "Healthy" : "Issues"}</span>
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-1">
                    {env.filter((e) => e.ok).length}/{env.length} checks pass
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="py-3 px-4">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                    Open findings
                  </div>
                  <div className="text-lg font-medium mt-1">
                    {findings.filter((f) => f.status === "open" || f.status === "acknowledged").length}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 text-[11px]">
                    {(["critical", "high", "medium", "low"] as Severity[]).map((s) => (
                      <Badge key={s} className={`${PILL_SM} ${SEVERITY_TONE[s]}`}>
                        {findingsBySeverity[s].length} {s}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="py-3 px-4">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                    Recent events (24h)
                  </div>
                  <div className="text-lg font-medium mt-1">
                    {events.filter((e) => Date.now() - new Date(e.occurred_at).getTime() < 86400_000).length}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-1">
                    {events.filter((e) => e.severity === "critical" || e.severity === "high").length}{" "}
                    elevated · {events.length} total in feed
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="py-3 px-4">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                    Auth gates
                  </div>
                  <div className="text-lg font-medium mt-1">
                    {summary ? `${summary.total - summary.no_gate}/${summary.total}` : "..."}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-1">
                    {summary?.super_admin_gated ?? 0} super_admin · {summary?.manager_gated ?? 0} manager · {summary?.auth_only ?? 0} auth
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Incident response panel */}
          <IncidentResponsePanel />

          {/* Env detail */}
          {data && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium inline-flex items-center gap-2">
                  <Shield className="size-4" /> Environment checks
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-2">
                {env.map((e) => (
                  <div
                    key={e.name}
                    className={`border rounded px-3 py-2 ${e.ok ? "border-emerald-200 bg-emerald-50/30" : "border-rose-300 bg-rose-50"}`}
                  >
                    <div className="flex items-center gap-1.5">
                      {e.ok ? (
                        <CheckCircle2 className="size-3.5 text-emerald-600" />
                      ) : (
                        <XCircle className="size-3.5 text-rose-600" />
                      )}
                      <span className="font-mono text-[11px]">{e.name}</span>
                    </div>
                    <div className="text-[10px] text-zinc-600 mt-0.5">{e.note}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Findings */}
          {data && (
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium inline-flex items-center gap-2">
                  <ShieldAlert className="size-4 text-rose-600" /> Findings
                </CardTitle>
                <label className="text-[11px] text-zinc-500 inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={showResolved}
                    onChange={(e) => setShowResolved(e.target.checked)}
                  />
                  Show resolved + wontfix
                </label>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.findings_error && (
                  <div className="text-xs text-rose-700">
                    Findings query failed: {data.findings_error}
                  </div>
                )}
                {findings.length === 0 && !data.findings_error && (
                  <div className="text-xs text-zinc-500 italic py-2">
                    No findings - either nothing has been audited yet or the table is clean.
                  </div>
                )}
                {(["critical", "high", "medium", "low"] as Severity[])
                  .filter((s) => findingsBySeverity[s].length > 0)
                  .map((s) => (
                    <div key={s} className="space-y-1.5">
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                        {s} ({findingsBySeverity[s].length})
                      </div>
                      {findingsBySeverity[s].map((f) => (
                        <FindingRow
                          key={f.finding_id}
                          finding={f}
                          expanded={expandedFinding === f.finding_id}
                          onToggle={() =>
                            setExpandedFinding((id) => (id === f.finding_id ? null : f.finding_id))
                          }
                          onTransition={(next, note) => transitionFinding(f, next, note)}
                        />
                      ))}
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}

          {/* Events */}
          {data && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium inline-flex items-center gap-2">
                  <Clock className="size-4" /> Recent security events
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {data.events_error && (
                  <div className="text-xs text-rose-700">
                    Events query failed: {data.events_error}
                  </div>
                )}
                {events.length === 0 && !data.events_error && (
                  <div className="text-xs text-zinc-500 italic py-2">
                    No events logged yet. Trigger a role-denied or upload-rejected action to see this stream populate.
                  </div>
                )}
                {events.map((e) => (
                  <div
                    key={e.event_id}
                    className={`border-l-4 ${SEVERITY_BORDER[e.severity]} bg-white border border-zinc-200 rounded-r px-3 py-2`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        className={`${PILL_SM} ${EVENT_TONE[e.event_type] ?? "bg-zinc-100"} font-mono`}
                      >
                        {e.event_type}
                      </Badge>
                      <Badge className={`${PILL_SM} ${SEVERITY_TONE[e.severity]}`}>
                        {e.severity}
                      </Badge>
                      {e.route && (
                        <span className="text-[11px] font-mono text-zinc-700">{e.route}</span>
                      )}
                      {e.user_email && (
                        <span className="text-[11px] text-zinc-500">· {e.user_email}</span>
                      )}
                      {e.user_role && (
                        <span className="text-[10px] text-zinc-400">({e.user_role})</span>
                      )}
                      <span className="text-[10px] text-zinc-400 ml-auto font-mono">
                        {fmtTime(e.occurred_at)}
                      </span>
                    </div>
                    {Object.keys(e.details ?? {}).length > 0 && (
                      <div className="text-[10px] text-zinc-500 mt-1 font-mono break-all">
                        {JSON.stringify(e.details)}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Route inventory */}
          {data && (
            <Card>
              <CardHeader
                className="pb-2 cursor-pointer"
                onClick={() => setRoutesExpanded((v) => !v)}
              >
                <CardTitle className="text-sm font-medium inline-flex items-center gap-2">
                  {routesExpanded ? (
                    <ChevronDown className="size-4" />
                  ) : (
                    <ChevronRight className="size-4" />
                  )}
                  Route inventory ({routes.length})
                </CardTitle>
              </CardHeader>
              {routesExpanded && (
                <CardContent className="space-y-1">
                  {routes
                    .slice()
                    .sort((a, b) => {
                      const concernOrder = { critical: 0, warn: 1, info: 2, ok: 3 };
                      const ca = concernOrder[a.concern];
                      const cb = concernOrder[b.concern];
                      if (ca !== cb) return ca - cb;
                      return a.route.localeCompare(b.route);
                    })
                    .map((r) => (
                      <div
                        key={r.route}
                        className="flex items-center gap-2 py-1 border-b border-zinc-100 text-[11px]"
                      >
                        <span
                          className={`size-2 rounded-full shrink-0 ${
                            r.concern === "critical"
                              ? "bg-rose-500"
                              : r.concern === "warn"
                                ? "bg-amber-500"
                                : r.concern === "info"
                                  ? "bg-sky-400"
                                  : "bg-emerald-500"
                          }`}
                        />
                        <span className="font-mono text-zinc-700 flex-1 truncate">{r.route}</span>
                        <div className="flex items-center gap-1">
                          {r.verbs.map((v) => (
                            <Badge
                              key={v}
                              className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono`}
                            >
                              {v}
                            </Badge>
                          ))}
                        </div>
                        <Badge
                          className={`${PILL_SM} ${
                            Object.values(r.gates)[0] === "super_admin"
                              ? "bg-rose-100 text-rose-800"
                              : Object.values(r.gates)[0] === "manager_or_role"
                                ? "bg-amber-100 text-amber-800"
                                : Object.values(r.gates)[0] === "auth"
                                  ? "bg-sky-100 text-sky-800"
                                  : Object.values(r.gates)[0] === "external_secret"
                                    ? "bg-violet-100 text-violet-800"
                                    : "bg-zinc-200 text-zinc-700"
                          }`}
                        >
                          {Object.values(r.gates)[0]}
                        </Badge>
                        {r.notes.length > 0 && (
                          <span className="text-[10px] text-zinc-500 italic max-w-md truncate">
                            {r.notes[0]}
                          </span>
                        )}
                      </div>
                    ))}
                </CardContent>
              )}
            </Card>
          )}
        </div>
      </div>
    </PageGuard>
  );
}

interface IncidentBlocklistRow { ip: string; reason: string; source: string; expires_at: string | null; created_at: string; }
interface IncidentFlag { flag_key: string; flag_value: unknown; updated_at: string; updated_by_email: string | null; }
interface IncidentActionLog { action_id: number; action: string; actor_email: string | null; actor_source: string; payload: Record<string, unknown>; occurred_at: string; }

function IncidentResponsePanel() {
  const [data, setData] = useState<{ blocklist: IncidentBlocklistRow[]; flags: IncidentFlag[]; recent_actions: IncidentActionLog[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [blockIp, setBlockIp] = useState("");
  const [blockReason, setBlockReason] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch("/api/security/actions");
      const json = (await r.json()) as typeof data & { error?: string };
      if (!r.ok) throw new Error(json?.error ?? "load failed");
      setData(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  async function call(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/security/actions", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const json = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(json.error ?? "action failed");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "action failed");
    } finally {
      setBusy(false);
    }
  }

  const lockdown = data?.flags.find((f) => f.flag_key === "lockdown_mode_active")?.flag_value === true;
  const minIat = Number(data?.flags.find((f) => f.flag_key === "session_min_iat")?.flag_value ?? 0);
  const blocked = data?.blocklist ?? [];
  const recent = data?.recent_actions ?? [];

  return (
    <Card className={lockdown ? "border-rose-500 border-2" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium inline-flex items-center gap-2">
          <ShieldAlert className="size-4 text-rose-600" /> Incident response
          {lockdown && <Badge className={`${PILL_SM} bg-rose-600 text-white`}>LOCKDOWN ACTIVE</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        {err && (
          <div className="border border-rose-300 bg-rose-50 text-rose-800 px-3 py-2 rounded inline-flex items-start gap-2 w-full">
            <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
            <div className="flex-1">{err}</div>
            <button onClick={() => setErr(null)} className="text-rose-700 hover:text-rose-900 text-[11px] underline">dismiss</button>
          </div>
        )}
        {loading && !data && <BraiinLoader label="Loading..." size="sm" variant="inline" />}

        {/* Action buttons */}
        <div className="grid grid-cols-3 gap-2">
          <Button size="sm" variant={lockdown ? "default" : "outline"}
            className={lockdown ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "border-rose-300 text-rose-700 hover:bg-rose-50"}
            disabled={busy}
            onClick={() => call({ action: "set_lockdown", active: !lockdown, reason: lockdown ? "manual clear" : prompt("Lockdown reason?") ?? "manual lockdown" }, lockdown ? "Clear lockdown? Writes will resume." : "ENABLE LOCKDOWN? All writes will be blocked until cleared.")}>
            {lockdown ? <><Unlock className="size-3 mr-1" />Clear lockdown</> : <><Lock className="size-3 mr-1" />Activate lockdown</>}
          </Button>
          <Button size="sm" variant="outline" className="text-rose-700 border-rose-300 hover:bg-rose-50" disabled={busy}
            onClick={() => call({ action: "revoke_all_sessions", reason: prompt("Revoke reason?") ?? "manual revoke" }, "REVOKE ALL SESSIONS? You will need to log back in. So will every other user.")}>
            <LogOut className="size-3 mr-1" />Revoke all sessions
          </Button>
          <div className="text-[10px] text-zinc-500 inline-flex items-center justify-end pr-1">
            min iat: <span className="font-mono ml-1">{minIat}</span>
          </div>
        </div>

        {/* Block IP form */}
        <div className="border-t pt-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Block IP (24h)</div>
          <div className="flex items-center gap-2">
            <input type="text" value={blockIp} onChange={(e) => setBlockIp(e.target.value)} placeholder="ip address"
              className="flex-1 h-7 px-2 rounded border border-zinc-300 text-xs bg-white font-mono" />
            <input type="text" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder="reason (optional)"
              className="flex-1 h-7 px-2 rounded border border-zinc-300 text-xs bg-white" />
            <Button size="sm" disabled={busy || !blockIp.trim()} className="h-7 text-[11px]"
              onClick={async () => { await call({ action: "block_ip", ip: blockIp.trim(), reason: blockReason.trim() || "manual block from dashboard", expires_at: new Date(Date.now() + 86400000).toISOString() }); setBlockIp(""); setBlockReason(""); }}>
              <Ban className="size-3 mr-1" />Block
            </Button>
          </div>
        </div>

        {/* Active blocks */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Active blocks ({blocked.length})</div>
          {blocked.length === 0 && <div className="text-zinc-500 italic">None</div>}
          {blocked.map((b) => (
            <div key={b.ip} className="flex items-center gap-2 py-1 border-b border-zinc-100 last:border-0">
              <span className="font-mono text-zinc-700 flex-1 truncate">{b.ip}</span>
              <Badge className={`${PILL_SM} ${b.source.startsWith("auto") ? "bg-violet-100 text-violet-800" : "bg-zinc-100 text-zinc-700"}`}>{b.source}</Badge>
              <span className="text-zinc-500 truncate max-w-xs">{b.reason}</span>
              <span className="text-[10px] text-zinc-400 font-mono">{b.expires_at ? `→${b.expires_at.slice(0, 16).replace("T", " ")}` : "permanent"}</span>
              <button disabled={busy} onClick={() => call({ action: "unblock_ip", ip: b.ip })} className="text-emerald-700 hover:text-emerald-900 text-[11px] underline">unblock</button>
            </div>
          ))}
        </div>

        {/* Recent actions */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Recent actions ({recent.length})</div>
          {recent.length === 0 && <div className="text-zinc-500 italic">None</div>}
          {recent.slice(0, 8).map((a) => (
            <div key={a.action_id} className="flex items-center gap-2 py-0.5 text-[11px]">
              <span className="font-mono text-zinc-400">{a.occurred_at.slice(11, 19)}</span>
              <span className="font-medium">{a.action}</span>
              <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600`}>{a.actor_source}</Badge>
              <span className="text-zinc-500 truncate flex-1">{a.actor_email ?? ""}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function FindingRow({
  finding,
  expanded,
  onToggle,
  onTransition,
}: {
  finding: Finding;
  expanded: boolean;
  onToggle: () => void;
  onTransition: (status: FindingStatus, note?: string) => void;
}) {
  const [note, setNote] = useState("");

  return (
    <Card className={`border-l-4 ${SEVERITY_BORDER[finding.severity]}`}>
      <CardHeader className="pb-2 cursor-pointer" onClick={onToggle}>
        <div className="flex items-start gap-2">
          {expanded ? (
            <ChevronDown className="size-4 mt-0.5 text-zinc-400" />
          ) : (
            <ChevronRight className="size-4 mt-0.5 text-zinc-400" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{finding.title}</span>
              <Badge className={`${PILL_SM} ${SEVERITY_TONE[finding.severity]}`}>
                {finding.severity}
              </Badge>
              <Badge className={`${PILL_SM} ${STATUS_TONE[finding.status]}`}>
                {finding.status}
              </Badge>
              {finding.tags.map((t) => (
                <Badge key={t} className={`${PILL_SM} bg-zinc-100 text-zinc-600`}>
                  {t}
                </Badge>
              ))}
              <span className="text-[10px] text-zinc-400 ml-auto font-mono">
                {finding.source_audit}
              </span>
            </div>
            {finding.file_path && (
              <div className="text-[11px] text-zinc-500 mt-0.5 font-mono">
                {finding.file_path}
                {finding.line_number ? `:${finding.line_number}` : ""}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-3 pt-0 text-xs">
          <div className="text-zinc-700 whitespace-pre-wrap leading-relaxed">
            {finding.description}
          </div>
          {finding.recommendation && (
            <div className="border-l-2 border-l-violet-300 bg-violet-50/40 pl-3 py-1.5 rounded-r">
              <div className="text-[10px] uppercase tracking-wide text-violet-700 mb-0.5">
                Recommendation
              </div>
              <div className="text-zinc-700 whitespace-pre-wrap">{finding.recommendation}</div>
            </div>
          )}
          {finding.history.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">
                History
              </div>
              <div className="space-y-1">
                {finding.history.map((h, i) => (
                  <div key={i} className="text-[11px] text-zinc-600">
                    <span className="font-mono">{fmtTime(h.at)}</span> · {h.by_email} ·{" "}
                    {h.from_status} → {h.to_status}
                    {h.note ? ` · "${h.note}"` : ""}
                  </div>
                ))}
              </div>
            </div>
          )}
          <Separator />
          <div className="space-y-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Optional note (commit SHA, rationale)..."
              className="w-full px-2 py-1.5 rounded border border-zinc-300 text-[11px] bg-white resize-none focus:outline-none focus:ring-1 focus:ring-violet-200"
            />
            <div className="flex items-center gap-1.5 flex-wrap">
              {finding.status !== "acknowledged" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => {
                    onTransition("acknowledged", note || undefined);
                    setNote("");
                  }}
                >
                  Acknowledge
                </Button>
              )}
              {finding.status !== "resolved" && (
                <Button
                  size="sm"
                  className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => {
                    onTransition("resolved", note || undefined);
                    setNote("");
                  }}
                >
                  <CheckCircle2 className="size-3 mr-1" />
                  Resolve
                </Button>
              )}
              {finding.status !== "wontfix" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-zinc-600"
                  onClick={() => {
                    onTransition("wontfix", note || undefined);
                    setNote("");
                  }}
                >
                  Won't fix
                </Button>
              )}
              {finding.status !== "open" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-rose-600"
                  onClick={() => {
                    onTransition("open", note || undefined);
                    setNote("");
                  }}
                >
                  Reopen
                </Button>
              )}
              <div className="ml-auto">
                <PushToBuildQueueButton
                  source_type="finding"
                  source_id={finding.finding_id}
                  title={`Fix: ${finding.title}`}
                  context={buildPromptForFinding(finding)}
                />
              </div>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
