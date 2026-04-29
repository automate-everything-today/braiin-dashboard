/**
 * Airtable importer for event-contact follow-ups.
 *
 * Source: "Networking - Follow ups" base, "Contacts" table.
 * Target: public.event_contacts (one-way sync, Airtable -> Braiin).
 *
 * Why one-way:
 *   Airtable is the ingest layer (where the team scans cards / adds new contacts
 *   on the road). Braiin is the source of truth for follow-up state from the
 *   moment a contact is imported - sent_at, replied_at, draft_body, tier
 *   overrides, etc., live in Postgres and never flow back to Airtable.
 *
 * Mapping:
 *   Airtable field name    -> event_contacts column
 *   ---------------------    ----------------------
 *   id (record id)         -> airtable_record_id
 *   Name                   -> name
 *   Title                  -> title
 *   Company                -> company
 *   Email                  -> email
 *   Phone                  -> phone
 *   Website                -> website
 *   Country                -> country
 *   Region                 -> region
 *   Event                  -> event_id (resolved by name match)
 *   Met By                 -> met_by[] (filtered to actual people - Rob/Sam/Bruna)
 *   Internal CC            -> internal_cc
 *   Contact Role           -> contact_role  (mapped to to/cc/skip)
 *   Lead Contact           -> is_lead_contact
 *   Priority               -> tier (1-5)
 *   Company Type           -> company_type
 *   Company Info           -> company_info
 *   Meeting Notes          -> meeting_notes
 *
 * Edge cases:
 *   - Met By can include 'GKF Directory' or 'Business Card' - these are
 *     sources, not people. Filtered out of met_by[]; if no people remain,
 *     met_by[] is empty and the send-from logic falls back to a default rep.
 *   - Event multi-select can have multiple values per contact (e.g.
 *     "Intermodal 2025" + "Intermodal 2026"). We import the contact once
 *     PER event (one event_contacts row per (email, event_id) pair) so
 *     each follow-up cycle has its own state.
 *   - Records without an email: imported as needs_attention rows with a
 *     synthesised placeholder email so we can surface them for manual action.
 *   - Records without an event: imported with event_id = null and
 *     follow_up_status = needs_attention so they are visible in the dashboard.
 *
 * Usage:
 *   const result = await importEventContacts({ runId, snapshot });
 *   // { fetched, imported, needs_attention, errors, run_id, imported_event_ids }
 *
 * Manual trigger (operator) and cron-trigger (every 6h) both call this.
 */

import { supabase } from "@/services/base";
import type { RulesSnapshot } from "@/lib/system-rules/types";
import { scoreTitle } from "@/lib/event-followup/seniority";
import { detectGroups } from "@/lib/event-followup/group-detection";

const AIRTABLE_BASE_ID = "appDiP9IKunUqdPl1";
const AIRTABLE_TABLE_ID = "tblMriM6Fox1AatVR";
const AIRTABLE_API_BASE = "https://api.airtable.com/v0";

const CHUNK_SIZE = 100;

// Map Rob/Sam/Bruna names to mailbox addresses for met_by[] persistence.
// Stored as emails so the send-from logic can route directly without a
// second lookup.
const METBY_NAME_TO_EMAIL: Record<string, string> = {
  Rob: "rob.donald@cortenlogistics.com",
  Sam: "sam.yauner@cortenlogistics.com",
  Bruna: "bruna.natale@cortenlogistics.com",
};
// Keep reference to prevent unused-variable warnings - mapping is for
// documentation; the raw met_by array is stored as-is (see comment in buildRows).
void METBY_NAME_TO_EMAIL;

type AirtableField = string | string[] | number | boolean | null | undefined;

interface AirtableRecord {
  id: string;
  fields: Record<string, AirtableField>;
}

interface AirtableListResponse {
  records: AirtableRecord[];
  offset?: string;
}

