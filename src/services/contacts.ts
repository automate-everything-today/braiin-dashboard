import { supabase, ServiceError } from "./base";
import type { CargowiseContact } from "@/types";

export async function getContactsByAccount(accountCode: string): Promise<CargowiseContact[]> {
  const { data, error } = await supabase
    .from("cargowise_contacts")
    .select("id, contact_name, job_title, email, phone, city, is_default")
    .eq("account_code", accountCode)
    .order("is_default", { ascending: false });
  if (error) throw new ServiceError("Failed to fetch contacts", error, "CONTACTS_FETCH");
  return (data || []) as CargowiseContact[];
}

export async function updateContact(id: number, updates: Partial<CargowiseContact>): Promise<void> {
  const { error } = await supabase.from("cargowise_contacts").update(updates).eq("id", id);
  if (error) throw new ServiceError("Failed to update contact", error, "CONTACT_UPDATE");
}

export async function deleteContact(id: number): Promise<void> {
  const { error } = await supabase.from("cargowise_contacts").delete().eq("id", id);
  if (error) throw new ServiceError("Failed to delete contact", error, "CONTACT_DELETE");
}
