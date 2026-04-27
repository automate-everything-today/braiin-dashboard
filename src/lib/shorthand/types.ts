/**
 * Shared types for the shorthand vocabulary (engiine RFC 3.4).
 *
 * Rows live in the `shorthand` Postgres schema (migrations 029, 030).
 * Read paths go through `src/lib/shorthand/index.ts` with an in-memory
 * cache; writes go through the admin route or direct migrations.
 */

export type ShorthandCategory =
  | "container"
  | "incoterm"
  | "mode"
  | "port"
  | "document"
  | "status"
  | "carrier"
  | "unit"
  | "misc";

export interface ShorthandEntry {
  termId: string;
  term: string;
  category: string;
  canonicalName: string;
  description: string | null;
  aliases: string[];
  metadata: Record<string, unknown>;
  locale: string;
}

export interface AddTermInput {
  term: string;
  category: string;
  canonicalName: string;
  description?: string;
  aliases?: string[];
  metadata?: Record<string, unknown>;
  locale?: string;
  createdBy?: string;
}
