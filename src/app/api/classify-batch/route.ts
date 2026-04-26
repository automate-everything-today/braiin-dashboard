import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";
import { apiError, apiResponse } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  submitClassifyBatch,
  fetchBatchStatus,
  processBatchResults,
  determineFinalStatus,
  type ClassifyBatchFinalStatus,
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

/**
 * The classify_batches table's `notes` column stores raw exception
 * messages from processBatchResults failures (Anthropic response bodies,
 * network errors, parser errors). Surfacing those verbatim to a manager
 * UI would leak internal detail and contradicts the "generic 500" rule
 * the rest of this route now follows. Project to a sanitised summary.
 */
function sanitiseBatchRow(row: Record<string, unknown>): Record<string, unknown> {
  if (!row) return row;
  const { notes, ...safe } = row;
  if (notes != null && String(notes).length > 0) {
    return { ...safe, has_processing_error: true };
  }
  return safe;
}

async function isManager(email: string): Promise<boolean> {
  const { data } = await supabase
    .from("staff")
    .select("is_manager")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return Boolean((data as { is_manager?: boolean } | null)?.is_manager);
}

async function requireManagerOrAdmin(
  session: { email: string; role: string } | null,
): Promise<Response | null> {
  if (!session?.email) return apiError("Not authenticated", 401);
  if (session.role !== "super_admin" && !(await isManager(session.email))) {
    return apiError("Forbidden", 403);
  }
  return null;
}

// Anthropic spend caps. Manager gating limits WHO; these limit how
// expensive a compromised manager session can get before we notice.
const MAX_SUBMITS_PER_MIN = 3;
const MAX_DAILY_REQUESTS_PER_USER = 25_000;

export async function POST(req: Request) {
  const session = await getSession();
  const denied = await requireManagerOrAdmin(session);
  if (denied) return denied;

  const submitter = session!.email.toLowerCase();

  // Per-minute cap. 3 × MAX_BATCH = 3,000 Anthropic charges/min worst
  // case. Submissions are bursty (typically once per backfill job), so
  // a small per-minute cap matches the legitimate usage pattern.
  if (!(await checkRateLimit(`classify-batch-submit:${submitter}`, MAX_SUBMITS_PER_MIN))) {
    return apiError("Too many submissions. Please wait a moment.", 429);
  }

  // 24h request-volume quota across all batches submitted by this user.
  // Caps the daily blast radius of a compromised manager credential at
  // ~25k Anthropic batch requests, well above any legitimate backfill
  // pattern (typical: one or two thousand per onboarding).
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: dailyRows, error: dailyErr } = await supabase
    .from("classify_batches")
    .select("request_count")
    .eq("submitted_by", submitter)
    .gte("submitted_at", since);
  if (dailyErr) {
    console.error("[classify-batch] daily quota lookup failed:", dailyErr.message);
    // Fail closed on the quota check - we'd rather block a legitimate
    // submission than miss an attack.
    return apiError("Could not verify daily quota. Please retry.", 503);
  }
  const usedToday = (dailyRows ?? []).reduce(
    (acc, r) => acc + (Number((r as { request_count?: number | null }).request_count) || 0),
    0,
  );
  if (usedToday >= MAX_DAILY_REQUESTS_PER_USER) {
    console.warn(
      `[classify-batch] daily quota exceeded for ${submitter}: ${usedToday}/${MAX_DAILY_REQUESTS_PER_USER}`,
    );
    return apiError(
      "Daily classify-batch quota reached. Try again tomorrow or contact an admin.",
      429,
    );
  }

  const body = await req.json().catch(() => null);
  const ids = Array.isArray(body?.email_ids) ? (body.email_ids as unknown[]) : [];
  const cleanIds = ids
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .slice(0, MAX_BATCH);
  if (cleanIds.length === 0) return apiError("email_ids required", 400);

  // Reject if THIS submission would push the user over the daily quota.
  // The earlier check rejects when already-over; this catches "one big
  // submission tips us over" so we don't burn the cap on a single call.
  if (usedToday + cleanIds.length > MAX_DAILY_REQUESTS_PER_USER) {
    const remaining = Math.max(0, MAX_DAILY_REQUESTS_PER_USER - usedToday);
    return apiError(
      `This submission (${cleanIds.length}) would exceed today's quota. ${remaining} requests remaining.`,
      429,
    );
  }

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
      submitted_by: session!.email,
      request_count: submitted.request_count,
    })
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
  const denied = await requireManagerOrAdmin(session);
  if (denied) return denied;

  // 60/min/user. Manual polling from the dashboard plus the page-load
  // batch list both use this; 60 is comfortably above any realistic UI
  // pattern and still bounds how fast a single user can hit Anthropic.
  if (!(await checkRateLimit(`classify-batch-read:${session!.email.toLowerCase()}`, 60))) {
    return apiError("Too many requests. Please slow down.", 429);
  }

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
    const safeRows = ((data ?? []) as Array<Record<string, unknown>>).map(sanitiseBatchRow);
    return apiResponse({ batches: safeRows });
  }

  // Independent reads from Anthropic + DB writes per row, so poll in
  // parallel. allSettled (not all) so a single batch's unexpected
  // throw - e.g. a Supabase outage during the tracking-row update -
  // doesn't reject the whole request and wipe progress on the others.
  const settled = await Promise.allSettled(rows.map(pollAndProcessOne));
  const updated = settled.map((s, i) => {
    if (s.status === "fulfilled") return sanitiseBatchRow(s.value);
    console.error(
      `[classify-batch] poll worker rejected for id=${rows[i]?.id}:`,
      s.reason instanceof Error ? s.reason.message : s.reason,
    );
    return { ...sanitiseBatchRow(rows[i]), _poll_error: "Poll failed; see server logs" };
  });

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

  // "in_progress" and "canceling" are both transient. Anthropic transitions
  // canceling -> canceled as the cancel propagates; treating canceling as
  // terminal would write "completed" with zero counts to a row that will
  // never be re-polled (SELECT filters .eq("status", "in_progress")), so
  // the batch's actual outcome would be permanently lost.
  if (status.processing_status === "in_progress" || status.processing_status === "canceling") {
    return { ...row, _live_status: status.processing_status, _request_counts: status.request_counts };
  }

  // Batch has ended (success, canceled, or expired). Process if results
  // are available, then mark the tracking row complete with counts.
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
      // Don't quietly mark the batch completed with zeroes - we genuinely
      // don't know what landed. Flag as errored so the dashboard surfaces
      // the failure and a human can re-submit if needed.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[classify-batch] processing failed for ${anthropicBatchId}:`, msg);
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

  const { data: updatedRow, error: updateErr } = await supabase
    .from("classify_batches")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (updateErr) {
    console.warn(`[classify-batch] tracking update failed for id=${id}:`, updateErr.message);
    return row;
  }
  return (updatedRow as unknown) as Record<string, unknown>;
}
