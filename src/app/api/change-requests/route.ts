// CRUD for feedback.change_requests + comment append.

import { z } from "zod";
import { supabase } from "@/services/base";
import { requireAuth, requireManager } from "@/lib/api-auth";
import { getOrgId } from "@/lib/org";

const ROUTE = "/api/change-requests";

// Bucket prefix used to validate attachment URLs - the only place attachments
// should ever come from is the change-request-attachments storage bucket.
// This is a defence-in-depth: the upload route already validates content
// type / size, but the PATCH `append_attachment` path is also publicly
// reachable so we re-validate here.
const STORAGE_BUCKET = "change-request-attachments";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

const attachmentSchema = z.object({
  url: z
    .string()
    .url()
    .max(2048)
    .refine((u) => u.includes(`/${STORAGE_BUCKET}/`), {
      message: `attachment url must be in the ${STORAGE_BUCKET} bucket`,
    }),
  filename: z.string().min(1).max(255),
  content_type: z.string().min(1).max(128),
  size: z.number().int().min(0).max(10 * 1024 * 1024),
  uploaded_at: z.string().optional(),
});

const commentSchema = z.object({
  body: z.string().min(1).max(10_000),
  kind: z.enum(["insight", "question", "decision", "update"]).default("insight"),
  by_name: z.string().max(200).nullable().optional(),
  by_staff_id: z.number().int().nullable().optional(),
});

const createSchema = z.object({
  source_page: z.string().max(2048).optional(),
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(20_000),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  tags: z.array(z.string().max(64)).max(50).default([]),
  raised_by_name: z.string().max(200).optional().nullable(),
  raised_by_email: z.string().email().max(320).optional().nullable(),
  attachments: z.array(attachmentSchema).max(20).default([]),
});

const patchSchema = z.object({
  request_id: z.string().uuid(),
  status: z
    .enum([
      "new",
      "reviewing",
      "brainstorming",
      "approved",
      "in_build",
      "shipped",
      "rejected",
      "parked",
    ])
    .optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  cto_decision_note: z.string().max(20_000).optional(),
  brainstorm_notes: z.string().max(50_000).optional(),
  shipped_commit_sha: z.string().max(64).optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().min(1).max(20_000).optional(),
  append_comment: commentSchema.optional(),
  append_attachment: attachmentSchema.optional(),
});

const deleteSchema = z.object({ request_id: z.string().uuid() });

export async function GET(req: Request) {
  const auth = await requireAuth(ROUTE);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const sourcePage = url.searchParams.get("source_page");
  let q = db
    .schema("feedback")
    .from("change_requests")
    .select("*")
    .eq("org_id", getOrgId())
    .order("created_at", { ascending: false });
  if (sourcePage) q = q.eq("source_page", sourcePage);
  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ requests: data ?? [] });
}

export async function POST(req: Request) {
  // Any authenticated staff member can raise a change request from any /dev
  // page - that's the whole point of the floating widget.
  const auth = await requireAuth(ROUTE);
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

  const { data, error } = await db
    .schema("feedback")
    .from("change_requests")
    .insert({
      org_id: getOrgId(),
      source_page: body.source_page ?? "unknown",
      title: body.title,
      description: body.description,
      priority: body.priority,
      tags: body.tags,
      raised_by_name: body.raised_by_name ?? auth.session.name ?? null,
      raised_by_email: body.raised_by_email ?? auth.session.email ?? null,
      raised_by_staff_id: auth.session.staff_id ?? null,
      attachments: body.attachments,
    })
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ request: data });
}

export async function PATCH(req: Request) {
  // Status transitions and CTO notes are management actions.
  const auth = await requireManager(ROUTE);
  if (!auth.ok) return auth.response;

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;

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
  ] as const) {
    const value = body[k];
    if (value !== undefined) updates[k] = value;
  }
  if (body.status === "approved") updates.cto_decided_at = new Date().toISOString();
  if (body.status === "shipped") updates.shipped_at = new Date().toISOString();
  if (body.status === "in_build") updates.build_started_at = new Date().toISOString();

  if (body.append_comment) {
    const { data: existing } = await db
      .schema("feedback")
      .from("change_requests")
      .select("comments")
      .eq("request_id", body.request_id)
      .single();
    const list = (existing?.comments ?? []) as unknown[];
    updates.comments = [
      ...list,
      {
        id: crypto.randomUUID(),
        body: body.append_comment.body,
        kind: body.append_comment.kind,
        by_name: body.append_comment.by_name ?? auth.session.name,
        by_staff_id: body.append_comment.by_staff_id ?? auth.session.staff_id,
        at: new Date().toISOString(),
      },
    ];
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
    .eq("org_id", getOrgId())
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ request: data });
}

export async function DELETE(req: Request) {
  const auth = await requireManager(ROUTE);
  if (!auth.ok) return auth.response;

  const parsed = deleteSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "request_id required" }, { status: 400 });
  }
  const { error } = await db
    .schema("feedback")
    .from("change_requests")
    .delete()
    .eq("request_id", parsed.data.request_id)
    .eq("org_id", getOrgId());
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