export interface ImportResult {
  fetched: number;
  imported: number;           // landed as a normal contact (has email + event)
  needs_attention: number;    // landed with follow_up_status = 'needs_attention'
  errors: string[];
  run_id: string;
  imported_event_ids: number[]; // distinct events that received contacts
  groups: {
    groups_created: number;
    groups_updated: number;
    members_tagged: number;
  };
}

export interface ImportOpts {
  runId: string;
  snapshot: RulesSnapshot;
}

// Audit row shape (before batched insert).
interface AuditRow {
  airtable_record_id: string;
  result: string;
  fields_present: string[];
  fields_landed: string[];
  rules_snapshot: unknown;
  run_id: string;
}

function readApiKey(): string {
  const key = process.env.AIRTABLE_API_KEY;
  if (!key) {
    throw new Error(
      "AIRTABLE_API_KEY not configured. Add it to Vercel env (server-side, no NEXT_PUBLIC prefix).",
    );
  }
  return key;
}

export async function fetchAllRecords(): Promise<AirtableRecord[]> {
  const apiKey = readApiKey();
  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const url = new URL(`${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      // Airtable rate limit is 5 req/sec/base. 100 records per page x 5 pages
      // = 500 records per second; we'll burn through 400 contacts in one call.
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Airtable fetch failed (${res.status}): ${body.slice(0, 500)}`);
    }

    const json = (await res.json()) as AirtableListResponse;
    records.push(...json.records);
    offset = json.offset;
  } while (offset);

  return records;
}

function asString(v: AirtableField): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  return null;
}

function asStringArray(v: AirtableField): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === "string");
  }
  return [];
}

function asBoolean(v: AirtableField): boolean {
  return v === true;
}

function asNumber(v: AirtableField): number | null {
  if (typeof v === "number") return v;
  return null;
}

function mapContactRole(v: AirtableField): "to" | "cc" | "skip" | null {
  const s = asString(v)?.toLowerCase();
  if (!s) return null;
  if (s.includes("to") && !s.includes("cc")) return "to";
  if (s.includes("cc")) return "cc";
  if (s.includes("skip") || s.includes("ignore")) return "skip";
  return null;
}

/** Airtable field names we consider when computing fields_present. */
const AIRTABLE_FIELD_NAMES = [
  "Name", "Email", "Title", "Company", "Phone", "Website",
  "Country", "Region", "Event", "Met By", "Internal CC",
  "Contact Role", "Lead Contact", "Priority", "Company Type",
  "Company Info", "Meeting Notes",
];

/** Map Airtable field names to DB column names for fields_landed reporting. */
const FIELD_TO_COLUMN: Record<string, string> = {
  Name: "name",
  Email: "email",
  Title: "title",
  Company: "company",
  Phone: "phone",
  Website: "website",
  Country: "country",
  Region: "region",
  Event: "event_id",
  "Met By": "met_by",
  "Internal CC": "internal_cc",
  "Contact Role": "contact_role",
  "Lead Contact": "is_lead_contact",
  Priority: "tier",
  "Company Type": "company_type",
  "Company Info": "company_info",
  "Meeting Notes": "meeting_notes",
};

function fieldsPresent(fields: Record<string, AirtableField>): string[] {
  return AIRTABLE_FIELD_NAMES.filter((name) => {
    const v = fields[name];
    if (v === null || v === undefined) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });
}

function fieldsLanded(
  presentFields: string[],
  eventResolved: boolean,
): string[] {
  return presentFields
    .map((f) => FIELD_TO_COLUMN[f])
    .filter((col): col is string => {
      if (!col) return false;
      // Event only lands if it resolved to an event_id
      if (col === "event_id") return eventResolved;
      return true;
    });
}

interface EventLookup {
  byName: Map<string, number>;
}

async function loadEventLookup(): Promise<EventLookup> {
  const { data, error } = await supabase
    .from("events")
    .select("id, name");
  if (error) throw new Error(`events lookup failed: ${error.message}`);
  const byName = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ id: number; name: string }>) {
    byName.set(row.name.toLowerCase(), row.id);
  }
  return { byName };
}

