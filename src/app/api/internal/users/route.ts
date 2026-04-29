// HONEYPOT: pretends to dump a user list. Common scanner target.

import { captureHoneypotHit } from "@/lib/security/honeypot";

const ROUTE_LABEL = "honeypot:/api/internal/users";

const FAKE_USERS = [
  { id: 1, email: "admin@example.com", role: "admin", last_login: "2026-04-29T10:12:00Z" },
  { id: 2, email: "support@example.com", role: "support", last_login: "2026-04-28T18:33:00Z" },
  { id: 3, email: "billing@example.com", role: "billing", last_login: "2026-04-27T09:45:00Z" },
];

async function honeypot(req: Request): Promise<Response> {
  await captureHoneypotHit(req, ROUTE_LABEL);
  return Response.json({ users: FAKE_USERS, total: FAKE_USERS.length, page: 1 });
}

export const GET = honeypot;
export const POST = honeypot;
