/**
 * UN/LOCODE autocomplete + lookup endpoint.
 *
 * GET /api/geo/locations?code=GBFXT
 *   Look up a single UN/LOCODE. Returns the location row or 404.
 *
 * GET /api/geo/locations?q=felix&country=GB&function=port&limit=20
 *   Free-text search. Required: q (>=2 chars). Optional:
 *     - country: ISO 3166 alpha-2 ('GB') to restrict results
 *     - function: 'port' | 'airport' | 'rail' | 'road' | 'postal' |
 *                 'icd' | 'fixed' | 'border'
 *     - limit: 1..100, default 20
 *
 * Authenticated callers only. Used by location pickers and the future
 * Cargowise integration UI.
 */

import { getSession } from "@/lib/session";
import { apiError, apiResponse } from "@/lib/validation";
import {
  locationsByCountry,
  lookupLocation,
  searchLocations,
} from "@/lib/geo/locations";
import type { LocationFunction } from "@/lib/geo/types";

const VALID_FUNCTIONS: ReadonlySet<LocationFunction> = new Set([
  "port",
  "rail",
  "road",
  "airport",
  "postal",
  "icd",
  "fixed",
  "border",
]);

const ISO2 = /^[A-Za-z]{2}$/;
const UNLOCODE = /^[A-Za-z]{5}$/;

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim() || "";
  const q = url.searchParams.get("q")?.trim() || "";
  const country = url.searchParams.get("country")?.trim() || "";
  const fn = url.searchParams.get("function")?.trim() || "";
  const limitRaw = url.searchParams.get("limit") || "";
  const limitParsed = limitRaw ? parseInt(limitRaw, 10) : 20;
  const limit = Math.min(Math.max(Number.isFinite(limitParsed) ? limitParsed : 20, 1), 100);

  if (country && !ISO2.test(country)) {
    return apiError("country must be a 2-letter ISO 3166 code", 400);
  }
  if (fn && !VALID_FUNCTIONS.has(fn as LocationFunction)) {
    return apiError(
      `function must be one of: ${Array.from(VALID_FUNCTIONS).join(", ")}`,
      400,
    );
  }

  // Single-code lookup
  if (code) {
    if (!UNLOCODE.test(code)) {
      return apiError("code must be a 5-letter UN/LOCODE", 400);
    }
    try {
      const entry = await lookupLocation(code);
      if (!entry) return apiError("Not found", 404);
      return apiResponse({ entry });
    } catch (err) {
      console.error("[geo/locations] lookup failed:", err instanceof Error ? err.message : err);
      return apiError("Lookup failed", 500);
    }
  }

  // Search or country listing
  try {
    if (q) {
      if (q.length < 2) return apiError("q must be at least 2 characters", 400);
      const entries = await searchLocations(q, {
        country: country || undefined,
        function: (fn || undefined) as LocationFunction | undefined,
        limit,
      });
      return apiResponse({ count: entries.length, entries });
    }
    if (country) {
      const entries = await locationsByCountry(country, {
        function: (fn || undefined) as LocationFunction | undefined,
        limit,
      });
      return apiResponse({ count: entries.length, entries });
    }
    return apiError("Provide one of: code, q (>=2 chars), or country", 400);
  } catch (err) {
    console.error("[geo/locations] search failed:", err instanceof Error ? err.message : err);
    return apiError("Search failed", 500);
  }
}
