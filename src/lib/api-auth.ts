import { getSession, type SessionPayload } from "@/lib/session";
import { logSecurityEvent } from "@/lib/security/log";
import { supabase } from "@/services/base";
import { isIpBlocked, isLockdownActive, getSessionMinIat } from "@/lib/security/enforcement";

export type AuthSuccess = { ok: true; session: SessionPayload };
export type AuthFailure = { ok: false; response: Response };
export type AuthResult = AuthSuccess | AuthFailure;

function clientIpFromRequest(req?: Request): string | undefined {
  if (!req) return undefined;
  const v = req.headers.get("x-vercel-forwarded-for");
  if (v) return v.split(",")[0].trim();
  const f = req.headers.get("x-forwarded-for");
  if (f) {
    const parts = f.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return undefined;
}

const UNAUTH_BODY = { success: false, error: "Not authenticated" } as const;
const FORBIDDEN_BODY = { success: false, error: "Forbidden" } as const;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Verifies the request carries a valid session cookie. Returns the session on
 * success or a ready-to-return Response on failure. The proxy enforces
 * presence of a valid JWT on `/api/*` already, but route handlers should call
 * this so they can rely on a typed session object without re-implementing the
 * cookie+JWT dance and to pick up the authenticated user's identity for
 * structured logging.
 *
 * Also enforces incident-response policies (Phase 5):
 *   - IP blocklist lookup -> 403 Blocked
 *   - Session revocation: if jwt.iat < system_flags.session_min_iat -> 401
 *
 * The req parameter is optional but recommended - without it we can't
 * extract the client IP for the blocklist check.
 *
 * @param route - the route identifier used in security_events on failure
 *                (e.g. "/api/charge-codes"). Pass a stable string per route.
 * @param req - the request, used to extract the IP for blocklist checks.
 */
export async function requireAuth(route: string, req?: Request): Promise<AuthResult> {
  // 1. IP blocklist check FIRST, before any DB lookup that costs more.
  const ip = clientIpFromRequest(req);
  if (ip && (await isIpBlocked(ip))) {
    await logSecurityEvent({
      event_type: "auth_failure",
      severity: "high",
      route,
      ip,
      details: { reason: "ip_blocked" },
    });
    return { ok: false, response: jsonResponse({ success: false, error: "Blocked" }, 403) };
  }

  // 2. Session cookie / JWT.
  const session = await getSession();
  if (!session) {
    await logSecurityEvent({
      event_type: "auth_failure",
      severity: "medium",
      route,
      ip,
      details: { reason: "no_session" },
    });
    return { ok: false, response: jsonResponse(UNAUTH_BODY, 401) };
  }

  // 3. Session revocation check - jwt.iat must be >= floor.
  const minIat = await getSessionMinIat();
  const sessionIat = (session as SessionPayload & { iat?: number }).iat ?? 0;
  if (minIat > 0 && sessionIat < minIat) {
    await logSecurityEvent({
      event_type: "session_expired",
      severity: "medium",
      route,
      ip,
      user_email: session.email,
      details: { reason: "revoked_globally", iat: sessionIat, min_iat: minIat },
    });
    return { ok: false, response: jsonResponse({ success: false, error: "Session revoked" }, 401) };
  }

  return { ok: true, session };
}

/**
 * Verifies the request carries a valid session AND the role allowlist is
 * satisfied. `super_admin` is always allowed implicitly so we never need to
 * repeat it in every callsite.
 *
 * Two-layer check:
 *   1. Fast path - JWT payload `role` from the session cookie.
 *   2. Fallback - if the JWT role doesn't match, look up the LIVE
 *      `staff.access_role` from the staff table. This is necessary because
 *      the JWT is signed at login (`/api/auth/callback`) using `staff.role`
 *      at that moment; it can be up to 8 hours stale OR pre-date a role
 *      promotion. The /api/auth/session enrichment route already reads
 *      `access_role` for the UI; this mirrors that contract on the
 *      server-side gate.
 *
 * Failures log a `role_denied` event with the attempted role and the route so
 * the security dashboard can surface unauthorised access attempts.
 */
export async function requireRole(
  route: string,
  allowedRoles: ReadonlyArray<string>,
  req?: Request,
): Promise<AuthResult> {
  const auth = await requireAuth(route, req);
  if (!auth.ok) return auth;

  // Lockdown mode: every non-GET request returns 503 maintenance.
  // Read-only traffic continues so the operator can still see the dashboard
  // and clear the lockdown.
  if (req && req.method !== "GET" && (await isLockdownActive())) {
    await logSecurityEvent({
      event_type: "unusual_activity",
      severity: "low",
      route,
      user_email: auth.session.email,
      details: { reason: "lockdown_active_blocked_write", method: req.method },
    });
    return {
      ok: false,
      response: jsonResponse(
        { success: false, error: "Service in maintenance (lockdown mode active)" },
        503,
      ),
    };
  }

  const jwtRole = auth.session.role;
  if (jwtRole === "super_admin") return auth;
  if (allowedRoles.includes(jwtRole)) return auth;

  // Fallback: check the live staff table. JWT role could be stale.
  let liveRole: string | null = null;
  if (auth.session.email) {
    const { data } = await supabase
      .from("staff")
      .select("access_role")
      .eq("email", auth.session.email.toLowerCase())
      .maybeSingle();
    liveRole = (data as { access_role?: string } | null)?.access_role ?? null;
    if (liveRole === "super_admin") return auth;
    if (liveRole && allowedRoles.includes(liveRole)) return auth;
  }

  await logSecurityEvent({
    event_type: "role_denied",
    severity: "medium",
    route,
    user_email: auth.session.email,
    user_role: liveRole ?? jwtRole,
    details: { allowed: [...allowedRoles], jwt_role: jwtRole, live_role: liveRole },
  });
  return { ok: false, response: jsonResponse(FORBIDDEN_BODY, 403) };
}

/**
 * Convenience for routes that should ONLY admit super_admin (e.g. roadmap,
 * security dashboard).
 */
export function requireSuperAdmin(route: string, req?: Request): Promise<AuthResult> {
  return requireRole(route, [], req);
}

/**
 * Convenience for the "internal staff" gate used by most pricing / quoting
 * mutations: manager, sales_manager, super_admin.
 */
export function requireManager(route: string, req?: Request): Promise<AuthResult> {
  return requireRole(route, ["manager", "sales_manager"], req);
}
