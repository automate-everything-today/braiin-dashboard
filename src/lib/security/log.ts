import { supabase } from "@/services/base";

export type SecurityEventType =
  | "auth_failure"
  | "session_expired"
  | "role_denied"
  | "upload_rejected"
  | "rate_limit_hit"
  | "csrf_failure"
  | "input_validation_failed"
  | "service_key_missing"
  | "unusual_activity";

export type SecuritySeverity = "low" | "medium" | "high" | "critical";

export type SecurityEventInput = {
  event_type: SecurityEventType;
  severity: SecuritySeverity;
  route?: string;
  user_email?: string | null;
  user_role?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  details?: Record<string, unknown>;
};

/**
 * Best-effort write to feedback.security_events. Never throws and never
 * propagates a failure to the caller - we don't want a security-logging
 * outage to take down the auth check. If the write fails, we log a console
 * warn so the operator can spot the gap in the dashboard.
 *
 * The shape is deliberately denormalised (route + email as plain text) so the
 * dashboard can render the event stream with zero joins.
 */
export async function logSecurityEvent(event: SecurityEventInput): Promise<void> {
  try {
    const db = supabase as unknown as { schema: (s: string) => { from: (t: string) => { insert: (rows: unknown[]) => Promise<{ error: { message: string } | null }> } } };
    const { error } = await db
      .schema("feedback")
      .from("security_events")
      .insert([
        {
          event_type: event.event_type,
          severity: event.severity,
          route: event.route ?? null,
          user_email: event.user_email ?? null,
          user_role: event.user_role ?? null,
          ip: event.ip ?? null,
          user_agent: event.user_agent ?? null,
          details: event.details ?? {},
        },
      ]);
    if (error) {
      console.warn("[security/log] insert failed:", error.message, "event:", event.event_type);
    }
  } catch (err) {
    console.warn(
      "[security/log] threw:",
      err instanceof Error ? err.message : String(err),
      "event:",
      event.event_type,
    );
  }
}
