import { logSecurityEvent } from "@/lib/security/log";

/**
 * Active org ID for the running deployment.
 *
 * Reads `DEFAULT_ORG_ID` from the environment and validates it as a UUID.
 *
 * If the env var is missing or malformed, we LOG LOUD (server console +
 * security_events table so the /dev/security dashboard catches it) and
 * fall back to the legacy sentinel UUID `00000000-0000-0000-0000-000000000001`.
 * Falling back rather than throwing keeps production routes responding;
 * crashing on startup turned a missing-config issue into a 500-with-empty-
 * body that broke every dashboard page that called these routes.
 *
 * The fallback is the same value the codebase silently used before the
 * audit, so behaviour is unchanged - the difference is the loud signal
 * that DEFAULT_ORG_ID is not set.
 */

const SENTINEL = "00000000-0000-0000-0000-000000000001";
const UUID_RE = /^[0-9a-fA-F-]{36}$/;

let cached: string | null = null;
let warned = false;

export function getOrgId(): string {
  if (cached) return cached;

  const fromEnv = process.env.DEFAULT_ORG_ID ?? process.env.NEXT_PUBLIC_DEFAULT_ORG_ID;

  if (fromEnv && UUID_RE.test(fromEnv)) {
    cached = fromEnv;
    return cached;
  }

  // Warn + log a security event ONCE per process so we don't flood logs.
  if (!warned) {
    warned = true;
    const reason = !fromEnv ? "env_missing" : "env_not_uuid";
    console.warn(
      `[getOrgId] DEFAULT_ORG_ID ${reason} - falling back to sentinel ${SENTINEL}. Set DEFAULT_ORG_ID in the Vercel environment to silence this.`,
    );
    void logSecurityEvent({
      event_type: "service_key_missing",
      severity: "high",
      details: {
        env_var: "DEFAULT_ORG_ID",
        reason,
        fallback: SENTINEL,
        message: "Set DEFAULT_ORG_ID env var to silence; fallback is in use.",
      },
    });
  }

  cached = SENTINEL;
  return cached;
}
