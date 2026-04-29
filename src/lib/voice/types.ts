/**
 * Shared types for the voice rules system.
 *
 * voice_rules table mirror + linter result types. See
 * docs/voice/anti-ai-writing-style.md for the design contract and
 * supabase/migrations/056_voice_rules.sql for the schema.
 */

export const RULE_TYPES = [
  "banned_word",
  "banned_phrase",
  "banned_structure",
  "banned_formatting",
  "banned_tone",
] as const;

export type RuleType = (typeof RULE_TYPES)[number];

export const SEVERITIES = ["block", "warn"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CHANNELS = ["all", "email", "messaging", "social"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface VoiceRule {
  id: number;
  rule_type: RuleType;
  pattern: string;
  replacement: string;
  severity: Severity;
  channel: Channel;
  notes: string | null;
  added_by: string | null;
  active: boolean;
  catch_count: number;
  last_caught_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoiceRuleInput {
  rule_type: RuleType;
  pattern: string;
  replacement: string;
  severity?: Severity;
  channel?: Channel;
  notes?: string | null;
}

/**
 * One hit recorded by the linter against a draft.
 */
export interface LintHit {
  rule_id: number;
  rule_type: RuleType;
  pattern: string;
  replacement: string;
  severity: Severity;
  channel: Channel;
  /** Character offset in the draft where the match starts. */
  offset: number;
  /** The matched substring as it appeared in the draft. */
  match: string;
}

export interface LintResult {
  blocks: LintHit[];
  warns: LintHit[];
  /** Total active rules consulted - useful for telemetry / debugging. */
  rules_checked: number;
}
