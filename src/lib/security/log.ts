import { supabase } from "@/services/base";
import { getOrgId } from "@/lib/org";

export type SecurityEventType =
  | "auth_failure"
  | "session_expired"
  | "role_denied"
  | "upload_rejected"
  | "rate_limit_hit"
  | "csrf_failure"
  | "input_validation_failed"
  | "service_key_missing"
  | "unusual_activity"
  | "super_admin_action"
  | "honeypot_hit";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

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

/**
 * Best-effort write to feedback.build_log so the timeline view at /dev/build-log
 * shows audit-trail and honeypot entries alongside feature commits. Same
 * fail-loud-but-never-throw contract as logSecurityEvent.
 */
export async function logBuildEntry(entry: {
  title: string;
  summary?: string | null;
  item_type?: "feature" | "fix" | "refactor" | "docs" | "chore" | "perf" | "ci" | "test";
  status?: "wip" | "shipped" | "reverted";
  area?: string | null;
  tags?: string[];
  notes?: string | null;
  author?: string | null;
}): Promise<void> {
  try {
    const { error } = await db
      .schema("feedback")
      .from("build_log")
      .insert([
        {
          org_id: getOrgId(),
          title: entry.title,
          summary: entry.summary ?? null,
          item_type: entry.item_type ?? "chore",
          status: entry.status ?? "shipped",
          area: entry.area ?? null,
          tags: entry.tags ?? [],
          occurred_at: new Date().toISOString(),
          notes: entry.notes ?? null,
          author: entry.author ?? null,
        },
      ]);
    if (error) {
      console.warn("[build_log] insert failed:", error.message, "title:", entry.title);
    }
  } catch (err) {
    console.warn("[build_log] threw:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Audit trail entry for sensitive super_admin actions. Writes to BOTH
 * security_events (so /dev/security shows it in the event stream) AND
 * build_log (so /dev/build-log shows it in the timeline).
 *
 * Use at the top of any super_admin POST/PATCH/DELETE handler:
 *
 *   await logSuperAdminAction({
 *     route: "/api/security",
 *     action: "transition_finding",
 *     user_email: auth.session.email,
 *     details: { finding_id, from_status, to_status },
 *   });
 */
export async function logSuperAdminAction(input: {
  route: string;
  action: string;                              // e.g. 'transition_finding', 'delete_cost_entry'
  method?: string;                             // HTTP method - decoration
  user_email?: string | null;
  ip?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  const eventDetails = {
    action: input.action,
    method: input.method,
    ...input.details,
  };
  await Promise.all([
    logSecurityEvent({
      event_type: "super_admin_action",
      severity: "low",
      route: input.route,
      user_email: input.user_email,
      ip: input.ip,
      details: eventDetails,
    }),
    logBuildEntry({
      title: `super_admin: ${input.action}`,
      summary: `${input.user_email ?? "unknown"} ${input.method ?? ""} ${input.route}`,
      item_type: "chore",
      status: "shipped",
      area: "audit",
      tags: ["super-admin", "audit"],
      author: input.user_email ?? null,
      notes: Object.keys(input.details ?? {}).length > 0 ? JSON.stringify(input.details) : null,
    }),
  ]);
}

/**
 * Honeypot hit logger. HIGH severity so the 5-min alert cron fires an
 * immediate Telegram. Captures the caller fingerprint (ip, ua, anything
 * the route extracted) so you can trace the scanner.
 */
export async function logHoneypotHit(input: {
  route: string;
  ip?: string | null;
  user_agent?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  await Promise.all([
    logSecurityEvent({
      event_type: "honeypot_hit",
      severity: "high",
      route: input.route,
      ip: input.ip,
      user_agent: input.user_agent,
      details: input.details,
    }),
    logBuildEntry({
      title: `honeypot hit: ${input.route}`,
      summary: `From ${input.ip ?? "unknown"} - ${input.user_agent?.slice(0, 80) ?? "no UA"}`,
      item_type: "chore",
      status: "shipped",
      area: "security",
      tags: ["honeypot", "security", "intrusion-attempt"],
      author: "honeypot",
      notes: input.details ? JSON.stringify(input.details) : null,
    }),
  ]);
}
