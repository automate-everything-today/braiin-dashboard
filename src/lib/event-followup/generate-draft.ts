/**
 * Draft generator for event follow-up emails.
 *
 * For each event_contacts row, build a personalised follow-up draft using:
 *   - The active voice_rules (banned words/phrases/structures with replacements)
 *   - Per-rep voice samples (hardcoded annotations from real sent emails)
 *   - Meeting notes + company info from Airtable
 *   - Event + tier metadata
 *
 * Pipeline:
 *   1. Build cached system prompt (voice rules + samples). Anthropic ephemeral
 *      cache means the system prompt costs full tokens once per 5min then 1/10
 *      per call afterwards - matters when generating 400 drafts in a batch.
 *   2. Build per-contact user prompt.
 *   3. Call LLM gateway -> JSON with subject + body.
 *   4. Lint the body. If any block hits, regenerate with feedback (max 2 retries).
 *   5. Return the draft + any remaining warn hits for operator review.
 *
 * Caller is responsible for persisting the draft to event_contacts
 * (this module is pure logic, no DB writes for drafts).
 */

import { complete } from "@/lib/llm-gateway";
import { lintDraft, recordCatches } from "@/lib/voice/lint";
import { supabase } from "@/services/base";
import type { Channel, LintHit } from "@/lib/voice/types";

const DRAFT_MODEL = "claude-sonnet-4-6";
const MAX_REGENERATE_RETRIES = 2;

export interface DraftInput {
  contact_id: number;
  contact_name: string | null;
  contact_email: string;
  title: string | null;
  company: string | null;
  company_type: string | null;
  company_info: string | null;
  country: string | null;
  region: string | null;
  meeting_notes: string | null;
  /** Multi-select Airtable values like ["Rob","Sam","GKF Directory","Business Card"] */
  met_by_raw: string[];
  event_name: string;
  event_location: string | null;
  event_start: string;
  /** Per-event context brief from /events form. Operator's notes that
   *  flavour every draft for this event (e.g. "WCA stand, focus on LATAM"). */
  event_context_brief: string | null;
  tier: number | null;
  rep_email: string;
  rep_first_name: string;
  /** ISO list of any other reps to CC (Internal CC routing). */
  cc_emails: string[];
  /** Operator feedback on a previous draft - if present, LLM gets the
   *  previous_draft + this instruction and rewrites. */
  feedback: string | null;
  previous_draft: string | null;
}

export interface DraftOutput {
  subject: string;
  body: string;
  /** Hits that survived all regenerations - operator can review. */
  warns: LintHit[];
  /** How many regenerations it took. 0 = clean on first try. */
  regenerations: number;
  /** Final lint state - useful for telemetry. */
  rules_checked: number;
}

/**
 * Per-rep voice anchors. These are condensed annotations from the real sent
 * emails captured in docs/voice/anti-ai-writing-style.md, rewritten as LLM-
 * actionable instructions. Update when more samples are added or per-rep
 * voice drifts.
 */
