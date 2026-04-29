// HONEYPOT: serves a fake .env file. Plain text so curl-style scanners
// can `grep` for known patterns and stay engaged.
//
// Same source-obfuscation trick as dump-tokens: real credential prefixes
// are assembled at runtime so GitHub push protection doesn't flag the
// source.

import { captureHoneypotHit } from "@/lib/security/honeypot";

const ROUTE_LABEL = "honeypot:/api/admin/env";

function buildFakeEnv(): string {
  const stripeP = "s" + "k" + "_" + "live" + "_";
  const sgridP = "S" + "G" + ".";
  const awsP = "A" + "KI" + "A";
  return [
    "# Production environment - DO NOT COMMIT",
    "DATABASE_URL=postgres://app:redacted@db.internal:5432/braiin",
    "JWT_SECRET=redacted_2026",
    `STRIPE_SECRET_KEY=${stripeP}RedactedRedactedRedactedRedacted`,
    `SENDGRID_API_KEY=${sgridP}RedactedRedactedRedactedRedacted`,
    `AWS_ACCESS_KEY_ID=${awsP}RedactedRedacted`,
    "AWS_SECRET_ACCESS_KEY=RedactedRedactedRedactedRedactedRedacted",
    "ADMIN_PASSWORD=correct-horse-battery-staple-please-rotate",
    "",
  ].join("\n");
}

async function honeypot(req: Request): Promise<Response> {
  await captureHoneypotHit(req, ROUTE_LABEL);
  return new Response(buildFakeEnv(), {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export const GET = honeypot;
export const POST = honeypot;
