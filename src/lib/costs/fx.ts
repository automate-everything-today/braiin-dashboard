/**
 * GBP conversion helper for cost entries.
 *
 * Uses the existing geo.convert_amount(amount, from, to, on_day) function
 * from migration 039 so we share the same FX rate cache as the quoting
 * engine. Falls back to 1.0 (= "treat as already GBP") if no rate is on
 * file - we log a warning so missing rates show up in observability but
 * never crash the costs dashboard.
 */

import { supabase } from "@/services/base";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { schema: (s: string) => any };

const APPROX_FALLBACK: Record<string, number> = {
  USD: 0.79,
  EUR: 0.85,
  GBP: 1.0,
};

export async function convertToGbp(
  amount: number,
  fromCurrency: string,
  onDay?: string,
): Promise<{ amount_gbp: number; rate: number; rate_date: string; source: "db" | "fallback" }> {
  const day = onDay ?? new Date().toISOString().slice(0, 10);

  if (fromCurrency === "GBP") {
    return { amount_gbp: amount, rate: 1.0, rate_date: day, source: "db" };
  }

  try {
    const { data, error } = await db.schema("geo").rpc("convert_amount", {
      p_amount: amount,
      p_from: fromCurrency,
      p_to: "GBP",
      p_on_day: day,
    });
    if (!error && typeof data === "number") {
      const rate = data / amount;
      return { amount_gbp: data, rate, rate_date: day, source: "db" };
    }
  } catch (e) {
    console.warn("[costs/fx] geo.convert_amount failed:", e instanceof Error ? e.message : e);
  }

  const fallback = APPROX_FALLBACK[fromCurrency.toUpperCase()] ?? 1.0;
  console.warn(
    `[costs/fx] no FX rate available for ${fromCurrency}->GBP on ${day}; falling back to approximate ${fallback}.`,
  );
  return { amount_gbp: amount * fallback, rate: fallback, rate_date: day, source: "fallback" };
}
