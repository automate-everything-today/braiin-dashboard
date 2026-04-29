import { getSession, type SessionPayload } from "@/lib/session";
import { logSecurityEvent } from "@/lib/security/log";
import { supabase } from "@/services/base";

export type AuthSuccess = { ok: true; session: SessionPayload };
export type AuthFailure = { ok: false; response: Response };
export type AuthResult = AuthSuccess | AuthFailure;

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
 * success or a ready-to-return 401 Response on failure. The proxy enforces
 * presence of a valid JWT on `/api/*` already, but route handlers should call
 * this so they can rely on a typed session object without re-implementing the
 * cookie+JWT dance and to pick up the authenticated user's identity for
 * structured logging.
 *
 * @param route - the route identifier used in security_events on failure
 *                (e.g. "/api/charge-codes"). Pass a stable string per route.
 */
export async function requireAuth(route: string): Promise<AuthResult> {
  const session = await getSession();
  if (!session) {
    await logSecurityEvent({
      event_type: "auth_failure",
      severity: "medium",
      route,
      details: { reason: "no_session" },
    });
    return { ok: false, response: jsonResponse(UNAUTH_BODY, 401) };
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
): Promise<AuthResult> {
  const auth = await requireAuth(route);
  if (!auth.ok) return auth;

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
export function requireSuperAdmin(route: string): Promise<AuthResult> {
  return requireRole(route, []);
}

/**
 * Convenience for the "internal staff" gate used by most pricing / quoting
 * mutations: manager, sales_manager, super_admin.
 */
export function requireManager(route: string): Promise<AuthResult> {
  return requireRole(route, ["manager", "sales_manager"]);
}
