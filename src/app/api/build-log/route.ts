import { supabase } from "@/services/base";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };
const ORG_ID =
  process.env.DEFAULT_ORG_ID ??
  process.env.NEXT_PUBLIC_DEFAULT_ORG_ID ??
  "00000000-0000-0000-0000-000000000001";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const area = url.searchParams.get("area");
  const itemType = url.searchParams.get("item_type");
  let q = db
    .schema("feedback")
    .from("build_log")
    .select("*")
    .eq("org_id", ORG_ID)
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (area) q = q.eq("area", area);
  if (itemType) q = q.eq("item_type", itemType);
  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ entries: data ?? [] });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.title || !body.item_type) {
    return Response.json({ error: "title + item_type required" }, { status: 400 });
  }
  const { data, error } = await db
    .schema("feedback")
    .from("build_log")
    .insert({
      org_id: ORG_ID,
      title: body.title,
      summary: body.summary ?? null,
      item_type: body.item_type,
      status: body.status ?? "shipped",
      area: body.area ?? null,
      tags: body.tags ?? [],
      occurred_at: body.occurred_at ?? new Date().toISOString(),
      commit_sha: body.commit_sha ?? null,
      commit_message: body.commit_message ?? null,
      file_paths: body.file_paths ?? [],
      pr_url: body.pr_url ?? null,
      deploy_url: body.deploy_url ?? null,
      author: body.author ?? null,
      linked_change_request: body.linked_change_request ?? null,
      notes: body.notes ?? null,
    })
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ entry: data });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  if (!body.log_id) return Response.json({ error: "log_id required" }, { status: 400 });
  const updates: Record<string, unknown> = {};
  for (const k of ["title", "summary", "status", "area", "tags", "notes", "commit_sha", "deploy_url", "pr_url"]) {
    if (body[k] !== undefined) updates[k] = body[k];
  }
  const { data, error } = await db
    .schema("feedback")
    .from("build_log")
    .update(updates)
    .eq("log_id", body.log_id)
    .eq("org_id", ORG_ID)
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ entry: data });
}

export async function DELETE(req: Request) {
  const { log_id } = await req.json();
  if (!log_id) return Response.json({ error: "log_id required" }, { status: 400 });
  const { error } = await db
    .schema("feedback")
    .from("build_log")
    .delete()
    .eq("log_id", log_id)
    .eq("org_id", ORG_ID);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
