/**
 * /api/event-followup/contacts/merge
 *
 * POST  body: { source_id, target_id }
 *       Merges enrichment fields from source (typically a needs_attention
 *       duplicate) into target (an existing event_contacts row at the
 *       same company), then deletes source. Fills target fields ONLY
 *       where target is currently null/empty - never overwrites real data.
 *
 * Auth: manager+.
 */

import { z } from "zod";
import { supabase } from "@/services/base";
import { requireManager } from "@/lib/api-auth";
import { apiError, apiResponse, validationError } from "@/lib/validation";

const ROUTE = "/api/event-followup/contacts/merge";

const inputSchema = z.object({
  source_id: z.number().int().positive(),
  target_id: z.number().int().positive(),
});

const MERGE_FIELDS = [
  "title",
  "company_type",
  "country",
  "region",
  "tier",
  "meeting_notes",
  "company_info",
  "phone",
  "website",
] as const;

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  const { source_id, target_id } = parsed.data;
  if (source_id === target_id) return apiError("source_id and target_id must differ", 400);

  const { data: rows, error: readErr } = await supabase
    .from("event_contacts")
    .select("*")
    .in("id", [source_id, target_id]);
  if (readErr) return apiError(readErr.message, 500);
  if (!rows || rows.length !== 2) return apiError("Source or target not found", 404);

  const source = rows.find((r) => r.id === source_id) as Record<string, unknown>;
  const target = rows.find((r) => r.id === target_id) as Record<string, unknown>;

  // Build patch: fill target fields only where they're currently empty.
  const patch: Record<string, unknown> = {};
  for (const field of MERGE_FIELDS) {
    const tVal = target[field];
    const sVal = source[field];
    if ((tVal === null || tVal === undefined || tVal === "") && sVal != null && sVal !== "") {
      patch[field] = sVal;
    }
  }

  // met_by is an array - union both arrays, dedupe.
  const tMetBy = Array.isArray(target.met_by) ? (target.met_by as string[]) : [];
  const sMetBy = Array.isArray(source.met_by) ? (source.met_by as string[]) : [];
  const mergedMetBy = Array.from(new Set([...tMetBy, ...sMetBy]));
  if (mergedMetBy.length > tMetBy.length) {
    patch.met_by = mergedMetBy;
  }

  // data_source_tags - union and dedupe.
  const tTags = Array.isArray(target.data_source_tags) ? (target.data_source_tags as string[]) : [];
  const sTags = Array.isArray(source.data_source_tags) ? (source.data_source_tags as string[]) : [];
  const mergedTags = Array.from(new Set([...tTags, ...sTags]));
  if (mergedTags.length > tTags.length) {
    patch.data_source_tags = mergedTags;
  }

  if (Object.keys(patch).length > 0) {
    const { error: updErr } = await supabase
      .from("event_contacts")
      .update(patch)
      .eq("id", target_id);
    if (updErr) return apiError(`Update target failed: ${updErr.message}`, 500);
  }

  const { error: delErr } = await supabase
    .from("event_contacts")
    .delete()
    .eq("id", source_id);
  if (delErr) return apiError(`Delete source failed: ${delErr.message}`, 500);

  return apiResponse({
    merged: true,
    target_id,
    source_id,
    fields_merged: Object.keys(patch),
  });
}
