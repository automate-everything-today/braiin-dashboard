import { supabase } from "@/services/base";
import { logSecurityEvent } from "@/lib/security/log";

const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MAX_REQUESTS = 30;

/**
 * Check whether the bucket (typically an IP or user email) is under the rate
 * limit. Backed by the Postgres `check_rate_limit` RPC so all Vercel workers
 * share a single counter instead of each having its own in-memory map.
 *
 * Fails open on DB error: we would rather serve a request than lock out every
 * user because of a transient Supabase blip. The DB error is logged for
 * follow-up investigation.
 */
export async function checkRateLimit(
  bucket: string,
  limit: number = DEFAULT_MAX_REQUESTS,
  windowSeconds: number = DEFAULT_WINDOW_SECONDS,
): Promise<boolean> {
  if (!bucket || bucket === "unknown") {
    // Cannot reliably identify caller - allow but log.
    console.warn("[rate-limit] Unidentified caller bypassed rate limit");
    return true;
  }

  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    console.error("[rate-limit] RPC failed, failing open:", error.message);
    return true;
  }

  if (data !== true) {
    // Log rate-limit hit so the security dashboard can spot abuse patterns.
    // Fire-and-forget; never delays the rejection.
    void logSecurityEvent({
      event_type: "rate_limit_hit",
      severity: "medium",
      details: { bucket, limit, window_seconds: windowSeconds },
    });
    return false;
  }
  return true;
}

/**
 * Extract the best-trust client IP from a request.
 *
 * On Vercel, `x-vercel-forwarded-for` is populated at the edge and cannot be
 * spoofed by clients. We prefer it over `x-forwarded-for`.
 *
 * If only `x-forwarded-for` is available (self-hosted, dev), we use the
 * LAST hop - closest to our infrastructure - rather than the first, which
 * clients can arbitrarily set to bypass per-IP limits.
 */
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
