/**
 * Telemetry write path for the LLM gateway.
 *
 * Every call - cache hit, miss, success, failure - writes one
 * row to activity.llm_calls. This is the audit trail and the
 * cost-rollup source of truth.
 *
 * Errors are logged but never thrown: telemetry failure must
 * never break the user-facing call.
 */

import { randomUUID } from "node:crypto";
import { supabase } from "@/services/base";

interface MeterClient {
  from(table: string): {
    insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  };
}

function activityClient(): MeterClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).schema("activity") as MeterClient;
}

export interface MeterParams {
  orgId: string;
  provider: string;
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costCents: number | null;
  latencyMs: number | null;
  cacheKey: string | null;
  cacheHit: boolean;
  decisionId: string | null;
  correlationEventId: string | null;
  requestedBy: string;
  success: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Insert a telemetry row. Returns the call_id so callers can
 * surface it for support tickets / debugging without a second DB
 * round-trip. Returns a fresh UUID even on insert failure so the
 * caller has a stable identifier in logs.
 */
export async function meter(params: MeterParams): Promise<string> {
  const callId = randomUUID();

  try {
    const { error } = await activityClient().from("llm_calls").insert({
      call_id: callId,
      org_id: params.orgId,
      provider: params.provider,
      model: params.model,
      purpose: params.purpose,
      input_tokens: params.inputTokens,
      output_tokens: params.outputTokens,
      cached_input_tokens: params.cachedInputTokens,
      cost_cents: params.costCents,
      latency_ms: params.latencyMs,
      cache_key: params.cacheKey,
      cache_hit: params.cacheHit,
      decision_id: params.decisionId,
      correlation_event_id: params.correlationEventId,
      requested_by: params.requestedBy,
      success: params.success,
      error_code: params.errorCode,
      error_message: params.errorMessage ? params.errorMessage.slice(0, 1000) : null,
      metadata: params.metadata,
    });

    if (error) {
      console.warn("[llm-gateway/metering] insert failed:", error.message);
    }
  } catch (err) {
    console.warn(
      "[llm-gateway/metering] insert threw:",
      err instanceof Error ? err.message : String(err),
    );
  }

  return callId;
}
