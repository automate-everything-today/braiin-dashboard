/**
 * Honeypot helper. Routes use this to capture the caller fingerprint
 * + return convincing-but-fake data, while logHoneypotHit fires a HIGH
 * security_event that the 5-min alert cron picks up for Telegram.
 *
 * Returning 200 (not 401/404) is deliberate: a scanner that gets a 401
 * moves on; one that gets 200 with juicy-looking content lingers and
 * triggers more honeypots, giving us a better fingerprint.
 */

import { logHoneypotHit } from "@/lib/security/log";
import { supabase } from "@/services/base";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

export function getClientIp(req: Request): string {
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return "unknown";
}

const HONEYPOT_AUTOBLOCK_HOURS = 24;
const AUTOBLOCK_THRESHOLD = 3; // 3+ honeypot hits in 1h from same IP

/**
 * Auto-block an IP after enough honeypot hits in the rolling window.
 * Best-effort. If the count query fails, we just don't block (we already
 * logged the hit, so the operator still sees it).
 */
async function maybeAutoBlockIp(ip: string): Promise<void> {
  if (!ip || ip === "unknown") return;
  try {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error } = await db
      .schema("feedback")
      .from("security_events")
      .select("*", { count: "exact", head: true })
      .eq("event_type", "honeypot_hit")
      .eq("ip", ip)
      .gte("occurred_at", cutoff);
    if (error || (count ?? 0) < AUTOBLOCK_THRESHOLD) return;

    const expires_at = new Date(Date.now() + HONEYPOT_AUTOBLOCK_HOURS * 60 * 60 * 1000).toISOString();
    await db
      .schema("feedback")
      .from("ip_blocklist")
      .upsert({
        ip,
        reason: `auto-block: ${count} honeypot hits in last hour`,
        source: "auto:honeypot",
        created_by_email: "auto",
        expires_at,
        notes: `Auto-blocked after ${count} hits >= threshold ${AUTOBLOCK_THRESHOLD}`,
      });
  } catch (e) {
    console.warn("[honeypot] auto-block failed:", e instanceof Error ? e.message : e);
  }
}

export async function captureHoneypotHit(
  req: Request,
  routeLabel: string,
  extraDetails?: Record<string, unknown>,
): Promise<void> {
  const ip = getClientIp(req);
  await logHoneypotHit({
    route: routeLabel,
    ip,
    user_agent: req.headers.get("user-agent")?.slice(0, 512) ?? null,
    details: {
      method: req.method,
      url: new URL(req.url).pathname + new URL(req.url).search,
      referrer: req.headers.get("referer") ?? null,
      cookie_present: req.headers.has("cookie"),
      ...extraDetails,
    },
  });
  // Fire-and-forget auto-block check.
  void maybeAutoBlockIp(ip);
}
