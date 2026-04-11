import { supabase, ServiceError } from "./base";
import type { Staff, BonusConfig } from "@/types";

export async function getActiveStaff(): Promise<Staff[]> {
  const { data, error } = await supabase
    .from("staff")
    .select("*")
    .eq("is_active", true)
    .order("department")
    .order("name");
  if (error) throw new ServiceError("Failed to fetch staff", error, "STAFF_FETCH");
  return (data || []) as Staff[];
}

export async function getStaffByEmail(email: string): Promise<Staff | null> {
  const { data, error } = await supabase
    .from("staff")
    .select("*")
    .eq("is_active", true)
    .eq("email", email)
    .single();
  if (error) return null;
  return data as Staff;
}

export async function updateStaff(id: number, updates: Partial<Staff>): Promise<void> {
  const { error } = await supabase.from("staff").update(updates).eq("id", id);
  if (error) throw new ServiceError("Failed to update staff", error, "STAFF_UPDATE");
}

export async function addStaff(staff: Omit<Staff, "id">): Promise<void> {
  const { error } = await supabase.from("staff").insert(staff);
  if (error) throw new ServiceError("Failed to add staff", error, "STAFF_INSERT");
}

export async function deactivateStaff(id: number): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const { error } = await supabase.from("staff").update({ is_active: false, end_date: today }).eq("id", id);
  if (error) throw new ServiceError("Failed to deactivate staff", error, "STAFF_DEACTIVATE");
}

export async function getBonusConfig(year: number): Promise<BonusConfig | null> {
  const { data, error } = await supabase
    .from("bonus_config")
    .select("*")
    .eq("year", year)
    .single();
  if (error) return null;
  return data as BonusConfig;
}

export async function updateBonusConfig(year: number, config: Partial<BonusConfig>): Promise<void> {
  const { error } = await supabase.from("bonus_config").update(config).eq("year", year);
  if (error) throw new ServiceError("Failed to update bonus config", error, "BONUS_CONFIG_UPDATE");
}

export async function applyBonusToAllStaff(config: { staff_t1: number; staff_t2: number; staff_t3: number; manager_t1: number; manager_t2: number; manager_t3: number }): Promise<void> {
  const { error: staffErr } = await supabase.from("staff").update({
    bonus_t1: config.staff_t1, bonus_t2: config.staff_t2, bonus_t3: config.staff_t3,
  }).eq("is_manager", false).eq("bonus_eligible", true);
  if (staffErr) throw new ServiceError("Failed to apply staff bonuses", staffErr, "BONUS_APPLY_STAFF");

  const { error: mgrErr } = await supabase.from("staff").update({
    bonus_t1: config.manager_t1, bonus_t2: config.manager_t2, bonus_t3: config.manager_t3,
  }).eq("is_manager", true).eq("bonus_eligible", true);
  if (mgrErr) throw new ServiceError("Failed to apply manager bonuses", mgrErr, "BONUS_APPLY_MANAGER");
}
