// Build queue API.
//
// POST   - push a new item (super_admin via cookie)
// GET    - list queue items (super_admin via cookie)
// PATCH  - mark complete or cancel (super_admin OR personal token)
// DELETE - super_admin

import { z } from "zod";
import { supabase } from "@/services/base";
import { requireSuperAdmin } from "@/lib/api-auth";
import { getOrgId } from "@/lib/org";
import { logSuperAdminAction } from "@/lib/security/log";
import { verifyPersonalToken } from "@/lib/personal-token";

const ROUTE = "/api/build-queue";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

const pushSchema = z.object({
  source_type: z.enum(["roadmap", "finding", "change_request", "manual", "telegram"]).default("manual"),
  source_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(500),
  prompt: z.string().min(1).max(50_000),
  target_repo: z.string().max(200).optional().nullable(),
  working_dir: z.string().max(500).optional().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  notes: z.string().max(2000).optional().nullable(),
});

const patchSchema = z.object({
  queue_id: z.string().uuid(),
  status: z.enum(["queued", "claimed", "done", "cancelled"]),
  completed_note: z.string().max(2000).optional().nullable(),
  completed_commit_sha: z.string().max(64).optional().nullable(),
});

export async function POST(req: Request) {
  const auth = await requireSuperAdmin(ROUTE, req);
  if (!auth.ok) return auth.response;
  const parsed = pushSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;
  const { data, error } = await db.schema("feedback").from("build_queue").insert({
    org_id: getOrgId(),
    source_type: body.source_type,
    source_id: body.source_id ?? null,
    title: body.title,
    prompt: body.prompt,
    target_repo: body.target_repo ?? "braiin-dashboard",
    working_dir: body.working_dir ?? "/Users/robdonald-agent/ai-projects/Corten Outreach/dashboard",
    priority: body.priority,
    notes: body.notes ?? null,
    created_by_email: auth.session.email,
  }).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  void logSuperAdminAction({
    route: ROUTE, action: "push_to_build_queue", method: "POST",
    user_email: auth.session.email,
    details: { title: body.title.slice(0, 80), source_type: body.source_type, priority: body.priority },
  });
  return Response.json({ queue_item: data });
}

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(ROUTE, req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  let q = db.schema("feedback").from("build_queue").select("*").eq("org_id", getOrgId()).order("created_at", { ascending: false }).limit(200);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ items: data ?? [] });
}

export async function PATCH(req: Request) {
  // Accept either cookie (super_admin) OR personal token via Authorization header.
  let actorEmail: string | null = null;
  const tokenHeader = req.headers.get("authorization");
  if (tokenHeader?.startsWith("Bearer bra_")) {
    const tok = tokenHeader.slice(7);
    const v = await verifyPersonalToken(tok);
    if (v) actorEmail = `token:${v.user_email}:${v.label}`;
  }
  if (!actorEmail) {
    const auth = await requireSuperAdmin(ROUTE, req);
    if (!auth.ok) return auth.response;
    actorEmail = auth.session.email;
  }
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });
  const body = parsed.data;
  const updates: Record<string, unknown> = { status: body.status };
  if (body.status === "done") {
    updates.completed_at = new Date().toISOString();
    if (body.completed_note) updates.completed_note = body.completed_note;
    if (body.completed_commit_sha) updates.completed_commit_sha = body.completed_commit_sha;
  }
  const { data, error } = await db.schema("feedback").from("build_queue")
    .update(updates).eq("queue_id", body.queue_id).eq("org_id", getOrgId()).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ queue_item: data, by: actorEmail });
}
