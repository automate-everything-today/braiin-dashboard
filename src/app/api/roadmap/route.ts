import { supabase } from "@/services/base";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };
const ORG_ID = process.env.DEFAULT_ORG_ID ?? process.env.NEXT_PUBLIC_DEFAULT_ORG_ID ?? "00000000-0000-0000-0000-000000000001";

export async function GET() {
  const { data, error } = await db.schema("feedback").from("roadmap_nodes")
    .select("*").eq("org_id", ORG_ID).order("position");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ nodes: data ?? [] });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.title) return Response.json({ error: "title required" }, { status: 400 });
  const { data, error } = await db.schema("feedback").from("roadmap_nodes").insert({
    org_id: ORG_ID,
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
  }).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ node: data });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  if (!body.node_id) return Response.json({ error: "node_id required" }, { status: 400 });
  const updates: Record<string, unknown> = {};
  for (const k of ["title", "rationale", "status", "priority", "area", "position", "tags", "notes", "eta", "parent_id"]) {
    if (body[k] !== undefined) updates[k] = body[k];
  }
  const { data, error } = await db.schema("feedback").from("roadmap_nodes")
    .update(updates).eq("node_id", body.node_id).eq("org_id", ORG_ID).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ node: data });
}

export async function DELETE(req: Request) {
  const { node_id } = await req.json();
  if (!node_id) return Response.json({ error: "node_id required" }, { status: 400 });
  const { error } = await db.schema("feedback").from("roadmap_nodes")
    .delete().eq("node_id", node_id).eq("org_id", ORG_ID);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
