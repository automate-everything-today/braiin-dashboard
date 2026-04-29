/**
 * "Already engaged" scanner for event follow-up contacts.
 *
 * For each event_contacts row, query email_classifications to see if this
 * contact has emailed any of our 3 reps since the event start date. If yes,
 * flag the row as 'already_engaged' so it gets a different (lighter) treatment
 * than a cold conference follow-up.
 *
 * Per scoping decision (2026-04-30):
 *   - Match: contact-level (exact email)
 *   - Direction: both inbound and outbound
 *   - Threshold: 1 email = engaged
 *   - Window: from event start_date forward
 *
 * v1 limitation - outbound coverage:
 *   email_classifications indexes INBOUND mail across all three Corten
 *   mailboxes (Rob, Sam, Bruna). It does NOT index outbound. Until tenant
 *   admin consent is granted on Corten 365, we cannot search Sam/Bruna's
 *   Sent Items via Graph.
 *
 *   v1 behaviour: inbound-only scan. Operator can manually flag a contact
 *   as 'already_engaged' in the review UI if they spot an active outbound
 *   thread the scanner missed.
 *
 *   v2 (post-tenant-consent): extend scanner with Graph search on each rep's
 *   Sent Items for the contact email. Flagged as TODO-OUTBOUND-SCAN below.
 *
 * Performance:
 *   For 400 contacts -> ~400 queries against email_classifications. Bounded
 *   by an index on lower(from_email) which already exists per usage in
 *   classify-email/route.ts. If the table grows past 1M rows we may want
 *   to batch-fetch and join in memory; for now keep it simple.
 */

import { supabase } from "@/services/base";

export interface EngagementCheck {
  contact_id: number;
  email: string;
  event_id: number;
  event_start: string;
  last_inbound_at: string | null;
  inbound_count: number;
  is_engaged: boolean;
  summary: string | null;
}

/**
 * Run the already-engaged check for one contact + event combination.
 * Returns the engagement signal but does NOT write to the database; caller
 * decides whether to update follow_up_status or just expose the signal.
 */
export async function checkEngagement(params: {
  contact_id: number;
  email: string;
  event_id: number;
  event_start: string;
}): Promise<EngagementCheck> {
  const { contact_id, email, event_id, event_start } = params;

  const { data, error } = await supabase
    .from("email_classifications")
    .select("from_email, created_at, ai_category, user_override_category")
    .eq("from_email", email.toLowerCase())
    .gte("created_at", event_start)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(`engagement scan failed for ${email}: ${error.message}`);
  }

  type Row = {
    from_email: string | null;
    created_at: string;
    ai_category: string | null;
    user_override_category: string | null;
  };
  const rows = (data ?? []) as Row[];
  const lastInbound = rows[0]?.created_at ?? null;
  const inboundCount = rows.length;
  const isEngaged = inboundCount >= 1;

  // Human summary for the review UI: "3 inbound emails since 2026-04-12,
  // most recent 2026-04-22 tagged quote_request"
  let summary: string | null = null;
  if (isEngaged && lastInbound) {
    const lastCategory =
      rows[0].user_override_category ?? rows[0].ai_category ?? "uncategorised";
    const dateOnly = lastInbound.split("T")[0];
    const sinceDate = event_start.split("T")[0];
    summary = `${inboundCount} inbound email${inboundCount === 1 ? "" : "s"} since ${sinceDate}, most recent ${dateOnly} (${lastCategory})`;
  }

  return {
    contact_id,
    email,
    event_id,
    event_start,
    last_inbound_at: lastInbound,
    inbound_count: inboundCount,
    is_engaged: isEngaged,
    summary,
  };
}

/**
 * Run engagement checks for every pending contact in an event and write the
 * results back to event_contacts (last_inbound_at, engagement_summary,
 * follow_up_status).
 *
 * Only contacts with follow_up_status='pending' are processed. Contacts
 * already past 'pending' (drafted/queued/sent/etc.) keep their state.
 */
export async function scanEventEngagement(eventId: number): Promise<{
  scanned: number;
  flagged_engaged: number;
  errors: string[];
}> {
  // Look up event start date.
  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id, name, start_date")
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr || !event) {
    throw new Error(`event ${eventId} not found: ${eventErr?.message ?? "no row"}`);
  }
  const eventStart = (event as { start_date: string }).start_date;

  // Pull all pending contacts for this event.
  const { data: contacts, error } = await supabase
    .from("event_contacts")
    .select("id, email, event_id")
    .eq("event_id", eventId)
    .eq("follow_up_status", "pending");
  if (error) throw new Error(`contacts load failed: ${error.message}`);

  type ContactRow = { id: number; email: string; event_id: number };
  const rows = (contacts ?? []) as ContactRow[];
  const errors: string[] = [];
  let flaggedEngaged = 0;

  for (const row of rows) {
    try {
      const check = await checkEngagement({
        contact_id: row.id,
        email: row.email,
        event_id: row.event_id,
        event_start: eventStart,
      });

      const updates: Record<string, unknown> = {
        last_inbound_at: check.last_inbound_at,
        engagement_summary: check.summary,
      };
      if (check.is_engaged) {
        updates.follow_up_status = "already_engaged";
        flaggedEngaged += 1;
      }

      const { error: updateErr } = await supabase
        .from("event_contacts")
        .update(updates)
        .eq("id", row.id);
      if (updateErr) {
        errors.push(`update ${row.email}: ${updateErr.message}`);
      }
    } catch (e) {
      errors.push(`${row.email}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  return {
    scanned: rows.length,
    flagged_engaged: flaggedEngaged,
    errors,
  };
}
