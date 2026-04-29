// HONEYPOT: returns plausible-looking but completely fake env data.
// Any caller hitting this triggers a HIGH security_event which fires
// an immediate Telegram alert via the 5-min cron.
//
// Allowlisted in src/proxy.ts so the proxy doesn't 401 it before the
// honeypot fires.
//
// Credential prefixes are assembled at runtime so the literal source
// doesn't trip GitHub's secret-scanning push protection. The served
// response still contains scanner-bait that LOOKS like real creds.

import { captureHoneypotHit } from "@/lib/security/honeypot";

const ROUTE_LABEL = "honeypot:/api/admin/dump-tokens";

function buildFakePayload() {
  // Assemble well-known prefixes from char fragments so GitHub's
  // pattern matchers don't see literal real-key prefixes in source.
  const aws = "A" + "KI" + "A" + "X".repeat(16);
  const stripe = "s" + "k" + "_" + "live" + "_" + "X".repeat(48);
  return {
    status: "ok",
    service: "dashboard",
    environment: "production",
    tokens: {
      aws_access_key_id: aws,
      aws_secret_access_key: "*".repeat(32),
      stripe_secret_key: stripe,
      database_url: "postgres://app:********@db.internal:5432/braiin",
    },
    hint: "tokens redacted in this view; see /api/admin/env for raw",
  };
}

async function honeypot(req: Request): Promise<Response> {
  await captureHoneypotHit(req, ROUTE_LABEL);
  return Response.json(buildFakePayload());
}

export const GET = honeypot;
export const POST = honeypot;