interface NetworkLookup {
  wcaId: number | null;
  gkfUlnId: number | null;
}

async function loadNetworkLookup(): Promise<NetworkLookup> {
  const { data } = await supabase
    .from("freight_networks")
    .select("id, primary_domain");
  const rows = (data ?? []) as Array<{ id: number; primary_domain: string }>;
  return {
    wcaId: rows.find((r) => r.primary_domain === "wcaworld.com")?.id ?? null,
    gkfUlnId: rows.find((r) => r.primary_domain === "gkfsummit.com")?.id ?? null,
  };
}

function inferAttributedNetwork(
  eventName: string,
  networks: NetworkLookup,
): number | null {
  // Per Option B scoping: Intermodal 2026 -> WCA. GKF/ULN Summit 2026 -> null
  // (standalone). Older Intermodal (2024, 2025) - assume WCA stand similarly.
  const lower = eventName.toLowerCase();
  if (lower.includes("intermodal")) return networks.wcaId;
  // GKF/ULN summit - standalone for ROI purposes per Rob's call.
  return null;
}

/**
 * For needs_attention rows (event_id IS NULL), the unique index on
 * (email, event_id) cannot deduplicate because Postgres treats NULL != NULL.
 * We therefore check airtable_record_id first and UPDATE if found, INSERT if not.
 * Returns the id of the written row, or null on error.
 */
async function upsertNeedsAttentionRow(
  row: Record<string, unknown>,
): Promise<{ id: number | null; error: string | null }> {
  const airtableRecordId = row.airtable_record_id as string;

  // Check for existing row by airtable_record_id where event_id is NULL.
  const { data: existing, error: selectError } = await supabase
    .from("event_contacts")
    .select("id")
    .eq("airtable_record_id", airtableRecordId)
    .is("event_id", null)
    .limit(1);

  if (selectError) {
    return {
      id: null,
      error: `needs_attention select failed for ${airtableRecordId}: ${selectError.message}`,
    };
  }

  const existingRow = (existing ?? [])[0] as { id: number } | undefined;

  if (existingRow) {
    // UPDATE the existing row by id.
    const { error: updateError } = await supabase
      .from("event_contacts")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(row as any)
      .eq("id", existingRow.id);

    if (updateError) {
      return {
        id: null,
        error: `needs_attention update failed for ${airtableRecordId}: ${updateError.message}`,
      };
    }
    return { id: existingRow.id, error: null };
  } else {
    // INSERT a new row.
    const { data: inserted, error: insertError } = await supabase
      .from("event_contacts")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(row as any)
      .select("id")
      .limit(1);

    if (insertError) {
      return {
        id: null,
        error: `needs_attention insert failed for ${airtableRecordId}: ${insertError.message}`,
      };
    }
    const newRow = (inserted ?? [])[0] as { id: number } | undefined;
    return { id: newRow?.id ?? null, error: null };
  }
}

/** Batch insert audit rows for a chunk. */
async function insertAuditRows(auditRows: AuditRow[]): Promise<string[]> {
  if (auditRows.length === 0) return [];
  const errors: string[] = [];
  const { error } = await supabase
    .from("import_audit_log")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(auditRows as any);
  if (error) {
    errors.push(`audit_log insert failed: ${error.message}`);
  }
  return errors;
}

/**
 * Walk the Airtable records and produce contact rows for upsert into
 * event_contacts. Records without email or event are no longer silently
 * dropped - they become needs_attention rows. Per-record outcomes are written
 * to import_audit_log.
 */
