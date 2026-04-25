import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";
import { apiError, apiResponse } from "@/lib/validation";
import {
  submitClassifyBatch,
  fetchBatchStatus,
  processBatchResults,
} from "@/lib/classify-batch";

/**
 * Bulk async email classification via Anthropic's Messages Batches API
 * at ~50% the per-token cost of synchronous calls. Used for legacy
 * backfill, manager-triggered "re-classify all stale", and similar bulk
 * jobs where a 5-30 minute turnaround is acceptable.
 *
 * POST  body: { email_ids: string[] }
 *   Loads the requested emails' data from email_classifications + Graph
 *   if needed, builds batch requests, submits to Anthropic, returns the
 *   tracking row (id + anthropic_batch_id + request_count).
 *
 * GET   query: ?id=<classify_batches.id> | ?all=open
 *   Polls Anthropic; when status='ended', downloads JSONL results and
 *   writes them back to email_classifications. Idempotent - safe to call
 *   on a row that's already 'completed'. Used both manually and by the
 *   /api/cron/poll-classify-batches job.
 */

const MAX_BATCH = 1000;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const body = await req.json().catch(() => null);
  const ids = Array.isArray(body?.email_ids) ? (body.email_ids as unknown[]) : [];
  const cleanIds = ids
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .slice(0, MAX_BATCH);
  if (cleanIds.length === 0) return apiError("email_ids required", 400);

  // Pull existing rows for context. Batch path doesn't have access to the
  // raw inbox feed, so we rely on email_classifications already having
  // subject / from_email / from_name etc. populated. The hot-path classify
  // saves these on first run, and the email-sync flow seeds them - so any
  // email that has ever been opened or synced is eligible.
  const { data: rows, error } = await supabase
    .from("email_classifications")
    .select("email_id, subject, from_email, from_name")
    .in("email_id", cleanIds);
  if (error) return apiError(error.message, 500);
  if (!rows || rows.length === 0) {
    return apiError("No matching email_classifications rows found - submit ids that have been seen at least once", 400);
  }

  let submitted: { batch_id: string; request_count: number };
  try {
    submitted = await submitClassifyBatch(rows.map((r) => ({
      email_id: r.email_id as string,
      subject: r.subject as string | null,
      from_email: r.from_email as string | null,
      from_name: r.from_name as string | null,
      // preview/body/to/cc are not stored on email_classifications so we
      // submit the lighter context. Sufficient for category/tag/stage
      // detection on legacy rows; live sync calls still get full context.
      preview: null,
      body: null,
      to: null,
      cc: null,
    })));
  } catch (e: unknown) {
    return apiError(e instanceof Error ? e.message : "Batch submission failed", 502);
  }

  const submittedEmailIds = rows.map((r) => r.email_id as string);

  const { data: tracking, error: insertErr } = await supabase
    .from("classify_batches")
    .insert({
      anthropic_batch_id: submitted.batch_id,
      email_ids: submittedEmailIds,
      status: "in_progress",
      submitted_by: session.email,
      request_count: submitted.request_count,
    } as never)
    .select()
    .single();
  if (insertErr) {
    // Anthropic batch is already submitted - log loudly but don't 500 the
    // caller; the cron will still pick this up by anthropic_batch_id once
    // the row is reconciled.
    console.error("[classify-batch] tracking insert failed:", insertErr.message);
    return apiResponse({
      anthropic_batch_id: submitted.batch_id,
      request_count: submitted.request_count,
      warning: "Submitted to Anthropic but failed to record tracking row",
    });
  }

  return apiResponse({ batch: tracking });
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const url = new URL(req.url);
  const idParam = url.searchParams.get("id");
  const allOpen = url.searchParams.get("all") === "open";

  let rows: Array<Record<string, unknown>> = [];
  if (idParam) {
    const { data, error } = await supabase
      .from("classify_batches")
      .select("*")
      .eq("id", parseInt(idParam))
      .limit(1);
    if (error) return apiError(error.message, 500);
    rows = (data as unknown as Array<Record<string, unknown>>) || [];
  } else if (allOpen) {
    const { data, error } = await supabase
      .from("classify_batches")
      .select("*")
      .eq("status", "in_progress");
    if (error) return apiError(error.message, 500);
    rows = (data as unknown as Array<Record<string, unknown>>) || [];
  } else {
    // No filter: return the 20 most recent batches for the dashboard.
    const { data, error } = await supabase
      .from("classify_batches")
      .select("*")
      .order("submitted_at", { ascending: false })
      .limit(20);
    if (error) return apiError(error.message, 500);
    return apiResponse({ batches: data ?? [] });
  }

  const updated: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const result = await pollAndProcessOne(row);
    updated.push(result);
  }

  return apiResponse({ batches: updated });
}

/**
 * Poll one tracking row's Anthropic batch and process results if ready.
 * Used by both manual GET and the cron job. Exported via a separate
 * route call rather than imported because both code paths live in
 * server-only API routes.
 */
async function pollAndProcessOne(
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = row.id as number;
  const anthropicBatchId = row.anthropic_batch_id as string;

  if (row.status !== "in_progress") {
    return row;
  }

  let status;
  try {
    status = await fetchBatchStatus(anthropicBatchId);
  } catch (err) {
    console.warn(`[classify-batch] poll failed for ${anthropicBatchId}:`, err);
    return row;
  }

  if (status.processing_status === "in_progress") {
    return { ...row, _live_status: status.processing_status, _request_counts: status.request_counts };
  }

  // Batch has ended (success, canceled, or expired). Process if results
  // are available, then mark the tracking row complete with counts.
  let succeeded = 0;
  let errored = 0;
  if (status.results_url) {
    try {
      const counts = await processBatchResults(anthropicBatchId, status.results_url);
      succeeded = counts.succeeded;
      errored = counts.errored;
    } catch (err) {
      console.warn(`[classify-batch] processing failed for ${anthropicBatchId}:`, err);
    }
  }

  const finalStatus: "completed" | "canceled" | "expired" | "errored" =
    status.processing_status === "canceled"
      ? "canceled"
      : status.request_counts.expired > 0
        ? "expired"
        : status.request_counts.errored === status.request_counts.processing + status.request_counts.succeeded
          ? "errored"
          : "completed";

  const { data: updatedRow, error: updateErr } = await supabase
    .from("classify_batches")
    .update({
      status: finalStatus,
      completed_at: status.ended_at || new Date().toISOString(),
      succeeded_count: succeeded,
      errored_count: errored,
    } as never)
    .eq("id", id)
    .select()
    .single();

  if (updateErr) {
    console.warn(`[classify-batch] tracking update failed for id=${id}:`, updateErr.message);
    return row;
  }
  return (updatedRow as unknown) as Record<string, unknown>;
}
