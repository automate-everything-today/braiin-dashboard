// Security dashboard backend.
//
// GET returns:
//   - env: presence + sanity of critical env vars (no secret values returned)
//   - routes: per-API-route auth posture detected by static scan
//   - findings: open + recent security findings from feedback.security_findings
//   - events: recent (default 100) entries from feedback.security_events
// PATCH transitions a finding's status with an audit-trailed note.
//
// Super_admin only - this surfaces sensitive posture data and lets the
// operator close findings, so it's gated above the normal manager bar.

import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { supabase } from "@/services/base";
import { requireSuperAdmin } from "@/lib/api-auth";
import { getOrgId } from "@/lib/org";
import { logSuperAdminAction } from "@/lib/security/log";

const ROUTE = "/api/security";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

interface EnvCheck {
  name: string;
  present: boolean;
  ok: boolean;
  note: string;
}

interface RoutePosture {
  route: string;
  verbs: string[];
  // Per-verb gate: "auth" | "manager" | "super_admin" | "none" | "external_secret"
  gates: Record<string, string>;
  // Highest level of concern about this route
  concern: "ok" | "info" | "warn" | "critical";
  notes: string[];
}

function checkEnv(): EnvCheck[] {
  const checks: EnvCheck[] = [];
  const sessionSecret = process.env.SESSION_SECRET;
  checks.push({
    name: "SESSION_SECRET",
    present: !!sessionSecret,
    ok: !!sessionSecret && sessionSecret.length >= 32,
    note: !sessionSecret
      ? "missing - app will refuse to boot"
      : sessionSecret.length < 32
        ? `too short (${sessionSecret.length} chars; need >=32)`
        : "ok",
  });
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  checks.push({
    name: "SUPABASE_SERVICE_KEY",
    present: !!serviceKey,
    ok: !!serviceKey && serviceKey.length > 40,
    note: !serviceKey ? "missing - service-role writes will fail" : "ok",
  });
  const orgId = process.env.DEFAULT_ORG_ID ?? process.env.NEXT_PUBLIC_DEFAULT_ORG_ID;
  checks.push({
    name: "DEFAULT_ORG_ID",
    present: !!orgId,
    ok: !!orgId && /^[0-9a-fA-F-]{36}$/.test(orgId),
    note: !orgId
      ? "missing - getOrgId() will throw on first call"
      : !/^[0-9a-fA-F-]{36}$/.test(orgId)
        ? "not a valid UUID"
        : "ok",
  });
  return checks;
}

