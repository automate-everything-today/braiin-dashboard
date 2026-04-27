/**
 * Cargo Visibility webhook receiver.
 *
 * Cargo Visibility POSTs Universal Event XML to a CallbackAddress we
 * registered in our subscription. Per the CV Tech Guide:
 *   - Must support HTTPS (Vercel does)
 *   - Must support HTTP OPTIONS preflight
 *   - OPTIONS response must include `Access-Control-Allow-Methods`
 *     containing "POST" or the subscription is rejected
 *
 * Auth: shared secret bearer token in Authorization header. The CV
 * docs describe a JWT-based outbound auth, but the audience GUID isn't
 * surfaced in the public guide and varies per onboarding - so we
 * gate-keep with a shared secret today (matching /api/inbound/email's
 * pattern) and layer JWT validation on later when we know the audience.
 *
 * Persistence: every accepted payload is parsed via the cargowise
 * adapter and one row per UniversalEvent goes into `tms.events` with
 * the original XML preserved. Failures land as status='failed' rows
 * with the error message - we never 500 the carrier; that triggers
 * retries and amplifies any parser bug.
 */

import { timingSafeEqual } from "node:crypto";
import { supabase } from "@/services/base";
import { TENANT_ZERO_ORG_ID } from "@/lib/activity/log-event";
import { cargowiseAdapter } from "@/lib/tms/cargowise";
import type { TmsEvent } from "@/lib/tms/types";

const WEBHOOK_SECRET = process.env.INBOUND_WEBHOOK_SECRET;

interface TmsEventInsert {
  org_id: string;
  provider_id: string;
  connection_id: string | null;
  event_type: string;
  event_time: string | null;
  client_reference: string | null;
  tms_ref: string | null;
  tms_ref_type: string | null;
  payload_format: string;
  payload_raw: string;
  parsed: Record<string, unknown> | null;
  status: string;
  error_message: string | null;
  metadata: Record<string, unknown>;
}

interface TmsClient {
  from(table: string): {
    insert: (rows: TmsEventInsert[]) => Promise<{ error: { message: string } | null }>;
    update: (vals: Record<string, unknown>) => {
      eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }>;
    };
  };
}

function tmsClient(): TmsClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).schema("tms") as TmsClient;
}

function safeEq(a: string, b: string): boolean {
  // Constant-time string compare. Length leak is acceptable - the secret
  // length is fixed and not derivable from the comparison alone.
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function checkAuth(req: Request): boolean {
  if (!WEBHOOK_SECRET) {
    console.error("[inbound/cargowise] INBOUND_WEBHOOK_SECRET not configured");
    return false;
  }
  const auth = req.headers.get("authorization");
  if (!auth) return false;
  if (auth.startsWith("Bearer ")) {
    return safeEq(auth.slice("Bearer ".length), WEBHOOK_SECRET);
  }
  // Allow Basic for symmetry with /api/inbound/email - some
  // integrations only support Basic on the target.
  if (auth.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(auth.slice("Basic ".length).trim(), "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      const password = idx >= 0 ? decoded.slice(idx + 1) : decoded;
      return safeEq(password, WEBHOOK_SECRET);
    } catch {
      return false;
    }
  }
  return false;
}

function eventToRow(event: TmsEvent): TmsEventInsert {
  return {
    org_id: TENANT_ZERO_ORG_ID,
    provider_id: event.providerId,
    connection_id: null, // resolved later when connection lookup is wired
    event_type: event.eventType,
    event_time: event.eventTime?.toISOString() ?? null,
    client_reference: event.clientReference,
    tms_ref: event.tmsRef,
    tms_ref_type: event.tmsRefType,
    payload_format: event.payloadFormat,
    payload_raw: event.rawPayload,
    parsed: {
      context: event.context,
      subContexts: event.subContexts ?? [],
      carrierCode: event.carrierCode,
      transportMode: event.transportMode,
    },
    status: "parsed",
    error_message: null,
    metadata: {},
  };
}

export async function OPTIONS() {
  // Cargo Visibility expects this preflight to succeed before it will
  // accept the subscription's callback URL. Header value list must
  // include POST and OPTIONS.
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}

export async function POST(req: Request) {
  if (!checkAuth(req)) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") ?? "application/xml";
  let payload: string;
  try {
    payload = await req.text();
  } catch (err) {
    console.error("[inbound/cargowise] failed to read body:", err);
    return Response.json({ error: "Could not read request body" }, { status: 400 });
  }

  if (!payload || payload.length === 0) {
    return Response.json({ error: "Empty payload" }, { status: 400 });
  }

  // Parse via the adapter. On parse failure we still record a failed
  // event row so the failure is visible in /dev/cargowise rather than
  // dropped silently.
  let events: TmsEvent[] = [];
  let parseError: string | null = null;
  try {
    events = await cargowiseAdapter.parseInboundEvent(payload, contentType);
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
  }

  if (parseError || events.length === 0) {
    const failedRow: TmsEventInsert = {
      org_id: TENANT_ZERO_ORG_ID,
      provider_id: "cargowise",
      connection_id: null,
      event_type: "PARSE_FAILED",
      event_time: null,
      client_reference: null,
      tms_ref: null,
      tms_ref_type: null,
      payload_format: contentType.toLowerCase().includes("xml") ? "xml" : "json",
      payload_raw: payload.slice(0, 100_000),
      parsed: null,
      status: "failed",
      error_message: parseError ?? "Payload contained no UniversalEvent",
      metadata: { contentType },
    };
    const { error } = await tmsClient().from("events").insert([failedRow]);
    if (error) console.error("[inbound/cargowise] failed-row insert error:", error.message);

    // Still 200 - the carrier should not retry on our parse bugs.
    return Response.json(
      { ok: true, parsed: 0, error: parseError ?? "no events" },
      { status: 200 },
    );
  }

  const rows = events.map(eventToRow);
  const { error } = await tmsClient().from("events").insert(rows);
  if (error) {
    console.error("[inbound/cargowise] event insert failed:", error.message);
    // Return 500 only if persistence fails - that's a real backend
    // problem the carrier should retry on.
    return Response.json({ error: "Failed to persist events" }, { status: 500 });
  }

  // Note: subscription ack tracking (mark tms.subscriptions row as
  // acknowledged on IRA / rejected on IRJ) lands in a follow-up commit
  // once /api/dev/cargowise-subscribe is creating subscription rows.

  return Response.json({ ok: true, parsed: events.length });
}
