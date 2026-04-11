import { supabase, ServiceError } from "./base";
import type { Branch } from "@/types";

export async function getBranches(): Promise<Branch[]> {
  const { data, error } = await supabase.from("branches").select("*").order("id");
  if (error) throw new ServiceError("Failed to fetch branches", error, "BRANCHES_FETCH");
  return (data || []) as Branch[];
}

export async function updateBranch(id: number, updates: Partial<Branch>): Promise<void> {
  const { error } = await supabase.from("branches").update(updates).eq("id", id);
  if (error) throw new ServiceError("Failed to update branch", error, "BRANCH_UPDATE");
}

export async function addBranch(branch: Omit<Branch, "id">): Promise<void> {
  const { error } = await supabase.from("branches").insert(branch);
  if (error) throw new ServiceError("Failed to add branch", error, "BRANCH_INSERT");
}

export async function toggleBranch(id: number, currentActive: boolean): Promise<void> {
  const { error } = await supabase.from("branches").update({ is_active: !currentActive }).eq("id", id);
  if (error) throw new ServiceError("Failed to toggle branch", error, "BRANCH_TOGGLE");
}
