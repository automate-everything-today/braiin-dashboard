import { supabase } from "@/services/base";
import {
  CLASSIFIER_RULES,
  CLASSIFY_MODEL,
  CLASSIFY_MAX_TOKENS,
  buildBatchUserMessage,
} from "@/lib/classify-prompt";
import { normaliseTags } from "@/lib/relevance-tags";
import { normaliseStage } from "@/lib/conversation-stages";
import { findNetworkByEmail } from "@/lib/freight-networks";

/**
 * Wrappers around the Anthropic Messages Batches API. Used for cost-
 * sensitive bulk reclassification (legacy backfill, manager-triggered
 * "re-classify all stale", etc.). The hot-path /api/classify-email POST
 * keeps using sync calls because batch results take up to 24h.
 *
 * Anthropic charges 50% of per-token cost on Batch API for both input
 * and output, so a backfill of N rows that would cost £X synchronously
 * costs ~£X/2 here. Same prompt + same model => same classification
 * quality.
 */

const ANTHROPIC_BATCH_URL = "https://api.anthropic.com/v1/messages/batches";
const ANTHROPIC_VERSION = "2023-06-01";

type BatchRequestParams = {
  model: string;
  max_tokens: number;
  system: { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[];
  messages: { role: "user"; content: string }[];
};

type BatchRequest = {
  custom_id: string;
  params: BatchRequestParams;
};

type AnthropicBatch = {
  id: string;
  processing_status: "in_progress" | "ended" | "canceling" | "canceled";
  request_counts: {
    processing: number;
    succeeded: number;
    errored: number;
    canceled: number;
    expired: number;
  };
  results_url: string | null;
  ended_at: string | null;
};

/**
 * Submit a list of emails to the Anthropic Batches API. Returns the
 * Anthropic batch_id; the caller stores it in classify_batches and polls.
 */
export async function submitClassifyBatch(
  emails: Array<{
    email_id: string;
    subject?: string | null;
    from_email?: string | null;
    from_name?: string | null;
    preview?: string | null;
    body?: string | null;
    to?: string[] | null;
    cc?: string[] | null;
  }>,
): Promise<{ batch_id: string; request_count: number }> {
  if (emails.length === 0) throw new Error("No emails to submit");
  if (emails.length > 10000) throw new Error("Batch API limit is 10,000 requests");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  // Look up network matches up-front so the prompt for each email can
  // include the SENDER NETWORK MATCH hint - same signal the sync path
  // gets. Done in parallel because findNetworkByEmail is read-only.
  const networkMatches = await Promise.all(
    emails.map((e) => findNetworkByEmail(e.from_email || "")),
  );

  const requests: BatchRequest[] = emails.map((email, i) => ({
    custom_id: email.email_id,
    params: {
      model: CLASSIFY_MODEL,
      max_tokens: CLASSIFY_MAX_TOKENS,
      system: [
        {
          type: "text",
          text: CLASSIFIER_RULES,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: buildBatchUserMessage({
            ...email,
            network_match: networkMatches[i]
              ? { name: networkMatches[i]!.name, relationship: networkMatches[i]!.relationship }
              : null,
          }),
        },
      ],
    },
  }));

  const res = await fetch(ANTHROPIC_BATCH_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic Batch API ${res.status}: ${errBody}`);
  }

  const data = (await res.json()) as AnthropicBatch;
  return { batch_id: data.id, request_count: requests.length };
}

/**
 * Fetch the current status of an Anthropic batch. Returns the parsed
 * batch object, including processing_status and request_counts. Used by
 * the polling endpoint to decide whether to download results.
 */
export async function fetchBatchStatus(batchId: string): Promise<AnthropicBatch> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await fetch(`${ANTHROPIC_BATCH_URL}/${batchId}`, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic batch status ${res.status}: ${errBody}`);
  }
  return (await res.json()) as AnthropicBatch;
}

/**
 * Download and parse the JSONL results file for a completed batch. Each
 * line is one request's outcome, with custom_id matching the email_id we
 * submitted. Writes successful classifications back to email_classifications
 * (same shape as the sync path's upsert) and returns count summaries.
 */
export async function processBatchResults(
  batchId: string,
  resultsUrl: string,
): Promise<{ succeeded: number; errored: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await fetch(resultsUrl, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to download batch results: ${res.status}`);
  }

  const text = await res.text();
  const lines = text.split("\n").filter((line) => line.trim().length > 0);

  let succeeded = 0;
  let errored = 0;

  for (const line of lines) {
    let parsed: {
      custom_id?: string;
      result?: {
        type: "succeeded" | "errored" | "canceled" | "expired";
        message?: { content?: Array<{ type: string; text?: string }> };
      };
    };
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      console.warn(`[classify-batch] failed to parse result line for batch ${batchId}:`, err);
      errored++;
      continue;
    }

    const emailId = parsed.custom_id;
    const outcome = parsed.result;
    if (!emailId || !outcome) {
      errored++;
      continue;
    }

    if (outcome.type !== "succeeded") {
      errored++;
      continue;
    }

    const textBlock = outcome.message?.content?.find((c) => c.type === "text");
    const raw = textBlock?.text || "";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let classification: Record<string, unknown>;
    try {
      classification = JSON.parse(cleaned);
    } catch {
      errored++;
      continue;
    }

    const aiTags = normaliseTags(classification.tags);
    const aiStage = normaliseStage(classification.conversation_stage);

    const { error } = await supabase
      .from("email_classifications")
      .upsert(
        {
          email_id: emailId,
          ai_category: (classification.category as string) || "fyi",
          ai_priority: (classification.priority as string) || "normal",
          ai_summary: (classification.summary as string) || "",
          ai_suggested_action: (classification.suggested_action as string) || "",
          ai_reply_options: (classification.reply_options as unknown) || [],
          ai_quote_details: classification.quote_details || null,
          ai_incident_detected: classification.incident_detected || null,
          ai_tags: aiTags,
          ai_conversation_stage: aiStage,
        } as never,
        { onConflict: "email_id" },
      );

    if (error) {
      console.warn(`[classify-batch] failed to write result for ${emailId}:`, error.message);
      errored++;
    } else {
      succeeded++;
    }
  }

  return { succeeded, errored };
}
