// Telegram bot webhook receiver.
//
// Accepts incoming messages from @bobbadobbabot and parses commands sent
// from Rob's authorized chat. Recognised commands:
//
//   /status                       - quick health summary
//   /block <ip> [reason...]       - block an IP for 24h
//   /unblock <ip>                 - remove an IP from the blocklist
//   /lockdown <reason...>         - enable lockdown mode
//   /unlock                       - clear lockdown mode
//   /logout-all <reason...>       - revoke every active session
//
// Auth model: Telegram doesn't sign webhooks. We rely on (a) a secret in
// the webhook URL path that ONLY Telegram + Rob know, and (b) a strict
// chat_id allowlist (TELEGRAM_CHAT_ID env). Any message from a
// non-authorised chat is silently dropped.
//
// This route is allowlisted in proxy.ts via the /api/inbound/* prefix.

import { z } from "zod";
import { sendTelegram } from "@/lib/security/notify";
import { clearEnforcementCaches } from "@/lib/security/enforcement";
import { logBuildEntry } from "@/lib/security/log";
import { supabase } from "@/services/base";

const ROUTE = "/api/inbound/telegram-command";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

const updateSchema = z.object({
  message: z
    .object({
      message_id: z.number(),
      from: z.object({ id: z.number(), username: z.string().optional() }).optional(),
      chat: z.object({ id: z.number() }),
      text: z.string().optional(),
    })
    .optional(),
});

function parseCommand(text: string): { command: string; args: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  // Strip "@botname" suffix if present (Telegram includes it in groups).
  const cleaned = trimmed.replace(/^(\/[a-z_-]+)(@\S+)?/, "$1");
  const parts = cleaned.split(/\s+/);
  return { command: parts[0].toLowerCase(), args: parts.slice(1) };
}

async function logAction(action: string, payload: Record<string, unknown>): Promise<void> {
  await db
    .schema("feedback")
    .from("security_actions_log")
    .insert({ action, actor_email: "telegram:bobbadobbabot", actor_source: "telegram", payload });
}

