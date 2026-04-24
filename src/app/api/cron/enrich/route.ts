import { pickItems, markComplete, markFailed, queueProspectsWithGaps, queueStaleRecords } from "@/lib/enrichment/queue";
import { processItem } from "@/lib/enrichment/processor";
import { supabase } from "@/services/base";

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Reclaim items stuck in processing for > 10 minutes
  const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await supabase.from("enrichment_queue").update({ status: "pending" }).eq("status", "processing").lt("processed_at", staleThreshold);

  let processed = 0;
  let failed = 0;
  let queued = 0;

  // Hourly sweep (first 5 minutes of each hour)
  const minutes = new Date().getMinutes();
  const isHourlySweep = minutes < 5;
  if (isHourlySweep) {
    try {
      const gapCount = await queueProspectsWithGaps();
      const staleCount = await queueStaleRecords();
      queued = gapCount + staleCount;
      console.log(`[enrichment-cron] Hourly sweep: queued ${gapCount} gaps + ${staleCount} stale`);
    } catch (err) {
      console.error("[enrichment-cron] Sweep failed:", err);
    }
  }

  const items = await pickItems(20);
  console.log(`[enrichment-cron] Processing ${items.length} items`);

  for (const item of items) {
    try {
      const result = await processItem(item);
      await markComplete(item.id, result);
      processed++;
    } catch (err: any) {
      console.error(`[enrichment-cron] Failed to process ${item.id}:`, err.message);
      await markFailed(item.id, err.message || "Unknown error", item.attempts);
      failed++;
    }
  }

  return Response.json({
    processed,
    failed,
    queued,
    sweep: isHourlySweep,
    timestamp: new Date().toISOString(),
  });
}
