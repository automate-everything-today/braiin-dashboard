/**
 * Incident-response enforcement helpers.
 *
 * Read-side queries used by api-auth + honeypot routes:
 *   - isIpBlocked(ip)           - is this caller's IP currently denied?
 *   - isLockdownActive()        - is the global lockdown mode on?
 *   - getSessionMinIat()        - epoch-seconds floor for JWT issuance
 *
 * All best-effort: a DB blip should NOT lock everyone out. Each helper
 * returns the safe-default ("not blocked", "not in lockdown", "0") on
 * any error and warns to the console.
 *
 * Each helper memoises within a 30s window per process to avoid hammering
 * Supabase on every single auth check. The trade-off: a manual block /
 * lockdown takes up to 30s to take full effect across all hot edge
 * functions. Acceptable for the response timeframe (you've already been
 * pinged on Telegram by then).
 */

import { supabase } from "@/services/base";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

const CACHE_TTL_MS = 30_000;

let blocklistCache: { ips: Set<string>; expires_at: number } | null = null;
let lockdownCache: { active: boolean; expires_at: number } | null = null;
let minIatCache: { value: number; expires_at: number } | null = null;

export async function isIpBlocked(ip: string): Promise<boolean> {
  if (!ip || ip === "unknown") return false;

  if (!blocklistCache || Date.now() > blocklistCache.expires_at) {
    try {
      const nowIso = new Date().toISOString();
      const { data, error } = await db
        .schema("feedback")
        .from("ip_blocklist")
        .select("ip, expires_at");
      if (error) {
        console.warn("[enforcement] blocklist query failed:", error.message);
        // Keep stale cache if any; otherwise fail-open with empty set.
        blocklistCache = blocklistCache ?? {
          ips: new Set(),
          expires_at: Date.now() + CACHE_TTL_MS,
        };
      } else {
        const active = ((data ?? []) as Array<{ ip: string; expires_at: string | null }>)
          .filter((r) => !r.expires_at || r.expires_at > nowIso)
          .map((r) => r.ip);
        blocklistCache = { ips: new Set(active), expires_at: Date.now() + CACHE_TTL_MS };
      }
    } catch (e) {
      console.warn("[enforcement] blocklist threw:", e instanceof Error ? e.message : e);
      blocklistCache = blocklistCache ?? { ips: new Set(), expires_at: Date.now() + CACHE_TTL_MS };
    }
  }
  return blocklistCache?.ips.has(ip) ?? false;
}

async function getFlag<T>(key: string, fallback: T): Promise<T> {
  try {
    const { data, error } = await db
      .schema("feedback")
      .from("system_flags")
      .select("flag_value")
      .eq("flag_key", key)
      .maybeSingle();
    if (error || !data) return fallback;
    return (data as { flag_value: T }).flag_value ?? fallback;
  } catch {
    return fallback;
  }
}

export async function isLockdownActive(): Promise<boolean> {
  if (!lockdownCache || Date.now() > lockdownCache.expires_at) {
    const value = await getFlag<boolean>("lockdown_mode_active", false);
    lockdownCache = { active: value === true, expires_at: Date.now() + CACHE_TTL_MS };
  }
  return lockdownCache.active;
}

export async function getSessionMinIat(): Promise<number> {
  if (!minIatCache || Date.now() > minIatCache.expires_at) {
    const value = await getFlag<number>("session_min_iat", 0);
    minIatCache = { value: typeof value === "number" ? value : 0, expires_at: Date.now() + CACHE_TTL_MS };
  }
  return minIatCache.value;
}

/**
 * Clear in-process caches. Called by /api/security/actions after a write
 * so the actor's own next request reflects the change instantly. Other
 * processes pick up the change at the next 30s tick.
 */
export function clearEnforcementCaches(): void {
  blocklistCache = null;
  lockdownCache = null;
  minIatCache = null;
}
