/**
 * /api/system-rules/baseline-template/generate
 *
 * Takes operator questionnaire answers (greeting/ask/signoff defaults +
 * length cap + country hook toggle + rep name) and asks Sonnet to compose
 * a refined template. Validates the output against baselineTemplateSchema
 * and returns it for operator review. Does NOT save - operator confirms
 * via POST /api/system-rules.
 */

import { z } from "zod";
import { complete } from "@/lib/llm-gateway";
import { requireManager } from "@/lib/api-auth";
import { apiError, apiResponse, validationError } from "@/lib/validation";
import { loadRulesSnapshot } from "@/lib/system-rules/load";
import { baselineTemplateSchema } from "@/lib/system-rules/schemas";

const ROUTE = "/api/system-rules/baseline-template/generate";

const inputSchema = z.object({
  language: z.enum(["en", "pt-br"]),
  tier_band: z.enum(["A", "B", "C", "D"]),
  greeting_default: z.string().min(1),
  ask_default: z.string().min(1),
  signoff_default: z.string().min(1),
  include_country_hook: z.boolean(),
  length_cap_lines: z.number().int().min(2).max(20),
  rep_first_name: z.string().min(1),
});

export async function POST(req: Request) {
  const auth = await requireManager(ROUTE, req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  // Per-run snapshot for deterministic model routing.
  let snapshot;
  try {
    snapshot = await loadRulesSnapshot();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load system_rules";
    return apiError(`Cannot generate template: ${msg}`, 500);
  }
  const model = snapshot.modelFor("baseline_template_authoring");

  const system = `You compose baseline cold-follow-up email templates for ${parsed.data.rep_first_name} at Corten Logistics.
Output is a JSON object matching the BaselineTemplate schema. Use the operator's defaults as a starting point; refine for clarity, no AI tells, no hedging.

Allowed placeholders: {first_name}, {company}, {event_name}, {rep_first_name}, {country}. Use them where appropriate; never leave unfilled placeholders the operator hasn't approved.

Voice constraints (apply to greeting/ask/signoff/country_hook_template):
- Hyphens only, never em-dash or en-dash.
- No "I hope this email finds you well" or any variant.
- No "just wanted to" / "just checking in" / apologetic "just".
- No corporate cringe ("circle back", "leverage", "unlock", "seamlessly").
- No comma after the name in the greeting (English convention; PT-BR exception is acceptable).
- Sign-off phrase has NO trailing comma.
- Direct, specific, lane-aware where possible.`;

  const user = `Operator answers (treat as defaults, refine if a better wording exists):

${JSON.stringify(parsed.data, null, 2)}

Return ONLY a JSON object with these keys:
- greeting (string)
- ask (string)
- signoff (string)
- length_cap_lines (integer 1-20)
- include_country_hook (boolean)
- country_hook_template (string, REQUIRED if include_country_hook=true)

No preamble, no markdown, no code fences.`;

  let result;
  try {
    result = await complete({
      purpose: "baseline_template_authoring",
      system: [{ text: system, cacheControl: "ephemeral" }],
      user,
      model,
      maxTokens: 800,
      temperature: 0.4,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "LLM call failed";
    return apiError(`Template generation failed: ${msg}`, 502);
  }

  let parsedTpl: unknown;
  try {
    const cleaned = result.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");
    parsedTpl = JSON.parse(cleaned);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "JSON parse failed";
    return apiError(`LLM did not return valid JSON: ${msg}`, 502);
  }

  const validated = baselineTemplateSchema.safeParse(parsedTpl);
  if (!validated.success) {
    return apiError(
      `LLM output failed schema validation: ${validated.error.message}`,
      502,
    );
  }

  return apiResponse({
    proposed: validated.data,
    slot: { language: parsed.data.language, tier_band: parsed.data.tier_band },
  });
}
