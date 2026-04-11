import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export type QueueItem = {
  id: string;
  entity_type: "account" | "company";
  entity_id: string;
  domain: string | null;
  company_name: string | null;
  priority: number;
  status: string;
  trigger: string;
  attempts: number;
  last_error: string | null;
  enrichment_data: any;
  created_at: string;
  processed_at: string | null;
  completed_at: string | null;
};

export async function enqueue(params: {
  entity_type: "account" | "company";
  entity_id: string;
  domain?: string | null;
  company_name?: string | null;
  priority: number;
  trigger: string;
}): Promise<string | null> {
  // Check for existing pending/processing entry
  const { data: existing } = await supabase
    .from("enrichment_queue")
    .select("id, status, attempts")
    .eq("entity_type", params.entity_type)
    .eq("entity_id", params.entity_id)
    .in("status", ["pending", "processing"])
    .limit(1)
    .single();

  if (existing) return null;

  // Check for failed entry with retries remaining
  const { data: failed } = await supabase
    .from("enrichment_queue")
    .select("id, attempts")
    .eq("entity_type", params.entity_type)
    .eq("entity_id", params.entity_id)
    .eq("status", "failed")
    .lt("attempts", 3)
    .limit(1)
    .single();

  if (failed) {
    await supabase
      .from("enrichment_queue")
      .update({ status: "pending", priority: params.priority })
      .eq("id", failed.id);
    return failed.id;
  }

  const { data, error } = await supabase
    .from("enrichment_queue")
    .insert({
      entity_type: params.entity_type,
      entity_id: params.entity_id,
      domain: params.domain || null,
      company_name: params.company_name || null,
      priority: params.priority,
      trigger: params.trigger,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[enrichment] Failed to enqueue:", error.message);
    return null;
  }

  return data?.id || null;
}

export async function pickItems(limit: number = 20): Promise<QueueItem[]> {
  const { data: items, error } = await supabase
    .from("enrichment_queue")
    .select("*")
    .eq("status", "pending")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error || !items?.length) return [];

  const ids = items.map((i: any) => i.id);
  await supabase
    .from("enrichment_queue")
    .update({ status: "processing", processed_at: new Date().toISOString() })
    .in("id", ids);

  return items as QueueItem[];
}

export async function markComplete(id: string, enrichmentData: any): Promise<void> {
  await supabase
    .from("enrichment_queue")
    .update({
      status: "completed",
      enrichment_data: enrichmentData,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);
}

export async function markFailed(id: string, error: string, attempts: number): Promise<void> {
  await supabase
    .from("enrichment_queue")
    .update({
      status: attempts >= 3 ? "failed" : "pending",
      last_error: error,
      attempts: attempts + 1,
      completed_at: attempts >= 3 ? new Date().toISOString() : null,
    })
    .eq("id", id);
}

export async function getQueueStats(): Promise<{
  pending: number;
  processing: number;
  completed_today: number;
  failed: number;
}> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [pending, processing, completedToday, failed] = await Promise.all([
    supabase.from("enrichment_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("enrichment_queue").select("id", { count: "exact", head: true }).eq("status", "processing"),
    supabase.from("enrichment_queue").select("id", { count: "exact", head: true })
      .eq("status", "completed").gte("completed_at", today.toISOString()),
    supabase.from("enrichment_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
  ]);

  return {
    pending: pending.count || 0,
    processing: processing.count || 0,
    completed_today: completedToday.count || 0,
    failed: failed.count || 0,
  };
}

export async function queueProspectsWithGaps(): Promise<number> {
  const { data: prospects } = await supabase
    .from("companies")
    .select("id, company_domain, company_name")
    .is("last_enriched_at", null)
    .not("company_domain", "is", null)
    .limit(50);

  if (!prospects?.length) return 0;

  let queued = 0;
  for (const p of prospects) {
    const result = await enqueue({
      entity_type: "company",
      entity_id: p.id,
      domain: p.company_domain,
      company_name: p.company_name,
      priority: 2,
      trigger: "stale_check",
    });
    if (result) queued++;
  }
  return queued;
}

export async function queueStaleRecords(): Promise<number> {
  const staleDate = new Date();
  staleDate.setDate(staleDate.getDate() - 90);

  const [accounts, companies] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, domain, company_name")
      .lt("last_enriched_at", staleDate.toISOString())
      .not("domain", "is", null)
      .limit(25),
    supabase
      .from("companies")
      .select("id, company_domain, company_name")
      .lt("last_enriched_at", staleDate.toISOString())
      .not("company_domain", "is", null)
      .limit(25),
  ]);

  let queued = 0;
  for (const a of accounts.data || []) {
    const result = await enqueue({
      entity_type: "account",
      entity_id: a.id,
      domain: a.domain,
      company_name: a.company_name,
      priority: 3,
      trigger: "stale_check",
    });
    if (result) queued++;
  }
  for (const c of companies.data || []) {
    const result = await enqueue({
      entity_type: "company",
      entity_id: c.id,
      domain: c.company_domain,
      company_name: c.company_name,
      priority: 3,
      trigger: "stale_check",
    });
    if (result) queued++;
  }
  return queued;
}