export async function POST(req: Request) {
  // Path-secret check. The webhook URL contains a secret only we know.
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const url = new URL(req.url);
  const headerSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (expectedSecret && headerSecret !== expectedSecret) {
    return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  // Chat allowlist - only Rob's authorized chat.
  const allowedChat = process.env.TELEGRAM_CHAT_ID;
  if (!allowedChat) {
    return Response.json({ ok: false, error: "TELEGRAM_CHAT_ID not configured" }, { status: 500 });
  }

  let parsed: z.infer<typeof updateSchema>;
  try {
    parsed = updateSchema.parse(await req.json());
  } catch {
    return Response.json({ ok: true });
  }

  const message = parsed.message;
  if (!message?.text) {
    return Response.json({ ok: true });
  }
  if (String(message.chat.id) !== String(allowedChat)) {
    // Drop silently. Do not reply, do not echo - we don't want to leak that
    // the bot is alive to scanners that scrape Telegram.
    return Response.json({ ok: true });
  }

  const cmd = parseCommand(message.text);
  if (!cmd) return Response.json({ ok: true });

  try {
    switch (cmd.command) {
      case "/status": {
        const [{ data: blocked }, { data: flags }, { data: recent }] = await Promise.all([
          db.schema("feedback").from("ip_blocklist").select("ip, expires_at"),
          db.schema("feedback").from("system_flags").select("*"),
          db.schema("feedback").from("security_actions_log").select("action, actor_source, occurred_at").order("occurred_at", { ascending: false }).limit(5),
        ]);
        const flagsMap: Record<string, unknown> = {};
        for (const f of (flags ?? []) as Array<{ flag_key: string; flag_value: unknown }>) {
          flagsMap[f.flag_key] = f.flag_value;
        }
        const lockdown = flagsMap.lockdown_mode_active === true;
        const lines = [
          `🛡️ *Status*`,
          `lockdown: ${lockdown ? "🚧 ACTIVE" : "✅ off"}`,
          `blocked IPs: ${(blocked ?? []).length}`,
          `last actions:`,
          ...((recent ?? []) as Array<{ action: string; actor_source: string; occurred_at: string }>).map(
            (r) => `  ${r.occurred_at.slice(11, 19)} ${r.action} (${r.actor_source})`,
          ),
        ];
        await sendTelegram(lines.join("\n"));
        break;
      }

      case "/block": {
        const ip = cmd.args[0];
        if (!ip) {
          await sendTelegram("usage: `/block <ip> [reason...]`");
          break;
        }
        const reason = cmd.args.slice(1).join(" ") || "manual telegram block";
        const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await db.schema("feedback").from("ip_blocklist").upsert({
          ip, reason, source: "telegram", created_by_email: "telegram", expires_at,
        });
        await logAction("block_ip", { ip, reason, expires_at, via: "telegram" });
        await logBuildEntry({
          title: `🛡️ IP blocked via Telegram: ${ip}`,
          summary: `Reason: ${reason}. Expires ${expires_at}.`,
          area: "security", tags: ["ip-block", "telegram"], author: "telegram",
        });
        clearEnforcementCaches();
        await sendTelegram(`🛡️ blocked \`${ip}\` for 24h\nreason: ${reason}`);
        break;
      }

      case "/unblock": {
        const ip = cmd.args[0];
        if (!ip) {
          await sendTelegram("usage: `/unblock <ip>`");
          break;
        }
        await db.schema("feedback").from("ip_blocklist").delete().eq("ip", ip);
        await logAction("unblock_ip", { ip, via: "telegram" });
        await logBuildEntry({
          title: `IP unblocked via Telegram: ${ip}`,
          area: "security", tags: ["ip-block", "telegram"], author: "telegram",
        });
        clearEnforcementCaches();
        await sendTelegram(`✅ unblocked \`${ip}\``);
        break;
      }

      case "/lockdown": {
        const reason = cmd.args.join(" ") || "manual telegram lockdown";
        await db
          .schema("feedback")
          .from("system_flags")
          .update({ flag_value: true, updated_by_email: "telegram", notes: reason, updated_at: new Date().toISOString() })
          .eq("flag_key", "lockdown_mode_active");
        await logAction("set_lockdown", { reason, via: "telegram" });
        await logBuildEntry({
          title: `🚧 LOCKDOWN ACTIVATED via Telegram`,
          summary: `Reason: ${reason}.`,
          item_type: "fix", area: "security", tags: ["lockdown", "incident", "telegram"], author: "telegram",
        });
        clearEnforcementCaches();
        await sendTelegram(`🚧 *LOCKDOWN ACTIVATED*\nreason: ${reason}\n\nAll writes blocked.`);
        break;
      }

      case "/unlock": {
        await db
          .schema("feedback")
          .from("system_flags")
          .update({ flag_value: false, updated_by_email: "telegram", notes: "cleared via telegram", updated_at: new Date().toISOString() })
          .eq("flag_key", "lockdown_mode_active");
        await logAction("clear_lockdown", { via: "telegram" });
        await logBuildEntry({
          title: `✅ Lockdown cleared via Telegram`,
          area: "security", tags: ["lockdown", "recovery", "telegram"], author: "telegram",
        });
        clearEnforcementCaches();
        await sendTelegram(`✅ lockdown cleared. Writes resumed.`);
        break;
      }

      case "/logout-all": {
        const reason = cmd.args.join(" ") || "manual telegram revocation";
        const nowSeconds = Math.floor(Date.now() / 1000);
        await db
          .schema("feedback")
          .from("system_flags")
          .update({ flag_value: nowSeconds, updated_by_email: "telegram", notes: reason, updated_at: new Date().toISOString() })
          .eq("flag_key", "session_min_iat");
        await logAction("revoke_all_sessions", { iat_floor: nowSeconds, reason, via: "telegram" });
        await logBuildEntry({
          title: `🔐 ALL SESSIONS REVOKED via Telegram`,
          summary: `iat floor set to ${nowSeconds}. Reason: ${reason}.`,
          item_type: "fix", area: "security", tags: ["session-revoke", "incident", "telegram"], author: "telegram",
        });
        clearEnforcementCaches();
        await sendTelegram(`🔐 all sessions revoked.\nreason: ${reason}\n\nEveryone (including you) must log in again.`);
        break;
      }

      case "/help": {
        await sendTelegram([
          "*Available commands:*",
          "`/status` - quick health",
          "`/block <ip> [reason]` - 24h block",
          "`/unblock <ip>` - remove block",
          "`/lockdown <reason>` - block all writes",
          "`/unlock` - clear lockdown",
          "`/logout-all <reason>` - kill every session",
        ].join("\n"));
        break;
      }

      default:
        await sendTelegram(`unknown command: \`${cmd.command}\` - try /help`);
    }
  } catch (e) {
    console.error(`[${ROUTE}] command failed:`, e);
    await sendTelegram(`❌ command failed: ${e instanceof Error ? e.message : "unknown"}`);
  }

  return Response.json({ ok: true });
}