const REP_VOICE_NOTES: Record<string, string> = {
  "rob.donald@cortenlogistics.com": `
ROB'S VOICE:
- Direct, specific, lane-named. Always names actual places (Felixstowe, Sao Paulo, Jakarta).
- Reciprocal: when offering something, mentions what we'd take in return ("Likewise, anything UK-bound...").
- Concrete CTA always - "Let us know what works your end and we'll get something in the diary."
- Salutation: "Hi [Name]" for first contact, "Hey [Name]" once warm. NEVER a comma after the name.
- Sign-off (pick ONE): "Best regards\\nRob" / "All the best\\nRob" / "Kind regards\\nRob". NEVER a comma after the sign-off phrase. NEVER include email address or signature block in the body - that's added by the mail client.
- Hyphens NEVER em-dashes. Inline asides use a normal hyphen ' - '.
- 3-paragraph max for warm follow-ups; shorter for scheduling replies.
- No 'I hope this email finds you well'-class openers ever. Open with the specific reason.`,

  "sam.yauner@cortenlogistics.com": `
SAM'S VOICE:
- More informal than Rob - uses 'Hey [Name]' as default opener. NEVER a comma after the name.
- Self-deprecating warmth. Honest about mistakes ('My bad', 'Sorry - now attached').
- Very short replies. Often 3 lines or fewer.
- Natural British idioms: 'having a think', 'best of luck with it', 'no still haven't made a decision'.
- Single emoji with context (🙂) - never decorative emojis.
- Direct asks without numbering. Names the example ('the upcoming one in Playa del Carmen for example').
- Sign-off (pick ONE): "Sam" alone for known contacts. "Best regards\\nSam" or "Cheers\\nSam" for newer contacts. NEVER a comma after the sign-off phrase.
- No apology for non-decisions or pushed timelines.`,

  "bruna.natale@cortenlogistics.com": `
BRUNA'S VOICE:
- Bilingual: writes in BRAZILIAN PORTUGUESE to Brazilian contacts (.com.br domains, BR locations, PT names), in ENGLISH to others.
- PT-BR opener: 'Oi [Name], bom dia!', 'Oi [Name], bom dia!!', 'Oieee'. NEVER a comma after the name in English; the BR-PT 'Oi [Name],' WITH comma is acceptable as it's a Portuguese convention.
- PT-BR closer: 'Fico a disposicao 🙂' or 'Obrigada\\nBruna'. NO comma after the sign-off phrase.
- ENGLISH opener: 'Hello [Name] 🙂'. Emoji in the greeting line is signature Bruna. NEVER a comma after the name.
- ENGLISH adds parenthetical asides: '(although I miss Brazil already)!', '(Sun is shining over the grey UK today ☀️)'.
- ENGLISH sign-off: "Regards\\nBruna Natale" - NEVER a comma after "Regards".
- Heavy emoji use overall (🙂 🤗 ☀️ 😂 😆) - more than Rob/Sam, especially in PT.
- Lane-named: 'Europe (UK) and Mexico', 'Brazil to UK'.
- For Brazilian recipients: respond in PT-BR. Short banter is welcome ('Tudo bem?', 'Como dizem aqui...').`,
};

const DEFAULT_VOICE_NOTE = `
DEFAULT VOICE (no rep matched):
- Direct, specific, no corporate filler.
- Lane-named where possible.
- 'Hi [Name]' opener with NO comma after the name.
- Sign-off: "Best regards\\n[FirstName]" with NO comma.
- No 'I hope this email finds you well'.`;

function repVoice(repEmail: string): string {
  return REP_VOICE_NOTES[repEmail.toLowerCase()] ?? DEFAULT_VOICE_NOTE;
}

/**
 * Corten company brief - global pitch context applied to EVERY draft. Shapes
 * how the LLM thinks about geography, scope, and value prop regardless of
 * which event the contact came from.
 *
 * TODO (operator-editable): move to a `org_settings` singleton table so this
 * can be edited from the dashboard without a code change. Hardcoded for now
 * to ship fast and iterate the prompt against real drafts.
 */
const CORTEN_COMPANY_BRIEF = `
ABOUT CORTEN LOGISTICS (apply to every draft):

WHO WE ARE:
- UK-based independent freight forwarder. HQ in London (registered office:
  Unit W106, The Windsor Centre, 15-29 Windsor Street, London N1 8QG).
- Founded 2009 by Rob Donald and Sam Yauner. Started by trading shipping
  containers; clients kept asking "can you ship them as well?" and the
  forwarding business grew from there.
- Sunday Times 100 Fastest Growing Companies (recent recognition).
- Tagline: #WeGetShipDone. Pitch: "Helping high-growth brands simplify
  global logistics."
- Founding principles: Be genuine. Stay agile. Act with honesty. (Use these
  as voice guides, not slogans to quote.)

WHO WE SERVE:
- High-growth brands, including household-name consumer brands. Long-term
  customer relationships - some clients have been with us 10+ years.
- Sweet spot: brands who need a forwarder that responds fast and actually
  knows their lanes, not a faceless multinational.

GEOGRAPHIC SCOPE (critical - the LLM gets this wrong by default):
- Primary lane shape: "UK <-> anywhere" plus Ireland inbound/outbound.
- We do NOT focus only on the country where a trade show happened. Meeting
  a contact at Intermodal South America does NOT mean we only want Brazil
  business. Meeting at GKF Summit does NOT mean we only want LATAM.
- When writing to a contact in country X, the relevant pitch is one of:
  (a) UK <-> X direct flows (our core)
  (b) X <-> third-country flows routed via the UK
  (c) Inbound to UK / Ireland from any origin (we always want this)
- We do NOT do domestic-only flows entirely outside the UK (no Brazil <->
  Brazil, no Mexico <-> Mexico). Don't pitch those.

SERVICES:
- Ocean (FCL + LCL), Air, Road, Rail. Real-time tracking. Full compliance.
- Reefer-capable. Project cargo. eCommerce-friendly (UK fulfilment for
  inbound consumer flows).
- Contracted stable rates from Asia for high-volume clients - this is a
  genuine differentiator worth surfacing for any Asia-origin pitch.
- Tech-forward: in-house systems for tracking and reporting. Sam's words:
  "tech that will make your IT department green with envy."

POSITIONING:
- Independent agent-network model. WCA member. GKF/ULN Network member.
- We win on responsiveness, lane-specific expertise, and a stable team -
  not on global scale.
- Reciprocal partnerships: we always ask what we can refer back to the
  contact's network or country.
- "Award-winning freight management" - real recognition, not marketing
  fluff.

NETWORKS / EVENTS WE ATTEND:
- WCA World (host us at trade shows like Intermodal South America)
- GKF/ULN Network (annual GKF Summit)
- Both summits ran in Sao Paulo April 2026 - that's where we met all the
  Intermodal/GKF cohort contacts.

UK INFRASTRUCTURE TO REFERENCE WHEN RELEVANT:
- Sea ports: Felixstowe, Southampton, London Gateway, Liverpool, Tilbury.
- Air gateways: London Heathrow (LHR), London Gatwick (LGW), Manchester (MAN), East Midlands (EMA).
- Ireland: Dublin, Belfast.
- Use these only when the lane actually involves them; don't drop names
  for flavour.

WHAT WE'RE NOT:
- Not a multinational. Not a software-only platform. Not a digital
  forwarder selling pure self-service. Not a one-stop-shop pitching every
  service to every contact. Not a "global reach + local expertise"
  forwarder - that's a banned phrase.

VOICE EXTRAS:
- Brand colour is coral/pink. Conference giveaways: branded fans, socks,
  pink sunglasses, Craigellachie whisky. Don't reference these in cold
  follow-ups, but if a contact mentions the fan club, lean in - it's a
  signature touchpoint.
`;

