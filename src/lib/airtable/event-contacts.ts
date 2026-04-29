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
 *   - Records without an email are skipped (we can't follow up by email).
 *   - Records without an event are skipped (we can't ROI-attribute them).
 *
 * Usage:
 *   const result = await importEventContacts();
 *   // { fetched, imported, skipped, errors }
 *
 * Manual trigger (operator) and cron-trigger (every 6h) both call this.
 */

import { supabase } from "@/services/base";

const AIRTABLE_BASE_ID = "appDiP9IKunUqdPl1";
const AIRTABLE_TABLE_ID = "tblMriM6Fox1AatVR";
const AIRTABLE_API_BASE = "https://api.airtable.com/v0";

const PEOPLE_VALUES = new Set(["Rob", "Sam", "Bruna"]);

// Map Rob/Sam/Bruna names to mailbox addresses for met_by[] persistence.
// Stored as emails so the send-from logic can route directly without a
// second lookup.
const METBY_NAME_TO_EMAIL: Record<string, string> = {
  Rob: "rob.donald@cortenlogistics.com",
  Sam: "sam.yauner@cortenlogistics.com",
  Bruna: "bruna.natale@cortenlogistics.com",
};

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
  imported: number;
  updated: number;
  skipped: number;
  skip_reasons: Record<string, number>;
  errors: string[];
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

async function fetchAllRecords(): Promise<AirtableRecord[]> {
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
 * Walk the Airtable records and produce one row per (record, event) pair
 * for upsert into event_contacts. Skips records without email or with no
 * resolvable event.
 */
async function buildRows(records: AirtableRecord[]): Promise<{
  rows: Array<Record<string, unknown>>;
  skipReasons: Record<string, number>;
}> {
  const events = await loadEventLookup();
  const networks = await loadNetworkLookup();
  const rows: Array<Record<string, unknown>> = [];
  const skipReasons: Record<string, number> = {};

  const recordSkip = (reason: string) => {
    skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
  };

  for (const rec of records) {
    const f = rec.fields;
    const email = asString(f["Email"]);
    if (!email) {
      recordSkip("no_email");
      continue;
    }

    const eventNames = asStringArray(f["Event"]);
    if (eventNames.length === 0) {
      recordSkip("no_event");
      continue;
    }

    const metByRaw = asStringArray(f["Met By"]);
    const metByPeople = metByRaw.filter((v) => PEOPLE_VALUES.has(v));
    const metByEmails = metByPeople
      .map((p) => METBY_NAME_TO_EMAIL[p])
      .filter((e): e is string => Boolean(e));

    const baseRow = {
      airtable_record_id: rec.id,
      email: email.toLowerCase(),
      name: asString(f["Name"]),
      title: asString(f["Title"]),
      company: asString(f["Company"]),
      phone: asString(f["Phone"]),
      website: asString(f["Website"]),
      country: asString(f["Country"]),
      region: asString(f["Region"]),
      met_by: metByEmails,
      internal_cc: asString(f["Internal CC"]),
      contact_role: mapContactRole(f["Contact Role"]),
      is_lead_contact: asBoolean(f["Lead Contact"]),
      tier: asNumber(f["Priority"]),
      company_type: asString(f["Company Type"]),
      company_info: asString(f["Company Info"]),
      meeting_notes: asString(f["Meeting Notes"]),
      imported_from_airtable_at: new Date().toISOString(),
    };

    // One row per (contact, event). Each event_contacts row has its own
    // follow_up_status so cycles don't collide.
    for (const eventName of eventNames) {
      const eventId = events.byName.get(eventName.toLowerCase());
      if (!eventId) {
        recordSkip(`unknown_event:${eventName}`);
        continue;
      }
      rows.push({
        ...baseRow,
        event_id: eventId,
        attributed_network_id: inferAttributedNetwork(eventName, networks),
      });
    }
  }

  return { rows, skipReasons };
}

/**
 * Upsert rows into event_contacts. Uniqueness is on (lower(email), event_id),
 * but Postgres on-conflict requires an actual unique constraint, which we
 * have via the unique index event_contacts_email_event_uniq. PostgREST
 * supports this via the `onConflict` parameter.
 */
async function upsertRows(
  rows: Array<Record<string, unknown>>,
): Promise<{ inserted: number; errors: string[] }> {
  if (rows.length === 0) return { inserted: 0, errors: [] };
  const errors: string[] = [];
  // Chunk to keep request bodies under typical PostgREST limits.
  const CHUNK = 100;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error, count } = await supabase
      .from("event_contacts")
      .upsert(chunk, {
        onConflict: "airtable_record_id",
        // We want the import to overwrite Airtable-side fields (name, notes,
        // tier, met_by) but NOT overwrite Braiin-side state (follow_up_status,
        // sent_at, draft_body). Since upsert only sets the columns we provide,
        // omitting those preserves them.
        ignoreDuplicates: false,
        count: "exact",
      });
    if (error) {
      errors.push(`upsert chunk ${i / CHUNK}: ${error.message}`);
      continue;
    }
    inserted += count ?? chunk.length;
  }
  return { inserted, errors };
}

export async function importEventContacts(): Promise<ImportResult> {
  const records = await fetchAllRecords();
  const { rows, skipReasons } = await buildRows(records);
  const { inserted, errors } = await upsertRows(rows);

  return {
    fetched: records.length,
    imported: inserted,
    updated: 0, // upsert doesn't distinguish insert vs update without extra cost; bundled into "imported"
    skipped: records.length - rows.length,
    skip_reasons: skipReasons,
    errors,
  };
}
