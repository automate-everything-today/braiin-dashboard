/**
 * UN/LOCODE lookup library.
 *
 * Reads from `geo.locations` and `geo.countries` (migration 031). Used
 * by the autocomplete endpoint, Cargowise integration, rate engine
 * cross-checks, and free-text port normalisation.
 *
 * Caching strategy: 116k rows is too large to load fully into memory
 * per process, so this module uses a hot-key Map (LRU eviction at 5000
 * entries) for `lookupLocation()` and lets `searchLocations()` /
 * `locationsByCountry()` hit Postgres directly. The DB has indexes on
 * country_code, LOWER(name), iata_code, and a pg_trgm GIN on name.
 */

import { supabase } from "@/services/base";
import type { GeoCountry, GeoLocation, LocationFunction, SearchOptions } from "./types";

interface LocationsClient {
  from(table: string): {
    select: (cols: string) => {
      eq: (col: string, val: string) => SelectChain;
    };
  };
}

interface SelectChain {
  eq?: (col: string, val: string) => SelectChain;
  maybeSingle?: () => Promise<{ data: LocationRow | null; error: { message: string } | null }>;
  ilike?: (col: string, pattern: string) => SelectChain;
  or?: (filter: string) => SelectChain;
  order?: (col: string) => SelectChain;
  limit?: (n: number) => Promise<{ data: LocationRow[] | null; error: { message: string } | null }>;
  // PostgREST chains are thenable
  then?: (resolve: (v: { data: LocationRow[] | null; error: { message: string } | null }) => void) => void;
}

interface LocationRow {
  unlocode: string;
  country_code: string;
  location_code: string;
  name: string;
  name_no_diacritics: string | null;
  subdivision: string | null;
  function_port: boolean;
  function_rail: boolean;
  function_road: boolean;
  function_airport: boolean;
  function_postal: boolean;
  function_icd: boolean;
  function_fixed: boolean;
  function_border: boolean;
  status: string | null;
  iata_code: string | null;
  latitude: number | null;
  longitude: number | null;
  source_release: string | null;
}

interface CountryRow {
  code: string;
  code_a3: string | null;
  code_num: string | null;
  name: string;
  official_name: string | null;
  region: string | null;
  subregion: string | null;
}

const HOT_KEY_LIMIT = 5000;
const hotCache = new Map<string, GeoLocation>();

function geoClient(): LocationsClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).schema("geo") as LocationsClient;
}

function rowToLocation(r: LocationRow): GeoLocation {
  return {
    unlocode: r.unlocode,
    countryCode: r.country_code,
    locationCode: r.location_code,
    name: r.name,
    nameNoDiacritics: r.name_no_diacritics,
    subdivision: r.subdivision,
    functions: {
      port: r.function_port,
      rail: r.function_rail,
      road: r.function_road,
      airport: r.function_airport,
      postal: r.function_postal,
      icd: r.function_icd,
      fixed: r.function_fixed,
      border: r.function_border,
    },
    status: r.status,
    iataCode: r.iata_code,
    latitude: r.latitude,
    longitude: r.longitude,
    sourceRelease: r.source_release,
  };
}

function rowToCountry(r: CountryRow): GeoCountry {
  return {
    code: r.code,
    codeA3: r.code_a3,
    codeNum: r.code_num,
    name: r.name,
    officialName: r.official_name,
    region: r.region,
    subregion: r.subregion,
  };
}

function cachePut(key: string, value: GeoLocation): void {
  if (hotCache.size >= HOT_KEY_LIMIT) {
    // Drop the oldest insertion (Map preserves insertion order).
    const firstKey = hotCache.keys().next().value;
    if (firstKey) hotCache.delete(firstKey);
  }
  hotCache.set(key, value);
}

const FUNCTION_COLUMN: Record<LocationFunction, string> = {
  port: "function_port",
  rail: "function_rail",
  road: "function_road",
  airport: "function_airport",
  postal: "function_postal",
  icd: "function_icd",
  fixed: "function_fixed",
  border: "function_border",
};

