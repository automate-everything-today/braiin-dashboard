/**
 * Group event_contacts at the same company within an event so the importer
 * (Phase 4 Task 4.2) can write company_groups rows + assign a lead.
 *
 * Pure function: takes contacts + canonicalisation rules, returns detected
 * groups. Caller is responsible for persisting via supabase + handling
 * lead_overridden_at semantics.
 *
 * Lead selection:
 *   1. Highest seniority_score wins.
 *   2. Tie -> contact with is_lead_contact = true wins.
 *   3. Still tied -> lowest id (deterministic).
 */

import { canonicalCompany, type CanonicalRules } from "./company-canonical";

interface ContactInput {
  id: number;
  company: string | null;
  title: string | null;
  is_lead_contact: boolean;
  seniority_score: number;
}

export interface DetectedGroup {
  company_name_canonical: string;
  member_ids: number[];
  lead_contact_id: number;
}

export function detectGroups(
  contacts: ContactInput[],
  rules: CanonicalRules,
): DetectedGroup[] {
  const buckets = new Map<string, ContactInput[]>();
  for (const c of contacts) {
    const key = canonicalCompany(c.company, rules);
    if (!key) continue; // skip contacts with empty/null company
    const bucket = buckets.get(key) ?? [];
    bucket.push(c);
    buckets.set(key, bucket);
  }

  const out: DetectedGroup[] = [];
  for (const [key, members] of buckets.entries()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => {
      if (b.seniority_score !== a.seniority_score) {
        return b.seniority_score - a.seniority_score;
      }
      if (a.is_lead_contact !== b.is_lead_contact) {
        return a.is_lead_contact ? -1 : 1;
      }
      return a.id - b.id;
    });
    out.push({
      company_name_canonical: key,
      member_ids: members.map((m) => m.id),
      lead_contact_id: sorted[0].id,
    });
  }
  return out;
}
