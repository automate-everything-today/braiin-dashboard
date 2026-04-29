/**
 * Single source of truth for the active org ID. Throws at first call if
 * `DEFAULT_ORG_ID` is missing from the environment so a misconfigured deploy
 * fails loud instead of silently writing to a sentinel UUID.
 *
 * Pre-fix the four new API routes (margin-rules, change-requests, build-log,
 * roadmap) each had their own ?? "00000000-..." fallback. This helper is the
 * fail-loud replacement.
 */

let cached: string | null = null;

export function getOrgId(): string {
  if (cached) return cached;

  const fromEnv = process.env.DEFAULT_ORG_ID ?? process.env.NEXT_PUBLIC_DEFAULT_ORG_ID;
  if (!fromEnv) {
    throw new Error(
      "DEFAULT_ORG_ID is not set. Refusing to fall back to a sentinel UUID - configure DEFAULT_ORG_ID in the environment.",
    );
  }
  if (!/^[0-9a-fA-F-]{36}$/.test(fromEnv)) {
    throw new Error(
      `DEFAULT_ORG_ID is not a valid UUID: "${fromEnv}". Refusing to use it.`,
    );
  }
  cached = fromEnv;
  return cached;
}
