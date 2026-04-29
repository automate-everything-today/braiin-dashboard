/**
 * Tests for the baseline template fallback in generateDraft (Task 6.3).
 *
 * Exercises:
 *   1. Baseline path: no notes / no company_info / no transcripts
 *      -> deterministic body substituted, data_source_tags = ["baseline_template"],
 *         complete() NOT called.
 *   2. Non-baseline path: has meeting_notes
 *      -> LLM path used, data_source_tags includes "airtable_notes".
 *   3. Baseline error path: baseline case but no template in snapshot for slot
 *      -> throws with message mentioning the slot key.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RulesSnapshot } from "@/lib/system-rules/types";
import type { BaselineTemplateValue } from "@/lib/system-rules/types";
import type { DraftInput } from "../generate-draft";

// ---------------------------------------------------------------------------
// Mock @/lib/llm-gateway so complete() never hits the network.
// ---------------------------------------------------------------------------
const mockComplete = vi.fn();
vi.mock("@/lib/llm-gateway", () => ({
  complete: (...args: unknown[]) => mockComplete(...args),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/voice/lint so lint never hits the DB.
// ---------------------------------------------------------------------------
vi.mock("@/lib/voice/lint", () => ({
  lintDraft: vi.fn().mockResolvedValue({ blocks: [], warns: [], rules_checked: 0 }),
  recordCatches: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock supabase (voice_rules query inside buildBansBlock).
// ---------------------------------------------------------------------------
vi.mock("@/services/base", () => ({
  supabase: {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          eq: (_col2: string, _val2: unknown) =>
            Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock @/lib/system-rules/load so loadRulesSnapshot() never hits the DB.
// We control what it returns via makeSnapshot().
// ---------------------------------------------------------------------------
const mockLoadRulesSnapshot = vi.fn();
vi.mock("@/lib/system-rules/load", () => ({
  loadRulesSnapshot: (...args: unknown[]) => mockLoadRulesSnapshot(...args),
}));

// ---------------------------------------------------------------------------
// Snapshot factory
// ---------------------------------------------------------------------------
const STUB_TEMPLATE: BaselineTemplateValue = {
  greeting: "Hi {first_name}",
  ask: "Send any active lanes through and we will take a look.",
  signoff: "Best regards",
  length_cap_lines: 6,
  include_country_hook: false,
};

function makeSnapshot(
  opts: { hasTemplate?: boolean; slotOverride?: string } = {},
): RulesSnapshot {
  return {
    id: "test-snapshot-id",
    modelFor: (_task: string) => "claude-sonnet-4-6",
    seniority: (_kw: string) => 20,
    companyMatch: {
      strip_suffixes: [],
      treat_and_equal: true,
      strip_punctuation: true,
      lowercase: true,
    },
    granolaThresholds: {
      auto_link_threshold: 80,
      review_floor: 50,
      date_buffer_days: 2,
    },
    baselineTemplate: (slotKey: string) => {
      if (opts.hasTemplate === false) return null;
      // By default return the stub template for any slot.
      if (opts.slotOverride && slotKey !== opts.slotOverride) return null;
      return STUB_TEMPLATE;
    },
    raw: {},
  };
}

// ---------------------------------------------------------------------------
// Minimal DraftInput factory
// ---------------------------------------------------------------------------
function makeInput(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    contact_id: 1,
    contact_name: "Adrià Rabadán",
    contact_email: "adria@krom.es",
    title: "Director",
    company: "Krom Global",
    company_type: "forwarder",
    company_info: null,
    country: "Spain",
    region: null,
    meeting_notes: null,
    met_by_raw: ["Rob"],
    event_name: "Intermodal 2026",
    event_location: "Sao Paulo",
    event_start: "2026-04-15T00:00:00Z",
    event_context_brief: null,
    tier: 2,
    rep_email: "rob.donald@cortenlogistics.com",
    rep_first_name: "Rob",
    cc_emails: [],
    feedback: null,
    previous_draft: null,
    granola_transcripts: [],
    language: "en",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Import the function under test (after all mocks are registered).
// ---------------------------------------------------------------------------
import { generateDraft } from "../generate-draft";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("generateDraft - baseline template fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComplete.mockResolvedValue({ text: '{"subject":"X","body":"Y"}' });
  });

  it("baseline path: returns deterministic body with placeholders substituted, complete() NOT called", async () => {
    const snapshot = makeSnapshot({ hasTemplate: true });
    const input = makeInput({
      meeting_notes: null,
      company_info: null,
      granola_transcripts: [],
      contact_name: "Adrià Rabadán",
      company: "Krom Global",
      event_name: "Intermodal 2026",
      rep_first_name: "Rob",
      tier: 2, // -> tier band B -> slot "en:B"
    });

    const result = await generateDraft(input, snapshot);

    // complete() must NOT have been called.
    expect(mockComplete).not.toHaveBeenCalled();

    // data_source_tags must be baseline_template.
    expect(result.data_source_tags).toEqual(["baseline_template"]);

    // Body should contain the substituted first name.
    expect(result.body).toContain("Adrià");

    // Body should contain the sign-off.
    expect(result.body).toContain("Best regards");

    // Regenerations + rules_checked should be zero (deterministic).
    expect(result.regenerations).toBe(0);
    expect(result.rules_checked).toBe(0);
    expect(result.warns).toHaveLength(0);
  });

  it("non-baseline path: goes through LLM, data_source_tags includes airtable_notes", async () => {
    const snapshot = makeSnapshot({ hasTemplate: true });
    const input = makeInput({
      meeting_notes: "Discussed UK-Spain lanes, interested in FCL.",
      company_info: null,
      granola_transcripts: [],
    });

    const result = await generateDraft(input, snapshot);

    // complete() MUST have been called (LLM path).
    expect(mockComplete).toHaveBeenCalledTimes(1);

    // data_source_tags should include airtable_notes.
    expect(result.data_source_tags).toContain("airtable_notes");

    // Should NOT include baseline_template.
    expect(result.data_source_tags).not.toContain("baseline_template");

    // Subject and body come from the mocked LLM response.
    expect(result.subject).toBe("X");
    expect(result.body).toBe("Y");
  });

  it("baseline error path: throws with slot key in message when no template is authored", async () => {
    // snapshot has no template for any slot
    const snapshot = makeSnapshot({ hasTemplate: false });
    const input = makeInput({
      meeting_notes: null,
      company_info: null,
      granola_transcripts: [],
      tier: 2, // -> tier band B -> slot "en:B"
      language: "en",
    });

    await expect(generateDraft(input, snapshot)).rejects.toThrow("en:B");

    // complete() should NOT have been called.
    expect(mockComplete).not.toHaveBeenCalled();
  });
});
