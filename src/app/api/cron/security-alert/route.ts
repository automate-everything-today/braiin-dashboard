// Security alert cron - runs every 5 minutes via vercel.json.
//
// Scans security_events that haven't been alerted yet and:
//   1. Sends an immediate Telegram for every CRITICAL event
//   2. Sends an immediate Telegram for every HIGH event
//   3. Aggregates 5+ MEDIUM/LOW events from the same IP or email into one
//      "cluster" message (catches scanners / brute-force without spamming
//      the operator with one ping per request)
//
// Marks alerted_at after sending so the next run skips already-handled rows.
//
// Auth: shared CRON_SECRET in the Authorization Bearer header.

import { supabase } from "@/services/base";
import { sendTelegram, formatSecurityAlert } from "@/lib/security/notify";

const ROUTE = "/api/cron/security-alert";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

interface SecurityEvent {
  event_id: number;
  event_type: string;
  severity: "low" | "medium" | "high" | "critical";
  route: string | null;
  user_email: string | null;
  user_role: string | null;
  ip: string | null;
  user_agent: string | null;
  details: Record<string, unknown>;
  occurred_at: string;
  alerted_at: string | null;
}

const CLUSTER_MIN_COUNT = 5; // 5+ events in the window from same source = cluster

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error(`[${ROUTE}] CRON_SECRET not set`);
    return Response.json({ error: "Server misconfigured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Pull all unalerted events that occurred more than 10s ago (avoids
  // races with in-flight inserts) but are not stale (last 1 hour bound
  // so a long-down cron doesn't blast the operator with hundreds of
  // backfill alerts).
  const cutoffOld = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const cutoffYoung = new Date(Date.now() - 10 * 1000).toISOString();

  const { data, error } = await db
    .schema("feedback")
    .from("security_events")
    .select("*")
    .is("alerted_at", null)
    .gte("occurred_at", cutoffOld)
    .lt("occurred_at", cutoffYoung)
    .order("occurred_at", { ascending: true })
    .limit(500);

  if (error) {
    console.error(`[${ROUTE}] query failed:`, error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  const events = (data ?? []) as SecurityEvent[];
  if (events.length === 0) {
    return Response.json({ ok: true, alerted: 0, clusters: 0 });
  }

  // Split into immediate-alert (critical + high) and cluster-candidate
  // (medium + low).
  const immediate = events.filter((e) => e.severity === "critical" || e.severity === "high");
  const clusterable = events.filter((e) => e.severity === "medium" || e.severity === "low");

  let sent = 0;
  let clusters = 0;
  const alertedIds: number[] = [];

  // 1. Immediate per-event alerts
  for (const event of immediate) {
    const result = await sendTelegram(formatSecurityAlert(event));
    if (result.ok) {
      sent += 1;
      alertedIds.push(event.event_id);
    } else {
      console.warn(`[${ROUTE}] telegram send failed for event ${event.event_id}: ${result.error}`);
    }
  }

  // 2. Cluster aggregation by source key (ip || email || event_type fallback)
  const buckets = new Map<string, SecurityEvent[]>();
  for (const e of clusterable) {
    const key = e.ip ?? e.user_email ?? `type:${e.event_type}`;
    const list = buckets.get(key) ?? [];
    list.push(e);
    buckets.set(key, list);
  }

  for (const [key, bucket] of buckets) {
    if (bucket.length < CLUSTER_MIN_COUNT) {
      // Below cluster threshold - mark as alerted so we don't re-evaluate
      // every 5 min indefinitely, but don't actually send.
      for (const e of bucket) alertedIds.push(e.event_id);
      continue;
    }
    const summary = [
      `🔔 *cluster* ${bucket.length} events from \`${key}\``,
      `types: ${Array.from(new Set(bucket.map((e) => e.event_type))).join(", ")}`,
      `routes: ${Array.from(new Set(bucket.map((e) => e.route).filter(Boolean))).slice(0, 5).join(", ") || "(none)"}`,
      `severity max: ${bucket.reduce((m, e) => (e.severity === "high" ? "high" : m), "medium")}`,
      ``,
      `View: https://braiin.app/dev/security`,
    ].join("\n");
    const result = await sendTelegram(summary);
    if (result.ok) {
      sent += 1;
      clusters += 1;
      for (const e of bucket) alertedIds.push(e.event_id);
    } else {
      console.warn(`[${ROUTE}] telegram cluster send failed for ${key}: ${result.error}`);
    }
  }

  if (alertedIds.length > 0) {
    await db
      .schema("feedback")
      .from("security_events")
      .update({ alerted_at: new Date().toISOString() })
      .in("event_id", alertedIds);
  }

  return Response.json({
    ok: true,
    sent_messages: sent,
    clusters,
    events_marked_alerted: alertedIds.length,
    immediate_count: immediate.length,
    clusterable_count: clusterable.length,
  });
}
