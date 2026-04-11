import { supabase, ServiceError } from "./base";
import type { EnrichedAccount } from "@/types";

export async function getEnrichedAccounts(statusFilter?: string) {
  let query = supabase.from("companies").select(`
    id, company_name, company_domain, postcode, trade_type, status,
    icp_score, icp_grade, logo_url, is_forwarder,
    contacts!inner(full_name, title, email, linkedin_url),
    enrichments!inner(commodity_summary, supply_chain_profile, vertical,
      angle, pain_points, email_subject, email_body_1,
      linkedin_connection_note, linkedin_dm,
      company_news, current_provider, provider_confidence, provider_source,
      suggested_approach, approach_hook, researched_at)
  `).not("status", "in", '("unprocessed","scored","do_not_contact","apollo_no_contact")')
    .not("contacts.email", "is", null)
    .order("icp_score", { ascending: false })
    .limit(100);

  if (statusFilter && statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) throw new ServiceError("Failed to fetch enriched accounts", error, "ENRICHED_FETCH");
  return data || [];
}

export async function getAppScores(companyIds: number[]) {
  const { data, error } = await supabase
    .from("app_scores")
    .select("*")
    .in("company_id", companyIds);
  if (error) throw new ServiceError("Failed to fetch app scores", error, "APP_SCORES_FETCH");
  return data || [];
}
