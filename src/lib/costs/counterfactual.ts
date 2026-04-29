/**
 * Counterfactual cost calculator.
 *
 * Given a project's actual elapsed days + a counterfactual scenario
 * (team composition + day rates + velocity multiplier), returns:
 *   - traditional_cost_gbp: what the same scope would have cost a
 *     traditional team
 *   - traditional_calendar_days: how long it would have taken
 *   - savings_gbp: traditional_cost - actual_cost
 *   - multiplier: traditional_cost / actual_cost
 *
 * Assumptions are exposed as inputs so the page can show "if velocity
 * multiplier were X, savings would be Y" sliders.
 */

import type { CounterfactualScenario } from "@/lib/costs/types";

export interface CounterfactualInput {
  actual_cost_gbp: number;
  actual_calendar_days: number;
  // Optional metrics for the scope estimation (used in the methodology
  // notes; not in the core math which uses calendar days).
  metrics?: {
    lines_of_code?: number;
    commits?: number;
    migrations?: number;
    features_shipped?: number;
  };
}

export interface CounterfactualResult {
  scenario_id: string;
  scenario_name: string;
  region: string;
  team_size: number;
  team_day_rate_gbp: number;
  velocity_multiplier: number;
  actual_calendar_days: number;
  traditional_calendar_days: number;
  traditional_cost_gbp: number;
  actual_cost_gbp: number;
  savings_gbp: number;
  multiplier: number;
  per_role: Array<{ role: string; count: number; day_rate_gbp: number; subtotal_gbp: number }>;
}

export function teamDayRate(scenario: CounterfactualScenario): number {
  return scenario.roles.reduce((sum, r) => sum + r.count * r.day_rate_gbp, 0);
}

export function calculateCounterfactual(
  scenario: CounterfactualScenario,
  input: CounterfactualInput,
): CounterfactualResult {
  const dayRate = teamDayRate(scenario);
  const traditionalDays = input.actual_calendar_days * scenario.velocity_multiplier;
  const traditionalCost = traditionalDays * dayRate;
  const savings = traditionalCost - input.actual_cost_gbp;
  const multiplier = input.actual_cost_gbp > 0 ? traditionalCost / input.actual_cost_gbp : 0;

  return {
    scenario_id: scenario.scenario_id,
    scenario_name: scenario.name,
    region: scenario.region,
    team_size: scenario.team_size,
    team_day_rate_gbp: dayRate,
    velocity_multiplier: scenario.velocity_multiplier,
    actual_calendar_days: input.actual_calendar_days,
    traditional_calendar_days: traditionalDays,
    traditional_cost_gbp: traditionalCost,
    actual_cost_gbp: input.actual_cost_gbp,
    savings_gbp: savings,
    multiplier,
    per_role: scenario.roles.map((r) => ({
      role: r.role,
      count: r.count,
      day_rate_gbp: r.day_rate_gbp,
      subtotal_gbp: r.count * r.day_rate_gbp * traditionalDays,
    })),
  };
}
