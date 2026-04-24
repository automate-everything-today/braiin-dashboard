import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";
import { apiError, apiResponse } from "@/lib/validation";
import {
  CONVERSATION_STAGES,
  isConversationStage,
  type ConversationStage,
} from "@/lib/conversation-stages";

/**
 * Stages dashboard feed. Returns the latest classified email per sender
 * per stage, so the kanban columns read as "deals" not a raw activity
 * stream. Staleness (days since last activity) is computed for each
 * card so the UI can flag deals stuck at a stage longer than a
 * threshold (e.g. quote_sent > 5 days = follow up).
 */

type StageCard = {
  email_id: string;
  subject: string;
  from_name: string;
  from_email: string;
  created_at: string;
  summary: string;
  stage: ConversationStage;
  stage_source: "ai" | "user";
  tags: string[];
  days_in_stage: number;
};

export async function GET() {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  // Fetch classifications with any effective stage. We cap at 2000 rows
  // because the email_classifications table is small today (~a few
  // hundred) but this gives headroom for 6-12 months without a redesign.
  const { data, error } = await supabase
    .from("email_classifications")
    .select(
      "email_id, subject, from_name, from_email, ai_summary, ai_tags, user_tags, ai_conversation_stage, user_conversation_stage, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) return apiError(error.message, 500);

  // Group by stage, keep the latest row per from_email so each sender
  // appears once per stage column. Later rows of the same sender in the
  // same stage are suppressed (they're just earlier messages in the
  // same thread).
  const byStage: Record<ConversationStage, StageCard[]> = Object.fromEntries(
    CONVERSATION_STAGES.map((s) => [s, [] as StageCard[]]),
  ) as Record<ConversationStage, StageCard[]>;
  const seenSenderInStage = new Set<string>();
  const now = Date.now();

  for (const row of ((data || []) as unknown) as Array<Record<string, unknown>>) {
    const userStage = row.user_conversation_stage;
    const aiStage = row.ai_conversation_stage;
    const stage = isConversationStage(userStage)
      ? (userStage as ConversationStage)
      : isConversationStage(aiStage)
        ? (aiStage as ConversationStage)
        : null;
    if (!stage) continue;

    const fromEmail = ((row.from_email as string | null) || "").toLowerCase();
    const dedupeKey = `${stage}::${fromEmail}`;
    if (seenSenderInStage.has(dedupeKey)) continue;
    seenSenderInStage.add(dedupeKey);

    const createdAt = (row.created_at as string) || new Date().toISOString();
    const daysInStage = Math.max(
      0,
      Math.floor((now - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)),
    );

    const userTags = Array.isArray(row.user_tags) ? (row.user_tags as string[]) : null;
    const aiTags = Array.isArray(row.ai_tags) ? (row.ai_tags as string[]) : [];
    const tags = userTags && userTags.length > 0 ? userTags : aiTags;

    byStage[stage].push({
      email_id: (row.email_id as string) || "",
      subject: (row.subject as string) || "",
      from_name: (row.from_name as string) || "",
      from_email: (row.from_email as string) || "",
      created_at: createdAt,
      summary: (row.ai_summary as string) || "",
      stage,
      stage_source: isConversationStage(userStage) ? "user" : "ai",
      tags,
      days_in_stage: daysInStage,
    });
  }

  return apiResponse({
    columns: CONVERSATION_STAGES.map((stage) => ({
      stage,
      count: byStage[stage].length,
      cards: byStage[stage],
    })),
  });
}
