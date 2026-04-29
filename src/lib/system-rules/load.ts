import { randomUUID } from "node:crypto";
import { supabase } from "@/services/base";
import { SCHEMA_BY_CATEGORY, type SystemRuleCategory } from "./schemas";
import type {
  BaselineTemplateValue,
  CompanyMatchValue,
  GranolaThresholdsValue,
  RulesSnapshot,
} from "./types";

const HARDCODED_DEFAULTS: Record<string, unknown> = {
  "seniority_score:weights": {
    ceo: 100,
    founder: 95,
    director: 80,
    head: 75,
    manager: 60,
    coordinator: 40,
    default_unknown: 20,
  },
  "company_match:canonicalisation": {
    strip_suffixes: ["Ltd", "Inc", "SA", "Group", "Logistics"],
    treat_and_equal: true,
    strip_punctuation: true,
    lowercase: true,
  } satisfies CompanyMatchValue,
  "granola_match:thresholds": {
    auto_link_threshold: 80,
    review_floor: 50,
    date_buffer_days: 2,
  } satisfies GranolaThresholdsValue,
  "model_routing:tasks": {
    draft_email: "claude-sonnet-4-6",
    seniority_score: "claude-haiku-4-5",
    granola_match: "claude-haiku-4-5",
  },
};

interface SystemRuleRow {
  category: string;
  key: string;
  value: unknown;
}

export async function loadRulesSnapshot(): Promise<RulesSnapshot> {
  const { data, error } = await supabase
    .from("system_rules")
    .select("category, key, value")
    .eq("active", true);
  if (error) throw new Error(`system_rules load failed: ${error.message}`);

  const byCatKey: Record<string, unknown> = {};
  for (const row of (data ?? []) as SystemRuleRow[]) {
    const schema = SCHEMA_BY_CATEGORY[row.category as SystemRuleCategory];
    if (!schema) continue; // unknown category is non-fatal; ignored
    const parsed = schema.safeParse(row.value);
    if (!parsed.success) {
      // Fail loud per spec section 9 + feedback_error_handling.md.
      throw new Error(
        `system_rules invalid: ${row.category}.${row.key} - ${parsed.error.message}`,
      );
    }
    byCatKey[`${row.category}:${row.key}`] = parsed.data;
  }

  const get = <T>(catKey: string): T => {
    const v = byCatKey[catKey] ?? HARDCODED_DEFAULTS[catKey];
    if (v === undefined) throw new Error(`system_rules: no value for ${catKey}`);
    return v as T;
  };

  const seniorityWeights = get<Record<string, number>>("seniority_score:weights");
  const companyMatch = get<CompanyMatchValue>("company_match:canonicalisation");
  const granolaThresholds = get<GranolaThresholdsValue>("granola_match:thresholds");
  const modelRouting = get<Record<string, string>>("model_routing:tasks");

  return {
    id: randomUUID(),
    modelFor: (task) => modelRouting[task] ?? modelRouting.draft_email,
    seniority: (kw) =>
      seniorityWeights[kw.toLowerCase()] ?? seniorityWeights.default_unknown ?? 20,
    companyMatch,
    granolaThresholds,
    baselineTemplate: (slotKey) => {
      const v = byCatKey[`baseline_template:${slotKey}`];
      return (v as BaselineTemplateValue | undefined) ?? null;
    },
    raw: byCatKey,
  };
}
