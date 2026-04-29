// CRUD for feedback.change_requests + comment append.

import { supabase } from "@/services/base";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

const ORG_ID =
  process.env.DEFAULT_ORG_ID ??
  process.env.NEXT_PUBLIC_DEFAULT_ORG_ID ??
  "00000000-0000-0000-0000-000000000001";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sourcePage = url.searchParams.get("source_page");
  let q = db
    .schema("feedback")
    .from("change_requests")
    .select("*")
    .eq("org_id", ORG_ID)
    .order("created_at", { ascending: false });
  if (sourcePage) q = q.eq("source_page", sourcePage);
  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ requests: data ?? [] });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.title || !body.description) {
    return Response.json({ error: "title + description required" }, { status: 400 });
  }
  const { data, error } = await db
    .schema("feedback")
    .from("change_requests")
    .insert({
      org_id: ORG_ID,
      source_page: body.source_page ?? "unknown",
      title: body.title,
      description: body.description,
      priority: body.priority ?? "medium",
      tags: body.tags ?? [],
      raised_by_name: body.raised_by_name ?? null,
      raised_by_email: body.raised_by_email ?? null,
      attachments: body.attachments ?? [],
    })
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ request: data });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  if (!body.request_id) {
    return Response.json({ error: "request_id required" }, { status: 400 });
  }

  // If a new comment is being appended, fetch existing comments first
  // and concatenate. Same for attachments. Other fields are direct sets.
  const updates: Record<string, unknown> = {};
  for (const k of [
    "status",
    "priority",
    "tags",
    "cto_decision_note",
    "brainstorm_notes",
    "shipped_commit_sha",
    "title",
    "description",
  ]) {
    if (body[k] !== undefined) updates[k] = body[k];
  }
  if (body.status === "approved" && !updates.cto_decided_at) {
    updates.cto_decided_at = new Date().toISOString();
  }
  if (body.status === "shipped" && !updates.shipped_at) {
    updates.shipped_at = new Date().toISOString();
  }
  if (body.status === "in_build" && !updates.build_started_at) {
    updates.build_started_at = new Date().toISOString();
  }

  if (body.append_comment) {
    const { data: existing } = await db
      .schema("feedback")
      .from("change_requests")
      .select("comments")
      .eq("request_id", body.request_id)
      .single();
    const list = (existing?.comments ?? []) as unknown[];
    const next = [
      ...list,
      {
        id: crypto.randomUUID(),
        body: body.append_comment.body,
        kind: body.append_comment.kind ?? "insight",
        by_name: body.append_comment.by_name ?? null,
        by_staff_id: body.append_comment.by_staff_id ?? null,
        at: new Date().toISOString(),
      },
    ];
    updates.comments = next;
  }

  if (body.append_attachment) {
    const { data: existing } = await db
      .schema("feedback")
      .from("change_requests")
      .select("attachments")
      .eq("request_id", body.request_id)
      .single();
    const list = (existing?.attachments ?? []) as unknown[];
    updates.attachments = [...list, body.append_attachment];
  }

  const { data, error } = await db
    .schema("feedback")
    .from("change_requests")
    .update(updates)
    .eq("request_id", body.request_id)
    .eq("org_id", ORG_ID)
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ request: data });
}

export async function DELETE(req: Request) {
  const { request_id } = await req.json();
  if (!request_id) return Response.json({ error: "request_id required" }, { status: 400 });
  const { error } = await db
    .schema("feedback")
    .from("change_requests")
    .delete()
    .eq("request_id", request_id)
    .eq("org_id", ORG_ID);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
