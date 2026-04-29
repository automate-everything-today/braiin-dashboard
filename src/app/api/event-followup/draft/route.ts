/**
 * /api/event-followup/draft
 *
 * POST: generate a draft for one event_contacts row (or a batch by event_id).
 *   Body: { contact_id: number } | { event_id: number, limit?: number }
 *   Auth: manager / sales_manager / super_admin
 *
 * Persists draft_subject + draft_body + draft_generated_at + draft_model
 * onto event_contacts and bumps follow_up_status from 'pending' -> 'drafted'.
 *
 * Skips contacts already past 'pending' (they have an explicit state -
 * already_engaged, drafted, sent, etc.). Forces a redraft only with
 * { contact_id, force: true }.
 */

import { z } from "zod";
import { supabase } from "@/services/base";
import { requireManager } from "@/lib/api-auth";
import { apiError, apiResponse, validationError } from "@/lib/validation";
import { generateDraft, type DraftInput } from "@/lib/event-followup/generate-draft";

const ROUTE = "/api/event-followup/draft";

const singleSchema = z.object({
  contact_id: z.number().int().positive(),
  force: z.boolean().optional().default(false),
});

const batchSchema = z.object({
  event_id: z.number().int().positive(),
  limit: z.number().int().positive().max(100).optional().default(10),
});

const REP_FIRST_NAMES: Record<string, string> = {
  "rob.donald@cortenlogistics.com": "Rob",
  "sam.yauner@cortenlogistics.com": "Sam",
  "bruna.natale@cortenlogistics.com": "Bruna",
};

const REP_NAME_TO_EMAIL: Record<string, string> = {
  Rob: "rob.donald@cortenlogistics.com",
  Sam: "sam.yauner@cortenlogistics.com",
  Bruna: "bruna.natale@cortenlogistics.com",
};

/**
 * Pick the sending rep email from the met_by array. Handles both:
 *   - Raw Airtable values: ["Rob","Bruna","GKF Directory","Business Card"]
 *   - Legacy email-only values from earlier imports: ["rob.donald@cortenlogistics.com"]
 *
 * Returns the first person it can resolve, falling back to Rob if nothing
 * usable is in the array.
 */
function pickRep(metBy: string[] | null | undefined): string {
  if (metBy && metBy.length > 0) {
    for (const v of metBy) {
      if (REP_NAME_TO_EMAIL[v]) return REP_NAME_TO_EMAIL[v];
      if (v.includes("@") && REP_FIRST_NAMES[v.toLowerCase()]) {
        return v.toLowerCase();
      }
    }
  }
  return "rob.donald@cortenlogistics.com";
}

interface ContactRow {
  id: number;
  email: string;
  name: string | null;
  title: string | null;
  company: string | null;
  company_type: string | null;
  company_info: string | null;
  country: string | null;
  region: string | null;
  meeting_notes: string | null;
  met_by: string[] | null;
  internal_cc: string | null;
  tier: number | null;
  follow_up_status: string;
  event_id: number | null;
  events: { name: string; location: string | null; start_date: string } | null;
}

async function loadContact(contactId: number): Promise<ContactRow | null> {
  // Two queries instead of FK-joined select - PostgREST relationship inference
  // requires the FK to be declared in the generated types. See import/route.ts
  // for the same pattern.
  const { data: contact, error } = await supabase
    .from("event_contacts")
    .select(
      "id, email, name, title, company, company_type, company_info, country, region, meeting_notes, met_by, internal_cc, tier, follow_up_status, event_id",
    )
    .eq("id", contactId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!contact) return null;

  type ContactBase = Omit<ContactRow, "events">;
  const base = contact as ContactBase;
  if (!base.event_id) {
    return { ...base, events: null };
  }

  const { data: event } = await supabase
    .from("events")
    .select("name, location, start_date")
    .eq("id", base.event_id)
    .maybeSingle();
  return {
    ...base,
    events: event
      ? (event as { name: string; location: string | null; start_date: string })
      : null,
  };
}

async function draftOne(contactId: number, force: boolean): Promise<{
  contact_id: number;
  status: "drafted" | "skipped" | "error";
  message?: string;
}> {
  const contact = await loadContact(contactId);
  if (!contact) return { contact_id: contactId, status: "error", message: "not found" };

  if (!force && contact.follow_up_status !== "pending") {
    return {
      contact_id: contactId,
      status: "skipped",
      message: `status='${contact.follow_up_status}' (use force=true to redraft)`,
    };
  }
  if (!contact.events) {
    return { contact_id: contactId, status: "error", message: "contact has no event" };
  }

  const repEmail = pickRep(contact.met_by);
  const repFirstName = REP_FIRST_NAMES[repEmail] ?? "the team";

  const ccEmails: string[] = [];
  if (contact.internal_cc && contact.internal_cc !== repEmail) {
    ccEmails.push(contact.internal_cc);
  }

  const input: DraftInput = {
    contact_id: contact.id,
    contact_name: contact.name,
    contact_email: contact.email,
    title: contact.title,
    company: contact.company,
    company_type: contact.company_type,
    company_info: contact.company_info,
    country: contact.country,
    region: contact.region,
    meeting_notes: contact.meeting_notes,
    met_by_raw: contact.met_by ?? [],
    event_name: contact.events.name,
    event_location: contact.events.location,
    event_start: contact.events.start_date,
    tier: contact.tier,
    rep_email: repEmail,
    rep_first_name: repFirstName,
    cc_emails: ccEmails,
  };

  const draft = await generateDraft(input);

  const { error: updateErr } = await supabase
    .from("event_contacts")
    .update({
      draft_subject: draft.subject,
      draft_body: draft.body,
      draft_generated_at: new Date().toISOString(),
      draft_model: "claude-sonnet-4-6",
      follow_up_status: "drafted",
      send_from_email: repEmail,
    })
    .eq("id", contactId);
  if (updateErr) {
    return { contact_id: contactId, status: "error", message: updateErr.message };
  }

  return { contact_id: contactId, status: "drafted" };
}

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body) return apiError("Request body required", 400);

  // Single-contact mode.
  const single = singleSchema.safeParse(body);
  if (single.success) {
    try {
      const result = await draftOne(single.data.contact_id, single.data.force);
      return apiResponse({ result });
    } catch (e) {
      return apiError(e instanceof Error ? e.message : "Draft failed", 500);
    }
  }

  // Batch mode.
  const batch = batchSchema.safeParse(body);
  if (!batch.success) return validationError(batch.error);

  const { data, error } = await supabase
    .from("event_contacts")
    .select("id")
    .eq("event_id", batch.data.event_id)
    .eq("follow_up_status", "pending")
    .order("tier", { ascending: true, nullsFirst: false })
    .limit(batch.data.limit);
  if (error) return apiError(error.message, 500);

  const ids = ((data ?? []) as Array<{ id: number }>).map((r) => r.id);
  const results = [];
  for (const id of ids) {
    try {
      results.push(await draftOne(id, false));
    } catch (e) {
      results.push({
        contact_id: id,
        status: "error" as const,
        message: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  return apiResponse({
    event_id: batch.data.event_id,
    drafted: results.filter((r) => r.status === "drafted").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  });
}
