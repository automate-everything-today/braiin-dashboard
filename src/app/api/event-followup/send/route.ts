/**
 * /api/event-followup/send
 *
 * POST: send the persisted draft on a single event_contacts row via Microsoft
 * Graph as the rep tagged in send_from_email.
 *
 * Body: { contact_id: number }
 * Auth: manager / sales_manager / super_admin
 *
 * Pre-conditions:
 *   - follow_up_status must be 'drafted' or 'reviewed' (not 'sent', 'replied' etc.)
 *   - draft_subject + draft_body must be populated
 *   - send_from_email must be a tenant user (rob/sam/bruna)
 *
 * Side effects:
 *   - Calls Graph sendMail
 *   - Persists sent_at, sent_message_id
 *   - Bumps follow_up_status to 'sent'
 *   - On failure: status -> 'bounced', bounce_reason populated
 */

import { z } from "zod";
import { supabase } from "@/services/base";
import { requireManager } from "@/lib/api-auth";
import { apiError, apiResponse, validationError } from "@/lib/validation";
import { sendViaGraph } from "@/lib/event-followup/send-via-graph";

const ROUTE = "/api/event-followup/send";

const sendSchema = z.object({
  contact_id: z.number().int().positive(),
});

const SENDABLE_STATUSES = new Set(["drafted", "reviewed", "queued"]);

interface SendableContact {
  id: number;
  email: string;
  name: string | null;
  draft_subject: string | null;
  draft_body: string | null;
  send_from_email: string | null;
  internal_cc: string | null;
  follow_up_status: string;
}

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const { data, error } = await supabase
    .from("event_contacts")
    .select(
      "id, email, name, draft_subject, draft_body, send_from_email, internal_cc, follow_up_status",
    )
    .eq("id", parsed.data.contact_id)
    .maybeSingle();
  if (error) return apiError(error.message, 500);
  const contact = (data ?? null) as SendableContact | null;
  if (!contact) return apiError("Contact not found", 404);

  if (!SENDABLE_STATUSES.has(contact.follow_up_status)) {
    return apiError(
      `Contact status='${contact.follow_up_status}' is not sendable. Expected one of: ${[...SENDABLE_STATUSES].join(", ")}`,
      409,
    );
  }
  if (!contact.draft_subject || !contact.draft_body) {
    return apiError("Contact has no draft. Generate one first.", 409);
  }
  if (!contact.send_from_email) {
    return apiError("Contact has no send_from_email. Set met_by or override.", 409);
  }

  try {
    const result = await sendViaGraph({
      fromEmail: contact.send_from_email,
      toEmail: contact.email,
      toName: contact.name,
      ccEmails: contact.internal_cc ? [contact.internal_cc] : [],
      subject: contact.draft_subject,
      body: contact.draft_body,
    });

    const { error: updateErr } = await supabase
      .from("event_contacts")
      .update({
        sent_at: result.sentAt,
        sent_message_id: result.messageId,
        follow_up_status: "sent",
      })
      .eq("id", contact.id);
    if (updateErr) {
      // Send went through but we couldn't persist - surface loud.
      return apiError(
        `Send succeeded but state update failed: ${updateErr.message}. Manually mark contact ${contact.id} as 'sent'.`,
        500,
      );
    }

    return apiResponse({ result });
  } catch (e) {
    const reason = e instanceof Error ? e.message : "unknown send error";
    await supabase
      .from("event_contacts")
      .update({
        follow_up_status: "bounced",
        bounce_reason: reason,
        bounced_at: new Date().toISOString(),
      })
      .eq("id", contact.id);
    return apiError(reason, 500);
  }
}
