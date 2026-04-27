#!/usr/bin/env -S npx tsx
/**
 * UN/LOCODE smoke test. Spot-checks a handful of well-known codes to
 * confirm migration 031 + the import script produced sensible rows.
 */

import * as fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ENV_PATHS = [".env.local", ".env"];

function loadEnv(): void {
  for (const p of ENV_PATHS) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
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

const SPOT_CHECKS = [
  "GBFXT", // Felixstowe
  "NLRTM", // Rotterdam
  "USNYC", // New York / New Jersey
  "CNSHA", // Shanghai
  "SGSIN", // Singapore
  "DEHAM", // Hamburg
  "BEANR", // Antwerp
  "AEDXB", // Dubai (airport too)
  "BRSSZ", // Santos
  "GBLON", // London (multi-function)
];

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing Supabase URL or service key");
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geo = (client as any).schema("geo");

  const { count: countryCount } = await geo
    .from("countries")
    .select("code", { count: "exact", head: true });

  const { count: locationCount } = await geo
    .from("locations")
    .select("unlocode", { count: "exact", head: true });

  const { count: portCount } = await geo
    .from("locations")
    .select("unlocode", { count: "exact", head: true })
    .eq("function_port", true);

  const { count: airportCount } = await geo
    .from("locations")
    .select("unlocode", { count: "exact", head: true })
    .eq("function_airport", true);

  const { count: ukCount } = await geo
    .from("locations")
    .select("unlocode", { count: "exact", head: true })
    .eq("country_code", "GB");

  console.log("=== UN/LOCODE smoke test ===");
  console.log(`Countries: ${countryCount}`);
  console.log(`Locations: ${locationCount}`);
  console.log(`  - ports:    ${portCount}`);
  console.log(`  - airports: ${airportCount}`);
  console.log(`  - UK:       ${ukCount}`);
  console.log("");
  console.log("Spot checks:");

  for (const code of SPOT_CHECKS) {
    const { data, error } = await geo
      .from("locations")
      .select(
        "unlocode,name,country_code,subdivision,function_port,function_airport,function_rail,latitude,longitude,iata_code,status,source_release",
      )
      .eq("unlocode", code)
      .maybeSingle();
    if (error) {
      console.log(`  ${code}: ERROR ${error.message}`);
      continue;
    }
    if (!data) {
      console.log(`  ${code}: NOT FOUND`);
      continue;
    }
    const fns: string[] = [];
    if (data.function_port) fns.push("port");
    if (data.function_airport) fns.push("airport");
    if (data.function_rail) fns.push("rail");
    const coord =
      data.latitude != null && data.longitude != null
        ? `(${data.latitude.toFixed(2)}, ${data.longitude.toFixed(2)})`
        : "no coords";
    const iata = data.iata_code ? ` IATA=${data.iata_code}` : "";
    console.log(
      `  ${code}: ${data.name} [${data.country_code}/${data.subdivision ?? "-"}] ${fns.join(",") || "no fn"} ${coord}${iata} status=${data.status ?? "-"}`,
    );
  }
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
