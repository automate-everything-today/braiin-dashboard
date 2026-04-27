/**
 * Domain shorthand vocabulary lookup (engiine RFC 3.4).
 *
 * Reads from `shorthand.terms` + `shorthand.translations`. The full vocab
 * is small enough (~100 rows today, ~500 expected ceiling) to cache in
 * process memory. TTL'd at 5 minutes so admin-route additions surface
 * without a redeploy.
 *
 * Public API:
 *   lookupTerm(term, { category?, locale? })        -> entry or null
 *   lookupByCategory(category, { locale? })          -> entries
 *   expandShorthand(text, { locale?, categories? })  -> text with (canonical) inlined
 *   addTerm(input)                                   -> persists + invalidates cache
 *   refreshVocabulary(locale?)                       -> manual cache invalidation
 */

import { supabase } from "@/services/base";
import type { AddTermInput, ShorthandEntry } from "./types";

interface ShorthandClient {
  from(table: string): {
    select: (cols: string) => {
      eq: (col: string, val: string) => SelectChain;
    };
    upsert: (
      row: Record<string, unknown>,
      opts?: { onConflict?: string },
    ) => {
      select: (cols: string) => {
        single: () => Promise<{ data: TermRow | null; error: { message: string } | null }>;
      };
    };
  };
}

interface SelectChain {
  data?: unknown;
  error?: { message: string } | null;
  // Real chain returns a thenable resolving to { data, error }
  then: (resolve: (v: { data: TranslationJoinRow[] | null; error: { message: string } | null }) => void) => void;
}

interface TermRow {
  term_id: string;
  term: string;
  category: string;
  metadata: Record<string, unknown> | null;
}

interface TranslationJoinRow {
  term_id: string;
  locale: string;
  canonical_name: string;
  description: string | null;
  aliases: string[] | null;
  terms: {
    term: string;
    category: string;
    metadata: Record<string, unknown> | null;
  } | null;
}

interface VocabSnapshot {
  loadedAt: number;
  byTermLower: Map<string, ShorthandEntry[]>;
  byCategory: Map<string, ShorthandEntry[]>;
  all: ShorthandEntry[];
  expansionRegex: RegExp | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, VocabSnapshot>();

function shorthandClient(): ShorthandClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).schema("shorthand") as ShorthandClient;
}

function rowToEntry(row: TranslationJoinRow): ShorthandEntry | null {
  if (!row.terms) return null;
  return {
    termId: row.term_id,
    term: row.terms.term,
    category: row.terms.category,
    canonicalName: row.canonical_name,
    description: row.description,
    aliases: row.aliases ?? [],
    metadata: row.terms.metadata ?? {},
    locale: row.locale,
  };
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSnapshot(entries: ShorthandEntry[]): VocabSnapshot {
  const byTermLower = new Map<string, ShorthandEntry[]>();
  const byCategory = new Map<string, ShorthandEntry[]>();

  for (const e of entries) {
    const tk = e.term.toLowerCase();
    const tBucket = byTermLower.get(tk) ?? [];
    tBucket.push(e);
    byTermLower.set(tk, tBucket);

    const cBucket = byCategory.get(e.category) ?? [];
    cBucket.push(e);
    byCategory.set(e.category, cBucket);
  }

  // Longest-first so 'MAERSK' doesn't get pre-empted by 'MA' if both exist.
  const expansionTerms = entries.map((e) => escapeRegex(e.term)).sort((a, b) => b.length - a.length);
  const expansionRegex = expansionTerms.length
    ? new RegExp(`\\b(?:${expansionTerms.join("|")})\\b`, "gi")
    : null;

  return {
    loadedAt: Date.now(),
    byTermLower,
    byCategory,
    all: entries,
    expansionRegex,
  };
}

async function fetchVocabulary(locale: string): Promise<ShorthandEntry[]> {
  // Pull translations for the locale and join the parent term row.
  // We use the embedded-resource select syntax so PostgREST returns
  // both rows in a single round trip.
  const client = shorthandClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client.from("translations") as any)
    .select("term_id,locale,canonical_name,description,aliases,terms(term,category,metadata)")
    .eq("locale", locale);

  if (error) {
    throw new Error(`Failed to load shorthand vocabulary: ${error.message}`);
  }

  const rows = (data ?? []) as TranslationJoinRow[];
  return rows.map(rowToEntry).filter((e): e is ShorthandEntry => e !== null);
}

async function getSnapshot(locale: string, force = false): Promise<VocabSnapshot> {
  const cached = cache.get(locale);
  const fresh = cached && Date.now() - cached.loadedAt < CACHE_TTL_MS;
  if (cached && fresh && !force) return cached;

  const entries = await fetchVocabulary(locale);
  const snapshot = buildSnapshot(entries);
  cache.set(locale, snapshot);
  return snapshot;
}

