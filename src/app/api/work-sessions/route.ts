// Work session time-tracking CRUD.

import { z } from "zod";
import { supabase } from "@/services/base";
import { requireSuperAdmin } from "@/lib/api-auth";
import { getOrgId } from "@/lib/org";

const ROUTE = "/api/work-sessions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

const createSchema = z.object({
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().nullable().optional(),
  project: z.string().min(1).max(64).default("braiin-dashboard"),
  notes: z.string().max(2000).nullable().optional(),
  source: z.enum(["manual", "auto-from-commits", "claude-mem"]).default("manual"),
  project_attribution: z.number().min(0).max(1).default(1.0),
});

export async function GET() {
  const auth = await requireSuperAdmin(ROUTE);
  if (!auth.ok) return auth.response;
  const { data, error } = await db
    .schema("feedback")
    .from("work_sessions")
    .select("*")
    .eq("org_id", getOrgId())
    .order("started_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ sessions: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireSuperAdmin(ROUTE);
  if (!auth.ok) return auth.response;
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;
  const { data, error } = await db
    .schema("feedback")
    .from("work_sessions")
    .insert({
      org_id: getOrgId(),
      started_at: body.started_at,
      ended_at: body.ended_at ?? null,
      project: body.project,
      notes: body.notes ?? null,
      source: body.source,
      project_attribution: body.project_attribution,
    })
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ session: data });
}

const patchSchema = z.object({
  session_id: z.string().uuid(),
  ended_at: z.string().datetime().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  project_attribution: z.number().min(0).max(1).optional(),
});

export async function PATCH(req: Request) {
  const auth = await requireSuperAdmin(ROUTE);
  if (!auth.ok) return auth.response;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;
  const updates: Record<string, unknown> = {};
  for (const k of ["ended_at", "notes", "project_attribution"] as const) {
    const v = body[k];
    if (v !== undefined) updates[k] = v;
  }
  const { data, error } = await db
    .schema("feedback")
    .from("work_sessions")
    .update(updates)
    .eq("session_id", body.session_id)
    .eq("org_id", getOrgId())
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ session: data });
}

const deleteSchema = z.object({ session_id: z.string().uuid() });

export async function DELETE(req: Request) {
  const auth = await requireSuperAdmin(ROUTE);
  if (!auth.ok) return auth.response;
  const parsed = deleteSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "session_id required" }, { status: 400 });
  const { error } = await db
    .schema("feedback")
    .from("work_sessions")
    .delete()
    .eq("session_id", parsed.data.session_id)
    .eq("org_id", getOrgId());
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