const META_RULES = `
META-RULES (apply universally - never violate):

1. NEVER use em-dash or en-dash. Use a standard hyphen (-), full stop, or comma.
2. NEVER open with 'I hope this email finds you well' or any variant.
3. NEVER use 'just wanted to', 'just checking in', 'just thought I'd' - drop the apologetic 'just'.
4. NEVER use 'circle back', 'touch base', 'leverage', 'unlock', 'seamlessly', 'delve', 'synergy', or any LinkedIn cringe term. Voice rules table below has the full list. This includes verb forms: 'diving', 'dives', 'delving', 'delves', 'leveraging' all banned.
5. NEVER claim 'best-in-class', 'world-class', 'cutting-edge', 'global reach + local expertise'. Show with specifics.
6. NEVER hedge or apologise about uncertainty. Do NOT write 'apologies for the uncertainty', 'I'm not sure if', 'I cannot confirm', 'whether we connected at all', 'if my colleague already followed up'. The contact is in our follow-up list because we MET them and we ARE writing on purpose. Be confident.
7. NEVER write 'before diving into specifics', 'before we get into the details' or similar throat-clearing. Get to the point.
8. ALWAYS prefer specifics over abstractions. Name places, lanes, numbers, dates.
9. ALWAYS reference the conversation at the conference IF meeting notes were captured. Use them as source material - quote phrases, mention the specific cargo or lane discussed, build on what was said.
10. WHEN meeting notes are empty: write a clean, confident 3-line note. "Good to meet you at [event] - [one specific thing relevant to their company / country / role]. If there's a specific lane or service you're working on, send it through and we will take a look." NEVER apologise, NEVER hedge, NEVER ask which colleague met them.
11. ALWAYS sign off in the rep's voice (see REP'S VOICE).
12. Tier-A: ~3 paragraphs with specific value prop tied to their role/lane. Tier-B: 2 paragraphs. Tier-C / no-meeting-notes: 3-4 lines max.
13. NEVER put a comma after the salutation. "Hi Adria" not "Hi Adria,". "Hey Jose" not "Hey Jose,". "Hello Lorelei 🙂" not "Hello Lorelei,". (BR-Portuguese 'Oi [Name],' is the one exception.)
14. NEVER put a comma after the sign-off phrase. "Best regards" not "Best regards,". "Kind regards" not "Kind regards,". "Regards" not "Regards,". "All the best" not "All the best,". (Trailing-comma sign-offs are an instant AI-tell.)
15. NEVER include the rep's email address or signature block in the email body. The mail client appends those. Just the first name on its own line after the sign-off phrase.
`;

/**
 * Pull active voice rules from the DB and format them as a structured
 * deny-list for the LLM. Cached at the gateway level so this re-renders
 * once per 30s.
 */
