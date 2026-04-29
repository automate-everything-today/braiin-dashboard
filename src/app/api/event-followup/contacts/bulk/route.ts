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

  // Per-row updates so unique-constraint collisions on (email, event_id)
  // (e.g. two Airtable contacts sharing an info@company.com mailbox both
  // targeted at the same event) only fail the offending row, not the whole
  // batch.
  //
  // Collision recovery: when a needs_attention row's email is already
  // represented at the target event, the existing row WINS - we delete
  // the duplicate needs_attention entry rather than fail. The operator
  // gets a clean bulk-assign that drains the pile, with a count of how
  // many rows were merged-away vs newly assigned.
  const updatedIds: number[] = [];
  const mergedAwayIds: number[] = [];
  const failed: Array<{ id: number; reason: string }> = [];

  for (const id of ids) {
    const { error } = await supabase
      .from("event_contacts")
      .update(payload)
      .eq("id", id);
    if (!error) {
      updatedIds.push(id);
      continue;
    }
    if (error.message.includes("event_contacts_email_event_uniq")) {
      // Email already represented at the target event: drop the duplicate.
      const { error: delErr } = await supabase
        .from("event_contacts")
        .delete()
        .eq("id", id);
      if (delErr) {
        failed.push({ id, reason: `Could not merge-delete duplicate: ${delErr.message}` });
      } else {
        mergedAwayIds.push(id);
      }
      continue;
    }
    failed.push({ id, reason: error.message });
  }

  return apiResponse({
    updated: updatedIds.length,
    merged_away: mergedAwayIds.length,
    failed_count: failed.length,
    failed,
    ids: updatedIds,
    merged_away_ids: mergedAwayIds,
  });
}
