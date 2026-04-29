/**
 * /api/event-followup/contacts
 *
 * GET ?event_id={id}           list contacts for an event
 * GET ?status=needs_attention  list all contacts with needs_attention status (event_id IS NULL)
 * PATCH                        update one contact (draft edits, status overrides)
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
  "needs_attention",
] as const;

const patchSchema = z.object({
  id: z.number().int().positive(),
  draft_subject: z.string().max(500).optional(),
  draft_body: z.string().max(20000).optional(),
  follow_up_status: z.enum(STATUSES).optional(),
  send_from_email: z.string().email().optional(),
  met_by: z.array(z.string()).max(10).optional(),
  meeting_notes: z.string().max(5000).nullable().optional(),
  company_info: z.string().max(5000).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  company_type: z.string().max(100).nullable().optional(),
  tier: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  event_id: z.number().int().positive().nullable().optional(),
  attention_reason: z.string().max(200).nullable().optional(),
});

export async function GET(req: Request) {
  const auth = await requireAuth(ROUTE, req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const eventId = parseInt(url.searchParams.get("event_id") || "0", 10);

  // Needs-attention pile: contacts with event_id IS NULL
  if (statusParam === "needs_attention") {
    const contactsRes = await supabase
      .from("event_contacts")
      .select(
        "id, email, name, title, company, company_type, country, region, tier, met_by, meeting_notes, company_info, follow_up_status, attention_reason, draft_subject, draft_body, send_from_email, engagement_summary, last_inbound_at, sent_at, sent_message_id, replied_at, bounced_at, bounce_reason, event_id",
      )
      .eq("follow_up_status", "needs_attention")
      .order("attention_reason", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true });
    if (contactsRes.error) return apiError(contactsRes.error.message, 500);
    const contacts = (contactsRes.data ?? []).map((c) => ({
      ...c,
      events: null,
    }));
    return apiResponse({ contacts });
  }

  if (!eventId) return apiError("event_id required", 400);

  // Two queries instead of FK-joined select. See import/route.ts comment.
  const [contactsRes, eventRes] = await Promise.all([
    supabase
      .from("event_contacts")
      .select(
        "id, email, name, title, company, company_type, country, region, tier, met_by, meeting_notes, company_info, follow_up_status, attention_reason, draft_subject, draft_body, send_from_email, engagement_summary, last_inbound_at, sent_at, sent_message_id, replied_at, bounced_at, bounce_reason, event_id",
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
  if (updates.met_by !== undefined) payload.met_by = updates.met_by;
  if (updates.meeting_notes !== undefined) payload.meeting_notes = updates.meeting_notes;
  if (updates.company_info !== undefined) payload.company_info = updates.company_info;
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.company_type !== undefined) payload.company_type = updates.company_type;
  if (updates.tier !== undefined) payload.tier = updates.tier;
  if (updates.event_id !== undefined) payload.event_id = updates.event_id;
  if (updates.attention_reason !== undefined) payload.attention_reason = updates.attention_reason;
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
