// src/services/accounts.ts
import { supabase, ServiceError } from "./base";
import type { Account } from "@/types";
import type { AccountInput } from "@/lib/validation";

export async function getAccounts(filters?: {
  status?: string;
  relationship_type?: string;
  search?: string;
}): Promise<Account[]> {
  let query = supabase.from("accounts").select("*").order("company_name");

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.relationship_type) query = query.contains("relationship_types", [filters.relationship_type]);
  if (filters?.search) {
    const escaped = filters.search.replace(/%/g, "\\%").replace(/_/g, "\\_");
    query = query.ilike("company_name", `%${escaped}%`);
  }

  const { data, error } = await query.limit(200);
  if (error) throw new ServiceError("Failed to fetch accounts", error, "ACCOUNTS_FETCH");
  return (data || []) as Account[];
}

export async function getAccountByCode(accountCode: string): Promise<Account | null> {
  const { data, error } = await supabase.from("accounts")
    .select("*").eq("account_code", accountCode).single();
  if (error && error.code !== "PGRST116") throw new ServiceError("Failed to fetch account", error);
  return (data as Account) || null;
}

export async function getAccountById(id: number): Promise<Account | null> {
  const { data, error } = await supabase.from("accounts")
    .select("*").eq("id", id).single();
  if (error && error.code !== "PGRST116") throw new ServiceError("Failed to fetch account", error);
  return (data as Account) || null;
}

export async function createAccount(input: AccountInput): Promise<Account> {
  const { data, error } = await supabase.from("accounts")
    .insert({ ...input, updated_at: new Date().toISOString() })
    .select().single();
  if (error) throw new ServiceError("Failed to create account", error, "ACCOUNT_CREATE");
  return data as Account;
}

export async function updateAccount(id: number, updates: Partial<AccountInput>): Promise<Account> {
  const { data, error } = await supabase.from("accounts")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) throw new ServiceError("Failed to update account", error, "ACCOUNT_UPDATE");
  return data as Account;
}

export async function blacklistAccount(
  accountCode: string,
  reason: string,
  incidentId: number
): Promise<void> {
  const { error } = await supabase.from("accounts")
    .update({
      status: "blacklisted",
      blacklist_reason: reason,
      blacklist_incident_id: incidentId,
      updated_at: new Date().toISOString(),
    })
    .eq("account_code", accountCode);
  if (error) throw new ServiceError("Failed to blacklist account", error);
}

export async function liftBlacklist(id: number): Promise<Account> {
  const { data, error } = await supabase.from("accounts")
    .update({
      status: "active",
      blacklist_reason: null,
      blacklist_incident_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id).select().single();
  if (error) throw new ServiceError("Failed to lift blacklist", error);
  return data as Account;
}
