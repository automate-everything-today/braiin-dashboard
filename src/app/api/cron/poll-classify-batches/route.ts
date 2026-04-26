import { supabase } from "@/services/base";
import {
  fetchBatchStatus,
  processBatchResults,
  determineFinalStatus,
  type ClassifyBatchFinalStatus,
} from "@/lib/classify-batch";
import { requireCronAuth } from "@/lib/cron-auth";

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
 *
 * Final-status mapping is shared with /api/classify-batch via
 * determineFinalStatus(), so the cron and the manual GET handler can
 * never drift on terminal-state semantics.
 */

type BatchRow = { id: number; anthropic_batch_id: string };

async function pollOne(row: BatchRow): Promise<Record<string, unknown>> {
  const { id, anthropic_batch_id: anthropicBatchId } = row;

  let status;
  try {
    status = await fetchBatchStatus(anthropicBatchId);
  } catch (err) {
    console.warn(`[cron] poll failed for ${anthropicBatchId}:`, err);
    return { id, anthropic_batch_id: anthropicBatchId, polled: false };
  }

  // Both "in_progress" and "canceling" are transient. Treating "canceling"
  // as terminal would write "completed" with zero counts to the row even
  // though Anthropic will shortly transition it to "canceled" with real
  // counts - and the SELECT filter `.eq("status", "in_progress")` would
  // never re-poll it.
  if (status.processing_status === "in_progress" || status.processing_status === "canceling") {
    return {
      id,
      anthropic_batch_id: anthropicBatchId,
      still_processing: true,
      processing_status: status.processing_status,
      request_counts: status.request_counts,
    };
  }

  let succeeded = 0;
  let errored = 0;
  let finalStatus: ClassifyBatchFinalStatus = determineFinalStatus(status);
  let processingNote: string | null = null;
  if (status.results_url) {
    try {
      const counts = await processBatchResults(anthropicBatchId, status.results_url);
      succeeded = counts.succeeded;
      errored = counts.errored;
    } catch (err) {
      // We don't know what landed - flag the batch as errored rather
      // than marking it completed with zero counts, which would hide
      // the failure from the dashboard.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron] processing failed for ${anthropicBatchId}:`, msg);
      finalStatus = "errored";
      processingNote = `processBatchResults failed: ${msg}`;
    }
  }

  const updatePayload: {
    status: ClassifyBatchFinalStatus;
    completed_at: string;
    succeeded_count: number;
    errored_count: number;
    notes?: string;
  } = {
    status: finalStatus,
    completed_at: status.ended_at || new Date().toISOString(),
    succeeded_count: succeeded,
    errored_count: errored,
  };
  if (processingNote) updatePayload.notes = processingNote;

  const { error: updateErr } = await supabase
    .from("classify_batches")
    .update(updatePayload)
    .eq("id", id);
  if (updateErr) {
    console.warn(`[cron] tracking update failed for id=${id}:`, updateErr.message);
  }

  return {
    id,
    anthropic_batch_id: anthropicBatchId,
    finalised_as: finalStatus,
    succeeded,
    errored,
  };
}

export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const { data: openBatches, error } = await supabase
    .from("classify_batches")
    .select("id, anthropic_batch_id")
    .eq("status", "in_progress");
  if (error) {
    console.error("[cron poll-classify-batches] select failed:", error.message);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }

  // Polls in parallel; allSettled so an unexpected throw on one batch
  // doesn't wipe per-batch progress on the others (and doesn't make
  // Vercel retry the whole cron tick).
  const rows = (openBatches ?? []) as BatchRow[];
  const settled = await Promise.allSettled(rows.map(pollOne));
  const summaries = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    console.error(
      `[cron] poll worker rejected for id=${rows[i]?.id}:`,
      s.reason instanceof Error ? s.reason.message : s.reason,
    );
    return { id: rows[i]?.id, polled: false, error: "rejected" };
  });

  return Response.json({
    polled: summaries.length,
    batches: summaries,
  });
}
