import { supabase, ServiceError } from "./base";
import type { Budget } from "@/types";

export async function getBudget(branchId: number = 1): Promise<Budget[]> {
  const { data, error } = await supabase
    .from("budget")
    .select("*")
    .eq("branch_id", branchId)
    .order("period");
  if (error) throw new ServiceError("Failed to fetch budget", error, "BUDGET_FETCH");
  return (data || []) as Budget[];
}