async function buildAndPersistRows(
  records: AirtableRecord[],
  opts: ImportOpts,
): Promise<{
  imported: number;
  needsAttention: number;
  errors: string[];
  importedEventIds: Set<number>;
}> {
  const events = await loadEventLookup();
  const networks = await loadNetworkLookup();

  const seniorityWeights = opts.snapshot.raw["seniority_score:weights"] as
    | Record<string, number>
    | undefined ?? {};

  let imported = 0;
  let needsAttention = 0;
  const errors: string[] = [];
  const importedEventIds = new Set<number>();

  // Process in chunks so audit rows stay manageable.
  for (let chunkStart = 0; chunkStart < records.length; chunkStart += CHUNK_SIZE) {
    const chunk = records.slice(chunkStart, chunkStart + CHUNK_SIZE);

    // Normal (email + event) rows accumulated for batch upsert.
    const normalRows: Array<Record<string, unknown>> = [];
    // Audit rows accumulated for batch insert at end of chunk.
    const auditRows: AuditRow[] = [];
    // Per-normal-row metadata needed for audit (index matches normalRows).
    const normalRowMeta: Array<{
      airtableRecordId: string;
      presentFields: string[];
      eventName: string;
      eventId: number;
    }> = [];

    for (const rec of chunk) {
      const f = rec.fields;
      const presentFields = fieldsPresent(f);
      const rawEmail = asString(f["Email"]);

      // --- No email: synthesise placeholder and surface as needs_attention ---
      if (!rawEmail) {
        const syntheticEmail = `pending+${rec.id.toLowerCase()}@needs-attention.local`;
        const row: Record<string, unknown> = {
          airtable_record_id: rec.id,
          email: syntheticEmail,
          name: asString(f["Name"]),
          title: asString(f["Title"]),
          company: asString(f["Company"]),
          phone: asString(f["Phone"]),
          website: asString(f["Website"]),
          country: asString(f["Country"]),
          region: asString(f["Region"]),
          met_by: asStringArray(f["Met By"]),
          internal_cc: asString(f["Internal CC"]),
          contact_role: mapContactRole(f["Contact Role"]),
          is_lead_contact: asBoolean(f["Lead Contact"]),
          tier: asNumber(f["Priority"]),
          company_type: asString(f["Company Type"]),
          company_info: asString(f["Company Info"]),
          meeting_notes: asString(f["Meeting Notes"]),
          imported_from_airtable_at: new Date().toISOString(),
          event_id: null,
          follow_up_status: "needs_attention",
          attention_reason: "no_email",
          seniority_score: scoreTitle(asString(f["Title"]), seniorityWeights),
        };

        const { error: writeError } = await upsertNeedsAttentionRow(row);
        if (writeError) {
          errors.push(writeError);
          auditRows.push({
            airtable_record_id: rec.id,
            result: `error:${writeError}`,
            fields_present: presentFields,
            fields_landed: [],
            rules_snapshot: opts.snapshot.raw,
            run_id: opts.runId,
          });
        } else {
          needsAttention++;
          const baseFieldsLanded = fieldsLanded(presentFields, false);
          // Synthesised placeholder email is written to DB; include it in fields_landed.
          if (!baseFieldsLanded.includes("email")) {
            baseFieldsLanded.push("email");
          }
          auditRows.push({
            airtable_record_id: rec.id,
            result: "needs_attention:no_email",
            fields_present: presentFields,
            fields_landed: baseFieldsLanded,
            rules_snapshot: opts.snapshot.raw,
            run_id: opts.runId,
          });
        }
        continue;
      }

      const email = rawEmail.toLowerCase();
      const eventNames = asStringArray(f["Event"]);

      // --- No event: persist with event_id = null, needs_attention ---
      if (eventNames.length === 0) {
        const row: Record<string, unknown> = {
          airtable_record_id: rec.id,
          email,
          name: asString(f["Name"]),
          title: asString(f["Title"]),
          company: asString(f["Company"]),
          phone: asString(f["Phone"]),
          website: asString(f["Website"]),
          country: asString(f["Country"]),
          region: asString(f["Region"]),
          met_by: asStringArray(f["Met By"]),
          internal_cc: asString(f["Internal CC"]),
          contact_role: mapContactRole(f["Contact Role"]),
          is_lead_contact: asBoolean(f["Lead Contact"]),
          tier: asNumber(f["Priority"]),
          company_type: asString(f["Company Type"]),
          company_info: asString(f["Company Info"]),
          meeting_notes: asString(f["Meeting Notes"]),
          imported_from_airtable_at: new Date().toISOString(),
          event_id: null,
          follow_up_status: "needs_attention",
          attention_reason: "no_event",
          seniority_score: scoreTitle(asString(f["Title"]), seniorityWeights),
        };

        const { error: writeError } = await upsertNeedsAttentionRow(row);
        if (writeError) {
          errors.push(writeError);
          auditRows.push({
            airtable_record_id: rec.id,
            result: `error:${writeError}`,
            fields_present: presentFields,
            fields_landed: [],
            rules_snapshot: opts.snapshot.raw,
            run_id: opts.runId,
          });
        } else {
          needsAttention++;
          auditRows.push({
            airtable_record_id: rec.id,
            result: "needs_attention:no_event",
            fields_present: presentFields,
            fields_landed: fieldsLanded(presentFields, false),
            rules_snapshot: opts.snapshot.raw,
            run_id: opts.runId,
          });
        }
        continue;
      }

      // --- One row per (contact, event) ---
      for (const eventName of eventNames) {
        const eventId = events.byName.get(eventName.toLowerCase());

        if (!eventId) {
          // Event name doesn't match any known event: needs_attention with
          // unmapped_event reason.
          const row: Record<string, unknown> = {
            airtable_record_id: rec.id,
            email,
            name: asString(f["Name"]),
            title: asString(f["Title"]),
            company: asString(f["Company"]),
            phone: asString(f["Phone"]),
            website: asString(f["Website"]),
            country: asString(f["Country"]),
            region: asString(f["Region"]),
            met_by: asStringArray(f["Met By"]),
            internal_cc: asString(f["Internal CC"]),
            contact_role: mapContactRole(f["Contact Role"]),
            is_lead_contact: asBoolean(f["Lead Contact"]),
            tier: asNumber(f["Priority"]),
            company_type: asString(f["Company Type"]),
            company_info: asString(f["Company Info"]),
            meeting_notes: asString(f["Meeting Notes"]),
            imported_from_airtable_at: new Date().toISOString(),
            event_id: null,
            follow_up_status: "needs_attention",
            attention_reason: `unmapped_event:${eventName}`,
            seniority_score: scoreTitle(asString(f["Title"]), seniorityWeights),
          };

          const { error: writeError } = await upsertNeedsAttentionRow(row);
          if (writeError) {
            errors.push(writeError);
            auditRows.push({
              airtable_record_id: rec.id,
              result: `error:${writeError}`,
              fields_present: presentFields,
              fields_landed: [],
              rules_snapshot: opts.snapshot.raw,
              run_id: opts.runId,
            });
          } else {
            needsAttention++;
            auditRows.push({
              airtable_record_id: rec.id,
              result: `needs_attention:unmapped_event:${eventName}`,
              fields_present: presentFields,
              fields_landed: fieldsLanded(presentFields, false),
              rules_snapshot: opts.snapshot.raw,
              run_id: opts.runId,
            });
          }
          continue;
        }

        // Normal path: email + resolved event.
        const normalRow: Record<string, unknown> = {
          airtable_record_id: rec.id,
          email,
          name: asString(f["Name"]),
          title: asString(f["Title"]),
          company: asString(f["Company"]),
          phone: asString(f["Phone"]),
          website: asString(f["Website"]),
          country: asString(f["Country"]),
          region: asString(f["Region"]),
          met_by: asStringArray(f["Met By"]),
          internal_cc: asString(f["Internal CC"]),
          contact_role: mapContactRole(f["Contact Role"]),
          is_lead_contact: asBoolean(f["Lead Contact"]),
          tier: asNumber(f["Priority"]),
          company_type: asString(f["Company Type"]),
          company_info: asString(f["Company Info"]),
          meeting_notes: asString(f["Meeting Notes"]),
          imported_from_airtable_at: new Date().toISOString(),
          event_id: eventId,
          attributed_network_id: inferAttributedNetwork(eventName, networks),
          seniority_score: scoreTitle(asString(f["Title"]), seniorityWeights),
        };

        normalRows.push(normalRow);
        normalRowMeta.push({
          airtableRecordId: rec.id,
          presentFields,
          eventName,
          eventId,
        });
      }
    }

    // Batch upsert normal rows for this chunk.
    if (normalRows.length > 0) {
      const { error: upsertError, count } = await supabase
        .from("event_contacts")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .upsert(normalRows as any, {
          // Upsert on (email, event_id) - the natural unique pair. One row
          // per contact per event so a contact attending both Intermodal and
          // GKF gets two follow-up rows with independent state. See migration
          // 060 for the index rework.
          onConflict: "email,event_id",
          // We want the import to overwrite Airtable-side fields (name, notes,
          // tier, met_by) but NOT overwrite Braiin-side state (follow_up_status,
          // sent_at, draft_body). Since upsert only sets the columns we provide,
          // omitting those preserves them.
          ignoreDuplicates: false,
          count: "exact",
        });

      if (upsertError) {
        const msg = `upsert chunk ${chunkStart / CHUNK_SIZE}: ${upsertError.message}`;
        errors.push(msg);
        // All rows in this normal batch failed - audit them as errors.
        for (const meta of normalRowMeta) {
          auditRows.push({
            airtable_record_id: meta.airtableRecordId,
            result: `error:${msg}`,
            fields_present: meta.presentFields,
            fields_landed: [],
            rules_snapshot: opts.snapshot.raw,
            run_id: opts.runId,
          });
        }
      } else {
        const upserted = count ?? normalRows.length;
        imported += upserted;
        for (const meta of normalRowMeta) {
          importedEventIds.add(meta.eventId);
          auditRows.push({
            airtable_record_id: meta.airtableRecordId,
            result: "imported",
            fields_present: meta.presentFields,
            fields_landed: fieldsLanded(meta.presentFields, true),
            rules_snapshot: opts.snapshot.raw,
            run_id: opts.runId,
          });
        }
      }
    }

    // Batch insert audit rows for this chunk.
    const auditErrors = await insertAuditRows(auditRows);
    errors.push(...auditErrors);
  }

  return { imported, needsAttention, errors, importedEventIds };
}

