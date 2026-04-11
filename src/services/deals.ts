import { supabase, ServiceError } from "./base";

export interface Deal {
  id: number;
  title: string;
  company_name: string;
  account_code: string;
  company_id: number | null;
  contact_name: string;
  contact_email: string;
  website: string;
  description: string;
  pipeline_type_id: number;
  stage_id: number;
  stage?: string;
  value: number;
  currency: string;
  probability: number;
  expected_close: string | null;
  assigned_to: string;
  branch: string;
  source: string;
  source_detail: string;
  notes: string;
  lost_reason: string;
  health_score: number;
  last_activity_at: string | null;
  days_in_stage: number;
  is_stale: boolean;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface PipelineType {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
}

export interface PipelineStage {
  id: number;
  pipeline_type_id: number;
  name: string;
  position: number;
  stale_days: number;
  probability: number;
  color: string;
  is_active: boolean;
}

export async function getPipelineTypes(): Promise<PipelineType[]> {
  const { data, error } = await supabase
    .from("pipeline_types")
    .select("*")
    .eq("is_active", true)
    .order("id");
  if (error) throw new ServiceError("Failed to fetch pipeline types", error);
  return (data || []) as PipelineType[];
}

export async function getPipelineStages(pipelineTypeId?: number): Promise<PipelineStage[]> {
  let query = supabase.from("pipeline_stages").select("*").eq("is_active", true).order("position");
  if (pipelineTypeId) query = query.eq("pipeline_type_id", pipelineTypeId);
  const { data, error } = await query;
  if (error) throw new ServiceError("Failed to fetch pipeline stages", error);
  return (data || []) as PipelineStage[];
}

export async function getDeals(pipelineTypeId?: number): Promise<Deal[]> {
  let query = supabase.from("deals").select("*").order("created_at", { ascending: false });
  if (pipelineTypeId) query = query.eq("pipeline_type_id", pipelineTypeId);
  const { data, error } = await query;
  if (error) throw new ServiceError("Failed to fetch deals", error);
  return (data || []) as Deal[];
}

export async function createDeal(deal: Partial<Deal>): Promise<Deal> {
  const { data, error } = await supabase.from("deals").insert(deal).select().single();
  if (error) throw new ServiceError("Failed to create deal", error);

  // Log activity
  await supabase.from("activities").insert({
    account_code: deal.account_code || "",
    company_id: deal.company_id || null,
    deal_id: data.id,
    user_name: deal.assigned_to || "",
    type: "deal_created",
    subject: `Deal created: ${deal.title}`,
  });

  return data as Deal;
}

export async function updateDeal(id: number, updates: Partial<Deal>): Promise<void> {
  const { error } = await supabase.from("deals").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new ServiceError("Failed to update deal", error);
}

export async function moveDealStage(id: number, stageId: number, stageName: string): Promise<void> {
  const { error } = await supabase.from("deals").update({
    stage_id: stageId,
    stage: stageName,
    days_in_stage: 0,
    is_stale: false,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw new ServiceError("Failed to move deal", error);

  // Log activity - always log even if account_code is empty
  const { data: deal } = await supabase.from("deals").select("account_code, company_id, title").eq("id", id).single();
  await supabase.from("activities").insert({
    account_code: deal?.account_code || "",
    company_id: deal?.company_id || null,
    deal_id: id,
    type: "deal_stage_change",
    subject: `${deal?.title || "Deal"} moved to ${stageName}`,
  });
}

export async function closeDeal(id: number, won: boolean, reason?: string): Promise<void> {
  const { error } = await supabase.from("deals").update({
    stage: won ? "Won" : "Lost",
    lost_reason: won ? "" : (reason || ""),
    probability: won ? 100 : 0,
    closed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw new ServiceError("Failed to close deal", error);

  const { data: deal } = await supabase.from("deals").select("account_code, company_id, title").eq("id", id).single();
  if (deal) {
    await supabase.from("activities").insert({
      account_code: deal.account_code,
      company_id: deal.company_id,
      deal_id: id,
      type: won ? "deal_won" : "deal_lost",
      subject: `${deal.title} - ${won ? "Won" : "Lost"}${reason ? `: ${reason}` : ""}`,
    });
  }
}

export async function getDealActivities(dealId: number) {
  const { data, error } = await supabase
    .from("activities")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });
  if (error) throw new ServiceError("Failed to fetch deal activities", error);
  return data || [];
}

export async function getAccountActivities(accountCode: string) {
  const { data, error } = await supabase
    .from("activities")
    .select("*")
    .eq("account_code", accountCode)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new ServiceError("Failed to fetch account activities", error);
  return data || [];
}

export async function addActivity(activity: {
  account_code?: string;
  company_id?: number;
  deal_id?: number;
  user_name?: string;
  type: string;
  subject: string;
  body?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.from("activities").insert(activity);
  if (error) throw new ServiceError("Failed to add activity", error);
}
