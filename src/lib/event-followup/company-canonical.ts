/**
 * Company name canonicalisation for same-company grouping.
 *
 * Two contacts at "Krom Global Logistics" and "KROM GLOBAL" should canonicalise
 * to the same string so the importer's group-detection pass (Phase 4) can put
 * them in one company_groups row.
 *
 * Rules are loaded from system_rules.company_match.canonicalisation. Operator
 * tunes strip_suffixes / treat_and_equal / strip_punctuation / lowercase via
 * /dev/system-rules.
 */

export interface CanonicalRules {
  strip_suffixes: string[];
  treat_and_equal: boolean;
  strip_punctuation: boolean;
  lowercase: boolean;
}

export function canonicalCompany(
  input: string | null | undefined,
  rules: CanonicalRules,
): string {
  if (!input) return "";
  let s = input.trim();
  if (!s) return "";

  if (rules.lowercase) s = s.toLowerCase();
  if (rules.treat_and_equal) s = s.replace(/\s*&\s*/g, " and ");

  // For suffix stripping to work with abbreviations like "S.A.", we need to normalize
  // abbreviations first: convert "S.A." → "sa" so we can match suffix "SA".
  // This is done by removing dots within words (between single letters).
  s = s.replace(/([a-z])\.(?=[a-z])/g, "$1");

  // Strip each configured suffix as a whole-word match.
  for (const suffix of rules.strip_suffixes) {
    const re = new RegExp(`\\b${suffix}\\b\\.?`, "gi");
    s = s.replace(re, " ");
  }

  if (rules.strip_punctuation) s = s.replace(/[.,/'"`!?]+/g, " ");

  return s.replace(/\s+/g, " ").trim();
}
