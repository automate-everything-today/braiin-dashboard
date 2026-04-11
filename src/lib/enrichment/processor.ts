import { createClient } from "@supabase/supabase-js";
import { scrapeWebsite } from "./scraper";
import { researchCompany, findContacts, type EnrichmentResult } from "./researcher";
import { mapServices, mapModes, mergeArrays } from "./taxonomy";
import { type QueueItem } from "./queue";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export async function processItem(item: QueueItem): Promise<EnrichmentResult> {
  const domain = item.domain || "";
  const companyName = item.company_name || "";

  const websiteText = domain ? await scrapeWebsite(domain) : "";
  const research = await researchCompany(companyName, domain, websiteText);
  const contacts = domain ? await findContacts(domain) : [];

  const mappedServices = research?.services ? mapServices(research.services) : [];
  const mappedModes = research?.modes ? mapModes(research.modes) : [];

  const table = item.entity_type === "account" ? "accounts" : "companies";

  const { data: existing } = await supabase
    .from(table)
    .select("service_categories, modes, countries_of_operation, trade_lanes, ports, certifications, website")
    .eq("id", item.entity_id)
    .single();

  if (existing) {
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
      last_enriched_at: new Date().toISOString(),
      enrichment_data: { research, contacts },
    };

    if (mappedServices.length > 0) {
      updates.service_categories = mergeArrays(existing.service_categories || [], mappedServices);
    }
    if (mappedModes.length > 0) {
      updates.modes = mergeArrays(existing.modes || [], mappedModes);
    }
    if (research?.countries?.length) {
      updates.countries_of_operation = mergeArrays(existing.countries_of_operation || [], research.countries);
    }
    if (research?.trade_lanes?.length) {
      updates.trade_lanes = mergeArrays(existing.trade_lanes || [], research.trade_lanes);
    }
    if (research?.ports?.length) {
      updates.ports = mergeArrays(existing.ports || [], research.ports);
    }
    if (research?.certifications?.length) {
      updates.certifications = mergeArrays(existing.certifications || [], research.certifications);
    }
    if (research?.website && !existing.website) {
      updates.website = research.website;
    }

    await supabase.from(table).update(updates).eq("id", item.entity_id);
  }

  return { research, contacts };
}
