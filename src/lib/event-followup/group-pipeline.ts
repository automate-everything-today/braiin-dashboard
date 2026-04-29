/**
 * Group detection pipeline: post-upsert pass that buckets contacts into
 * company groups and assigns lead/cc roles.
 *
 * Extracted from src/lib/airtable/event-contacts.ts to keep that file
 * under the 800-line ceiling.
 *
 * Race-safety: the insert path uses upsert with onConflict so concurrent
 * imports cannot violate the UNIQUE (event_id, company_name_canonical)
 * constraint on company_groups.
 */

import { supabase } from "@/services/base";
import { detectGroups } from "./group-detection";
import type { RulesSnapshot } from "@/lib/system-rules/types";

export interface GroupDetectionContact {
  id: number;
  company: string | null;
  title: string | null;
  is_lead_contact: boolean;
  seniority_score: number;
}

export async function runGroupDetection(
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
    // Try to read existing first (needed to check lead_overridden_at).
    const { data: existing } = await supabase
      .from("company_groups")
      .select("id, lead_overridden_at, lead_contact_id")
      .eq("event_id", eventId)
      .eq("company_name_canonical", g.company_name_canonical)
      .maybeSingle();

    let groupId: number;
    let effectiveLeadId: number;

    if (existing && (existing.lead_overridden_at as string | null) !== null) {
      // Override path: keep existing lead, update nothing on company_groups.
      groupId = existing.id as number;
      effectiveLeadId = (existing.lead_contact_id as number | null) ?? g.lead_contact_id;
      updated++;
    } else {
      // No existing row, or existing without override: upsert. Race-safe.
      const { data: upserted, error: upErr } = await supabase
        .from("company_groups")
        .upsert(
          {
            event_id: eventId,
            company_name_canonical: g.company_name_canonical,
            lead_contact_id: g.lead_contact_id,
          },
          { onConflict: "event_id,company_name_canonical" },
        )
        .select("id")
        .single();
      if (upErr || !upserted) {
        throw new Error(
          `company_groups upsert failed: ${upErr?.message ?? "no row returned"}`,
        );
      }
      groupId = (upserted as { id: number }).id;
      effectiveLeadId = g.lead_contact_id;
      if (existing) {
        // Row existed but had no override: this is an update.
        updated++;
      } else {
        created++;
      }
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