// Walk src/app/api recursively, collect every route.ts, statically inspect
// for requireAuth / requireRole / requireSuperAdmin / requireManager calls
// AND for `headers().get("x-cron-secret")` style external-secret patterns
// used by /cron and /inbound. Anything else is reported as `none` so the
// dashboard surfaces the gap.
async function scanApiRoutes(): Promise<RoutePosture[]> {
  const apiDir = path.join(process.cwd(), "src", "app", "api");
  const files: string[] = [];
  async function walk(dir: string) {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile() && e.name === "route.ts") {
        files.push(p);
      }
    }
  }
  await walk(apiDir);

  const out: RoutePosture[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8").catch(() => "");
    const route = "/api" + file.slice(apiDir.length).replace(/\/route\.ts$/, "");

    const verbs: string[] = [];
    for (const v of ["GET", "POST", "PATCH", "PUT", "DELETE"] as const) {
      if (new RegExp(`export async function ${v}\\b`).test(text)) verbs.push(v);
    }
    if (verbs.length === 0) continue;

    const usesSuperAdmin = /requireSuperAdmin\(/.test(text);
    const usesManager = /requireManager\(/.test(text);
    const usesRole = /requireRole\(/.test(text);
    const usesAuth = /requireAuth\(/.test(text);
    const usesCronSecret = /CRON_SECRET|cron-secret/i.test(text);
    const usesInboundSecret = /INBOUND_WEBHOOK_SECRET|x-inbound-secret/i.test(text);

    // For v1 we treat the gate as a per-route property (not per-verb) - true
    // per-verb scanning would need a real AST walk. The notes field captures
    // any caveats.
    let topGate: string;
    if (usesSuperAdmin) topGate = "super_admin";
    else if (usesManager || usesRole) topGate = "manager_or_role";
    else if (usesAuth) topGate = "auth";
    else if (usesCronSecret || usesInboundSecret) topGate = "external_secret";
    else topGate = "none";

    const gates: Record<string, string> = {};
    for (const v of verbs) gates[v] = topGate;

    const notes: string[] = [];
    let concern: RoutePosture["concern"] = "ok";

    const isAuthRoute = route.startsWith("/api/auth/");
    const isCronRoute = route.startsWith("/api/cron/");
    const isInboundRoute = route.startsWith("/api/inbound/");

    if (topGate === "none") {
      // Routes the proxy lets through without a session must use an
      // alternative gate (cron secret, inbound webhook secret). If they
      // don't, that's critical.
      if (isAuthRoute) {
        concern = "info";
        notes.push("auth route - intentionally no session gate (sign-in flow)");
      } else if (isCronRoute) {
        concern = "warn";
        notes.push("cron route without explicit CRON_SECRET check");
      } else if (isInboundRoute) {
        concern = "warn";
        notes.push("inbound route without INBOUND_WEBHOOK_SECRET check");
      } else {
        // Proxy still enforces JWT presence on /api/* (excluding /auth, /cron,
        // /inbound), so the route is at least authenticated. But there's no
        // per-route role check, which means any authenticated staff can hit
        // it. For most routes that's fine; for mutations it's a finding.
        concern = "info";
        notes.push("authenticated by proxy; no per-route role gate");
      }
    }

    out.push({ route, verbs, gates, concern, notes });
  }

  out.sort((a, b) => a.route.localeCompare(b.route));
  return out;
}

const patchSchema = z.object({
  finding_id: z.string().uuid(),
  status: z.enum(["open", "acknowledged", "resolved", "wontfix"]),
  resolved_commit_sha: z.string().max(64).optional(),
  resolved_note: z.string().max(20_000).optional(),
});

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(ROUTE);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const eventLimit = Math.min(
    Math.max(parseInt(url.searchParams.get("event_limit") ?? "100", 10) || 100, 1),
    1000,
  );
  const findingStatus = url.searchParams.get("finding_status") ?? "open_or_ack";

  // Run posture checks + DB reads in parallel.
  const [env, routes, eventsResult, findingsResult] = await Promise.all([
    Promise.resolve(checkEnv()),
    scanApiRoutes(),
    db
      .schema("feedback")
      .from("security_events")
      .select("*")
      .order("occurred_at", { ascending: false })
      .limit(eventLimit),
    (() => {
      let q = db
        .schema("feedback")
        .from("security_findings")
        .select("*")
        .eq("org_id", getOrgId())
        .order("created_at", { ascending: false });
      if (findingStatus === "open_or_ack") {
        q = q.in("status", ["open", "acknowledged"]);
      } else if (findingStatus !== "all") {
        q = q.eq("status", findingStatus);
      }
      return q;
    })(),
  ]);

  return Response.json({
    env,
    routes,
    routes_summary: {
      total: routes.length,
      super_admin_gated: routes.filter((r) => Object.values(r.gates).includes("super_admin")).length,
      manager_gated: routes.filter((r) => Object.values(r.gates).includes("manager_or_role")).length,
      auth_only: routes.filter((r) => Object.values(r.gates).every((g) => g === "auth")).length,
      no_gate: routes.filter((r) => r.concern !== "ok").length,
    },
    events: eventsResult.data ?? [],
    events_error: eventsResult.error?.message ?? null,
    findings: findingsResult.data ?? [],
    findings_error: findingsResult.error?.message ?? null,
    fetched_at: new Date().toISOString(),
  });
}

export async function PATCH(req: Request) {
  const auth = await requireSuperAdmin(ROUTE);
  if (!auth.ok) return auth.response;

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

  void logSuperAdminAction({
    route: ROUTE,
    action: `transition_finding:${body.status}`,
    method: "PATCH",
    user_email: auth.session.email,
    details: { finding_id: body.finding_id, to_status: body.status },
  });

  // Fetch existing for audit trail entry.
  const { data: existing, error: fetchErr } = await db
    .schema("feedback")
    .from("security_findings")
    .select("status, history")
    .eq("finding_id", body.finding_id)
    .eq("org_id", getOrgId())
    .single();
  if (fetchErr) return Response.json({ error: fetchErr.message }, { status: 500 });

  const fromStatus = (existing?.status ?? "open") as string;
  const historyEntry = {
    at: new Date().toISOString(),
    by_email: auth.session.email,
    from_status: fromStatus,
    to_status: body.status,
    note: body.resolved_note ?? null,
  };
  const history = Array.isArray(existing?.history)
    ? [...(existing!.history as unknown[]), historyEntry]
    : [historyEntry];

  const updates: Record<string, unknown> = {
    status: body.status,
    history,
  };
  if (body.status === "resolved" || body.status === "wontfix") {
    updates.resolved_at = new Date().toISOString();
    updates.resolved_by_email = auth.session.email;
    updates.resolved_commit_sha = body.resolved_commit_sha ?? null;
    updates.resolved_note = body.resolved_note ?? null;
  }

  const { data, error } = await db
    .schema("feedback")
    .from("security_findings")
    .update(updates)
    .eq("finding_id", body.finding_id)
    .eq("org_id", getOrgId())
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ finding: data });
}
