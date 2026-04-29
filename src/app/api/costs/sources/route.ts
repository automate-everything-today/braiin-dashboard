// Cost source registry CRUD.

import { z } from "zod";
import { supabase } from "@/services/base";
import { requireSuperAdmin } from "@/lib/api-auth";
import { getOrgId } from "@/lib/org";

const ROUTE = "/api/costs/sources";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

const upsertSchema = z.object({
  source_id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  vendor: z.string().min(1).max(64),
  category: z.enum(["usage", "build"]),
  provenance: z.enum(["manual", "api"]).default("manual"),
  default_currency: z.string().min(3).max(3).default("GBP"),
  api_config: z.record(z.string(), z.unknown()).default({}),
  pro_rate: z.number().min(0).max(1).default(1.0),
  recurring_monthly: z.number().min(0).max(1_000_000).nullable().optional(),
  started_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  ended_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  is_active: z.boolean().default(true),
});

export async function POST(req: Request) {
  const auth = await requireSuperAdmin(ROUTE);
  if (!auth.ok) return auth.response;
  const parsed = upsertSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }
  const body = parsed.data;
  const row = {
    ...(body.source_id ? { source_id: body.source_id } : {}),
    org_id: getOrgId(),
    name: body.name,
    vendor: body.vendor,
    category: body.category,
    provenance: body.provenance,
    default_currency: body.default_currency,
    api_config: body.api_config,
    pro_rate: body.pro_rate,
    recurring_monthly: body.recurring_monthly ?? null,
    started_at: body.started_at ?? null,
    ended_at: body.ended_at ?? null,
    notes: body.notes ?? null,
    is_active: body.is_active,
  };
  const { data, error } = await db
    .schema("feedback")
    .from("cost_sources")
    .upsert(row, { onConflict: "org_id,name" })
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ source: data });
}

const patchSchema = z.object({
  source_id: z.string().uuid(),
  pro_rate: z.number().min(0).max(1).optional(),
  is_active: z.boolean().optional(),
  recurring_monthly: z.number().min(0).max(1_000_000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  api_config: z.record(z.string(), z.unknown()).optional(),
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
  for (const k of ["pro_rate", "is_active", "recurring_monthly", "notes", "api_config"] as const) {
    const v = body[k];
    if (v !== undefined) updates[k] = v;
  }
  const { data, error } = await db
    .schema("feedback")
    .from("cost_sources")
    .update(updates)
    .eq("source_id", body.source_id)
    .eq("org_id", getOrgId())
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ source: data });
}

const deleteSchema = z.object({ source_id: z.string().uuid() });

export async function DELETE(req: Request) {
  const auth = await requireSuperAdmin(ROUTE);
  if (!auth.ok) return auth.response;
  const parsed = deleteSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "source_id required" }, { status: 400 });
  const { error } = await db
    .schema("feedback")
    .from("cost_sources")
    .delete()
    .eq("source_id", parsed.data.source_id)
    .eq("org_id", getOrgId());
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
