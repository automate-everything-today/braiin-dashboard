// CTO-only roadmap mind map. Every verb is super_admin-gated server-side; the
// PageGuard on the page side is a UX convenience, this is the security
// boundary.

import { z } from "zod";
import { supabase } from "@/services/base";
import { requireSuperAdmin } from "@/lib/api-auth";
import { getOrgId } from "@/lib/org";

const ROUTE = "/api/roadmap";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

const statusEnum = z.enum(["idea", "committed", "in_progress", "shipped", "paused", "dropped"]);
const priorityEnum = z.enum(["low", "medium", "high", "urgent"]);

const createSchema = z.object({
  parent_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(500),
  rationale: z.string().max(20_000).nullable().optional(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  area: z.string().max(64).nullable().optional(),
  position: z.number().int().min(0).max(100_000).optional(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  notes: z.string().max(50_000).nullable().optional(),
  eta: z.string().nullable().optional(),
});

const patchSchema = z.object({
  node_id: z.string().uuid(),
  title: z.string().min(1).max(500).optional(),
  rationale: z.string().max(20_000).nullable().optional(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  area: z.string().max(64).nullable().optional(),
  position: z.number().int().min(0).max(100_000).optional(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  notes: z.string().max(50_000).nullable().optional(),
  eta: z.string().nullable().optional(),
  parent_id: z.string().uuid().nullable().optional(),
});

const deleteSchema = z.object({ node_id: z.string().uuid() });

export async function GET() {
  const auth = await requireSuperAdmin(ROUTE);
  if (!auth.ok) return auth.response;

  const { data, error } = await db
    .schema("feedback")
    .from("roadmap_nodes")
    .select("*")
    .eq("org_id", getOrgId())
    .order("position");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ nodes: data ?? [] });
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
    .from("roadmap_nodes")
    .insert({
      org_id: getOrgId(),
      parent_id: body.parent_id ?? null,
      title: body.title,
      rationale: body.rationale ?? null,
      status: body.status ?? "idea",
      priority: body.priority ?? "medium",
      area: body.area ?? null,
      position: body.position ?? 0,
      tags: body.tags ?? [],
      notes: body.notes ?? null,
      eta: body.eta ?? null,
    })
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ node: data });
}

export async function PATCH(req: Request) {
  const auth = await requireSuperAdmin(ROUTE);
  if (!auth.ok) return auth.response;

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;
  const updates: Record<string, unknown> = {};
  for (const k of [
    "title",
    "rationale",
    "status",
    "priority",
    "area",
    "position",
    "tags",
    "notes",
    "eta",
    "parent_id",
  ] as const) {
    const value = body[k];
    if (value !== undefined) updates[k] = value;
  }
  const { data, error } = await db
    .schema("feedback")
    .from("roadmap_nodes")
    .update(updates)
    .eq("node_id", body.node_id)
    .eq("org_id", getOrgId())
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ node: data });
}

export async function DELETE(req: Request) {
  const auth = await requireSuperAdmin(ROUTE);
  if (!auth.ok) return auth.response;

  const parsed = deleteSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "node_id required" }, { status: 400 });
  }
  const { error } = await db
    .schema("feedback")
    .from("roadmap_nodes")
    .delete()
    .eq("node_id", parsed.data.node_id)
    .eq("org_id", getOrgId());
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
