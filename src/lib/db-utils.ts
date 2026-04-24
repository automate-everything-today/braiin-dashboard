/**
 * Small helpers for narrowing loose Supabase row values at the boundary.
 *
 * Postgres jsonb columns arrive typed as `unknown` because the schema does not
 * pin a shape, and nullable text columns arrive as `string | null`. Code
 * downstream usually wants typed arrays and non-null strings, so these
 * utilities do the narrowing in one place.
 */

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

export function asString(value: string | null | undefined): string {
  return value ?? "";
}

export function asNumber(value: number | null | undefined, fallback = 0): number {
  return value ?? fallback;
}
