/**
 * /api/system-rules/[id]
 *
 * POST = undo: swaps the rule's value with its previous_value (single-step
 * undo, mirrors spec section 4.6). Returns the updated row. Manager+ only.
 */

import { supabase } from "@/services/base";
import { requireManager } from "@/lib/api-auth";
import { apiError, apiResponse } from "@/lib/validation";

const ROUTE = "/api/system-rules/[id]";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> | { id: string } },
) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  const params = await Promise.resolve(ctx.params);
  const id = parseInt(params.id, 10);
  if (!id) return apiError("Invalid id", 400);

  const { data: row } = await supabase
    .from("system_rules")
    .select("value, previous_value")
    .eq("id", id)
    .maybeSingle();
  if (!row) return apiError("Rule not found", 404);
  if (row.previous_value === null || row.previous_value === undefined) {
    return apiError("No previous_value to undo", 400);
  }

  const { data, error } = await supabase
    .from("system_rules")
    .update({
      value: row.previous_value,
      previous_value: row.value,
      updated_by: auth.session.email,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) return apiError(error.message, 500);
  return apiResponse({ rule: data });
}