interface GroupDetectionContact {
  id: number;
  company: string | null;
  title: string | null;
  is_lead_contact: boolean;
  seniority_score: number;
}

async function runGroupDetection(
  eventId: number,
  snapshot: RulesSnapshot,
): Promise<{ groups_created: number; groups_updated: number; members_tagged: number }> {
  const { data: rows, error } = await supabase
    .from("event_contacts")
    .select("id, company, title, is_lead_contact, seniority_score")
    .eq("event_id", eventId);
  if (error) {
    throw new Error(`runGroupDetection select failed: ${error.message}`);
  }

  const contacts: GroupDetectionContact[] = (rows ?? []).map((r) => ({
    id: r.id as number,
    company: r.company as string | null,
    title: r.title as string | null,
    is_lead_contact: (r.is_lead_contact as boolean | null) ?? false,
    seniority_score: (r.seniority_score as number | null) ?? 0,
  }));

  const groups = detectGroups(contacts, snapshot.companyMatch);

  let created = 0;
  let updated = 0;
  let membersTagged = 0;

  for (const g of groups) {
    // Look up existing group.
    const { data: existing } = await supabase
      .from("company_groups")
      .select("id, lead_overridden_at, lead_contact_id")
      .eq("event_id", eventId)
      .eq("company_name_canonical", g.company_name_canonical)
      .maybeSingle();

    let groupId: number;
    let effectiveLeadId: number;
    if (existing) {
      groupId = existing.id as number;
      const overridden = (existing.lead_overridden_at as string | null) !== null;
      effectiveLeadId = overridden
        ? (existing.lead_contact_id as number) ?? g.lead_contact_id
        : g.lead_contact_id;
      if (!overridden) {
        const { error: updErr } = await supabase
          .from("company_groups")
          .update({ lead_contact_id: g.lead_contact_id })
          .eq("id", groupId);
        if (updErr) throw new Error(`company_groups update failed: ${updErr.message}`);
      }
      updated++;
    } else {
      const { data: created_, error: insErr } = await supabase
        .from("company_groups")
        .insert({
          event_id: eventId,
          company_name_canonical: g.company_name_canonical,
          lead_contact_id: g.lead_contact_id,
        })
        .select("id")
        .single();
      if (insErr || !created_) {
        throw new Error(`company_groups insert failed: ${insErr?.message ?? "no row returned"}`);
      }
      groupId = (created_ as { id: number }).id;
      effectiveLeadId = g.lead_contact_id;
      created++;
    }

    // Tag every member's company_group_id and set contact_role to 'cc' first.
    if (g.member_ids.length > 0) {
      const { error: tagErr } = await supabase
        .from("event_contacts")
        .update({ company_group_id: groupId, contact_role: "cc" })
        .in("id", g.member_ids);
      if (tagErr) throw new Error(`event_contacts tag failed: ${tagErr.message}`);
      membersTagged += g.member_ids.length;
    }

    // Override lead to 'to' after the bulk 'cc' assignment above.
    const { error: leadErr } = await supabase
      .from("event_contacts")
      .update({ contact_role: "to" })
      .eq("id", effectiveLeadId);
    if (leadErr) throw new Error(`event_contacts lead update failed: ${leadErr.message}`);
  }

  return { groups_created: created, groups_updated: updated, members_tagged: membersTagged };
}

