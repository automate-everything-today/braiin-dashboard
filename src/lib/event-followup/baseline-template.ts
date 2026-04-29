/**
 * Deterministic renderer for baseline (no-LLM-required) cold follow-up
 * emails. Used when an event_contact has no Granola transcript, no
 * meeting notes, and no actionable company info — i.e. nothing the AI
 * can responsibly say about the conversation.
 *
 * The template is authored ONCE by the operator (with Sonnet's help)
 * via /dev/system-rules; every send via this path is a pure substitution
 * with zero LLM cost or latency.
 *
 * Voice rules (banned words, sign-off conventions) are enforced by the
 * operator at template-authoring time, not at render time. The template
 * itself is the contract.
 */

import type { BaselineTemplateValue } from "@/lib/system-rules/types";

export interface BaselineRenderInput {
  first_name: string;
  company: string;
  event_name: string;
  rep_first_name: string;
  country: string | null;
}

export interface BaselineRenderOutput {
  subject: string;
  body: string;
}

function substitute(s: string, vars: BaselineRenderInput): string {
  return s
    .replaceAll("{first_name}", vars.first_name)
    .replaceAll("{company}", vars.company)
    .replaceAll("{event_name}", vars.event_name)
    .replaceAll("{rep_first_name}", vars.rep_first_name)
    .replaceAll("{country}", vars.country ?? "");
}

export function renderBaselineTemplate(
  tpl: BaselineTemplateValue,
  vars: BaselineRenderInput,
): BaselineRenderOutput {
  const lines: string[] = [];
  lines.push(substitute(tpl.greeting, vars));
  lines.push("");
  lines.push(`Good to meet you at ${vars.event_name}.`);

  if (tpl.include_country_hook && vars.country && tpl.country_hook_template) {
    lines.push(substitute(tpl.country_hook_template, vars));
  }

  lines.push(substitute(tpl.ask, vars));
  lines.push("");
  lines.push(substitute(tpl.signoff, vars));
  lines.push(vars.rep_first_name);

  // Length cap is advisory; the template structure is fixed at 6-8 lines.
  // We don't truncate aggressively because we'd risk dropping the sign-off.
  // Caller can trim further if needed.

  const body = lines.join("\n");
  const subject = `Following up after ${vars.event_name}`;

  return { subject, body };
}