async function buildBansBlock(channel: Channel): Promise<string> {
  const { data, error } = await supabase
    .from("voice_rules")
    .select("rule_type, pattern, replacement, channel, severity")
    .eq("active", true)
    .eq("severity", "block");
  if (error) {
    throw new Error(`voice_rules load failed: ${error.message}`);
  }
  type Row = { rule_type: string; pattern: string; replacement: string; channel: string; severity: string };
  const rules = ((data ?? []) as Row[]).filter(
    (r) => r.channel === "all" || r.channel === channel,
  );
  const grouped: Record<string, Row[]> = {};
  for (const r of rules) {
    grouped[r.rule_type] = grouped[r.rule_type] ?? [];
    grouped[r.rule_type].push(r);
  }
  const sections = Object.entries(grouped).map(([type, items]) => {
    const lines = items
      .map((r) => `  - "${r.pattern}" -> ${r.replacement}`)
      .join("\n");
    return `${type.toUpperCase()}:\n${lines}`;
  });
  return sections.join("\n\n");
}

function buildSystemPrompt(repEmail: string, bansBlock: string): string {
  return `You are writing a post-conference follow-up email on behalf of a Corten Logistics team member. Output MUST follow the rules below exactly.

${CORTEN_COMPANY_BRIEF}

${META_RULES}

${repVoice(repEmail)}

BANNED WORDS / PHRASES / STRUCTURES (with the replacement to use instead):

${bansBlock}

OUTPUT FORMAT:
Return ONLY a JSON object with two keys, no preamble, no markdown:
{
  "subject": "short subject line, no all-caps",
  "body": "email body, plain text, paragraphs separated by blank line, no greeting separator dashes"
}`;
}

function buildUserPrompt(input: DraftInput): string {
  const tierGuidance = input.tier
    ? input.tier <= 2
      ? "Tier-A contact (rating 1-2): full warm follow-up, 3 paragraphs, opens partnership conversation."
      : input.tier <= 3
        ? "Tier-B contact (rating 3): solid 2-paragraph follow-up, name what we discussed, propose a next step."
        : "Tier-C contact (rating 4-5): brief 'good to meet' note, 3-4 lines max."
    : "No tier set - default to a solid 2-paragraph warm follow-up.";

  // The Met By field on Airtable mixes people (Rob/Sam/Bruna) with sources
  // ("GKF Directory", "Business Card"). Surface BOTH so the LLM understands
  // how the contact was acquired and writes accordingly.
  const peopleMet = input.met_by_raw.filter((v) =>
    ["Rob", "Sam", "Bruna"].includes(v),
  );
  const sourceTags = input.met_by_raw.filter((v) =>
    !["Rob", "Sam", "Bruna"].includes(v),
  );

  const lines: string[] = [];
  lines.push("=== CONTACT ===");
  lines.push(`Name: ${input.contact_name ?? "(unknown - skip the personal greeting, use 'Hi there')"}`);
  if (input.title) lines.push(`Title: ${input.title}`);
  lines.push(`Company: ${input.company ?? "(unknown)"}`);
  if (input.company_type) lines.push(`Company type: ${input.company_type}`);
  if (input.country) lines.push(`Country: ${input.country}`);
  if (input.region) lines.push(`Region: ${input.region}`);
  lines.push(`Email: ${input.contact_email}`);
  lines.push("");

  lines.push("=== EVENT ===");
  lines.push(`${input.event_name}${input.event_location ? ` (${input.event_location})` : ""}, ${input.event_start.split("T")[0]}`);
  if (input.event_context_brief) {
    lines.push("");
    lines.push("Event context brief (operator-provided - lean into this when writing the value prop / hook):");
    lines.push(input.event_context_brief);
  }
  lines.push("");

  lines.push("=== HOW WE GOT THIS CONTACT ===");
  if (peopleMet.length > 0) {
    lines.push(`Met in person by: ${peopleMet.join(", ")}.`);
  }
  if (sourceTags.includes("GKF Directory")) {
    lines.push(`Sourced from the GKF/ULN member directory${peopleMet.length === 0 ? " (we did NOT meet them in person)" : ""}.`);
  }
  if (sourceTags.includes("Business Card")) {
    lines.push("Card collected at the booth.");
  }
  if (peopleMet.length === 0 && sourceTags.length === 0) {
    lines.push("Source unclear. Treat as warm-network outreach, not a person-to-person follow-up.");
  }
  lines.push("");

  lines.push("=== CONVERSATION CONTEXT ===");
  if (input.meeting_notes) {
    lines.push("Meeting notes (what was actually discussed - lean into this, quote phrases, build on the specific lane/cargo mentioned):");
    lines.push(input.meeting_notes);
  } else {
    lines.push("No meeting notes captured. Do NOT pretend we had a deep conversation. Do NOT hedge or apologise. Write a confident short 'good to meet you at [event]' opener, ground it in something REAL from the contact data above (their country, role, or company type), and close with a direct 'send any active lanes through and we'll take a look'.");
  }
  lines.push("");

  if (input.company_info) {
    lines.push("=== COMPANY BACKGROUND (do not quote verbatim, use as awareness only) ===");
    lines.push(input.company_info);
    lines.push("");
  }

  lines.push(tierGuidance);
  lines.push("");

  if (input.previous_draft && input.feedback) {
    lines.push("=== REVISION REQUEST ===");
    lines.push("Previous draft (the one to revise):");
    lines.push(input.previous_draft);
    lines.push("");
    lines.push("Operator feedback on the previous draft (apply this faithfully):");
    lines.push(input.feedback);
    lines.push("");
    lines.push("Rewrite the email taking the feedback above into account. Keep what worked, change what the operator flagged. Output the FULL new email as JSON.");
    lines.push("");
  }

  lines.push(`Write the email as ${input.rep_first_name} (signing off with first name only).`);
  lines.push("Output JSON only - no preamble, no markdown.");
  return lines.join("\n");
}

