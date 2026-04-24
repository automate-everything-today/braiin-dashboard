#!/usr/bin/env -S node --loader tsx
/**
 * Generates src/types/database.ts from the Supabase PostgREST OpenAPI spec.
 *
 * Why this script exists:
 *   `supabase gen types typescript --project-id <id>` requires a management
 *   API access token (supabase login), which is awkward in CI and when the
 *   developer doesn't have console access. PostgREST exposes the same schema
 *   information via its OpenAPI spec, which can be fetched with the service
 *   role key alone.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_KEY=... tsx scripts/gen-supabase-types.ts
 *
 *   Or, from .env.local:
 *   npx tsx scripts/gen-supabase-types.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ENV_PATHS = [".env.local", ".env"];

function loadEnv() {
  for (const p of ENV_PATHS) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq);
        const value = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
        if (!process.env[key]) process.env[key] = value;
      }
    }
  }
}

loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}

type SwaggerProp = {
  type?: string;
  format?: string;
  description?: string;
  enum?: string[];
  items?: SwaggerProp;
  default?: unknown;
  // Non-standard: PostgREST marks identity/default/generated columns with these
  readOnly?: boolean;
};

type SwaggerDefinition = {
  description?: string;
  required?: string[];
  properties: Record<string, SwaggerProp>;
};

type SwaggerSpec = {
  definitions: Record<string, SwaggerDefinition>;
  paths: Record<string, { [method: string]: { tags?: string[] } }>;
};

function pgTypeToTs(prop: SwaggerProp): string {
  if (prop.enum && prop.enum.length) {
    return prop.enum.map((e) => JSON.stringify(e)).join(" | ");
  }

  // PostgREST format hints
  const format = (prop.format || "").toLowerCase();
  const type = (prop.type || "").toLowerCase();

  if (format === "json" || format === "jsonb") return "unknown";
  if (format === "uuid") return "string";
  if (format === "timestamp with time zone" || format === "timestamp without time zone") return "string";
  if (format === "date") return "string";
  if (format === "time" || format === "time with time zone") return "string";
  if (format.startsWith("bigint")) return "number";
  if (format.startsWith("bytea")) return "string";

  if (type === "string") return "string";
  if (type === "integer" || type === "number") return "number";
  if (type === "boolean") return "boolean";

  if (type === "array") {
    const inner = prop.items ? pgTypeToTs(prop.items) : "unknown";
    return `${inner}[]`;
  }

  if (type === "object") return "Record<string, unknown>";

  return "unknown";
}

function generateTypes(spec: SwaggerSpec): string {
  const tables: string[] = [];

  for (const [name, def] of Object.entries(spec.definitions)) {
    if (!def.properties) continue;

    const rowEntries: string[] = [];
    const insertEntries: string[] = [];
    const updateEntries: string[] = [];

    const required = new Set(def.required || []);

    for (const [colName, prop] of Object.entries(def.properties)) {
      const tsType = pgTypeToTs(prop);
      const desc = prop.description ? `          /** ${prop.description.replace(/\n/g, " ").slice(0, 200)} */\n` : "";

      const isRequired = required.has(colName);
      const isPrimaryKey = typeof prop.description === "string" && prop.description.includes("<pk/>");
      // Columns with ANY default (even default: "") are auto-filled by Postgres,
      // so they are optional on Insert. Same for PK (SERIAL / identity).
      const hasDefault = Object.prototype.hasOwnProperty.call(prop, "default") || isPrimaryKey;

      // Row: what you get back - all columns present, nullable if not required
      rowEntries.push(`${desc}          ${JSON.stringify(colName)}: ${tsType}${isRequired ? "" : " | null"}`);

      // Insert: column is required on insert only if Postgres requires it AND
      // there's no default we can rely on.
      const mustSupplyOnInsert = isRequired && !hasDefault;
      if (mustSupplyOnInsert) {
        insertEntries.push(`          ${JSON.stringify(colName)}: ${tsType}`);
      } else {
        insertEntries.push(`          ${JSON.stringify(colName)}?: ${tsType}${isRequired ? "" : " | null"}`);
      }

      // Update: all columns optional
      updateEntries.push(`          ${JSON.stringify(colName)}?: ${tsType}${isRequired ? "" : " | null"}`);
    }

    tables.push(`      ${JSON.stringify(name)}: {
        Row: {
${rowEntries.join("\n")}
        }
        Insert: {
${insertEntries.join("\n")}
        }
        Update: {
${updateEntries.join("\n")}
        }
        Relationships: []
      }`);
  }

  return `// AUTO-GENERATED by scripts/gen-supabase-types.ts
// Do not edit manually. Regenerate by running:
//   npx tsx scripts/gen-supabase-types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
${tables.join("\n")}
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_rate_limit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number }
        Returns: boolean
      }
      prune_rate_limits: {
        Args: Record<string, never>
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Convenience row/insert/update helpers
type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
`;
}

async function main() {
  console.log(`Fetching OpenAPI spec from ${SUPABASE_URL}/rest/v1/...`);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  if (!res.ok) {
    console.error(`Failed to fetch OpenAPI spec: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const spec: SwaggerSpec = await res.json();

  const tableCount = Object.keys(spec.definitions).length;
  console.log(`Found ${tableCount} tables/views`);

  const output = generateTypes(spec);
  const outPath = path.join("src", "types", "database.ts");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output);
  console.log(`Wrote ${outPath} (${output.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
