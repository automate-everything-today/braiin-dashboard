/**
 * LLM gateway - the single boundary every Braiin LLM call goes through.
 *
 * Replaces 14 distinct fetch() call sites that each duplicate API
 * key reading, header setup, error handling, and have no central
 * token metering or response cache.
 *
 * Public API:
 *   complete(params: LlmCompleteParams) -> LlmResult
 *
 * Behaviour:
 *   1. If params.cacheKey is set, look up activity.llm_cache. On hit,
 *      write a cache_hit telemetry row and return immediately.
 *   2. Otherwise call the provider (currently anthropic-only).
 *   3. On success: write activity.llm_calls row, optionally upsert
 *      activity.llm_cache, return result.
 *   4. On failure: write activity.llm_calls row with success=false,
 *      then re-throw.
 *
 * Server-only. Imports @/services/base which uses the service-role
 * key on the server. Calling from a browser context will throw.
 */

import { randomUUID } from "node:crypto";
import { computeCacheKey, readCache, writeCache } from "./cache";
import { resolveTimeSavedSeconds } from "./human-equivalents";
import { meter } from "./metering";
import { callAnthropic } from "./providers/anthropic";
import {
  type LlmCompleteParams,
  type LlmResult,
  LlmGatewayError,
} from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-6" as const;
const DEFAULT_MAX_TOKENS = 1024;
const TENANT_ZERO_ORG_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Anthropic prices in cents-per-million-tokens (sonnet-4-6).
 * Roughly indicative; revisit when Anthropic pricing changes.
 * cached_input is 1/10th of input rate per Anthropic ephemeral cache pricing.
 */
const PRICE_PER_M_TOKENS_CENTS: Record<string, { input: number; output: number; cachedInput: number }> = {
  "claude-opus-4-7": { input: 1500, output: 7500, cachedInput: 150 },
  "claude-sonnet-4-6": { input: 300, output: 1500, cachedInput: 30 },
  "claude-haiku-4-5": { input: 100, output: 500, cachedInput: 10 },
};

/**
 * Normalise a possibly-dated model string ("claude-haiku-4-5-20251001")
 * down to its pricing-table key ("claude-haiku-4-5"). Anthropic's
 * date-suffixed snapshots use the same prices as the family.
 */
function pricingKey(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

function computeCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number,
): number | null {
  const pricing = PRICE_PER_M_TOKENS_CENTS[pricingKey(model)];
  if (!pricing) return null;
  const fresh = (inputTokens - cachedInputTokens) * pricing.input;
  const cached = cachedInputTokens * pricing.cachedInput;
  const out = outputTokens * pricing.output;
  return (fresh + cached + out) / 1_000_000;
}

function flattenSystem(
  system: LlmCompleteParams["system"],
): string {
  if (system === undefined) return "";
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system
      .map((s) => (typeof s === "string" ? s : s.text))
      .join("\n");
  }
  return system.text;
}

/** Flatten user/messages into a single string for cache key derivation. */
function flattenUserContent(params: LlmCompleteParams): string {
  if (params.messages && params.messages.length > 0) {
    return params.messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
  }
  return params.user ?? "";
}