/**
 * Look up a single shorthand term. Match is case-insensitive against
 * `term`. If `category` is given, only entries in that category are
 * considered (useful when the same code lives in multiple categories).
 *
 * Returns null when the term is not in the vocabulary - this is a
 * normal lookup outcome, not an error.
 */
export async function lookupTerm(
  term: string,
  opts: { category?: string; locale?: string } = {},
): Promise<ShorthandEntry | null> {
  const locale = opts.locale ?? "en";
  const snapshot = await getSnapshot(locale);
  const matches = snapshot.byTermLower.get(term.toLowerCase()) ?? [];
  if (!matches.length) return null;
  if (opts.category) {
    return matches.find((m) => m.category === opts.category) ?? null;
  }
  // Stable order: prefer non-misc, then alphabetical by category.
  return [...matches].sort((a, b) => {
    if (a.category === "misc" && b.category !== "misc") return 1;
    if (b.category === "misc" && a.category !== "misc") return -1;
    return a.category.localeCompare(b.category);
  })[0];
}

/**
 * All entries in a given category, e.g. all Incoterms or all UK ports.
 */
export async function lookupByCategory(
  category: string,
  opts: { locale?: string } = {},
): Promise<ShorthandEntry[]> {
  const locale = opts.locale ?? "en";
  const snapshot = await getSnapshot(locale);
  return snapshot.byCategory.get(category) ?? [];
}

/**
 * Expand shorthand inline. For every known term that appears in `text`,
 * appends "(Canonical Name)" after the first occurrence. Used to enrich
 * LLM prompts so the model has the unambiguous expansion alongside the
 * jargon.
 *
 * Already-expanded occurrences (followed by "(") are left alone.
 *
 * Pass `categories` to restrict to a subset (e.g. only ports + carriers).
 */
export async function expandShorthand(
  text: string,
  opts: { locale?: string; categories?: string[]; firstOnly?: boolean } = {},
): Promise<string> {
  const locale = opts.locale ?? "en";
  const snapshot = await getSnapshot(locale);
  if (!snapshot.expansionRegex || !text) return text;

  const allowed = opts.categories ? new Set(opts.categories) : null;
  const seen = new Set<string>();
  const firstOnly = opts.firstOnly !== false;

  return text.replace(snapshot.expansionRegex, (match, _g, offset: number) => {
    const next = text.charAt(offset + match.length);
    if (next === "(") return match;

    const key = match.toLowerCase();
    if (firstOnly && seen.has(key)) return match;

    const candidates = snapshot.byTermLower.get(key) ?? [];
    const filtered = allowed
      ? candidates.filter((c) => allowed.has(c.category))
      : candidates;
    if (!filtered.length) return match;

    const entry = filtered[0];
    seen.add(key);
    return `${match} (${entry.canonicalName})`;
  });
}

/**
 * Persist a new term and its translation. Uses the `shorthand.upsert_term`
 * Postgres function so terms + translations are written atomically.
 *
 * Invalidates the in-memory cache for the affected locale.
 */
export async function addTerm(input: AddTermInput): Promise<ShorthandEntry> {
  const locale = input.locale ?? "en";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = (supabase as any).schema("shorthand").rpc("upsert_term", {
    p_term: input.term,
    p_category: input.category,
    p_canonical_name: input.canonicalName,
    p_description: input.description ?? null,
    p_aliases: input.aliases ?? [],
    p_metadata: input.metadata ?? {},
    p_locale: locale,
  });

  const { data: termId, error } = (await rpc) as {
    data: string | null;
    error: { message: string } | null;
  };

  if (error) {
    throw new Error(`Failed to add shorthand term: ${error.message}`);
  }
  if (!termId) {
    throw new Error("Shorthand upsert returned no term_id");
  }

  cache.delete(locale);

  return {
    termId,
    term: input.term,
    category: input.category,
    canonicalName: input.canonicalName,
    description: input.description ?? null,
    aliases: input.aliases ?? [],
    metadata: input.metadata ?? {},
    locale,
  };
}

/**
 * Force a cache reload for the given locale (or all locales if omitted).
 * Useful after bulk seed migrations or on startup smoke tests.
 */
export async function refreshVocabulary(locale?: string): Promise<void> {
  if (locale) {
    await getSnapshot(locale, true);
  } else {
    cache.clear();
  }
}

/**
 * Snapshot inspection for the dashboard / smoke tests. Returns a
 * shallow copy so callers can't mutate the cache.
 */
export async function getAllTerms(locale = "en"): Promise<ShorthandEntry[]> {
  const snapshot = await getSnapshot(locale);
  return [...snapshot.all];
}
