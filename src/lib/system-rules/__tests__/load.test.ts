import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEq = vi.fn();
vi.mock("@/services/base", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => mockEq(),
      }),
    }),
  },
}));

import { loadRulesSnapshot } from "../load";

describe("loadRulesSnapshot", () => {
  beforeEach(() => mockEq.mockReset());

  it("loads all categories at once and exposes accessors", async () => {
    mockEq.mockResolvedValueOnce({
      data: [
        {
          category: "seniority_score",
          key: "weights",
          value: { ceo: 100, default_unknown: 20 },
        },
        {
          category: "model_routing",
          key: "tasks",
          value: {
            draft_email: "claude-sonnet-4-6",
            seniority_score: "claude-haiku-4-5",
          },
        },
        {
          category: "company_match",
          key: "canonicalisation",
          value: {
            strip_suffixes: ["Ltd"],
            treat_and_equal: true,
            strip_punctuation: true,
            lowercase: true,
          },
        },
        {
          category: "granola_match",
          key: "thresholds",
          value: {
            auto_link_threshold: 80,
            review_floor: 50,
            date_buffer_days: 2,
          },
        },
      ],
      error: null,
    });
    const snap = await loadRulesSnapshot();
    expect(snap.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(snap.modelFor("draft_email")).toBe("claude-sonnet-4-6");
    expect(snap.modelFor("seniority_score")).toBe("claude-haiku-4-5");
    expect(snap.modelFor("unknown_task")).toBe("claude-sonnet-4-6"); // falls back to draft_email
    expect(snap.seniority("ceo")).toBe(100);
    expect(snap.seniority("janitor")).toBe(20); // unknown -> default_unknown
    expect(snap.companyMatch.strip_suffixes).toEqual(["Ltd"]);
    expect(snap.granolaThresholds.auto_link_threshold).toBe(80);
  });

  it("aborts loudly on validation failure (no silent fallback)", async () => {
    mockEq.mockResolvedValueOnce({
      data: [
        {
          category: "model_routing",
          key: "tasks",
          value: { not_an_email_field: 42 },
        },
      ],
      error: null,
    });
    await expect(loadRulesSnapshot()).rejects.toThrow(/system_rules invalid/);
  });

  it("falls back to seeded defaults when a row is missing", async () => {
    mockEq.mockResolvedValueOnce({ data: [], error: null });
    const snap = await loadRulesSnapshot();
    expect(snap.modelFor("draft_email")).toBe("claude-sonnet-4-6");
    expect(snap.companyMatch.strip_suffixes.length).toBeGreaterThan(0);
  });

  it("propagates Supabase errors as load failures", async () => {
    mockEq.mockResolvedValueOnce({
      data: null,
      error: { message: "permission denied" },
    });
    await expect(loadRulesSnapshot()).rejects.toThrow(/system_rules load failed/);
  });

  it("returns null from baselineTemplate when no row authored for the slot", async () => {
    mockEq.mockResolvedValueOnce({ data: [], error: null });
    const snap = await loadRulesSnapshot();
    expect(snap.baselineTemplate("en:D")).toBeNull();
  });
});
