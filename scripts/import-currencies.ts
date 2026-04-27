#!/usr/bin/env -S npx tsx
/**
 * ISO 4217 currency importer.
 *
 * Pulls the github.com/datasets/currency-codes mirror (ISO 4217 aligned).
 * Writes rows to geo.currencies (migration 032).
 *
 * Usage:
 *   npx tsx scripts/import-currencies.ts
 *   npx tsx scripts/import-currencies.ts --dry
 *
 * Idempotent on the 3-letter alpha code PK.
 */

import { createClient } from "@supabase/supabase-js";
import { defaultReleaseTag, fetchText, loadEnv, parseCsv } from "./_lib/import-utils";

const SOURCE_URL =
  "https://raw.githubusercontent.com/datasets/currency-codes/master/data/codes-all.csv";

interface CurrencyRow {
  code: string;
  name: string;
  numeric_code: string | null;
  minor_unit: number | null;
  active: boolean;
  withdrawal_date: string | null;
  countries: string[];
}

async function main() {
  loadEnv();
  const dry = process.argv.includes("--dry");
  const release = process.env.CURRENCIES_RELEASE || defaultReleaseTag();
  console.log(`[currencies] release=${release} dry=${dry}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing Supabase URL or service key");

  console.log("[currencies] fetching ISO 4217 list...");
  const text = await fetchText(SOURCE_URL);
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("currency-codes csv looks empty");

  const header = rows[0].map((h) => h.trim());
  const idxAlpha = header.indexOf("AlphabeticCode");
  const idxName = header.indexOf("Currency");
  const idxEntity = header.indexOf("Entity");
  const idxNum = header.indexOf("NumericCode");
  const idxMinor = header.indexOf("MinorUnit");
  const idxWithdrawal = header.indexOf("WithdrawalDate");

  if (idxAlpha < 0 || idxName < 0) {
    throw new Error(`currency csv missing expected columns. Header: ${header.join("|")}`);
  }

  // Multiple rows per currency (one per entity/country) - aggregate
  // countries into a single row per AlphabeticCode.
  const byCode = new Map<string, CurrencyRow & { _countries: Set<string> }>();
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const code = (r[idxAlpha] || "").trim().toUpperCase();
    if (code.length !== 3) {
      skipped += 1;
      continue;
    }
    const name = (r[idxName] || "").trim();
    if (!name) {
      skipped += 1;
      continue;
    }
    const entity = (r[idxEntity] || "").trim();
    const minorRaw = (r[idxMinor] || "").trim();
    const minor = /^\d+$/.test(minorRaw) ? parseInt(minorRaw, 10) : null;
    const withdrawal = idxWithdrawal >= 0 ? (r[idxWithdrawal] || "").trim() : "";

    const existing = byCode.get(code);
    if (existing) {
      if (entity) existing._countries.add(entity);
      if (withdrawal && !existing.withdrawal_date) {
        existing.withdrawal_date = withdrawal;
        existing.active = false;
      }
      continue;
    }

    byCode.set(code, {
      code,
      name,
      numeric_code: idxNum >= 0 ? (r[idxNum] || "").trim().padStart(3, "0").slice(-3) || null : null,
      minor_unit: minor,
      active: !withdrawal,
      withdrawal_date: withdrawal || null,
      countries: [],
      _countries: new Set(entity ? [entity] : []),
    });
  }

  const currencies = Array.from(byCode.values()).map((r) => ({
    code: r.code,
    name: r.name,
    numeric_code: r.numeric_code,
    minor_unit: r.minor_unit,
    active: r.active,
    withdrawal_date: r.withdrawal_date,
    countries: Array.from(r._countries).sort(),
  }));

  console.log(`[currencies] parsed ${currencies.length} (skipped ${skipped})`);

  if (dry) {
    console.log("[currencies] --dry: skipping writes");
    return;
  }

  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geo = (client as any).schema("geo");

  const payload = currencies.map((c) => ({ ...c, source_release: release }));
  const chunkSize = 200;
  for (let off = 0; off < payload.length; off += chunkSize) {
    const chunk = payload.slice(off, off + chunkSize);
    const { error } = await geo.from("currencies").upsert(chunk, { onConflict: "code" });
    if (error) throw new Error(`currency upsert failed at offset ${off}: ${error.message}`);
    process.stdout.write(`\r[currencies] upserted ${Math.min(off + chunk.length, payload.length)}/${payload.length}`);
  }
  process.stdout.write("\n[currencies] done.\n");
}

main().catch((err) => {
  console.error("[currencies] FAILED:", err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
