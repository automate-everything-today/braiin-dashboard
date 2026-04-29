/**
 * FX conversion helper.
 *
 * Single boundary every ROI calculation goes through. Always normalises to
 * GBP - that's the canonical reporting currency. Display currency is a
 * separate concern (user preference, applied at render time).
 *
 * Source of truth: geo.fx_rates (multi-source, date-keyed table from
 * migration 039). We pick the highest-priority source that has a rate on
 * or before the requested date, falling back to the most recent rate within
 * 30 days if no exact match exists. Beyond 30 days we throw - the operator
 * needs to seed a manual rate.
 */

import { supabase } from "@/services/base";

export const SUPPORTED_CURRENCIES = ["GBP", "USD", "EUR"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

interface FxRow {
  rate: number;
  rate_date: string;
  source: string;
  source_priority: number;
}

interface CacheEntry {
  rate: number;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes - rates barely move during a session
const cache = new Map<string, CacheEntry>();

function cacheKey(base: Currency, quote: Currency, asOfDate: string): string {
  return `${base}|${quote}|${asOfDate}`;
}

/**
 * Look up the best available FX rate for a given currency pair and date.
 * Strategy:
 *   1. Try exact rate_date match, take highest-priority source.
 *   2. If miss, try most recent rate within 30 days BEFORE asOfDate.
 *   3. If still miss, throw - rate must be seeded manually via geo.fx_rates.
 *
 * Same-currency conversions return 1.0 immediately.
 */
async function lookupRate(
  base: Currency,
  quote: Currency,
  asOfDate: string,
): Promise<number> {
  if (base === quote) return 1;

  const key = cacheKey(base, quote, asOfDate);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.rate;

  // Schema reference: geo.fx_rates (rate_id, base_currency, quote_currency,
  // rate, rate_date, source, source_priority, fetched_at).
  //
  // PostgREST exposes the geo schema via the client's `.schema('geo')`
  // method when configured; otherwise we go through public via a view
  // or use rpc. Here we assume the client can reach geo.fx_rates - if
  // it can't, we'll surface that loud and the operator switches to the
  // public view fallback.

  // Cast through unknown - the typed client only knows the public schema, but
  // PostgREST + the supabase-js client both support cross-schema queries when
  // the schema is enabled in the Supabase project settings.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geoClient = (supabase as any).schema("geo");
  const { data, error } = await geoClient
    .from("fx_rates")
    .select("rate, rate_date, source, source_priority")
    .eq("base_currency", base)
    .eq("quote_currency", quote)
    .lte("rate_date", asOfDate)
    .gte("rate_date", subtractDays(asOfDate, 30))
    .order("rate_date", { ascending: false })
    .order("source_priority", { ascending: true })
    .limit(1);

  if (error) {
    throw new Error(`fx_rates lookup failed for ${base}->${quote} on ${asOfDate}: ${error.message}`);
  }
  const rows = (data ?? []) as FxRow[];
  if (rows.length === 0) {
    throw new Error(
      `No fx_rate found for ${base}->${quote} on or within 30 days before ${asOfDate}. Seed a manual rate via geo.fx_rates.`,
    );
  }
  const rate = rows[0].rate;
  cache.set(key, { rate, expiresAt: Date.now() + CACHE_TTL_MS });
  return rate;
}

function subtractDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}

/**
 * Convert an amount from any supported currency to GBP using the rate
 * effective on `asOfDate`. Defaults to today.
 *
 * Returns null when amount is null (so callers don't have to null-check
 * separately - just pass through). Throws on missing rates.
 */
export async function convertToGbp(
  amount: number | null,
  currency: Currency | null,
  asOfDate?: string,
): Promise<number | null> {
  if (amount === null || currency === null) return null;
  if (currency === "GBP") return amount;
  const date = asOfDate ?? new Date().toISOString().split("T")[0];
  const rate = await lookupRate(currency, "GBP", date);
  return amount * rate;
}

/**
 * Convert an amount from GBP to any supported display currency.
 * Used at render time when the user has selected USD or EUR display.
 */
export async function convertFromGbp(
  amountGbp: number | null,
  targetCurrency: Currency,
  asOfDate?: string,
): Promise<number | null> {
  if (amountGbp === null) return null;
  if (targetCurrency === "GBP") return amountGbp;
  const date = asOfDate ?? new Date().toISOString().split("T")[0];
  const rate = await lookupRate("GBP", targetCurrency, date);
  return amountGbp * rate;
}

/**
 * Format an amount with currency symbol and locale. Used everywhere ROI
 * surfaces a currency value. Always rounds to 0 decimals for ROI display
 * (we don't care about pence at this level).
 */
export function formatCurrency(
  amount: number | null,
  currency: Currency,
): string {
  if (amount === null) return "-";
  const formatter = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });
  return formatter.format(amount);
}

/**
 * Bulk-convert a list of {amount, currency} pairs to GBP, sharing the same
 * asOfDate. Used in ROI rollups where many event costs need converting at
 * once. Returns sum-in-GBP plus per-row conversions.
 */
export async function sumInGbp(
  rows: Array<{ amount: number | null; currency: Currency | null }>,
  asOfDate?: string,
): Promise<{ totalGbp: number; converted: Array<number | null> }> {
  const converted = await Promise.all(
    rows.map((r) => convertToGbp(r.amount, r.currency, asOfDate)),
  );
  const totalGbp = converted.reduce<number>(
    (acc, v) => acc + (v ?? 0),
    0,
  );
  return { totalGbp, converted };
}

/**
 * Force-flush the FX cache. Useful in tests and after manual rate inserts.
 */
export function clearFxCache(): void {
  cache.clear();
}
