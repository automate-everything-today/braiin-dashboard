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
import { lintDraft, recordCatches, type LintHit } from "@/lib/voice/lint";
import { supabase } from "@/services/base";
import type { Channel } from "@/lib/voice/types";

const DRAFT_MODEL = "claude-sonnet-4-6";
const MAX_REGENERATE_RETRIES = 2;

export interface DraftInput {
  contact_id: number;
  contact_name: string | null;
  company: string | null;
  contact_email: string;
  meeting_notes: string | null;
  company_info: string | null;
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

1. NEVER use em-dash (—) or en-dash (–). Use a standard hyphen (-) or full stop or comma.
2. NEVER open with 'I hope this email finds you well' or any variant.
3. NEVER use 'just wanted to', 'just checking in', 'just thought I'd' - drop the apologetic 'just'.
4. NEVER use 'circle back', 'touch base', 'leverage', 'unlock', 'seamlessly', 'delve', 'synergy', or any other LinkedIn cringe term. Voice rules table below has the full list.
5. NEVER claim 'best-in-class', 'world-class', 'cutting-edge', 'global reach + local expertise'. Show with specifics instead.
6. ALWAYS prefer specifics over abstractions. Name places, name lanes, name numbers, name dates.
7. ALWAYS reference the actual conversation that happened at the conference - meeting notes are gold. Don't write a generic follow-up.
8. ALWAYS sign off in the rep's voice (see REP'S VOICE above).
9. ALWAYS use a normal hyphen (-) for inline asides, not em-dash.
10. Keep it short. Tier-A: ~3 paragraphs. Tier-B: 2 paragraphs. Tier-C: 'good to meet, here's our card' - 3 lines.
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

  const lines: string[] = [];
  lines.push(`CONTACT NAME: ${input.contact_name ?? "(unknown - use a generic warm opener)"}`);
  lines.push(`COMPANY: ${input.company ?? "(unknown)"}`);
  lines.push(`EVENT: ${input.event_name}${input.event_location ? ` (${input.event_location})` : ""}`);
  lines.push(`EVENT DATE: ${input.event_start.split("T")[0]}`);
  lines.push(`SENDING REP: ${input.rep_first_name} (${input.rep_email})`);
  lines.push("");
  lines.push(tierGuidance);
  lines.push("");
  if (input.meeting_notes) {
    lines.push("MEETING NOTES (what was discussed at the booth - WEAVE THIS INTO THE EMAIL, don't ignore it):");
    lines.push(input.meeting_notes);
    lines.push("");
  } else {
    lines.push("MEETING NOTES: (none captured - keep follow-up generic but warm)");
    lines.push("");
  }
  if (input.company_info) {
    lines.push("COMPANY CONTEXT (for awareness, don't quote verbatim):");
    lines.push(input.company_info);
    lines.push("");
  }
  lines.push(`Write the email as ${input.rep_first_name}. Sign off with their first name. Output JSON only.`);
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
