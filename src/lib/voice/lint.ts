/**
 * Voice rule linter.
 *
 * Loads active voice_rules and scans a draft against them. Returns block hits
 * (severity=block) and warn hits (severity=warn). Caller decides whether to
 * regenerate the draft (any block hits) or surface warnings to the operator.
 *
 * Channel-aware: rules with channel='all' always apply; rules with a specific
 * channel only apply when the caller passes that channel.
 *
 * Used by:
 *   - src/lib/event-followup/generate-draft.ts (regenerate-on-block loop)
 *   - /dev/voice (dry-run preview when adding a new rule)
 *   - /dev/event-followup review UI (highlight any warns inline)
 *
 * Design notes:
 *   - Patterns are matched case-insensitive, word-boundary-aware where the
 *     pattern is a single word; whole-substring otherwise. This stops "use"
 *     from blocking text that happens to contain "use" inside a longer word
 *     (e.g. "house") for banned_word rules. Phrase / tone / structure
 *     patterns match anywhere.
 *   - Em dash + en dash (banned_formatting) match anywhere, no word boundary.
 *   - Catch counts are NOT incremented synchronously - that would double the
 *     write cost on every draft. Instead, fire-and-forget telemetry from the
 *     caller via recordCatches() at the end of generation.
 */

import { supabase } from "@/services/base";
import type {
  Channel,
  LintHit,
  LintResult,
  VoiceRule,
} from "./types";

interface ActiveRulesCache {
  rules: VoiceRule[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 30_000;
let cache: ActiveRulesCache | null = null;

async function loadActiveRules(): Promise<VoiceRule[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rules;
  }

  const { data, error } = await supabase
    .from("voice_rules")
    .select("*")
    .eq("active", true);
  if (error) {
    // Fail loud per project policy. Don't return stale cache on error - that
    // would silently degrade if the table is misconfigured.
    throw new Error(`voice_rules load failed: ${error.message}`);
  }

  const rules = (data ?? []) as VoiceRule[];
  cache = { rules, fetchedAt: now };
  return rules;
}

/**
 * Force-reload the cache. Call after any voice_rules write so the linter
 * picks up new bans / replacements without waiting for the TTL.
 */
export function invalidateVoiceRulesCache(): void {
  cache = null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Verb stems whose conjugations should also be banned. Adding the bare
 * verb to voice_rules implicitly bans -s / -ed / -ing / -er forms via this
 * stem-aware regex.
 *
 * Maps stem -> regex tail. The tail captures common English verb endings
 * without false-matching nouns that share a prefix (e.g. 'leveraging' yes,
 * 'lever' alone is fine - no e.g. 'leverage' in the noun sense).
 */
const VERB_STEM_TAIL = "(?:e|es|ed|ing|er)?";

function isLikelyVerbStem(pattern: string): boolean {
  // Heuristic: single-token, all lowercase, no spaces or punctuation.
  // Avoids munging multi-word phrases or hyphenated compounds.
  return /^[a-z]+$/.test(pattern);
}

/**
 * Build a RegExp for a rule. Single-word patterns use word boundaries to
 * avoid false positives inside longer words. Multi-word phrases and
 * formatting characters match as substrings.
 *
 * For banned_word entries that look like verb stems, we also catch the
 * conjugations: 'dive' catches 'diving', 'dives', 'dived'. 'delve' catches
 * 'delving', 'delves'. 'leverage' catches 'leveraging', 'leveraged'.
 */
function patternToRegex(rule: VoiceRule): RegExp {
  const isSingleWord =
    rule.rule_type === "banned_word" && /^\S+$/.test(rule.pattern);
  if (isSingleWord && isLikelyVerbStem(rule.pattern)) {
    // Strip a trailing 'e' if present so the regex tail can re-add it.
    // 'dive' -> 'div', tail '(?:e|es|ed|ing|er)?' -> matches dive/dives/dived/diving.
    const stem = rule.pattern.endsWith("e")
      ? rule.pattern.slice(0, -1)
      : rule.pattern;
    return new RegExp(`\\b${escapeRegExp(stem)}${VERB_STEM_TAIL}\\b`, "gi");
  }
  const escaped = escapeRegExp(rule.pattern);
  const body = isSingleWord ? `\\b${escaped}\\b` : escaped;
  return new RegExp(body, "gi");
}

function appliesToChannel(ruleChannel: Channel, target: Channel): boolean {
  if (ruleChannel === "all") return true;
  return ruleChannel === target;
}

/**
 * Lint a draft against the active voice rules.
 *
 * @param text   The draft to scan.
 * @param channel  Which channel the draft is for. Rules with a different
 *                 explicit channel are skipped; rules with channel='all' always apply.
 */
export async function lintDraft(
  text: string,
  channel: Channel = "email",
): Promise<LintResult> {
  if (!text || text.trim().length === 0) {
    return { blocks: [], warns: [], rules_checked: 0 };
  }

  const rules = await loadActiveRules();
  const applicable = rules.filter((r) => appliesToChannel(r.channel, channel));

  const blocks: LintHit[] = [];
  const warns: LintHit[] = [];

  for (const rule of applicable) {
    const regex = patternToRegex(rule);
    // matchAll returns an iterator of RegExpMatchArray with .index set when
    // the regex has the /g flag (which patternToRegex sets). Same semantics
    // as the older while-loop pattern, more idiomatic for ES2020+.
    for (const m of text.matchAll(regex)) {
      const matchedText = m[0];
      const offset = m.index ?? 0;
      const hit: LintHit = {
        rule_id: rule.id,
        rule_type: rule.rule_type,
        pattern: rule.pattern,
        replacement: rule.replacement,
        severity: rule.severity,
        channel: rule.channel,
        offset,
        match: matchedText,
      };
      if (rule.severity === "block") {
        blocks.push(hit);
      } else {
        warns.push(hit);
      }
    }
  }

  return {
    blocks,
    warns,
    rules_checked: applicable.length,
  };
}

/**
 * Increment catch_count + last_caught_at for the rules that fired. Fire and
 * forget - caller awaits this only if it cares about ordering. Used for
 * dashboard telemetry ("which rules are actually doing work").
 */
export async function recordCatches(hits: LintHit[]): Promise<void> {
  if (hits.length === 0) return;
  // Deduplicate rule ids - if a rule fired 5 times in one draft, count it
  // once for telemetry purposes (we care about hit-distinct-rules-per-draft,
  // not raw match count).
  const uniqueRuleIds = Array.from(new Set(hits.map((h) => h.rule_id)));
  // RPC is defined in migration 056 but not in generated types yet.
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  await Promise.all(
    uniqueRuleIds.map((id) => rpc("voice_rules_record_catch", { rule_id: id })),
  );
}

/**
 * Format a lint result for human-readable surfacing in the review UI.
 * Returns a list of strings like:
 *   "BLOCK 'leverage' -> use, lean on, or just say what you do with it"
 */
export function formatLintHits(hits: LintHit[]): string[] {
  return hits.map(
    (h) => `${h.severity.toUpperCase()} '${h.match}' -> ${h.replacement}`,
  );
}
