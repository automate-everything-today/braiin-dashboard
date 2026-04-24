import { supabase } from "@/services/base";

/**
 * Hierarchical reply rules. Rules are pulled from the reply_rules table at
 * classify / refine time and merged into the Anthropic prompt so every reply
 * draft honours Corten-wide, branch, department, mode, user, and category
 * voice preferences.
 *
 * Specificity order (most specific first). More specific rules appear higher
 * in the prompt so Claude prefers them when instructions conflict:
 *   1. category     (e.g. quote_request)
 *   2. user         (the author's personal voice)
 *   3. mode         (Air / Road / Sea / Warehousing)
 *   4. department   (Ops / Sales / Accounts)
 *   5. branch       (London / Manchester / etc.)
 *   6. global       (Corten house style)
 */

export type ReplyRuleScope =
  | "category"
  | "user"
  | "mode"
  | "department"
  | "branch"
  | "global";

export type ReplyRuleContext = {
  userEmail?: string | null;
  category?: string | null;
  /**
   * Content tags for the email (e.g. ["Sales","Sea"], ["Accounts","Sea"]).
   * Any tag whose value matches a known department or mode name is used to
   * load the corresponding scoped rules. One email can carry multiple tags,
   * so one classification can pull rules from multiple departments / modes.
   */
  tags?: string[] | null;
  branch?: string | null;
};

const KNOWN_DEPARTMENTS = new Set(["Ops", "Sales", "Accounts"]);
const KNOWN_MODES = new Set(["Air", "Road", "Sea", "Warehousing"]);

export type LoadedReplyRule = {
  id: number;
  scope_type: ReplyRuleScope;
  scope_value: string;
  instruction: string;
};

const SCOPE_ORDER: ReplyRuleScope[] = [
  "category",
  "user",
  "mode",
  "department",
  "branch",
  "global",
];

const SCOPE_LABELS: Record<ReplyRuleScope, string> = {
  category: "category",
  user: "your personal",
  mode: "business unit",
  department: "department",
  branch: "branch",
  global: "Corten house-style",
};

/**
 * One-shot lookup of every active rule relevant to the given context.
 * Returns rules ordered by specificity (category first, global last) so the
 * prompt can list them without further sorting.
 *
 * Performance note: a single round-trip using OR filters; avoids N queries.
 */
export async function loadReplyRules(ctx: ReplyRuleContext): Promise<LoadedReplyRule[]> {
  const orClauses: string[] = [];

  if (ctx.category) {
    orClauses.push(`and(scope_type.eq.category,scope_value.eq.${escapeFilter(ctx.category)})`);
  }
  if (ctx.userEmail) {
    orClauses.push(`and(scope_type.eq.user,scope_value.eq.${escapeFilter(ctx.userEmail.toLowerCase())})`);
  }
  // Expand content tags into the scope types they match. A tag value that
  // matches a known department name pulls department-scoped rules; a tag
  // that matches a known mode pulls mode-scoped rules. Unknown tags are
  // silently ignored today (future: a generic "tag" scope_type).
  const tags = (ctx.tags || []).filter(Boolean);
  const seenDept = new Set<string>();
  const seenMode = new Set<string>();
  for (const tag of tags) {
    if (KNOWN_DEPARTMENTS.has(tag) && !seenDept.has(tag)) {
      seenDept.add(tag);
      orClauses.push(`and(scope_type.eq.department,scope_value.eq.${escapeFilter(tag)})`);
    } else if (KNOWN_MODES.has(tag) && !seenMode.has(tag)) {
      seenMode.add(tag);
      orClauses.push(`and(scope_type.eq.mode,scope_value.eq.${escapeFilter(tag)})`);
    }
  }
  if (ctx.branch) {
    orClauses.push(`and(scope_type.eq.branch,scope_value.eq.${escapeFilter(ctx.branch)})`);
  }
  // Global rules always apply.
  orClauses.push(`and(scope_type.eq.global,scope_value.eq.global)`);

  const { data, error } = await supabase
    .from("reply_rules")
    .select("id, scope_type, scope_value, instruction")
    .eq("active", true)
    .or(orClauses.join(","))
    .limit(50);

  if (error) {
    // Best effort: if the table isn't live yet we shouldn't break classification.
    console.warn("[reply-rules] failed to load:", error.message);
    return [];
  }

  const rows = (data || []) as LoadedReplyRule[];
  rows.sort((a, b) => SCOPE_ORDER.indexOf(a.scope_type) - SCOPE_ORDER.indexOf(b.scope_type));
  return rows;
}

