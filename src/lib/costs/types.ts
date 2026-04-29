/**
 * Cost-tracking shared types. Mirrors the column shapes in
 * supabase/migrations/050_cost_tracking.sql.
 */

export type CostCategory = "usage" | "build";
export type CostProvenance = "manual" | "api";
export type PeriodType = "daily" | "weekly" | "monthly" | "annual" | "one-off";
export type WorkSessionSource = "manual" | "auto-from-commits" | "claude-mem";

export interface CostSource {
  source_id: string;
  org_id: string;
  name: string;
  vendor: string;
  category: CostCategory;
  provenance: CostProvenance;
  default_currency: string;
  api_config: Record<string, unknown>;
  pro_rate: number;
  recurring_monthly: number | null;
  started_at: string | null;
  ended_at: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CostEntry {
  entry_id: string;
  org_id: string;
  source_id: string;
  period_start: string;
  period_end: string;
  period_type: PeriodType;
  amount: number;
  currency: string;
  amount_gbp: number | null;
  fx_rate_used: number | null;
  fx_rate_date: string | null;
  description: string | null;
  raw_payload: Record<string, unknown> | null;
  fetched_at: string | null;
  fetched_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkSession {
  session_id: string;
  org_id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  project: string;
  notes: string | null;
  source: WorkSessionSource;
  project_attribution: number;
  created_at: string;
}

export interface CounterfactualRole {
  role: string;
  count: number;
  day_rate_gbp: number;
}

export interface CounterfactualScenario {
  scenario_id: string;
  org_id: string;
  name: string;
  description: string | null;
  team_size: number;
  roles: CounterfactualRole[];
  region: string;
  velocity_multiplier: number;
  working_days_per_month: number;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface PeriodTotals {
  period_label: string;
  period_start: string;
  period_end: string;
  total_gbp: number;
  by_source: Array<{ source_id: string; name: string; amount_gbp: number }>;
}
