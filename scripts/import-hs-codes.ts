#!/usr/bin/env -S npx tsx
/**
 * WCO Harmonized System (HS) commodity-code importer.
 *
 * Pulls the github.com/datasets/harmonized-system mirror, which tracks
 * the WCO HS6 nomenclature (~5500 active codes across chapter / heading
 * / subheading levels). Writes to customs.hs_codes (migration 033).
 *
 * Usage:
 *   npx tsx scripts/import-hs-codes.ts
 *   npx tsx scripts/import-hs-codes.ts --dry
 *
 * Idempotent on the code PK.
 */

import { createClient } from "@supabase/supabase-js";
import { defaultReleaseTag, fetchText, loadEnv, parseCsv } from "./_lib/import-utils";

const SOURCE_URL =
  "https://raw.githubusercontent.com/datasets/harmonized-system/master/data/harmonized-system.csv";

interface HsRow {
  code: string;
  description: string;
  level: 2 | 4 | 6;
  parent_code: string | null;
  section: string | null;
}

function deriveLevel(code: string): 2 | 4 | 6 | null {
  if (/^\d{2}$/.test(code)) return 2;
  if (/^\d{4}$/.test(code)) return 4;
  if (/^\d{6}$/.test(code)) return 6;
  return null;
}

function deriveParent(code: string): string | null {
  if (/^\d{6}$/.test(code)) return code.slice(0, 4);
  if (/^\d{4}$/.test(code)) return code.slice(0, 2);
  return null;
}

async function main() {
  loadEnv();
  const dry = process.argv.includes("--dry");
  const release = process.env.HS_CODES_RELEASE || defaultReleaseTag();
  console.log(`[hs-codes] release=${release} dry=${dry}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing Supabase URL or service key");

  console.log("[hs-codes] fetching WCO HS list...");
  const text = await fetchText(SOURCE_URL);
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("hs csv looks empty");

  const header = rows[0].map((h) => h.trim());
  const idxCode = header.findIndex((h) => /^(hscode|code)$/i.test(h));
  const idxDesc = header.findIndex((h) => /^description$/i.test(h));
  const idxSection = header.findIndex((h) => /^section$/i.test(h));

  if (idxCode < 0 || idxDesc < 0) {
    throw new Error(`hs csv missing expected columns. Header: ${header.join("|")}`);
  }

  const parsed: HsRow[] = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    // Some sources zero-pad codes; strip to digits only.
    const codeRaw = (r[idxCode] || "").trim().replace(/[^\d]/g, "");
    const code = codeRaw;
    if (!code) {
      skipped += 1;
      continue;
    }
    const level = deriveLevel(code);
    if (!level) {
      skipped += 1;
      continue;
    }
    const description = (r[idxDesc] || "").trim();
    if (!description) {
      skipped += 1;
      continue;
    }
    parsed.push({
      code,
      description,
      level,
      parent_code: deriveParent(code),
      section: idxSection >= 0 ? (r[idxSection] || "").trim() || null : null,
    });
  }

  // Dedupe by code, keeping the last occurrence.
  const dedupe = new Map<string, HsRow>();
  for (const r of parsed) dedupe.set(r.code, r);
  const all = Array.from(dedupe.values());

  // FK requires parents inserted first. Sort by level ascending.
  all.sort((a, b) => a.level - b.level);

  console.log(`[hs-codes] parsed ${all.length} (skipped ${skipped})`);

  if (dry) {
    console.log("[hs-codes] --dry: skipping writes");
    return;
  }

  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customs = (client as any).schema("customs");

  // Insert level by level so parent_code FK is satisfied. Within a
  // level, batch in 500s.
  const byLevel = new Map<number, HsRow[]>();
  for (const r of all) {
    const bucket = byLevel.get(r.level) ?? [];
    bucket.push(r);
    byLevel.set(r.level, bucket);
  }

  const payload = (rows: HsRow[]) => rows.map((r) => ({ ...r, source_release: release }));
  for (const lvl of [2, 4, 6] as const) {
    const bucket = byLevel.get(lvl) ?? [];
    if (!bucket.length) continue;
    const data = payload(bucket);
    const chunkSize = 500;
    for (let off = 0; off < data.length; off += chunkSize) {
      const chunk = data.slice(off, off + chunkSize);
      const { error } = await customs.from("hs_codes").upsert(chunk, { onConflict: "code" });
      if (error) {
        throw new Error(`hs_codes upsert (level ${lvl}) failed at offset ${off}: ${error.message}`);
      }
      process.stdout.write(`\r[hs-codes] level ${lvl}: ${Math.min(off + chunk.length, data.length)}/${data.length}`);
    }
    process.stdout.write("\n");
  }
  console.log("[hs-codes] done.");
}

main().catch((err) => {
  console.error("[hs-codes] FAILED:", err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
