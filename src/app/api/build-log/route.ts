import { z } from "zod";
import { supabase } from "@/services/base";
import { requireAuth, requireManager } from "@/lib/api-auth";
import { getOrgId } from "@/lib/org";

const ROUTE = "/api/build-log";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

const itemTypeEnum = z.enum(["feature", "fix", "refactor", "docs", "chore", "perf", "ci", "test"]);
const statusEnum = z.enum(["wip", "shipped", "reverted"]);

const createSchema = z.object({
  title: z.string().min(1).max(500),
  summary: z.string().max(20_000).optional().nullable(),
  item_type: itemTypeEnum,
  status: statusEnum.optional(),
  area: z.string().max(64).optional().nullable(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  occurred_at: z.string().optional(),
  commit_sha: z.string().max(64).optional().nullable(),
  commit_message: z.string().max(20_000).optional().nullable(),
  file_paths: z.array(z.string().max(512)).max(500).optional(),
  pr_url: z.string().url().max(2048).optional().nullable(),
  deploy_url: z.string().url().max(2048).optional().nullable(),
  author: z.string().max(200).optional().nullable(),
  linked_change_request: z.string().uuid().optional().nullable(),
  notes: z.string().max(20_000).optional().nullable(),
});

const patchSchema = z.object({
  log_id: z.string().uuid(),
  title: z.string().min(1).max(500).optional(),
  summary: z.string().max(20_000).optional().nullable(),
  status: statusEnum.optional(),
  area: z.string().max(64).optional().nullable(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  notes: z.string().max(20_000).optional().nullable(),
  commit_sha: z.string().max(64).optional().nullable(),
  deploy_url: z.string().url().max(2048).optional().nullable(),
  pr_url: z.string().url().max(2048).optional().nullable(),
});

const deleteSchema = z.object({ log_id: z.string().uuid() });

export async function GET(req: Request) {
  const auth = await requireAuth(ROUTE);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const area = url.searchParams.get("area");
  const itemType = url.searchParams.get("item_type");
  let q = db
    .schema("feedback")
    .from("build_log")
    .select("*")
    .eq("org_id", getOrgId())
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (area) q = q.eq("area", area);
  if (itemType) q = q.eq("item_type", itemType);
  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ entries: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE);
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;
  const { data, error } = await db
    .schema("feedback")
    .from("build_log")
    .insert({
      org_id: getOrgId(),
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
      author: body.author ?? auth.session.email,
      linked_change_request: body.linked_change_request ?? null,
      notes: body.notes ?? null,
    })
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ entry: data });
}

export async function PATCH(req: Request) {
  const auth = await requireManager(ROUTE);
  if (!auth.ok) return auth.response;

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;
  const updates: Record<string, unknown> = {};
  for (const k of [
    "title",
    "summary",
    "status",
    "area",
    "tags",
    "notes",
    "commit_sha",
    "deploy_url",
    "pr_url",
  ] as const) {
    const value = body[k];
    if (value !== undefined) updates[k] = value;
  }
  const { data, error } = await db
    .schema("feedback")
    .from("build_log")
    .update(updates)
    .eq("log_id", body.log_id)
    .eq("org_id", getOrgId())
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ entry: data });
}

export async function DELETE(req: Request) {
  const auth = await requireManager(ROUTE);
  if (!auth.ok) return auth.response;

  const parsed = deleteSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "log_id required" }, { status: 400 });
  }
  const { error } = await db
    .schema("feedback")
    .from("build_log")
    .delete()
    .eq("log_id", parsed.data.log_id)
    .eq("org_id", getOrgId());
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