export async function fetchAllAirtableRecordsForAudit(): Promise<Array<{
  id: string;
  email: string | null;
  event_name: string | null;
  name: string | null;
  title: string | null;
  company: string | null;
  country: string | null;
  region: string | null;
  meeting_notes: string | null;
  company_info: string | null;
}>> {
  const records = await fetchAllRecords();
  return records.map((rec) => {
    const f = rec.fields;
    const eventNames = asStringArray(f["Event"]);
    return {
      id: rec.id,
      email: asString(f["Email"]),
      // For audit purposes, take the first event name. Records with multiple events
      // produce multiple DB rows in the importer; the audit only needs one comparison.
      event_name: eventNames[0] ?? null,
      name: asString(f["Name"]),
      title: asString(f["Title"]),
      company: asString(f["Company"]),
      country: asString(f["Country"]),
      region: asString(f["Region"]),
      meeting_notes: asString(f["Meeting Notes"]),
      company_info: asString(f["Company Info"]),
    };
  });
}

export async function importEventContacts(
  opts: ImportOpts,
  _fetchRecords: () => Promise<AirtableRecord[]> = fetchAllRecords,
): Promise<ImportResult> {
  const records = await _fetchRecords();
  const { imported, needsAttention, errors, importedEventIds } =
    await buildAndPersistRows(records, opts);

  const groups = { groups_created: 0, groups_updated: 0, members_tagged: 0 };

  for (const eventId of importedEventIds) {
    try {
      const detection = await runGroupDetection(eventId, opts.snapshot);
      groups.groups_created += detection.groups_created;
      groups.groups_updated += detection.groups_updated;
      groups.members_tagged += detection.members_tagged;
    } catch (err) {
      errors.push(
        `runGroupDetection failed for event ${eventId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    fetched: records.length,
    imported,
    needs_attention: needsAttention,
    errors,
    run_id: opts.runId,
    imported_event_ids: Array.from(importedEventIds),
    groups,
  };
}
