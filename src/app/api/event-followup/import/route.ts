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

import { supabase } from "@/services/base";
import { requireAuth, requireManager } from "@/lib/api-auth";
import { apiError, apiResponse } from "@/lib/validation";
import { importEventContacts } from "@/lib/airtable/event-contacts";

const ROUTE = "/api/event-followup/import";

export async function GET(req: Request) {
  const auth = await requireAuth(ROUTE, req);
  if (!auth.ok) return auth.response;

  const { data, error } = await supabase
    .from("event_contacts")
    .select("event_id, follow_up_status, events(name)")
    .order("event_id", { ascending: true });
  if (error) return apiError(error.message, 500);

  // Reduce to per-event counts grouped by status.
  const summary: Record<
    string,
    { event_id: number; event_name: string; total: number; by_status: Record<string, number> }
  > = {};
  for (const row of (data ?? []) as Array<{
    event_id: number | null;
    follow_up_status: string;
    events: { name: string } | null;
  }>) {
    if (!row.event_id) continue;
    const key = String(row.event_id);
    const eventName = row.events?.name ?? "(unknown)";
    if (!summary[key]) {
      summary[key] = { event_id: row.event_id, event_name: eventName, total: 0, by_status: {} };
    }
    summary[key].total += 1;
    summary[key].by_status[row.follow_up_status] =
      (summary[key].by_status[row.follow_up_status] ?? 0) + 1;
  }

  return apiResponse({ events: Object.values(summary) });
}

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  try {
    const result = await importEventContacts();
    return apiResponse({ result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Import failed";
    return apiError(msg, 500);
  }
}
