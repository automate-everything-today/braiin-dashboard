/**
 * Anthropic provider for the LLM gateway.
 *
 * Translates the gateway's normalised LlmCompleteParams into
 * Anthropic's Messages API shape and parses the response back.
 * This is the ONLY file in src/* that should call
 * https://api.anthropic.com - everything else goes through the
 * gateway. CI lint enforces that (added in a follow-up PR after
 * all 14 existing call sites are migrated).
 */

import { LlmGatewayError, type LlmMessage, type SystemSegment } from "../types";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicMessageResponse {
  id: string;
  type: string;
  role: string;
  model: string;
  content: { type: string; text: string }[];
  stop_reason?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/**
 * Convert the gateway's SystemSegment to Anthropic's `system` array
 * shape. Strings become `{ type: "text", text }`; objects with
 * cacheControl: "ephemeral" map to `{ ..., cache_control: { type: "ephemeral" } }`.
 */
function buildSystemArray(
  system: SystemSegment | SystemSegment[] | undefined,
): { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[] | undefined {
  if (system === undefined) return undefined;
  const arr = Array.isArray(system) ? system : [system];
  if (arr.length === 0) return undefined;

  return arr.map((seg) => {
    if (typeof seg === "string") {
      return { type: "text" as const, text: seg };
    }
    return {
      type: "text" as const,
      text: seg.text,
      ...(seg.cacheControl === "ephemeral"
        ? { cache_control: { type: "ephemeral" as const } }
        : {}),
    };
  });
}

export interface AnthropicCallInput {
  apiKey: string;
  model: string;
  system: SystemSegment | SystemSegment[] | undefined;
  /** Pass exactly one of these: */
  user?: string;
  messages?: LlmMessage[];
  maxTokens: number;
  temperature?: number;
}

export interface AnthropicCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  model: string;
  finishReason?: string;
}

/**
 * Single Anthropic Messages API call. Throws LlmGatewayError on
 * any non-2xx; the gateway catches and writes a failure row to
 * activity.llm_calls.
 */
export async function callAnthropic(input: AnthropicCallInput): Promise<AnthropicCallResult> {
  const messages =
    input.messages && input.messages.length > 0
      ? input.messages
      : [{ role: "user" as const, content: input.user ?? "" }];

  const body = {
    model: input.model,
    max_tokens: input.maxTokens,
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(buildSystemArray(input.system) ? { system: buildSystemArray(input.system) } : {}),
    messages,
  };

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "x-api-key": input.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new LlmGatewayError(
      `Anthropic fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      "network_error",
    );
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "(could not read response body)");
    throw new LlmGatewayError(
      `Anthropic ${res.status}: ${errBody.slice(0, 500)}`,
      `http_${res.status}`,
      res.status,
    );
  }

  const data = (await res.json()) as AnthropicMessageResponse;
  const text = data.content?.[0]?.text ?? "";
  const usage = data.usage ?? { input_tokens: 0, output_tokens: 0 };

  return {
    text,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cachedInputTokens: usage.cache_read_input_tokens ?? 0,
    model: data.model,
    finishReason: data.stop_reason,
  };
}
