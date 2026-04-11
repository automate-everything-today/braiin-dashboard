import { supabase, fetchAllRows, ServiceError } from "./base";
import type { ClientPerformance, ClientNote, ClientEmail } from "@/types";

/**
 * Fetch all client performance data (paginated).
 */
export async function getClientPerformance(): Promise<ClientPerformance[]> {
  return fetchAllRows<ClientPerformance>(
    "client_performance",
    "account_code, client_name, report_month, total_jobs, fcl_jobs, lcl_jobs, air_jobs, bbk_jobs, fcl_teu, lcl_cbm, air_kg, bbk_cbm, profit_total, profit_fcl, profit_lcl, profit_air, profit_bbk"
  );
}

/**
 * Fetch client research data for all clients.
 */
export async function getClientResearch() {
  const { data, error } = await supabase
    .from("client_research")
    .select("account_code, client_news, growth_signals, retention_risks, competitor_intel, recommended_action, account_health, is_forwarder, country, source_links, research_date, insight, ff_networks, logo_url");
  if (error) throw new ServiceError("Failed to fetch client research", error, "RESEARCH_FETCH");
  return data || [];
}

/**
 * Fetch notes for a specific client account.
 */
export async function getClientNotes(accountCode: string): Promise<ClientNote[]> {
  const { data, error } = await supabase
    .from("client_notes")
    .select("id, note, author, created_at")
    .eq("account_code", accountCode)
    .order("created_at", { ascending: false });
  if (error) throw new ServiceError("Failed to fetch notes", error, "NOTES_FETCH");
  return (data || []) as ClientNote[];
}

/**
 * Add a note to a client account.
 */
export async function addClientNote(accountCode: string, note: string, author: string): Promise<void> {
  const { error } = await supabase.from("client_notes").insert({
    account_code: accountCode,
    note,
    author,
  });
  if (error) throw new ServiceError("Failed to add note", error, "NOTE_INSERT");
}

/**
 * Delete a client note.
 */
export async function deleteClientNote(id: number): Promise<void> {
  const { error } = await supabase.from("client_notes").delete().eq("id", id);
  if (error) throw new ServiceError("Failed to delete note", error, "NOTE_DELETE");
}

/**
 * Fetch sent emails for a client account.
 */
export async function getClientEmails(accountCode: string): Promise<ClientEmail[]> {
  const { data, error } = await supabase
    .from("client_emails")
    .select("id, to_email, to_name, subject, from_name, sent_at")
    .eq("account_code", accountCode)
    .order("sent_at", { ascending: false })
    .limit(10);
  if (error) throw new ServiceError("Failed to fetch emails", error, "EMAILS_FETCH");
  return (data || []) as ClientEmail[];
}

/**
 * Fetch trade data matches (companies with account codes + app scores).
 */
export async function getTradeMatches(accountCodes: string[]) {
  const { data: companyLinks, error: compError } = await supabase
    .from("companies")
    .select("account_code, id, icp_score, trade_type, months_active, logo_url")
    .in("account_code", accountCodes.slice(0, 200));
  if (compError) throw new ServiceError("Failed to fetch company links", compError, "COMPANIES_FETCH");

  const matchedIds = (companyLinks || []).map((c: any) => c.id);
  const { data: appScores, error: scoreError } = await supabase
    .from("app_scores")
    .select("company_id, ultimate_score, grade, import_volume, export_volume, import_months, export_months, is_dual")
    .in("company_id", matchedIds.slice(0, 200));
  if (scoreError) throw new ServiceError("Failed to fetch app scores", scoreError, "SCORES_FETCH");

  return { companyLinks: companyLinks || [], appScores: appScores || [] };
}
