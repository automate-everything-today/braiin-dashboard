/**
 * Shared types for the LLM gateway.
 *
 * The gateway is the single boundary every Braiin LLM call flows
 * through. Provider-specific quirks (Anthropic's `system` array,
 * `cache_control: ephemeral`, etc.) are normalised to this shape;
 * provider modules translate back at the wire.
 */

export type LlmProvider = "anthropic"; // OpenAI/etc to follow

/**
 * Common Anthropic model identifiers. Arbitrary strings are also
 * accepted (`claude-haiku-4-5-20251001`, future variants) - the
 * union exists for autocomplete, not validation. Provider is the
 * source of truth for what's actually accepted.
 */
export type LlmModel =
  | "claude-opus-4-7"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5"
  | (string & {});

/**
 * A system-prompt segment. Plain string for the simple case;
 * object form lets the caller opt into Anthropic's 5-minute
 * ephemeral prompt cache for static rule blocks (classifier
 * rules, persona prompts, schemas) without burning tokens on
 * repeat calls.
 */
export type SystemSegment =
  | string
  | { text: string; cacheControl?: "ephemeral" };

export interface LlmCompleteParams {
  /**
   * App-defined tag identifying *why* the call was made. Used
   * for telemetry rollups ("how much did classify-email cost
   * this month?") and cache analytics. Use snake_case.
   */
  purpose: string;

  /** System prompt(s). Single string or array of segments. */
  system?: SystemSegment | SystemSegment[];

  /** User message content. */
  user: string;

  /** Model. Defaults to claude-sonnet-4-6. */
  model?: LlmModel;

  /** Hard cap on output tokens. */
  maxTokens?: number;

  /** Sampling temperature. Provider default if omitted. */
  temperature?: number;

  /**
   * Opt-in content-hash cache. When provided, the gateway hashes
   * (provider | model | system | user | params) into a SHA-256
   * key and serves a cached response if present. Pass an array
   * of strings to make the key human-readable in telemetry; the
   * gateway joins them with '|' before mixing into the hash.
   *
   * Pass undefined (default) to skip the cache entirely. Useful
   * for chat / streaming / nondeterministic prompts.
   */
  cacheKey?: string[] | string;

  /**
   * Time-to-live for content-hash cache entries, in seconds.
   * Pass null/undefined for "no expiry". Has no effect when
   * cacheKey is not provided.
   */
  cacheTtlSeconds?: number;

  /**
   * Override the default human-equivalent time for this purpose.
   * If omitted, the gateway looks up `purpose` in
   * `human-equivalents.ts` and falls back to 0 if not mapped.
   * Counts on success (including cache hits); failures save 0.
   */
  humanEquivalentSeconds?: number;

  /**
   * Tenant scope. Defaults to TENANT_ZERO_ORG_ID.
   * Required field once multi-tenant CRM ships.
   */
  orgId?: string;

  /**
   * Caller identity for the audit row. Defaults to a service-
   * role-derived label; pass an email when the call is made on
   * behalf of an authenticated user.
   */
  requestedBy?: string;

  /** Soft link to a future decisions table. */
  decisionId?: string;

  /**
   * If this LLM call was triggered by an existing
   * activity.events row, pass its event_id so feedback can
   * stitch back through it later.
   */
  correlationEventId?: string;

  /** Free-form metadata persisted on the telemetry row. */
  metadata?: Record<string, unknown>;
}

export interface LlmResult {
  /** Primary text content from the model. */
  text: string;

  /** Input tokens charged. */
  inputTokens: number;

  /** Output tokens charged. */
  outputTokens: number;

  /** Tokens served from the provider's ephemeral prompt cache. */
  cachedInputTokens: number;

  /** Model identifier returned by the provider. */
  model: string;

  /** Provider identifier. */
  provider: LlmProvider;

  /** TRUE if the response was served from the content-hash cache. */
  cacheHit: boolean;

  /** UUID of the activity.llm_calls telemetry row. */
  callId: string;

  /** End-to-end latency in milliseconds. */
  latencyMs: number;

  /**
   * Human-equivalent time saved by this call (seconds). Resolved
   * from `human-equivalents.ts` per `purpose`, optionally
   * overridden via `humanEquivalentSeconds` on the call params.
   * Zero on failures.
   */
  timeSavedSeconds: number;
}

/** Result of a single provider call before caching/metering. */
export interface ProviderRawResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  model: string;
  finishReason?: string;
}

export class LlmGatewayError extends Error {
  constructor(
    message: string,
    public readonly errorCode: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "LlmGatewayError";
  }
}
