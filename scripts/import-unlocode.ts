#!/usr/bin/env -S npx tsx
/**
 * UN/LOCODE bulk importer.
 *
 * Pulls the UNECE-maintained data via the github.com/datasets/un-locode
 * mirror (auto-published on each UNECE release) plus a richer ISO 3166
 * country list (with M49 region / subregion) from datasets/country-codes,
 * and upserts both into the `geo` schema (migration 031).
 *
 * Usage:
 *   npx tsx scripts/import-unlocode.ts             # full refresh
 *   npx tsx scripts/import-unlocode.ts --dry       # parse only, no DB write
 *   npx tsx scripts/import-unlocode.ts --countries # countries only
 *   npx tsx scripts/import-unlocode.ts --locations # locations only
 *
 * Idempotent: upsert-on-PK so re-running the same release is a no-op
 * and refreshing to a newer release updates names / coords / status.
 *
 * Requires SUPABASE_SERVICE_KEY + NEXT_PUBLIC_SUPABASE_URL in env or
 * .env.local. Service role is mandatory because geo.* tables are
 * REVOKEd from PUBLIC by migration 031.
 */

import * as fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ---------- env loading (same pattern as gen-supabase-types.ts) ----------

const ENV_PATHS = [".env.local", ".env"];

function loadEnv(): void {
  for (const p of ENV_PATHS) {
    if (!fs.existsSync(p)) continue;
    const content = fs.readFileSync(p, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

// ---------- minimal RFC 4180 CSV parser ----------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  // Strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\r") {
      i += 1;
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  // Flush the last field/row if no trailing newline
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// ---------- coordinate parser ----------
// UNECE format: 'DDMM[N|S] DDDMM[E|W]' e.g. '5159N 00112E'.
// Returns null if not parseable.

function parseCoordinates(raw: string | null | undefined): {
  lat: number | null;
  lon: number | null;
} {
  if (!raw) return { lat: null, lon: null };
  const trimmed = raw.trim();
  if (!trimmed) return { lat: null, lon: null };

  const match = trimmed.match(/^(\d{2})(\d{2})([NS])\s+(\d{3})(\d{2})([EW])$/);
  if (!match) return { lat: null, lon: null };

  const [, latDeg, latMin, latHem, lonDeg, lonMin, lonHem] = match;
  let lat = parseInt(latDeg, 10) + parseInt(latMin, 10) / 60;
  let lon = parseInt(lonDeg, 10) + parseInt(lonMin, 10) / 60;
  if (latHem === "S") lat = -lat;
  if (lonHem === "W") lon = -lon;
  return { lat, lon };
}

// ---------- function-flag parser ----------
// UNECE encodes 8 functions in an 8-char string. A digit (1-7) or 'B'
// at position N means the function is set; '-' means not set.

interface FunctionFlags {
  port: boolean;
  rail: boolean;
  road: boolean;
  airport: boolean;
  postal: boolean;
  icd: boolean;
  fixed: boolean;
  border: boolean;
  raw: string | null;
}

function parseFunctions(raw: string | null | undefined): FunctionFlags {
  const padded = (raw ?? "").padEnd(8, "-").slice(0, 8);
  return {
    port: padded[0] === "1",
    rail: padded[1] === "2",
    road: padded[2] === "3",
    airport: padded[3] === "4",
    postal: padded[4] === "5",
    icd: padded[5] === "6",
    fixed: padded[6] === "7",
    border: padded[7] === "B",
    raw: raw && raw.length > 0 ? padded : null,
  };
}

// ---------- HTTP fetch with retry ----------

async function fetchText(url: string, attempts = 3): Promise<string> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      }
      return await res.text();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ---------- supabase admin client ----------

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
  if (!key) throw new Error("SUPABASE_SERVICE_KEY is required");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------- countries import ----------

const COUNTRY_CODES_URL =
  "https://raw.githubusercontent.com/datasets/country-codes/master/data/country-codes.csv";

interface CountryRow {
  code: string;
  code_a3: string | null;
  code_num: string | null;
  name: string;
  official_name: string | null;
  region: string | null;
  subregion: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importCountries(
  client: any,
  release: string,
  dry: boolean,
): Promise<{ count: number; codes: Set<string> }> {
  console.log("[unlocode] fetching country list...");
  const text = await fetchText(COUNTRY_CODES_URL);
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("country-codes.csv looks empty");

  const header = rows[0];
  const idxA2 = header.findIndex((h) => h === "ISO3166-1-Alpha-2");
  const idxA3 = header.findIndex((h) => h === "ISO3166-1-Alpha-3");
  const idxNum = header.findIndex((h) => h === "ISO3166-1-numeric");
  const idxName = header.findIndex((h) => h === "CLDR display name");
  const idxOfficial = header.findIndex((h) => h === "official_name_en");
  const idxRegion = header.findIndex((h) => h === "Region Name");
  const idxSub = header.findIndex((h) => h === "Sub-region Name");

  if (idxA2 < 0 || idxName < 0) {
    throw new Error("country-codes.csv missing expected columns");
  }

  const countries: CountryRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const code = (r[idxA2] || "").trim();
    if (!code || code.length !== 2) continue;
    const name = (r[idxName] || "").trim();
    if (!name) continue;
    countries.push({
      code,
      code_a3: ((r[idxA3] || "").trim() || null) as string | null,
      code_num: ((r[idxNum] || "").trim() || null) as string | null,
      name,
      official_name: ((r[idxOfficial] || "").trim() || null) as string | null,
      region: ((r[idxRegion] || "").trim() || null) as string | null,
      subregion: ((r[idxSub] || "").trim() || null) as string | null,
    });
  }

  console.log(`[unlocode] parsed ${countries.length} countries`);
  const codes = new Set(countries.map((c) => c.code));

  if (dry) {
    console.log("[unlocode] --dry: skipping country writes");
    return { count: countries.length, codes };
  }

  const payload = countries.map((c) => ({ ...c, source_release: release }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geo = (client as any).schema("geo");
  const chunkSize = 500;
  for (let off = 0; off < payload.length; off += chunkSize) {
    const chunk = payload.slice(off, off + chunkSize);
    const { error } = await geo.from("countries").upsert(chunk, { onConflict: "code" });
    if (error) {
      throw new Error(`country upsert failed at offset ${off}: ${error.message}`);
    }
    process.stdout.write(`\r[unlocode] countries upserted ${Math.min(off + chunk.length, payload.length)}/${payload.length}`);
  }
  process.stdout.write("\n");
  return { count: countries.length, codes };
}

// ---------- locations import ----------

const UNLOCODE_URL =
  "https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv";

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
  function_raw: string | null;
  status: string | null;
  date_changed: string | null;
  iata_code: string | null;
  latitude: number | null;
  longitude: number | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importLocations(
  client: any,
  knownCountryCodes: Set<string>,
  release: string,
  dry: boolean,
): Promise<{ inserted: number; skipped: number }> {
  console.log("[unlocode] fetching UN/LOCODE code list...");
  const text = await fetchText(UNLOCODE_URL);
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("code-list.csv looks empty");

  const header = rows[0].map((h) => h.trim());
  const col = (name: string): number => header.findIndex((h) => h === name);
  const idxCountry = col("Country");
  const idxLoc = col("Location");
  const idxName = col("Name");
  const idxNameWo = col("NameWoDiacritics");
  const idxSub = col("Subdivision");
  const idxStatus = col("Status");
  const idxFn = col("Function");
  const idxDate = col("Date");
  const idxIata = col("IATA");
  const idxCoords = col("Coordinates");

  if (idxCountry < 0 || idxLoc < 0 || idxName < 0) {
    throw new Error(`code-list.csv missing expected columns. Header: ${header.join("|")}`);
  }

  const locations: LocationRow[] = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const country = (r[idxCountry] || "").trim().toUpperCase();
    const loc = (r[idxLoc] || "").trim().toUpperCase();
    const name = (r[idxName] || "").trim();

    if (country.length !== 2 || loc.length !== 3 || !name) {
      skipped += 1;
      continue;
    }
    if (!knownCountryCodes.has(country)) {
      // Country not in geo.countries (rare; ISO 3166 retirees). Skip
      // rather than break the FK.
      skipped += 1;
      continue;
    }

    const fns = parseFunctions(idxFn >= 0 ? r[idxFn] : null);
    const coords = parseCoordinates(idxCoords >= 0 ? r[idxCoords] : null);

    locations.push({
      unlocode: country + loc,
      country_code: country,
      location_code: loc,
      name,
      name_no_diacritics: idxNameWo >= 0 ? (r[idxNameWo] || "").trim() || null : null,
      subdivision: idxSub >= 0 ? (r[idxSub] || "").trim() || null : null,
      function_port: fns.port,
      function_rail: fns.rail,
      function_road: fns.road,
      function_airport: fns.airport,
      function_postal: fns.postal,
      function_icd: fns.icd,
      function_fixed: fns.fixed,
      function_border: fns.border,
      function_raw: fns.raw,
      status: idxStatus >= 0 ? (r[idxStatus] || "").trim() || null : null,
      date_changed: idxDate >= 0 ? (r[idxDate] || "").trim().slice(0, 4) || null : null,
      iata_code: idxIata >= 0 ? (r[idxIata] || "").trim().slice(0, 3) || null : null,
      latitude: coords.lat,
      longitude: coords.lon,
    });
  }

  // Dedupe by unlocode. The UN/LOCODE source occasionally publishes the
  // same code twice in one release (different status/dates during the
  // approval lifecycle) - keep the last occurrence so the most recent
  // wins, and avoid Postgres "ON CONFLICT cannot affect row a second
  // time" errors during batch upsert.
  const dedupeMap = new Map<string, LocationRow>();
  for (const l of locations) dedupeMap.set(l.unlocode, l);
  const deduped = Array.from(dedupeMap.values());
  const duplicates = locations.length - deduped.length;
  console.log(
    `[unlocode] parsed ${locations.length} locations ` +
      `(skipped ${skipped}, deduped ${duplicates})`,
  );

  if (dry) {
    console.log("[unlocode] --dry: skipping location writes");
    return { inserted: 0, skipped };
  }

  const payload = deduped.map((l) => ({ ...l, source_release: release }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geo = (client as any).schema("geo");
  const chunkSize = 500;
  for (let off = 0; off < payload.length; off += chunkSize) {
    const chunk = payload.slice(off, off + chunkSize);
    const { error } = await geo.from("locations").upsert(chunk, { onConflict: "unlocode" });
    if (error) {
      throw new Error(`location upsert failed at offset ${off}: ${error.message}`);
    }
    process.stdout.write(`\r[unlocode] locations upserted ${Math.min(off + chunk.length, payload.length)}/${payload.length}`);
  }
  process.stdout.write("\n");
  return { inserted: payload.length, skipped };
}

// ---------- entrypoint ----------

async function main(): Promise<void> {
  loadEnv();

  const args = new Set(process.argv.slice(2));
  const dry = args.has("--dry");
  const onlyCountries = args.has("--countries");
  const onlyLocations = args.has("--locations");

  const release = process.env.UNLOCODE_RELEASE
    || `${new Date().getUTCFullYear()}-${new Date().getUTCMonth() < 6 ? 1 : 2}`;

  console.log(
    `[unlocode] release=${release} dry=${dry} ` +
      `mode=${onlyCountries ? "countries-only" : onlyLocations ? "locations-only" : "full"}`,
  );

  const client = adminClient();

  let countryCount = 0;
  let knownCountryCodes = new Set<string>();

  if (!onlyLocations) {
    const result = await importCountries(client, release, dry);
    countryCount = result.count;
    knownCountryCodes = result.codes;
  } else if (!dry) {
    // --locations only: read the existing country list from DB so the
    // FK check works without re-importing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geo = (client as any).schema("geo");
    const { data, error } = await geo.from("countries").select("code");
    if (error) throw new Error(`failed to read geo.countries: ${error.message}`);
    knownCountryCodes = new Set(((data ?? []) as Array<{ code: string }>).map((r) => r.code));
  } else {
    // --locations --dry: fetch the country list in-memory but don't write
    const result = await importCountries(client, release, true);
    knownCountryCodes = result.codes;
  }

  let locResult = { inserted: 0, skipped: 0 };
  if (!onlyCountries) {
    locResult = await importLocations(client, knownCountryCodes, release, dry);
  }

  console.log(
    `[unlocode] done. countries=${countryCount} ` +
      `locations=${locResult.inserted} skipped=${locResult.skipped}`,
  );
}

main().catch((err) => {
  console.error("[unlocode] FAILED:", err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
