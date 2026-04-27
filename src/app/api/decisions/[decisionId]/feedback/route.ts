/**
 * Decision feedback endpoint - engiine adoption RFC section 3.2.
 *
 * POST /api/decisions/{decisionId}/feedback
 *   body: { type: "confirm" | "reject" | "correct" | "flag",
 *           note?: string,
 *           correctedOutput?: string,
 *           metadata?: Record<string, unknown> }
 *
 * Records a row in activity.llm_feedback against the supplied
 * decision_id. The decision_id is the UUID minted by the LLM gateway
 * for every call (see src/lib/llm-gateway/index.ts) and surfaced on
 * LlmResult.decisionId. UI affordances pass it back with the user's
 * verdict.
 *
 * Auth: cookie session via the global proxy. Submitter is the
 * authenticated user's email.
 *
 * Validation:
 *   - decisionId must be a valid UUID
 *   - type must be one of the four allowed values
 *   - correctedOutput is only persisted when type === "correct"
 *
 * Returns: { feedback_id, decision_id, type, submitted_by, submitted_at }.
 *
 * Service-role on the schema query because activity.* is service-
 * role-only.
 */

import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";
import { TENANT_ZERO_ORG_ID } from "@/lib/activity/log-event";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_TYPES = new Set(["confirm", "reject", "correct", "flag"]);
const NOTE_MAX_CHARS = 2000;
const CORRECTION_MAX_CHARS = 8000;

interface FeedbackInsert {
  decision_id: string;
  org_id: string;
  feedback_type: "confirm" | "reject" | "correct" | "flag";
  note: string | null;
  corrected_output: string | null;
  submitted_by: string;
  metadata: Record<string, unknown>;
}

interface FeedbackRow extends FeedbackInsert {
  feedback_id: string;
  submitted_at: string;
}

interface ActivityFeedbackClient {
  from(table: string): {
    insert: (
      row: FeedbackInsert,
    ) => {
      select: (cols: string) => {
        single: () => Promise<{ data: FeedbackRow | null; error: { message: string } | null }>;
      };
    };
  };
}

function activityClient(): ActivityFeedbackClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).schema("activity") as ActivityFeedbackClient;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ decisionId: string }> },
) {
  const session = await getSession();
  if (!session?.email) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { decisionId } = await ctx.params;
  if (!UUID_REGEX.test(decisionId)) {
    return Response.json({ error: "decisionId must be a UUID" }, { status: 400 });
  }

  let body: {
    type?: string;
    note?: string;
    correctedOutput?: string;
    metadata?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.type || !ALLOWED_TYPES.has(body.type)) {
    return Response.json(
      { error: "type must be one of: confirm, reject, correct, flag" },
      { status: 400 },
    );
  }

  if (body.note !== undefined && typeof body.note !== "string") {
    return Response.json({ error: "note must be a string" }, { status: 400 });
  }
  if (body.correctedOutput !== undefined && typeof body.correctedOutput !== "string") {
    return Response.json({ error: "correctedOutput must be a string" }, { status: 400 });
  }

  // correctedOutput only meaningful with type=correct
  const correctedOutput =
    body.type === "correct" && body.correctedOutput
      ? body.correctedOutput.slice(0, CORRECTION_MAX_CHARS)
      : null;

  const insertRow: FeedbackInsert = {
    decision_id: decisionId,
    org_id: TENANT_ZERO_ORG_ID,
    feedback_type: body.type as FeedbackInsert["feedback_type"],
    note: body.note ? body.note.slice(0, NOTE_MAX_CHARS) : null,
    corrected_output: correctedOutput,
    submitted_by: session.email,
    metadata: body.metadata ?? {},
  };

  const { data, error } = await activityClient()
    .from("llm_feedback")
    .insert(insertRow)
    .select("feedback_id,decision_id,feedback_type,submitted_by,submitted_at")
    .single();

  if (error || !data) {
    console.error("[decisions/feedback] insert failed:", error?.message);
    return Response.json(
      { error: "Failed to record feedback" },
      { status: 500 },
    );
  }

  return Response.json({
    feedback_id: data.feedback_id,
    decision_id: data.decision_id,
    type: data.feedback_type,
    submitted_by: data.submitted_by,
    submitted_at: data.submitted_at,
  });
}
