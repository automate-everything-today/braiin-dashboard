import { supabase } from "@/services/base";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { scrapeWebsite } from "@/lib/enrichment/scraper";
import { researchCompany, findContacts } from "@/lib/enrichment/researcher";
import { mapServices, mapModes, mergeArrays } from "@/lib/enrichment/taxonomy";
import { enqueue } from "@/lib/enrichment/queue";

export async function POST(req: Request) {
  if (!(await checkRateLimit(getClientIp(req)))) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const { company_name, domain, account_id, entity_type, entity_id } = await req.json();
  if (!company_name && !domain) {
    return Response.json({ error: "Need company_name or domain" }, { status: 400 });
  }

  // Validate entity_type if provided
  if (entity_type && !["account", "company"].includes(entity_type)) {
    return Response.json({ error: "Invalid entity_type - must be 'account' or 'company'" }, { status: 400 });
  }

  // Also queue for background processing if entity info provided
  let queueId: string | null = null;
  if (entity_type && entity_id) {
    queueId = await enqueue({
      entity_type,
      entity_id,
      domain,
      company_name,
      priority: 1,
      trigger: "user_request",
    });
  }

  // Process synchronously for immediate results
  const websiteText = domain ? await scrapeWebsite(domain) : "";
  const research = await researchCompany(company_name || "", domain || "", websiteText);
  const contacts = domain ? await findContacts(domain) : [];

  const mappedServices = research?.services ? mapServices(research.services) : [];
  const mappedModes = research?.modes ? mapModes(research.modes) : [];

  // Save to account if we have an account_id
  if (account_id && research && !research.error) {
    const { data: existing } = await supabase
      .from("accounts")
      .select("service_categories, modes, countries_of_operation, trade_lanes, ports, certifications, website")
      .eq("id", account_id)
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
      if (research.countries?.length) {
        updates.countries_of_operation = mergeArrays(existing.countries_of_operation || [], research.countries);
      }
      if (research.trade_lanes?.length) {
        updates.trade_lanes = mergeArrays(existing.trade_lanes || [], research.trade_lanes);
      }
      if (research.ports?.length) {
        updates.ports = mergeArrays(existing.ports || [], research.ports);
      }
      if (research.certifications?.length) {
        updates.certifications = mergeArrays(existing.certifications || [], research.certifications);
      }
      if (research.website && !existing.website) {
        updates.website = research.website;
      }

      await supabase.from("accounts").update(updates).eq("id", account_id);
    }
  }

  // After sync processing, mark queue item complete to avoid duplicate work
  if (queueId) {
    const { markComplete } = await import("@/lib/enrichment/queue");
    await markComplete(queueId, { research, contacts });
  }

  return Response.json({ research, contacts });
}
