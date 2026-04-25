import { supabase } from "@/services/base";
import { fetchBatchStatus, processBatchResults } from "@/lib/classify-batch";

/**
 * Cron-triggered poller for in-flight classify batches. Runs every 5
 * minutes via vercel.json so completed Anthropic batches land in
 * email_classifications without manual intervention. Secured by the
 * CRON_SECRET header check (set automatically by Vercel cron).
 *
 * Iterates every classify_batches row with status='in_progress', polls
 * Anthropic for each, and processes results when ready. Idempotent -
 * a row that's already 'completed' is filtered out by the SELECT
 * predicate, and a re-poll of an in-flight row just re-reads status
 * without writing.
 */

export async function GET(req: Request) {
  // Vercel cron jobs include this header; reject anything else so the
  // endpoint can't be hit by an external caller to spend on Anthropic.
  const authHeader = req.headers.get("authorization") || "";
  const expected = `Bearer ${process.env.CRON_SECRET || ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: openBatches, error } = await supabase
    .from("classify_batches")
    .select("*")
    .eq("status", "in_progress");
  if (error) {
    console.error("[cron poll-classify-batches] select failed:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  const summaries: Array<Record<string, unknown>> = [];
  for (const row of (openBatches as unknown as Array<Record<string, unknown>>) || []) {
    const id = row.id as number;
    const anthropicBatchId = row.anthropic_batch_id as string;

    let status;
    try {
      status = await fetchBatchStatus(anthropicBatchId);
    } catch (err) {
      console.warn(`[cron] poll failed for ${anthropicBatchId}:`, err);
      summaries.push({ id, anthropic_batch_id: anthropicBatchId, polled: false });
      continue;
    }

    if (status.processing_status === "in_progress") {
      summaries.push({
        id,
        anthropic_batch_id: anthropicBatchId,
        still_processing: true,
        request_counts: status.request_counts,
      });
      continue;
    }

    let succeeded = 0;
    let errored = 0;
    if (status.results_url) {
      try {
        const counts = await processBatchResults(anthropicBatchId, status.results_url);
        succeeded = counts.succeeded;
        errored = counts.errored;
      } catch (err) {
        console.warn(`[cron] processing failed for ${anthropicBatchId}:`, err);
      }
    }

    const finalStatus =
      status.processing_status === "canceled"
        ? "canceled"
        : status.request_counts.expired > 0
          ? "expired"
          : "completed";

    const { error: updateErr } = await supabase
      .from("classify_batches")
      .update({
        status: finalStatus,
        completed_at: status.ended_at || new Date().toISOString(),
        succeeded_count: succeeded,
        errored_count: errored,
      } as never)
      .eq("id", id);
    if (updateErr) {
      console.warn(`[cron] tracking update failed for id=${id}:`, updateErr.message);
    }

    summaries.push({
      id,
      anthropic_batch_id: anthropicBatchId,
      finalised_as: finalStatus,
      succeeded,
      errored,
    });
  }

  return Response.json({
    polled: summaries.length,
    batches: summaries,
  });
}
