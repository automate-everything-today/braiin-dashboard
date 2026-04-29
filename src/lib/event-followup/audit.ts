/**
 * Diff Airtable source records against the event_contacts DB state.
 *
 * For records that SHOULD have landed (have email + event), report:
 *   - matched: count of records present in DB
 *   - missing: airtable_record_ids that should be in DB but aren't
 *   - field_mismatches: per-field divergences for matched records
 *
 * Records without email or event are excluded - they go to the
 * needs_attention pile, not the audit-missing pile.
 */

export interface AirtableRowSummary {
  id: string;
  email: string | null;
  event_name: string | null;
  name?: string | null;
  title?: string | null;
  company?: string | null;
  country?: string | null;
  region?: string | null;
  meeting_notes?: string | null;
  company_info?: string | null;
}

export interface DbRowSummary {
  airtable_record_id: string;
  email: string | null;
  event_id: number | null;
  name?: string | null;
  title?: string | null;
  company?: string | null;
  country?: string | null;
  region?: string | null;
  meeting_notes?: string | null;
  company_info?: string | null;
}

export interface FieldMismatch {
  airtable_id: string;
  field: string;
  airtable_value: unknown;
  db_value: unknown;
}

export interface AuditDiff {
  matched: number;
  missing: string[];
  field_mismatches: FieldMismatch[];
}

const COMPARED_FIELDS = [
  "name",
  "title",
  "company",
  "country",
  "region",
  "meeting_notes",
  "company_info",
] as const;

export function diffAirtableVsDb(
  airtable: AirtableRowSummary[],
  db: DbRowSummary[],
  eventsByLowerName: Map<string, number>,
): AuditDiff {
  const out: AuditDiff = { matched: 0, missing: [], field_mismatches: [] };
  const dbByAirtableId = new Map<string, DbRowSummary>(
    db.map((r) => [r.airtable_record_id, r]),
  );

  for (const at of airtable) {
    if (!at.email || !at.event_name) continue;
    const eventId = eventsByLowerName.get(at.event_name.toLowerCase());
    if (!eventId) {
      out.missing.push(at.id);
      continue;
    }
    const dbRow = dbByAirtableId.get(at.id);
    if (!dbRow || dbRow.event_id !== eventId) {
      out.missing.push(at.id);
      continue;
    }
    const rowMismatches: FieldMismatch[] = [];
    for (const field of COMPARED_FIELDS) {
      const a = (at as unknown as Record<string, unknown>)[field] ?? null;
      const d = (dbRow as unknown as Record<string, unknown>)[field] ?? null;
      if (a !== d) {
        rowMismatches.push({
          airtable_id: at.id,
          field,
          airtable_value: a,
          db_value: d,
        });
      }
    }
    if (rowMismatches.length === 0) {
      out.matched++;
    } else {
      out.field_mismatches.push(...rowMismatches);
    }
  }
  return out;
}
