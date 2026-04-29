/**
 * /api/event-followup/audit
 *
 * GET   summary of the most recent import_audit_log run.
 * POST  run a fresh Airtable->DB diff using the importer's fetchAllAirtableRecordsForAudit.
 *
 * Auth: GET = any staff. POST = manager+.
 */

import { supabase } from "@/services/base";
import { requireAuth, requireManager } from "@/lib/api-auth";
import { apiError, apiResponse } from "@/lib/validation";
import { diffAirtableVsDb, type AirtableRowSummary, type DbRowSummary } from "@/lib/event-followup/audit";
import { fetchAllAirtableRecordsForAudit } from "@/lib/airtable/event-contacts";

const ROUTE = "/api/event-followup/audit";

export async function GET(req: Request) {
  const auth = await requireAuth(ROUTE, req);
  if (!auth.ok) return auth.response;

  // Most recent run summary: count of rows by result status for the latest run_id.
  const { data: latest } = await supabase
    .from("import_audit_log")
    .select("run_id, imported_at")
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest || !latest.run_id) return apiResponse({ recent: null });

  const { data: rows, error } = await supabase
    .from("import_audit_log")
    .select("result")
    .eq("run_id", latest.run_id);
  if (error) return apiError(error.message, 500);

  const counts: Record<string, number> = {};
  for (const r of (rows ?? []) as { result: string }[]) {
    counts[r.result] = (counts[r.result] ?? 0) + 1;
  }
  return apiResponse({
    recent: {
      run_id: latest.run_id,
      imported_at: latest.imported_at,
      counts,
    },
  });
}

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  // Pull Airtable + event_contacts + events in parallel.
  const [airtableRecords, eventContactsRes, eventsRes] = await Promise.all([
    fetchAllAirtableRecordsForAudit(),
    supabase.from("event_contacts").select("airtable_record_id, email, event_id, name, title, company, country, region, meeting_notes, company_info"),
    supabase.from("events").select("id, name"),
  ]);

  if (eventContactsRes.error) return apiError(eventContactsRes.error.message, 500);
  if (eventsRes.error) return apiError(eventsRes.error.message, 500);

  const events = new Map<string, number>();
  for (const e of (eventsRes.data ?? []) as { id: number; name: string }[]) {
    events.set(e.name.toLowerCase(), e.id);
  }

  const airtable: AirtableRowSummary[] = airtableRecords;
  const db: DbRowSummary[] = (eventContactsRes.data ?? []) as DbRowSummary[];

  const diff = diffAirtableVsDb(airtable, db, events);
  return apiResponse({ diff });
}
