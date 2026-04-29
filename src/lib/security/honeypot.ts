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

export async function captureHoneypotHit(
  req: Request,
  routeLabel: string,
  extraDetails?: Record<string, unknown>,
): Promise<void> {
  await logHoneypotHit({
    route: routeLabel,
    ip: getClientIp(req),
    user_agent: req.headers.get("user-agent")?.slice(0, 512) ?? null,
    details: {
      method: req.method,
      url: new URL(req.url).pathname + new URL(req.url).search,
      referrer: req.headers.get("referer") ?? null,
      cookie_present: req.headers.has("cookie"),
      ...extraDetails,
    },
  });
}