interface ParsedDraft {
  subject: string;
  body: string;
}

function parseDraftJson(text: string): ParsedDraft {
  // The LLM should return raw JSON. Strip any code fences in case it slips up.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`LLM did not return valid JSON: ${e instanceof Error ? e.message : "parse error"}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { subject?: unknown }).subject !== "string" ||
    typeof (parsed as { body?: unknown }).body !== "string"
  ) {
    throw new Error("LLM JSON missing 'subject' or 'body' string fields");
  }
  return parsed as ParsedDraft;
}

function buildRegenerateNote(blocks: LintHit[]): string {
  const items = blocks
    .map((h) => `  - "${h.match}" violates ${h.rule_type} rule. Use instead: ${h.replacement}`)
    .join("\n");
  return `\n\nYour previous draft contained banned content. Fix these and regenerate the JSON:\n${items}`;
}

export async function generateDraft(input: DraftInput): Promise<DraftOutput> {
  const channel: Channel = "email";
  const bansBlock = await buildBansBlock(channel);
  const systemPrompt = buildSystemPrompt(input.rep_email, bansBlock);
  const userPrompt = buildUserPrompt(input);

  let userMessage = userPrompt;
  let regenerations = 0;
  let lastBlocks: LintHit[] = [];
  let lastWarns: LintHit[] = [];
  let lastRulesChecked = 0;
  let lastDraft: ParsedDraft | null = null;

  for (let attempt = 0; attempt <= MAX_REGENERATE_RETRIES; attempt++) {
    const result = await complete({
      purpose: "event_followup_draft",
      system: [{ text: systemPrompt, cacheControl: "ephemeral" }],
      user: userMessage,
      model: DRAFT_MODEL,
      maxTokens: 1200,
      temperature: 0.4,
    });

    const draft = parseDraftJson(result.text);
    lastDraft = draft;

    const lint = await lintDraft(draft.body, channel);
    lastBlocks = lint.blocks;
    lastWarns = lint.warns;
    lastRulesChecked = lint.rules_checked;

    // Telemetry: record the catches even if we'll regenerate. Helps surface
    // which rules are actually doing work in /dev/voice.
    void recordCatches([...lint.blocks, ...lint.warns]);

    if (lint.blocks.length === 0) {
      // Clean run - return immediately.
      return {
        subject: draft.subject,
        body: draft.body,
        warns: lint.warns,
        regenerations: attempt,
        rules_checked: lint.rules_checked,
      };
    }

    // Block hits found - regenerate with feedback.
    regenerations = attempt + 1;
    userMessage = userPrompt + buildRegenerateNote(lint.blocks);
  }

  // Exhausted retries. Return the last draft anyway with the surviving block
  // hits surfaced as warns so the operator can hand-edit. Better to ship a
  // flawed draft for review than to error - the operator gate catches it.
  if (!lastDraft) {
    throw new Error("Draft generation produced no output across retries");
  }
  return {
    subject: lastDraft.subject,
    body: lastDraft.body,
    warns: [...lastBlocks, ...lastWarns],
    regenerations,
    rules_checked: lastRulesChecked,
  };
}