/**
 * Render loaded rules into a prompt block. Returns an empty string when
 * there are no rules so callers can concatenate without conditional logic.
 */
export function formatRulesBlock(rules: LoadedReplyRule[]): string {
  if (rules.length === 0) return "";
  const lines = rules.map(
    (r) => `- (${SCOPE_LABELS[r.scope_type]}) ${r.instruction.trim()}`,
  );
  return [
    "REPLY RULES (apply to every draft, most specific first):",
    ...lines,
    "",
    "",
  ].join("\n");
}

/**
 * Fire-and-forget bump of usage_count + last_used_at so managers can see
 * which rules are being applied and prune dead ones. Errors are logged but
 * never surfaced - a stats update failure must not break classification.
 *
 * Read-then-write per rule is acceptable because we only ever apply a
 * handful of rules per email (capped at 50 in loadReplyRules, in practice
 * 0-10). Swap for a SQL function if that changes.
 */
export async function recordRulesUsage(ruleIds: number[]): Promise<void> {
  if (ruleIds.length === 0) return;
  const nowIso = new Date().toISOString();
  await Promise.all(
    ruleIds.map(async (id) => {
      try {
        const { data: row } = await supabase
          .from("reply_rules")
          .select("usage_count")
          .eq("id", id)
          .single();
        const current = (row?.usage_count as number | undefined) ?? 0;
        await supabase
          .from("reply_rules")
          .update({ usage_count: current + 1, last_used_at: nowIso })
          .eq("id", id);
      } catch (err) {
        console.warn("[reply-rules] usage bump failed for id", id, err);
      }
    }),
  );
}

/**
 * Upsert a user-scoped learned rule when somebody refines a reply. We merge
 * by (scope_type, scope_value, instruction) so repeating the same tweak
 * just increments usage_count instead of cluttering the rules list.
 */
export async function upsertLearnedUserRule(params: {
  userEmail: string;
  instruction: string;
}): Promise<void> {
  const userEmail = params.userEmail.toLowerCase();
  const instruction = params.instruction.trim();
  if (!instruction) return;

  const { data: existing } = await supabase
    .from("reply_rules")
    .select("id, usage_count")
    .eq("scope_type", "user")
    .eq("scope_value", userEmail)
    .eq("instruction", instruction)
    .eq("source", "learned")
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const nextCount = ((existing.usage_count as number | undefined) ?? 0) + 1;
    await supabase
      .from("reply_rules")
      .update({ usage_count: nextCount, last_used_at: new Date().toISOString(), active: true })
      .eq("id", existing.id);
    return;
  }

  const { error } = await supabase.from("reply_rules").insert({
    scope_type: "user",
    scope_value: userEmail,
    instruction,
    source: "learned",
    created_by: userEmail,
    active: true,
    usage_count: 1,
    last_used_at: new Date().toISOString(),
  });
  if (error) {
    console.warn("[reply-rules] failed to record learned rule:", error.message);
  }
}

/**
 * Fetch the current user's business unit mode from the staff table. Nullable;
 * staff members who haven't been assigned a mode yet will skip mode-scoped
 * rules. Deliberately not cached - a stale value is not worth the cache
 * invalidation complexity for a handful of users.
 */
export async function getUserMode(userEmail: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("staff")
    .select("mode")
    .eq("email", userEmail.toLowerCase())
    .maybeSingle();

  if (error) {
    console.warn("[reply-rules] failed to load user mode:", error.message);
    return null;
  }

  const mode = (data as { mode?: string | null } | null)?.mode ?? null;
  return mode ?? null;
}

function escapeFilter(value: string): string {
  // PostgREST .or() needs commas / parens inside values quoted.
  if (/[,()]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
  return value;
}
