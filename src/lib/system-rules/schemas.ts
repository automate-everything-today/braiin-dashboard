import { z } from "zod";

export const seniorityScoreSchema = z.object({
  default_unknown: z.number().int().min(0).max(100),
}).catchall(z.number().int().min(0).max(100))
  .refine((obj) => Object.keys(obj).length >= 2, "must include at least one role weight");

export const companyMatchSchema = z.object({
  strip_suffixes: z.array(z.string()).min(0),
  treat_and_equal: z.boolean(),
  strip_punctuation: z.boolean(),
  lowercase: z.boolean(),
});

export const granolaMatchSchema = z.object({
  auto_link_threshold: z.number().int().min(0).max(100),
  review_floor: z.number().int().min(0).max(100),
  date_buffer_days: z.number().int().min(0),
}).refine((d) => d.review_floor < d.auto_link_threshold,
  "review_floor must be less than auto_link_threshold");

export const modelRoutingSchema = z.object({
  draft_email: z.string().min(1),
}).catchall(z.string().min(1));

export const baselineTemplateSchema = z.object({
  greeting: z.string().min(1),
  ask: z.string().min(1),
  signoff: z.string().min(1),
  length_cap_lines: z.number().int().min(1).max(20),
  include_country_hook: z.boolean(),
  country_hook_template: z.string().optional(),
}).refine(
  (d) => !d.include_country_hook || (d.country_hook_template !== undefined && d.country_hook_template.length > 0),
  "country_hook_template is required when include_country_hook is true",
);

export const SCHEMA_BY_CATEGORY = {
  seniority_score: seniorityScoreSchema,
  company_match: companyMatchSchema,
  granola_match: granolaMatchSchema,
  model_routing: modelRoutingSchema,
  baseline_template: baselineTemplateSchema,
} as const;

export type SystemRuleCategory = keyof typeof SCHEMA_BY_CATEGORY;
