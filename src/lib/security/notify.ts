/**
 * Telegram notification helper for security alerts.
 *
 * Sends Markdown-formatted messages to the bot configured by
 * TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env vars. Best-effort - never
 * throws, since alerting failures shouldn't cascade into the call site.
 *
 * The dashboard uses the same bot Rob already has wired locally
 * (@bobbadobbabot). The chat_id targets Rob's authorized chat directly.
 */

export interface TelegramSendResult {
  ok: boolean;
  error?: string;
  message_id?: number;
}

export async function sendTelegram(
  text: string,
  opts: { silent?: boolean; parseMode?: "Markdown" | "HTML" } = {},
): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[notify/telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set; alert dropped");
    return { ok: false, error: "telegram_not_configured" };
  }

  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: opts.parseMode ?? "Markdown",
        disable_notification: opts.silent ?? false,
        disable_web_page_preview: true,
      }),
    });
    const data = (await resp.json()) as { ok?: boolean; description?: string; result?: { message_id?: number } };
    if (!resp.ok || !data.ok) {
      console.warn("[notify/telegram] send failed:", data.description ?? resp.status);
      return { ok: false, error: data.description ?? `HTTP ${resp.status}` };
    }
    return { ok: true, message_id: data.result?.message_id };
  } catch (e) {
    console.warn("[notify/telegram] threw:", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/**
 * Format a security event into a Telegram-friendly Markdown message.
 */
export function formatSecurityAlert(event: {
  event_type: string;
  severity: string;
  route?: string | null;
  user_email?: string | null;
  user_role?: string | null;
  ip?: string | null;
  details?: Record<string, unknown> | null;
  occurred_at?: string;
}): string {
  const sevEmoji =
    event.severity === "critical" ? "🚨" :
    event.severity === "high" ? "⚠️" :
    event.severity === "medium" ? "🔔" : "ℹ️";

  const lines = [
    `${sevEmoji} *${event.severity.toUpperCase()}* \`${event.event_type}\``,
  ];
  if (event.route) lines.push(`route: \`${event.route}\``);
  if (event.user_email) lines.push(`user: \`${event.user_email}\``);
  if (event.user_role) lines.push(`role: \`${event.user_role}\``);
  if (event.ip) lines.push(`ip: \`${event.ip}\``);
  if (event.occurred_at) {
    const t = new Date(event.occurred_at).toLocaleString("en-GB", { timeZone: "Europe/London" });
    lines.push(`time: ${t}`);
  }
  if (event.details && Object.keys(event.details).length > 0) {
    const json = JSON.stringify(event.details);
    lines.push(`details: \`${json.slice(0, 200)}${json.length > 200 ? "..." : ""}\``);
  }
  lines.push("");
  lines.push("View: https://braiin.app/dev/security");
  return lines.join("\n");
}

/**
 * HMAC helper for the proxy -> /api/security/proxy-event channel.
 * Uses Web Crypto so it works in both edge (proxy) and node (route handler).
 */
export async function hmacSign(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmacVerify(secret: string, payload: string, expected: string): Promise<boolean> {
  const sig = await hmacSign(secret, payload);
  if (sig.length !== expected.length) return false;
  // Constant-time compare to avoid timing leaks
  let diff = 0;
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
