/**
 * /api/event-followup/import
 *
 * Pulls all records from the Airtable "Networking - Follow ups" base and
 * upserts them into event_contacts. One-way sync (Airtable -> Braiin).
 *
 * POST (manual trigger):
 *   - Auth: manager / sales_manager / super_admin
 *   - Returns the ImportResult so the operator can see what landed
 *
 * GET (status / dry-run):
 *   - Auth: any authenticated staff
 *   - Returns the row counts currently in event_contacts grouped by event,
 *     so the dashboard can show "X contacts loaded" per event without
 *     hitting Airtable.
 *
 * Cron: a separate cron handler can call importEventContacts() directly;
 * not wired in this iteration.
 */

import { randomUUID } from "node:crypto";
import { supabase } from "@/services/base";
import { requireAuth, requireManager } from "@/lib/api-auth";
import { apiError, apiResponse } from "@/lib/validation";
import { importEventContacts } from "@/lib/airtable/event-contacts";
import { loadRulesSnapshot } from "@/lib/system-rules/load";
import { importGranolaForEvent, type GranolaImportResult } from "@/lib/event-followup/granola-import";
import { defaultGranolaClient } from "@/lib/event-followup/granola-clients";

const ROUTE = "/api/event-followup/import";

export async function GET(req: Request) {
  const auth = await requireAuth(ROUTE, req);
  if (!auth.ok) return auth.response;

  // Pull ALL active events first, then layer contact counts on top. This way
  // an event with zero contacts still shows in the selector so the operator
  // can click "Import from Airtable" and see the event ready to receive them.
  const [eventsRes, contactsRes] = await Promise.all([
    supabase
      .from("events")
      .select("id, name, active")
      .eq("active", true)
      .order("start_date", { ascending: false }),
    supabase
      .from("event_contacts")
      .select("event_id, follow_up_status")
      .order("event_id", { ascending: true }),
  ]);
  if (eventsRes.error) return apiError(eventsRes.error.message, 500);
  if (contactsRes.error) return apiError(contactsRes.error.message, 500);

  // Seed the summary with one entry per event, total=0, status counts empty.
  const summary: Record<
    string,
    { event_id: number; event_name: string; total: number; by_status: Record<string, number> }
  > = {};
  for (const e of (eventsRes.data ?? []) as Array<{ id: number; name: string }>) {
    summary[String(e.id)] = {
      event_id: e.id,
      event_name: e.name,
      total: 0,
      by_status: {},
    };
  }

  // Layer in the contact counts.
  for (const row of (contactsRes.data ?? []) as Array<{
    event_id: number | null;
    follow_up_status: string;
  }>) {
    if (!row.event_id) continue;
    const key = String(row.event_id);
    if (!summary[key]) continue; // contact pointing at an inactive/deleted event
    summary[key].total += 1;
    summary[key].by_status[row.follow_up_status] =
      (summary[key].by_status[row.follow_up_status] ?? 0) + 1;
  }

  return apiResponse({ events: Object.values(summary) });
}

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  const runId = randomUUID();

  let snapshot;
  try {
    snapshot = await loadRulesSnapshot();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load system_rules";
    return apiError(`Cannot run import: ${msg}`, 500);
  }

  try {
    const result = await importEventContacts({ runId, snapshot });

    const granolaClient = defaultGranolaClient();
    const granolaResults: GranolaImportResult[] = [];
    for (const eventId of result.imported_event_ids) {
      try {
        const gResult = await importGranolaForEvent(eventId, granolaClient, snapshot);
        granolaResults.push(gResult);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Granola ingestion failed";
        granolaResults.push({
          ingested_meetings: 0,
          auto_linked: 0,
          pending_review: 0,
          errors: [`event_id=${eventId}: ${msg}`],
        });
      }
    }

    const granola: GranolaImportResult = {
      ingested_meetings: granolaResults.reduce((s, r) => s + r.ingested_meetings, 0),
      auto_linked: granolaResults.reduce((s, r) => s + r.auto_linked, 0),
      pending_review: granolaResults.reduce((s, r) => s + r.pending_review, 0),
      errors: granolaResults.flatMap((r) => r.errors),
    };

    return apiResponse({ result, run_id: runId, granola });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Import failed";
    return apiError(msg, 500);
  }
}
