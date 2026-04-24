/**
 * Controlled vocabulary for email relevance tags. Kept in a dedicated
 * module so both server (rules loader, classify/refine routes) and client
 * (tag chips + picker) can import without a runtime cycle. Adding new tags
 * here is a conscious, reviewable change - ad-hoc tags would leak through
 * the rule-matching pipeline and make scope selection unpredictable.
 */

export const DEPARTMENT_TAGS = ["Ops", "Sales", "Accounts"] as const;
export const MODE_TAGS = ["Air", "Road", "Sea", "Warehousing"] as const;
export const ALL_TAGS = [...DEPARTMENT_TAGS, ...MODE_TAGS] as const;

export type DepartmentTag = (typeof DEPARTMENT_TAGS)[number];
export type ModeTag = (typeof MODE_TAGS)[number];
export type RelevanceTag = (typeof ALL_TAGS)[number];

const ALLOWED_SET = new Set<string>(ALL_TAGS);
const DEPARTMENT_SET = new Set<string>(DEPARTMENT_TAGS);
const MODE_SET = new Set<string>(MODE_TAGS);

export function isDepartmentTag(value: string): value is DepartmentTag {
  return DEPARTMENT_SET.has(value);
}

export function isModeTag(value: string): value is ModeTag {
  return MODE_SET.has(value);
}

/**
 * Coerce an arbitrary value into the controlled tag vocabulary. Dedupes,
 * title-cases, and drops anything unknown. Returns [] if input isn't an
 * array so malformed upstream data (e.g. model output) can't enter the
 * rule-matching pipeline or the DB.
 */
export function normaliseTags(raw: unknown): RelevanceTag[] {
  if (!Array.isArray(raw)) return [];
  const out: RelevanceTag[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const title = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
    if (!ALLOWED_SET.has(title) || seen.has(title)) continue;
    seen.add(title);
    out.push(title as RelevanceTag);
  }
  return out;
}
