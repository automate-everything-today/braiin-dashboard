/**
 * Shorthand vocabulary admin endpoint (engiine RFC 3.4).
 *
 * GET  /api/shorthand/terms?category=&locale=&q=
 *   Authenticated users can read the vocabulary. Optional filters:
 *     - category: restrict to a category (port, incoterm, ...)
 *     - locale:   default 'en'
 *     - q:        case-insensitive substring match against term + canonical
 *
 * POST /api/shorthand/terms
 *   Body: { term, category, canonicalName, description?, aliases?, metadata?, locale? }
 *   Manager / super_admin only. Upserts via the shorthand.upsert_term
 *   Postgres function and invalidates the in-memory vocab cache.
 */

import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";
import { apiError, apiResponse } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { addTerm, getAllTerms, lookupByCategory } from "@/lib/shorthand";

const TERM_MAX_LEN = 32;
const CANONICAL_MAX_LEN = 200;
const DESCRIPTION_MAX_LEN = 2000;
const ALIASES_MAX = 20;
const ALIAS_MAX_LEN = 100;
const VALID_CATEGORY = /^[a-z][a-z0-9_]{0,31}$/;
const VALID_LOCALE = /^[a-z]{2}(-[A-Z]{2})?$/;

async function isManager(email: string): Promise<boolean> {
  const { data } = await supabase
    .from("staff")
    .select("is_manager")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return Boolean((data as { is_manager?: boolean } | null)?.is_manager);
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const url = new URL(req.url);
  const category = url.searchParams.get("category")?.trim() || null;
  const locale = url.searchParams.get("locale")?.trim() || "en";
  const q = url.searchParams.get("q")?.trim().toLowerCase() || null;

  if (!VALID_LOCALE.test(locale)) {
    return apiError("Invalid locale (expected BCP 47, e.g. 'en' or 'pt-BR')", 400);
  }
  if (category && !VALID_CATEGORY.test(category)) {
    return apiError("Invalid category", 400);
  }

  try {
    const entries = category
      ? await lookupByCategory(category, { locale })
      : await getAllTerms(locale);

    const filtered = q
      ? entries.filter(
          (e) =>
            e.term.toLowerCase().includes(q) ||
            e.canonicalName.toLowerCase().includes(q) ||
            e.aliases.some((a) => a.toLowerCase().includes(q)),
        )
      : entries;

    return apiResponse({
      locale,
      count: filtered.length,
      entries: filtered,
    });
  } catch (err) {
    console.error("[shorthand/terms] GET failed:", err instanceof Error ? err.message : err);
    return apiError("Failed to load shorthand vocabulary", 500);
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);
  if (session.role !== "super_admin" && !(await isManager(session.email))) {
    return apiError("Forbidden", 403);
  }
  if (!(await checkRateLimit(`shorthand-write:${session.email.toLowerCase()}`, 120))) {
    return apiError("Too many requests. Please slow down.", 429);
  }

  let body: {
    term?: unknown;
    category?: unknown;
    canonicalName?: unknown;
    description?: unknown;
    aliases?: unknown;
    metadata?: unknown;
    locale?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  if (typeof body.term !== "string" || !body.term.trim()) {
    return apiError("term is required (string)", 400);
  }
  const term = body.term.trim();
  if (term.length > TERM_MAX_LEN) {
    return apiError(`term must be ${TERM_MAX_LEN} chars or fewer`, 400);
  }

  if (typeof body.category !== "string" || !VALID_CATEGORY.test(body.category)) {
    return apiError(
      "category is required (lowercase letters, numbers, underscore; starts with letter)",
      400,
    );
  }
  const category = body.category;

  if (typeof body.canonicalName !== "string" || !body.canonicalName.trim()) {
    return apiError("canonicalName is required (string)", 400);
  }
  const canonicalName = body.canonicalName.trim().slice(0, CANONICAL_MAX_LEN);

  let description: string | undefined;
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== "string") {
      return apiError("description must be a string", 400);
    }
    description = body.description.trim().slice(0, DESCRIPTION_MAX_LEN) || undefined;
  }

  let aliases: string[] | undefined;
  if (body.aliases !== undefined && body.aliases !== null) {
    if (!Array.isArray(body.aliases)) {
      return apiError("aliases must be an array of strings", 400);
    }
    if (body.aliases.length > ALIASES_MAX) {
      return apiError(`aliases supports up to ${ALIASES_MAX} entries`, 400);
    }
    const cleaned: string[] = [];
    for (const a of body.aliases) {
      if (typeof a !== "string") {
        return apiError("aliases must be strings", 400);
      }
      const trimmed = a.trim().slice(0, ALIAS_MAX_LEN);
      if (trimmed) cleaned.push(trimmed);
    }
    aliases = cleaned;
  }

  let metadata: Record<string, unknown> | undefined;
  if (body.metadata !== undefined && body.metadata !== null) {
    if (typeof body.metadata !== "object" || Array.isArray(body.metadata)) {
      return apiError("metadata must be a JSON object", 400);
    }
    metadata = body.metadata as Record<string, unknown>;
  }

  let locale = "en";
  if (body.locale !== undefined && body.locale !== null) {
    if (typeof body.locale !== "string" || !VALID_LOCALE.test(body.locale)) {
      return apiError("locale must be BCP 47 (e.g. 'en' or 'pt-BR')", 400);
    }
    locale = body.locale;
  }

  try {
    const entry = await addTerm({
      term,
      category,
      canonicalName,
      description,
      aliases,
      metadata,
      locale,
      createdBy: session.email,
    });
    return apiResponse({ entry });
  } catch (err) {
    console.error("[shorthand/terms] POST failed:", err instanceof Error ? err.message : err);
    return apiError("Failed to save shorthand term", 500);
  }
}
