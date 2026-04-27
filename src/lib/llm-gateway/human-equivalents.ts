/**
 * Human-equivalent time estimates per LLM purpose.
 *
 * Used to populate `time_saved_seconds` on activity.llm_calls
 * automatically. Callers can override via humanEquivalentSeconds
 * on LlmCompleteParams.
 *
 * Conservative numbers - these are defensible to a customer
 * looking at the ROI dashboard. When in doubt, err low; we'd
 * rather under-claim and have the cumulative number still feel
 * material.
 *
 * To revise: change the constant here, redeploy. Historical rows
 * keep their original time_saved_seconds value (correct - the
 * estimate at the time the work was done is the right number for
 * audit purposes).
 *
 * Adding a new purpose? Add it here at the same time as you call
 * the gateway with that purpose tag. Falls back to 0 for
 * unmapped purposes (which renders as "no estimate" rather than
 * a fictional number).
 */

export const HUMAN_EQUIVALENT_SECONDS: Record<string, number> = {
  // Email triage / classification - reading + tagging an email
  classify_email: 30,

  // Research-style operations - analyst desk-research on a company
  research_analysis: 600, // 10 min
  client_report: 1800, // 30 min - writing a polished client report
  client_reresearch: 300, // 5 min - light update to existing research

  // Sales workflow
  deal_coach: 300, // 5 min - sales manager reviewing a deal stage
  deal_workspace: 240, // 4 min - workspace summary
  compose_email: 180, // 3 min - drafting one outbound
  refine_replies: 60, // 1 min - polishing a single reply

  // Chat-style features (interactive, harder to estimate)
  braiin_chat: 120, // 2 min per turn - rough average
  client_chat: 120,
  client_chat_extract: 30, // post-chat structured extraction

  // Tag / summary (lightweight)
  tag_summary: 30,

  // Enrichment pipeline
  enrichment_research: 480, // 8 min - person/company enrichment

  // (Add more as new purposes ship)
};

/**
 * Resolve the time-saved seconds for a given purpose, with optional
 * caller override. Returns 0 for unmapped purposes (renders as
 * "no estimate" on the dashboard rather than a fictional number).
 */
export function resolveTimeSavedSeconds(
  purpose: string,
  override: number | undefined,
): number {
  if (override !== undefined && override >= 0) return Math.round(override);
  return HUMAN_EQUIVALENT_SECONDS[purpose] ?? 0;
}
