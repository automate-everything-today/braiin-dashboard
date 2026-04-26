/**
 * Shared cron auth gate. Vercel cron jobs include the configured
 * CRON_SECRET as a Bearer token; this helper enforces it consistently
 * across every cron route.
 *
 * Failure modes, in order:
 *   - CRON_SECRET unset or empty in env  -> 500. This is a deployment
 *     misconfiguration, not an access-denied. Returning 403 here would
 *     silently disable the cron on a misconfigured deploy with no
 *     loud signal in logs.
 *   - Authorization header missing or wrong -> 403.
 *
 * Returns null on success (caller proceeds), or a Response on rejection.
 */
export function requireCronAuth(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length === 0) {
    // Log loudly server-side so operators see the misconfig in Vercel
    // function logs; return a generic body so we don't reveal env-var
    // names to anyone hitting the endpoint.
    console.error(
      "[cron-auth] CRON_SECRET is unset or empty. Refusing to run cron job - this is a deploy misconfiguration.",
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  if (authHeader !== expected) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}
