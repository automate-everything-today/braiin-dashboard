// Security response actions: block_ip / unblock_ip / set_lockdown /
// clear_lockdown / revoke_all_sessions. Super_admin only. Each action
// writes to feedback.security_actions_log AND to feedback.build_log
// (audit trail) and clears in-process enforcement caches so the actor's
// own next request reflects the change instantly.

import { z } from "zod";
import { supabase } from "@/services/base";
import { requireSuperAdmin } from "@/lib/api-auth";
import { logBuildEntry, logSuperAdminAction } from "@/lib/security/log";
import { clearEnforcementCaches } from "@/lib/security/enforcement";
import { sendTelegram } from "@/lib/security/notify";

const ROUTE = "/api/security/actions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("block_ip"),
    ip: z.string().min(1).max(64),
    reason: z.string().max(500).default("manual block from dashboard"),
    expires_at: z.string().datetime().nullable().optional(),
  }),
  z.object({
    action: z.literal("unblock_ip"),
    ip: z.string().min(1).max(64),
  }),
  z.object({
    action: z.literal("set_lockdown"),
    active: z.boolean(),
    reason: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("revoke_all_sessions"),
    reason: z.string().max(500).default("manual session revocation"),
  }),
]);

async function logAction(
  actor_email: string | null,
  actor_source: "dashboard" | "telegram" | "auto-cron",
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db
    .schema("feedback")
    .from("security_actions_log")
    .insert({ action, actor_email, actor_source, payload });
}

export async function POST(req: Request) {
  const auth = await requireSuperAdmin(ROUTE, req);
  if (!auth.ok) return auth.response;

  const parsed = actionSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;
  const actor = auth.session.email;

  try {
    if (body.action === "block_ip") {
      const { error } = await db
        .schema("feedback")
        .from("ip_blocklist")
        .upsert({
          ip: body.ip,
          reason: body.reason,
          source: "manual",
          created_by_email: actor,
          expires_at: body.expires_at ?? null,
        });
      if (error) return Response.json({ error: error.message }, { status: 500 });
      await logAction(actor, "dashboard", "block_ip", { ip: body.ip, expires_at: body.expires_at, reason: body.reason });
      void logSuperAdminAction({ route: ROUTE, action: "block_ip", method: "POST", user_email: actor, details: { ip: body.ip } });
      void logBuildEntry({
        title: `🛡️ IP blocked: ${body.ip}`,
        summary: `Manual block by ${actor}. Reason: ${body.reason}.${body.expires_at ? ` Expires ${body.expires_at}.` : " Permanent."}`,
        item_type: "chore", area: "security", tags: ["ip-block", "manual"], author: actor,
      });
      void sendTelegram(`🛡️ *IP blocked* \`${body.ip}\`\nby ${actor}\nreason: ${body.reason}`);
    } else if (body.action === "unblock_ip") {
      const { error } = await db
        .schema("feedback")
        .from("ip_blocklist")
        .delete()
        .eq("ip", body.ip);
      if (error) return Response.json({ error: error.message }, { status: 500 });
      await logAction(actor, "dashboard", "unblock_ip", { ip: body.ip });
      void logSuperAdminAction({ route: ROUTE, action: "unblock_ip", method: "POST", user_email: actor, details: { ip: body.ip } });
      void logBuildEntry({
        title: `IP unblocked: ${body.ip}`,
        summary: `Unblocked by ${actor}.`,
        item_type: "chore", area: "security", tags: ["ip-block", "manual"], author: actor,
      });
      void sendTelegram(`✅ *IP unblocked* \`${body.ip}\` by ${actor}`);
    } else if (body.action === "set_lockdown") {
      const { error } = await db
        .schema("feedback")
        .from("system_flags")
        .update({ flag_value: body.active, updated_by_email: actor, notes: body.reason ?? null, updated_at: new Date().toISOString() })
        .eq("flag_key", "lockdown_mode_active");
      if (error) return Response.json({ error: error.message }, { status: 500 });
      await logAction(actor, "dashboard", body.active ? "set_lockdown" : "clear_lockdown", { reason: body.reason });
      void logSuperAdminAction({ route: ROUTE, action: body.active ? "set_lockdown" : "clear_lockdown", method: "POST", user_email: actor, details: { reason: body.reason } });
      void logBuildEntry({
        title: body.active ? `🚧 LOCKDOWN MODE ACTIVATED` : `✅ Lockdown cleared`,
        summary: body.active
          ? `${actor} enabled lockdown. Every non-GET /api/* now returns 503. Reason: ${body.reason ?? "(unspecified)"}.`
          : `${actor} cleared lockdown. Writes resumed.`,
        item_type: body.active ? "fix" : "chore",
        area: "security",
        tags: body.active ? ["lockdown", "incident"] : ["lockdown", "recovery"],
        author: actor,
      });
      void sendTelegram(
        body.active
          ? `🚧 *LOCKDOWN ACTIVATED* by ${actor}\nreason: ${body.reason ?? "(unspecified)"}\n\nAll writes blocked until cleared.`
          : `✅ *Lockdown cleared* by ${actor}\nWrites resumed.`,
      );
    } else if (body.action === "revoke_all_sessions") {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const { error } = await db
        .schema("feedback")
        .from("system_flags")
        .update({ flag_value: nowSeconds, updated_by_email: actor, notes: body.reason, updated_at: new Date().toISOString() })
        .eq("flag_key", "session_min_iat");
      if (error) return Response.json({ error: error.message }, { status: 500 });
      await logAction(actor, "dashboard", "revoke_all_sessions", { iat_floor: nowSeconds, reason: body.reason });
      void logSuperAdminAction({ route: ROUTE, action: "revoke_all_sessions", method: "POST", user_email: actor, details: { iat_floor: nowSeconds, reason: body.reason } });
      void logBuildEntry({
        title: `🔐 ALL SESSIONS REVOKED`,
        summary: `${actor} revoked all sessions. JWTs issued before ${new Date(nowSeconds * 1000).toISOString()} now invalid. Reason: ${body.reason}.`,
        item_type: "fix", area: "security", tags: ["session-revoke", "incident"], author: actor,
      });
      void sendTelegram(
        `🔐 *ALL SESSIONS REVOKED* by ${actor}\nreason: ${body.reason}\n\nEveryone (including you) needs to log in again.`,
      );
    }
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "action failed" }, { status: 500 });
  }

  // Clear caches so the actor's own next request sees the change instantly.
  clearEnforcementCaches();

  return Response.json({ ok: true, action: body.action });
}

export async function GET() {
  const auth = await requireSuperAdmin(ROUTE);
  if (!auth.ok) return auth.response;

  const [blocklistRes, flagsRes, recentRes] = await Promise.all([
    db.schema("feedback").from("ip_blocklist").select("*").order("created_at", { ascending: false }),
    db.schema("feedback").from("system_flags").select("*"),
    db.schema("feedback").from("security_actions_log").select("*").order("occurred_at", { ascending: false }).limit(50),
  ]);

  return Response.json({
    blocklist: blocklistRes.data ?? [],
    flags: flagsRes.data ?? [],
    recent_actions: recentRes.data ?? [],
  });
}
