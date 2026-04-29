/**
 * Seniority scorer: maps free-text job titles to a 0-100 score using a
 * keyword-to-score weight table loaded from system_rules.seniority_score.
 *
 * Strategy:
 *   1. Lowercase and search for each known phrase as a substring.
 *   2. Among all matches, return the highest weight (so "Founder & CEO" -> CEO).
 *   3. No match -> default_unknown (or 20 if the weights table doesn't define it).
 *
 * The ALIASES table maps surface phrases to canonical weight keys. The seed
 * migration 068 supplies the canonical keys (ceo, founder, director, etc.).
 * Adding a new alias here without a corresponding weight entry returns 0;
 * adding a new weight without an alias here means the title must contain
 * the canonical key verbatim to match. Both are intentional.
 */

const ALIASES: Record<string, string> = {
  "chief executive officer": "ceo",
  "chief executive": "ceo",
  ceo: "ceo",
  "co-founder": "founder",
  cofounder: "founder",
  founder: "founder",
  owner: "owner",
  president: "president",
  "managing director": "managing_director",
  md: "managing_director",
  director: "director",
  head: "head",
  "vice president": "vp",
  vp: "vp",
  manager: "manager",
  lead: "lead",
  analyst: "analyst",
  coordinator: "coordinator",
  executive: "executive",
  exec: "executive",
};

export function scoreTitle(
  title: string | null | undefined,
  weights: Record<string, number>,
): number {
  const fallback = weights.default_unknown ?? 20;
  if (!title) return fallback;

  const lower = title.toLowerCase();
  let best = -1;
  for (const [phrase, canonical] of Object.entries(ALIASES)) {
    if (lower.includes(phrase)) {
      const score = weights[canonical];
      if (score !== undefined && score > best) best = score;
    }
  }
  return best >= 0 ? best : fallback;
}
