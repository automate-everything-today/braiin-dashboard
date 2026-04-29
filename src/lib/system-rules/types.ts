export interface BaselineTemplateValue {
  greeting: string;
  ask: string;
  signoff: string;
  length_cap_lines: number;
  include_country_hook: boolean;
  country_hook_template?: string;
}

export interface CompanyMatchValue {
  strip_suffixes: string[];
  treat_and_equal: boolean;
  strip_punctuation: boolean;
  lowercase: boolean;
}

export interface GranolaThresholdsValue {
  auto_link_threshold: number;
  review_floor: number;
  date_buffer_days: number;
}

export interface RulesSnapshot {
  /** UUID identifying this snapshot (used in import_audit_log + llm_calls). */
  id: string;
  /** Resolves a model id for a given task name; falls back to draft_email. */
  modelFor(task: string): string;
  /** Returns seniority score 0-100 for a title keyword; default_unknown if no match. */
  seniority(titleKeyword: string): number;
  companyMatch: CompanyMatchValue;
  granolaThresholds: GranolaThresholdsValue;
  /** Returns the baseline template for a slot key, or null if not authored. */
  baselineTemplate(slotKey: string): BaselineTemplateValue | null;
  /** Snapshot of the resolved rules; written to import_audit_log.rules_snapshot. */
  raw: Record<string, unknown>;
}
