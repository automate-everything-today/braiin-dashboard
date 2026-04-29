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
  tier: number | null;
  rep_email: string;
  rep_first_name: string;
  /** ISO list of any other reps to CC (Internal CC routing). */
  cc_emails: string[];
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
- Uses 'Hi [Name]' for first contact, 'Hey [Name]' once warm.
- Hyphens NEVER em-dashes. Inline asides use a normal hyphen ' - '.
- 3-paragraph max for warm follow-ups; shorter for scheduling replies.
- No 'I hope this email finds you well'-class openers ever. Open with the specific reason.`,

  "sam.yauner@cortenlogistics.com": `
SAM'S VOICE:
- More informal than Rob - uses 'Hey' as default opener.
- Self-deprecating warmth. Honest about mistakes ('My bad', 'Sorry - now attached').
- Very short replies. Often 3 lines or fewer.
- Natural British idioms: 'having a think', 'best of luck with it', 'no still haven't made a decision'.
- Single emoji with context (🙂) - never decorative emojis.
- Direct asks without numbering. Names the example ('the upcoming one in Playa del Carmen for example').
- No apology for non-decisions or pushed timelines.`,

  "bruna.natale@cortenlogistics.com": `
BRUNA'S VOICE:
- Bilingual: writes in BRAZILIAN PORTUGUESE to Brazilian contacts (.com.br domains, BR locations, PT names), in ENGLISH to others.
- PT-BR opener: 'Oi [Name], bom dia!', 'Oi [Name], bom dia!!', 'Oieee'. PT-BR closer: 'Fico a disposicao 🙂', 'Obrigada, otima semana!'
- ENGLISH opener: 'Hello [Name] 🙂'. Note the emoji in the greeting line - signature Bruna.
- ENGLISH adds parenthetical asides: '(although I miss Brazil already)!', '(Sun is shining over the grey UK today ☀️)'.
- Heavy emoji use overall (🙂 🤗 ☀️ 😂 😆) - more than Rob/Sam, especially in PT.
- Lane-named: 'Europe (UK) and Mexico', 'Brazil to UK'.
- WATCH-OUT in English: trims toward 'Looking forward to staying in close contact and developing business together' - this is acceptable but borderline; do not amplify it. Keep her warmth, trim the formulaic closers.
- For Brazilian recipients: respond in PT-BR. Short banter is welcome ('Tudo bem?', 'Como dizem aqui...').`,
};

const DEFAULT_VOICE_NOTE = `
DEFAULT VOICE (no rep matched):
- Direct, specific, no corporate filler.
- Lane-named where possible.
- 'Hi [Name]' opener.
- No 'I hope this email finds you well'.`;

function repVoice(repEmail: string): string {
  return REP_VOICE_NOTES[repEmail.toLowerCase()] ?? DEFAULT_VOICE_NOTE;
}

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
