/**
 * /api/event-followup/contacts
 *
 * GET ?event_id={id}    list contacts for an event
 * PATCH                 update one contact (draft edits, status overrides)
 *
 * Auth: GET = any authenticated staff. PATCH = manager+.
 */

import { z } from "zod";
import { supabase } from "@/services/base";
import { requireAuth, requireManager } from "@/lib/api-auth";
import { apiError, apiResponse, validationError } from "@/lib/validation";

const ROUTE = "/api/event-followup/contacts";

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
] as const;

const patchSchema = z.object({
  id: z.number().int().positive(),
  draft_subject: z.string().max(500).optional(),
  draft_body: z.string().max(20000).optional(),
  follow_up_status: z.enum(STATUSES).optional(),
  send_from_email: z.string().email().optional(),
  tier: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function GET(req: Request) {
  const auth = await requireAuth(ROUTE, req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const eventId = parseInt(url.searchParams.get("event_id") || "0", 10);
  if (!eventId) return apiError("event_id required", 400);

  // Two queries instead of FK-joined select. See import/route.ts comment.
  const [contactsRes, eventRes] = await Promise.all([
    supabase
      .from("event_contacts")
      .select(
        "id, email, name, company, country, region, tier, met_by, follow_up_status, draft_subject, draft_body, send_from_email, engagement_summary, last_inbound_at, sent_at, sent_message_id, replied_at, bounced_at, bounce_reason, event_id",
      )
      .eq("event_id", eventId)
      .order("tier", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true }),
    supabase.from("events").select("id, name").eq("id", eventId).maybeSingle(),
  ]);
  if (contactsRes.error) return apiError(contactsRes.error.message, 500);
  if (eventRes.error) return apiError(eventRes.error.message, 500);

  const eventInfo = eventRes.data
    ? (eventRes.data as { id: number; name: string })
    : null;
  const contacts = (contactsRes.data ?? []).map((c) => ({
    ...c,
    events: eventInfo,
  }));

  return apiResponse({ contacts });
}

export async function PATCH(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  const { id, ...updates } = parsed.data;

  const payload: Record<string, unknown> = {};
  if (updates.draft_subject !== undefined) payload.draft_subject = updates.draft_subject;
  if (updates.draft_body !== undefined) payload.draft_body = updates.draft_body;
  if (updates.follow_up_status !== undefined) payload.follow_up_status = updates.follow_up_status;
  if (updates.send_from_email !== undefined) payload.send_from_email = updates.send_from_email;
  if (updates.tier !== undefined) payload.tier = updates.tier;
  if (Object.keys(payload).length === 0) return apiError("No fields to update", 400);

  const { data, error } = await supabase
    .from("event_contacts")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) return apiError(error.message, 500);
  return apiResponse({ contact: data });
}
