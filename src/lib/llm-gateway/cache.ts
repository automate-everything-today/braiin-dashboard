/**
 * Content-hash response cache for the LLM gateway.
 *
 * Backed by activity.llm_cache. Keyed by SHA-256 of
 * (provider | model | system | user | params). Sits beside
 * Anthropic's 5-minute ephemeral prompt cache: ephemeral wins
 * inside a 5-minute burst, this wins across hours/days for
 * deterministic prompts (classification, extraction, schema-
 * bound JSON). Caller opts in via cacheKey on LlmCompleteParams.
 */

import { createHash } from "node:crypto";
import { supabase } from "@/services/base";

interface CacheClient {
  from(table: string): {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: CachedRow | null; error: { message: string } | null }>;
      };
    };
    upsert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    update: (vals: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
  };
}

interface CachedRow {
  cache_key: string;
  response: { text: string; finish_reason?: string };
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  expires_at: string | null;
}

function activityClient(): CacheClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).schema("activity") as CacheClient;
}

/**
 * Compute the cache key. Mixes the caller-supplied label with all
 * inputs that influence model output so semantically identical
 * calls hit the same key regardless of how the caller composed
 * the cacheKey label.
 */
export function computeCacheKey(input: {
  label: string[] | string;
  provider: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): string {
  const labelStr = Array.isArray(input.label) ? input.label.join("|") : input.label;
  const payload = JSON.stringify({
    label: labelStr,
    provider: input.provider,
    model: input.model,
    system: input.system,
    user: input.user,
    maxTokens: input.maxTokens ?? null,
    temperature: input.temperature ?? null,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export interface CacheReadHit {
  text: string;
  inputTokens: number;
  outputTokens: number;
  finishReason?: string;
}

/**
 * Look up a cached response. Returns null on miss, expired entry,
 * or DB error (logged, never throws - cache failures degrade to
 * "no cache" rather than breaking the call).
 */
export async function readCache(cacheKey: string): Promise<CacheReadHit | null> {
  try {
    const { data, error } = await activityClient()
      .from("llm_cache")
      .select("cache_key,response,provider,model,input_tokens,output_tokens,expires_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (error) {
      console.warn("[llm-gateway/cache] read failed:", error.message);
      return null;
    }
    if (!data) return null;

    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
      return null;
    }

    // Fire-and-forget hit-count update. Don't block the caller on it.
    activityClient()
      .from("llm_cache")
      .update({ last_hit_at: new Date().toISOString() })
      .eq("cache_key", cacheKey)
      .then(({ error: updErr }) => {
        if (updErr) {
          console.warn("[llm-gateway/cache] hit_count update failed:", updErr.message);
        }
      });

    return {
      text: data.response.text,
      inputTokens: data.input_tokens,
      outputTokens: data.output_tokens,
      finishReason: data.response.finish_reason,
    };
  } catch (err) {
    console.warn(
      "[llm-gateway/cache] read threw:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Write a response to the cache. Errors logged but never thrown -
 * cache failures must never break the user-facing call path.
 */
export async function writeCache(input: {
  cacheKey: string;
  provider: string;
  model: string;
  purpose: string;
  text: string;
  finishReason?: string;
  inputTokens: number;
  outputTokens: number;
  ttlSeconds?: number;
}): Promise<void> {
  try {
    const expiresAt = input.ttlSeconds
      ? new Date(Date.now() + input.ttlSeconds * 1000).toISOString()
      : null;

    const { error } = await activityClient().from("llm_cache").upsert({
      cache_key: input.cacheKey,
      response: { text: input.text, finish_reason: input.finishReason },
      provider: input.provider,
      model: input.model,
      purpose: input.purpose,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      expires_at: expiresAt,
    });

    if (error) {
      console.warn("[llm-gateway/cache] write failed:", error.message);
    }
  } catch (err) {
    console.warn(
      "[llm-gateway/cache] write threw:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
