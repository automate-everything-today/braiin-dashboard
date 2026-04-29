// Security daily digest cron - runs at 09:00 UTC via vercel.json.
//
// Sends a single Telegram summarising yesterday's security_events grouped
// by severity. Designed as the "if all is well, this is what you'd want
// to know" daily recap. The 5-minute alert cron handles real-time
// CRITICAL / HIGH; this cron is the calmer overview.

import { supabase } from "@/services/base";
import { sendTelegram } from "@/lib/security/notify";

const ROUTE = "/api/cron/security-digest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

interface SecurityEvent {
  event_id: number;
  event_type: string;
  severity: "low" | "medium" | "high" | "critical";
  route: string | null;
  user_email: string | null;
  ip: string | null;
  occurred_at: string;
}

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return Response.json({ error: "Server misconfigured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const yStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0));
  const yEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const dateLabel = yStart.toISOString().slice(0, 10);

  const { data, error } = await db
    .schema("feedback")
    .from("security_events")
    .select("*")
    .gte("occurred_at", yStart.toISOString())
    .lt("occurred_at", yEnd.toISOString());

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const events = (data ?? []) as SecurityEvent[];
  const bySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const byType: Record<string, number> = {};
  const topIps = new Map<string, number>();
  const topEmails = new Map<string, number>();

  for (const e of events) {
    bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
    byType[e.event_type] = (byType[e.event_type] ?? 0) + 1;
    if (e.ip) topIps.set(e.ip, (topIps.get(e.ip) ?? 0) + 1);
    if (e.user_email) topEmails.set(e.user_email, (topEmails.get(e.user_email) ?? 0) + 1);
  }

  const top = (m: Map<string, number>, n: number) =>
    Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => `\`${k}\` ${v}`)
      .join(", ");

  const lines = [
    `📊 *Security digest ${dateLabel}*`,
    ``,
    `${events.length} events total`,
    bySeverity.critical > 0 ? `🚨 critical: ${bySeverity.critical}` : null,
    bySeverity.high > 0 ? `⚠️ high: ${bySeverity.high}` : null,
    bySeverity.medium > 0 ? `🔔 medium: ${bySeverity.medium}` : null,
    bySeverity.low > 0 ? `ℹ️ low: ${bySeverity.low}` : null,
  ].filter(Boolean);

  if (Object.keys(byType).length > 0) {
    lines.push(``);
    lines.push(`*By type:*`);
    for (const [t, c] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
      lines.push(`\`${t}\` ${c}`);
    }
  }

  if (topIps.size > 0) {
    lines.push(``);
    lines.push(`*Top IPs:* ${top(topIps, 5)}`);
  }
  if (topEmails.size > 0) {
    lines.push(`*Top users:* ${top(topEmails, 5)}`);
  }

  lines.push(``);
  lines.push(`View: https://braiin.app/dev/security`);

  const result = await sendTelegram(lines.join("\n"));
  return Response.json({
    ok: true,
    date: dateLabel,
    events_count: events.length,
    by_severity: bySeverity,
    sent: result.ok,
    send_error: result.ok ? null : result.error,
  });
}