const SELECT_COLS =
  "unlocode,country_code,location_code,name,name_no_diacritics,subdivision," +
  "function_port,function_rail,function_road,function_airport,function_postal," +
  "function_icd,function_fixed,function_border,status,iata_code,latitude,longitude,source_release";

/**
 * Look up a single UN/LOCODE. Hits the hot-key cache first; falls back
 * to Postgres on miss and caches the result.
 *
 * Returns null when the code is not in the dataset - this is a normal
 * lookup outcome, not an error.
 */
export async function lookupLocation(unlocodeRaw: string): Promise<GeoLocation | null> {
  const code = unlocodeRaw.trim().toUpperCase();
  if (code.length !== 5) return null;

  const cached = hotCache.get(code);
  if (cached) return cached;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (geoClient().from("locations") as any)
    .select(SELECT_COLS)
    .eq("unlocode", code)
    .maybeSingle();

  if (error) throw new Error(`geo.lookupLocation failed: ${error.message}`);
  if (!data) return null;

  const result = rowToLocation(data as LocationRow);
  cachePut(code, result);
  return result;
}

/**
 * Free-text search over `name` / `name_no_diacritics` / `unlocode`.
 * Used by the autocomplete endpoint. The DB has trigram + lower-name
 * indexes so ILIKE-style queries are cheap.
 */
export async function searchLocations(
  query: string,
  opts: SearchOptions = {},
): Promise<GeoLocation[]> {
  const q = query.trim();
  if (!q) return [];
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);

  // Build the OR filter string in PostgREST syntax.
  // 'unlocode' match: exact prefix on the 5-char code (uppercase).
  // 'name' match: case-insensitive substring (ILIKE).
  // 'name_no_diacritics' match: same but for the ASCII-folded variant.
  const upperQ = q.toUpperCase();
  const ilikePattern = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chain: any = (geoClient().from("locations") as any).select(SELECT_COLS);

  if (opts.country) {
    chain = chain.eq("country_code", opts.country.toUpperCase());
  }
  if (opts.function) {
    chain = chain.eq(FUNCTION_COLUMN[opts.function], true);
  }

  chain = chain.or(
    `unlocode.ilike.${upperQ}%,name.ilike.${ilikePattern},name_no_diacritics.ilike.${ilikePattern}`,
  );
  chain = chain.order("name").limit(limit);

  const { data, error } = await chain;
  if (error) throw new Error(`geo.searchLocations failed: ${error.message}`);
  return ((data ?? []) as LocationRow[]).map(rowToLocation);
}

/**
 * All locations in a given country. Optional function filter (e.g.
 * "all UK ports"). Capped at 1000 rows per call.
 */
export async function locationsByCountry(
  countryCode: string,
  opts: { function?: LocationFunction; limit?: number } = {},
): Promise<GeoLocation[]> {
  const cc = countryCode.trim().toUpperCase();
  if (cc.length !== 2) return [];
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chain: any = (geoClient().from("locations") as any)
    .select(SELECT_COLS)
    .eq("country_code", cc);
  if (opts.function) {
    chain = chain.eq(FUNCTION_COLUMN[opts.function], true);
  }
  chain = chain.order("name").limit(limit);

  const { data, error } = await chain;
  if (error) throw new Error(`geo.locationsByCountry failed: ${error.message}`);
  return ((data ?? []) as LocationRow[]).map(rowToLocation);
}

/**
 * Look up an ISO 3166 country.
 */
export async function lookupCountry(codeRaw: string): Promise<GeoCountry | null> {
  const code = codeRaw.trim().toUpperCase();
  if (code.length !== 2) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (geoClient().from("countries") as any)
    .select("code,code_a3,code_num,name,official_name,region,subregion")
    .eq("code", code)
    .maybeSingle();

  if (error) throw new Error(`geo.lookupCountry failed: ${error.message}`);
  if (!data) return null;
  return rowToCountry(data as CountryRow);
}

/**
 * Drop the hot-key cache. Useful for tests and after manual data
 * patches in the dashboard.
 */
export function clearHotCache(): void {
  hotCache.clear();
}
