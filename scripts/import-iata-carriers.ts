#!/usr/bin/env -S npx tsx
/**
 * IATA / ICAO airline carrier importer.
 *
 * Pulls openflights.org's airlines.dat (CC-BY) via the project's GitHub
 * repo. Writes to aviation.carriers (migration 034).
 *
 * Source format is CSV without a header, columns:
 *   id, name, alias, iata, icao, callsign, country, active
 *
 * Empty / missing fields are encoded as the literal string "\\N".
 *
 * Usage:
 *   npx tsx scripts/import-iata-carriers.ts
 *   npx tsx scripts/import-iata-carriers.ts --dry
 *
 * Idempotent on the openflights numeric id PK.
 */

import { createClient } from "@supabase/supabase-js";
import { defaultReleaseTag, fetchText, loadEnv, parseCsv } from "./_lib/import-utils";

const SOURCE_URL =
  "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat";

interface CarrierRow {
  carrier_id: number;
  name: string;
  alias: string | null;
  iata_code: string | null;
  icao_code: string | null;
  callsign: string | null;
  country: string | null;
  active: boolean;
}

function nullable(v: string): string | null {
  const t = v.trim();
  if (!t || t === "\\N" || t === "-" || t === "N/A") return null;
  return t;
}

async function main() {
  loadEnv();
  const dry = process.argv.includes("--dry");
  const release = process.env.IATA_RELEASE || defaultReleaseTag();
  console.log(`[iata] release=${release} dry=${dry}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing Supabase URL or service key");

  console.log("[iata] fetching openflights airlines.dat...");
  const text = await fetchText(SOURCE_URL);
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("airlines.dat looks empty");

  const carriers: CarrierRow[] = [];
  let skipped = 0;
  for (const r of rows) {
    if (r.length < 8) {
      skipped += 1;
      continue;
    }
    const idRaw = (r[0] || "").trim();
    const id = parseInt(idRaw, 10);
    if (!Number.isFinite(id) || id < 0) {
      skipped += 1;
      continue;
    }
    const name = nullable(r[1] || "");
    if (!name) {
      skipped += 1;
      continue;
    }
    const iata = nullable(r[3] || "");
    const icao = nullable(r[4] || "");
    // Truncate code fields to declared char widths in case the source
    // has dirty data.
    const iataClean = iata && /^[A-Z0-9]{2}$/i.test(iata) ? iata.toUpperCase() : null;
    const icaoClean = icao && /^[A-Z0-9]{3}$/i.test(icao) ? icao.toUpperCase() : null;

    const activeRaw = (r[7] || "").trim().toUpperCase();
    const active = activeRaw === "Y" || activeRaw === "TRUE" || activeRaw === "1";

    carriers.push({
      carrier_id: id,
      name,
      alias: nullable(r[2] || ""),
      iata_code: iataClean,
      icao_code: icaoClean,
      callsign: nullable(r[5] || ""),
      country: nullable(r[6] || ""),
      active,
    });
  }

  // Dedupe by carrier_id (openflights occasionally has dupes)
  const dedupe = new Map<number, CarrierRow>();
  for (const c of carriers) dedupe.set(c.carrier_id, c);
  const final = Array.from(dedupe.values());

  console.log(`[iata] parsed ${final.length} (skipped ${skipped}, raw ${rows.length})`);

  if (dry) {
    console.log("[iata] --dry: skipping writes");
    return;
  }

  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aviation = (client as any).schema("aviation");

  const payload = final.map((c) => ({ ...c, source_release: release }));
  const chunkSize = 500;
  for (let off = 0; off < payload.length; off += chunkSize) {
    const chunk = payload.slice(off, off + chunkSize);
    const { error } = await aviation.from("carriers").upsert(chunk, { onConflict: "carrier_id" });
    if (error) throw new Error(`carrier upsert failed at offset ${off}: ${error.message}`);
    process.stdout.write(`\r[iata] upserted ${Math.min(off + chunk.length, payload.length)}/${payload.length}`);
  }
  process.stdout.write("\n[iata] done.\n");
}

main().catch((err) => {
  console.error("[iata] FAILED:", err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
