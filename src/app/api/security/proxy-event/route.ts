// Proxy-event sink. The edge proxy can't talk to Supabase directly
// (different runtime), so it fire-and-forget POSTs here on every 401 /
// expired-session / invalid-jwt. We validate via HMAC of (timestamp +
// event_type + body) so only the proxy itself can write here.
//
// Allowlisted in src/proxy.ts so the proxy's POST to it doesn't get
// blocked by its own auth check.

import { z } from "zod";
import { logSecurityEvent } from "@/lib/security/log";
import { hmacVerify } from "@/lib/security/notify";

const ROUTE = "/api/security/proxy-event";

const eventSchema = z.object({
  ts: z.number().int(),                                   // ms epoch from the proxy
  event_type: z.enum([
    "auth_failure",
    "session_expired",
    "csrf_failure",
    "unusual_activity",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  route: z.string().max(2048).optional(),
  ip: z.string().max(64).optional(),
  user_agent: z.string().max(512).optional(),
  reason: z.string().max(256).optional(),
});

const MAX_AGE_MS = 60_000; // anti-replay: reject signed payloads older than 60s

export async function POST(req: Request) {
  const secret = process.env.PROXY_LOG_SECRET;
  if (!secret) {
    return Response.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const sigHeader = req.headers.get("x-proxy-signature");
  if (!sigHeader) {
    return Response.json({ error: "Missing signature" }, { status: 401 });
  }

  const rawBody = await req.text();

  const valid = await hmacVerify(secret, rawBody, sigHeader);
  if (!valid) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let parsed: z.infer<typeof eventSchema>;
  try {
    parsed = eventSchema.parse(JSON.parse(rawBody));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Bad payload" }, { status: 400 });
  }

  // Anti-replay
  if (Date.now() - parsed.ts > MAX_AGE_MS) {
    return Response.json({ error: "Stale signature" }, { status: 401 });
  }

  await logSecurityEvent({
    event_type: parsed.event_type,
    severity: parsed.severity,
    route: parsed.route ?? ROUTE,
    ip: parsed.ip,
    user_agent: parsed.user_agent,
    details: { source: "proxy", reason: parsed.reason },
  });

  return Response.json({ ok: true });
}
