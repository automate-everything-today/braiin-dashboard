// Personal access token CRUD. Super_admin only.
//
// POST creates a token, returns plaintext ONCE - never recoverable after.
// GET lists active tokens (no plaintext, just metadata).
// DELETE revokes by token_id.

import { z } from "zod";
import { supabase } from "@/services/base";
import { requireSuperAdmin } from "@/lib/api-auth";
import { logSuperAdminAction } from "@/lib/security/log";
import { generatePersonalToken } from "@/lib/personal-token";

const ROUTE = "/api/personal-tokens";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

const createSchema = z.object({ label: z.string().min(1).max(100) });
const deleteSchema = z.object({ token_id: z.string().uuid() });

export async function POST(req: Request) {
  const auth = await requireSuperAdmin(ROUTE, req);
  if (!auth.ok) return auth.response;
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "label required" }, { status: 400 });
  }
  const { plaintext, sha256 } = generatePersonalToken();
  const { data, error } = await db
    .schema("feedback")
    .from("personal_tokens")
    .insert({ token_sha256: sha256, user_email: auth.session.email, label: parsed.data.label })
    .select("token_id, label, created_at")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  void logSuperAdminAction({
    route: ROUTE, action: "create_personal_token", method: "POST",
    user_email: auth.session.email, details: { label: parsed.data.label },
  });
  return Response.json({ token_id: data.token_id, label: data.label, created_at: data.created_at, token: plaintext });
}

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(ROUTE, req);
  if (!auth.ok) return auth.response;
  const { data, error } = await db
    .schema("feedback")
    .from("personal_tokens")
    .select("token_id, user_email, label, created_at, last_used_at, revoked_at")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ tokens: data ?? [] });
}

export async function DELETE(req: Request) {
  const auth = await requireSuperAdmin(ROUTE, req);
  if (!auth.ok) return auth.response;
  const parsed = deleteSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "token_id required" }, { status: 400 });
  const { error } = await db
    .schema("feedback")
    .from("personal_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_id", parsed.data.token_id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  void logSuperAdminAction({
    route: ROUTE, action: "revoke_personal_token", method: "DELETE",
    user_email: auth.session.email, details: { token_id: parsed.data.token_id },
  });
  return Response.json({ ok: true });
}
