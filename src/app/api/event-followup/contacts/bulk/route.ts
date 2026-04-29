/**
 * /api/event-followup/contacts/bulk
 *
 * POST  apply the same patch to many contact rows at once. Used by the
 *       needs_attention pile to assign N records to an event in one
 *       action, or to mark N records as junk.
 *
 * Auth: manager+. Same allowed fields as the single-row PATCH.
 */

import { z } from "zod";
import { supabase } from "@/services/base";
import { requireManager } from "@/lib/api-auth";
import { apiError, apiResponse, validationError } from "@/lib/validation";

const ROUTE = "/api/event-followup/contacts/bulk";

const STATUSES = [
  "pending",
  "already_engaged",
  "drafted",
  "reviewed",
  "queued",
  "sent",
  "replied",
  "bounced",
  "opted_out",
  "cancelled",
  "needs_attention",
] as const;

const bulkSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  event_id: z.number().int().positive().nullable().optional(),
  follow_up_status: z.enum(STATUSES).optional(),
  attention_reason: z.string().max(200).nullable().optional(),
  tier: z.number().int().min(1).max(5).nullable().optional(),
}).refine(
  (d) =>
    d.event_id !== undefined ||
    d.follow_up_status !== undefined ||
    d.attention_reason !== undefined ||
    d.tier !== undefined,
  "At least one field to update is required",
);

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const { ids, ...updates } = parsed.data;
  const payload: Record<string, unknown> = {};
  if (updates.event_id !== undefined) payload.event_id = updates.event_id;
  if (updates.follow_up_status !== undefined) payload.follow_up_status = updates.follow_up_status;
  if (updates.attention_reason !== undefined) payload.attention_reason = updates.attention_reason;
  if (updates.tier !== undefined) payload.tier = updates.tier;

  const { data, error, count } = await supabase
    .from("event_contacts")
    .update(payload, { count: "exact" })
    .in("id", ids)
    .select("id");

  if (error) return apiError(error.message, 500);
  return apiResponse({ updated: count ?? data?.length ?? 0, ids: data?.map((r) => r.id) ?? [] });
}