export async function complete(params: LlmCompleteParams): Promise<LlmResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new LlmGatewayError(
      "ANTHROPIC_API_KEY not configured",
      "missing_api_key",
    );
  }

  const provider = "anthropic";
  const model = params.model ?? DEFAULT_MODEL;
  const orgId = params.orgId ?? TENANT_ZERO_ORG_ID;
  const requestedBy = params.requestedBy ?? "service_role";
  const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
  const timeSavedOnSuccess = resolveTimeSavedSeconds(
    params.purpose,
    params.humanEquivalentSeconds,
  );
  // Auto-mint decision_id if caller didn't supply one. Every LLM
  // call leaves a stable identifier in activity.llm_calls so feedback
  // (activity.llm_feedback) can be wired against it later. See engiine
  // adoption RFC section 3.2.
  const decisionId = params.decisionId ?? randomUUID();

  // Validate input shape - either user or messages must be present.
  if (!params.user && (!params.messages || params.messages.length === 0)) {
    throw new LlmGatewayError(
      "Either `user` or non-empty `messages` must be provided",
      "missing_input",
    );
  }

  // Cache key (only if caller opted in)
  const cacheKey = params.cacheKey
    ? computeCacheKey({
        label: params.cacheKey,
        provider,
        model,
        system: flattenSystem(params.system),
        user: flattenUserContent(params),
        maxTokens,
        temperature: params.temperature,
      })
    : null;

  // === 1. Cache lookup ===
  if (cacheKey) {
    const cached = await readCache(cacheKey);
    if (cached) {
      const callId = await meter({
        orgId,
        provider,
        model,
        purpose: params.purpose,
        inputTokens: cached.inputTokens,
        outputTokens: cached.outputTokens,
        cachedInputTokens: 0,
        costCents: 0,
        latencyMs: 0,
        cacheKey,
        cacheHit: true,
        decisionId,
        correlationEventId: params.correlationEventId ?? null,
        requestedBy,
        success: true,
        errorCode: null,
        errorMessage: null,
        metadata: { ...(params.metadata ?? {}), cache_layer: "content_hash" },
        timeSavedSeconds: timeSavedOnSuccess,
      });

      return {
        text: cached.text,
        inputTokens: cached.inputTokens,
        outputTokens: cached.outputTokens,
        cachedInputTokens: 0,
        model,
        provider,
        cacheHit: true,
        callId,
        latencyMs: 0,
        timeSavedSeconds: timeSavedOnSuccess,
        decisionId,
      };
    }
  }

  // === 2. Provider call ===
  const startedAt = Date.now();

  try {
    const result = await callAnthropic({
      apiKey,
      model,
      system: params.system,
      user: params.user,
      messages: params.messages,
      maxTokens,
      temperature: params.temperature,
    });
    const latencyMs = Date.now() - startedAt;

    const costCents = computeCostCents(
      result.model,
      result.inputTokens,
      result.outputTokens,
      result.cachedInputTokens,
    );

    // === 3a. Telemetry on success ===
    const callId = await meter({
      orgId,
      provider,
      model: result.model,
      purpose: params.purpose,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cachedInputTokens: result.cachedInputTokens,
      costCents,
      latencyMs,
      cacheKey,
      cacheHit: false,
      decisionId: params.decisionId ?? null,
      correlationEventId: params.correlationEventId ?? null,
      requestedBy,
      success: true,
      errorCode: null,
      errorMessage: null,
      metadata: params.metadata ?? {},
      timeSavedSeconds: timeSavedOnSuccess,
    });

    // === 3b. Cache write (if caller opted in) ===
    if (cacheKey) {
      await writeCache({
        cacheKey,
        provider,
        model: result.model,
        purpose: params.purpose,
        text: result.text,
        finishReason: result.finishReason,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        ttlSeconds: params.cacheTtlSeconds,
      });
    }

    return {
      text: result.text,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cachedInputTokens: result.cachedInputTokens,
      model: result.model,
      provider,
      cacheHit: false,
      callId,
      latencyMs,
      timeSavedSeconds: timeSavedOnSuccess,
      decisionId,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const isGatewayErr = err instanceof LlmGatewayError;
    const errorCode = isGatewayErr ? err.errorCode : "unknown";
    const errorMessage = err instanceof Error ? err.message : String(err);

    // === 4. Telemetry on failure ===
    await meter({
      orgId,
      provider,
      model,
      purpose: params.purpose,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costCents: 0,
      latencyMs,
      cacheKey,
      cacheHit: false,
      decisionId: params.decisionId ?? null,
      correlationEventId: params.correlationEventId ?? null,
      requestedBy,
      success: false,
      errorCode,
      errorMessage,
      metadata: params.metadata ?? {},
      timeSavedSeconds: 0, // failures deliver no value
    });

    throw err;
  }
}

export type { LlmCompleteParams, LlmResult, SystemSegment, LlmModel, LlmMessage } from "./types";
export { LlmGatewayError } from "./types";
