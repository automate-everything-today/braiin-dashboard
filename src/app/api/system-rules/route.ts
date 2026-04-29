/**
 * /api/system-rules
 *
 * Operator-configurable system rules engine. Mirrors the voice_rules pattern.
 *
 * GET ?category=...   list rules in a category, or all if no filter.
 *                     Auth: any authenticated staff.
 * POST                 upsert a rule (insert if new, update with previous_value
 *                     snapshot if existing). Auth: manager+. Validates the
 *                     submitted value against the per-category Zod schema.
 */

import { z } from "zod";
import { supabase } from "@/services/base";
import { requireAuth, requireManager } from "@/lib/api-auth";
import { apiError, apiResponse, validationError } from "@/lib/validation";
import { SCHEMA_BY_CATEGORY, type SystemRuleCategory } from "@/lib/system-rules/schemas";

const ROUTE = "/api/system-rules";

export async function GET(req: Request) {
  const auth = await requireAuth(ROUTE, req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const category = url.searchParams.get("category");

  let q = supabase
    .from("system_rules")
    .select("id, category, key, value, previous_value, notes, active, updated_at, updated_by");
  if (category) q = q.eq("category", category);

  const { data, error } = await q.order("category").order("key");
  if (error) return apiError(error.message, 500);
  return apiResponse({ rules: data });
}

const upsertSchema = z.object({
  category: z.string().min(1),
  key: z.string().min(1),
  value: z.unknown(),
  notes: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const schema = SCHEMA_BY_CATEGORY[parsed.data.category as SystemRuleCategory];
  if (!schema) {
    return apiError(`Unknown category: ${parsed.data.category}`, 400);
  }
  const valid = schema.safeParse(parsed.data.value);
  if (!valid.success) {
    return apiError(
      `Invalid value for ${parsed.data.category}: ${valid.error.message}`,
      400,
    );
  }

  const { data: existing } = await supabase
    .from("system_rules")
    .select("id, value")
    .eq("category", parsed.data.category)
    .eq("key", parsed.data.key)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("system_rules")
      .update({
        value: valid.data,
        previous_value: existing.value,
        notes: parsed.data.notes ?? null,
        updated_by: auth.session.email,
      })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) return apiError(error.message, 500);
    return apiResponse({ rule: data });
  }

  const { data, error } = await supabase
    .from("system_rules")
    .insert({
      category: parsed.data.category,
      key: parsed.data.key,
      value: valid.data,
      notes: parsed.data.notes ?? null,
      updated_by: auth.session.email,
    })
    .select()
    .single();
  if (error) return apiError(error.message, 500);
  return apiResponse({ rule: data });
}
