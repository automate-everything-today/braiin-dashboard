import { supabase } from "@/services/base";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { stripHtml } from "@/types/email";
import {
  loadReplyRules,
  formatRulesBlock,
  recordRulesUsage,
  upsertLearnedUserRule,
  getUserMode,
} from "@/lib/reply-rules";

import { complete as llmComplete, LlmGatewayError } from "@/lib/llm-gateway";

const MODEL = "claude-sonnet-4-6"; // Sonnet for reply drafting, not Haiku - tone matters
const BODY_MAX_CHARS = 4000;

/**
 * Regenerate the 3 suggested replies for an email, guided by a user
 * instruction such as "make it more direct" or "ask for a 10% discount".
 *
 * Reuses the current email_classifications row as context so Claude
 * doesn't re-classify from scratch. Writes the new reply_options back to
 * the same row so they persist.
 */
const SYSTEM_PROMPT = `You rewrite email reply drafts to match a user's instruction.

You will receive:
- The original email (sender, subject, body)
- The current 3 reply drafts
- A user instruction on how to change them

Return 3 new reply options following these rules:
- Each reply must include greeting, body, and sign-off separated by \\n\\n.
- Format: "Hi [first name],\\n\\n[paragraph 1]\\n\\n[paragraph 2 if needed]\\n\\nKind regards"
- The user's instruction is the priority. Apply it to all 3 replies.
- Keep the 3 replies meaningfully different from each other - different approaches, not just rephrasings.
- Professional but warm. Standard hyphens only (-), never em dashes.
- British English spelling.

Return JSON only:
{
  "reply_options": ["reply 1", "reply 2", "reply 3"]
}`;

export async function POST(req: Request) {
  if (!(await checkRateLimit(getClientIp(req)))) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const session = await getSession();
  if (!session?.email) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { email_id, instruction, subject, from_email, from_name, preview, body } = await req.json();
  if (!email_id || !instruction) {
    return Response.json({ error: "Missing email_id or instruction" }, { status: 400 });
  }

  // Load existing classification so we can show current replies to Claude.
  // We also fetch the AI's detected relevance (department / mode of the
  // email content) so reply rules are loaded against what the email is
  // actually about, not against the user's home assignment.
  const { data: existing, error: loadErr } = await supabase
    .from("email_classifications")
    .select("*")
    .eq("email_id", email_id)
    .single();

  if (loadErr) {
    console.error("[refine-replies] Failed to load existing classification:", loadErr.message);
    return Response.json({ error: "Could not load email context" }, { status: 500 });
  }

  const currentReplies = Array.isArray(existing?.ai_reply_options)
    ? (existing.ai_reply_options as string[])
    : [];
  const existingRow = existing as
    | {
        ai_category?: string | null;
        user_override_category?: string | null;
        ai_tags?: string[] | null;
        user_tags?: string[] | null;
      }
    | null;
  const existingCategory =
    existingRow?.user_override_category ||
    existingRow?.ai_category ||
    null;
  // Source of truth for tags: user's manual override beats Claude's
  // detection. If neither is set (legacy row before migration 012), fall
  // back to the user's home department + mode so refines still get
  // something reasonable.
  let effectiveTags: string[] = existingRow?.user_tags?.length
    ? existingRow.user_tags
    : existingRow?.ai_tags?.length
      ? existingRow.ai_tags
      : [];
  if (effectiveTags.length === 0) {
    const homeDept = session.department ?? null;
    const homeMode = await getUserMode(session.email);
    effectiveTags = [homeDept, homeMode].filter((v): v is string => !!v);
  }

  const bodyText = body ? stripHtml(String(body)).slice(0, BODY_MAX_CHARS).trim() : "";

  // Layered reply rules at six scopes (category, user, mode, department,
  // branch, global). Most specific first so Claude prefers them on conflict.
  // The new instruction for THIS email always takes priority and is rendered
  // separately below.
  const branch = session.branch ?? null;
  const rules = await loadReplyRules({
    userEmail: session.email,
    category: existingCategory,
    tags: effectiveTags,
    branch,
  });
  // Don't echo back the same instruction the user just typed.
  const normalisedNewInstr = instruction.trim().toLowerCase();
  const filteredRules = rules.filter(
    (r) => r.instruction.trim().toLowerCase() !== normalisedNewInstr,
  );
  const voiceBlock = formatRulesBlock(filteredRules);

  const userMessage = `${voiceBlock}ORIGINAL EMAIL:
From: ${from_name || ""} (${from_email || ""})
Subject: ${subject || ""}
Preview: ${preview || ""}
${bodyText ? `\nBody:\n${bodyText}\n` : ""}

CURRENT REPLY DRAFTS:
${currentReplies.map((r, i) => `Draft ${i + 1}:\n${r}`).join("\n\n---\n\n") || "(none yet)"}

NEW INSTRUCTION FOR THIS EMAIL (takes priority):
${instruction}

Rewrite the 3 reply drafts per the new instruction, while staying consistent with the reply rules above.`;

  let llmResult;
  try {
    llmResult = await llmComplete({
      purpose: "refine_replies",
      model: MODEL,
      maxTokens: 1200,
      system: { text: SYSTEM_PROMPT, cacheControl: "ephemeral" },
      user: userMessage,
    });
  } catch (e: unknown) {
    if (e instanceof LlmGatewayError) {
      console.error("[refine-replies] LLM gateway error:", e.errorCode, e.message);
      return Response.json({ error: "Refinement service unavailable" }, { status: 502 });
    }
    throw e;
  }

  try {
    let text = llmResult.text || "{}";
    text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(text);
    const newReplies = Array.isArray(parsed.reply_options) ? parsed.reply_options : [];

    if (newReplies.length === 0) {
      return Response.json({ error: "AI returned no replies" }, { status: 502 });
    }

    // Persist so the next time the email is opened we serve the refined set
    const { error: saveErr } = await supabase
      .from("email_classifications")
      .update({ ai_reply_options: newReplies })
      .eq("email_id", email_id);

    if (saveErr) {
      console.error(`[refine-replies] Failed to save refined replies for ${email_id}:`, saveErr.message);
      // Still return the new replies to the client; persistence is best-effort
    }

    // Learning, two paths:
    //   1. reply_learnings - legacy per-sender-domain store kept for analytics
    //      and the usage dashboard.
    //   2. reply_rules - the new hierarchical store. Every user refinement
    //      becomes a scope_type='user' learned rule so it flows into future
    //      classify-email calls across ALL senders and categories.
    const senderDomain = (from_email || "").toLowerCase().split("@")[1] || null;

    const { error: learnErr } = await supabase.from("reply_learnings").insert({
      user_email: session.email,
      sender_domain: senderDomain,
      sender_email: (from_email || "").toLowerCase() || null,
      category: existingCategory,
      instruction,
      reply_options: newReplies,
    });
    if (learnErr) {
      console.error("[refine-replies] Failed to store learning:", learnErr.message);
    }

    void upsertLearnedUserRule({ userEmail: session.email, instruction });

    // Bump usage counters on the rules that influenced this refinement.
    if (filteredRules.length > 0) {
      void recordRulesUsage(filteredRules.map((r) => r.id));
    }

    return Response.json({ reply_options: newReplies });
  } catch (e: unknown) {
    console.error("[refine-replies] Unexpected failure:", e);
    const msg = e instanceof Error ? e.message : "Refinement failed";
    return Response.json({ error: msg }, { status: 500 });
  }
}
