import { describe, it, expect } from "vitest";
import { scoreGranolaMatch } from "../granola-match";

describe("scoreGranolaMatch", () => {
  it("scores name_exact at 100 when first name is a token in the title and date is in window", () => {
    const r = scoreGranolaMatch(
      { id: "uuid-1", title: "Prasath", recorded_at: "2026-04-13T17:57:00Z" },
      { id: 1, name: "Prasath", first_email_at: "2026-04-13T18:00:00Z" },
      2,
    );
    expect(r.confidence).toBe(100);
    expect(r.method).toBe("name_exact");
  });

  it("scores name_exact at 100 when first name is in title (even with fuzzy overlap)", () => {
    const r = scoreGranolaMatch(
      { id: "uuid-2", title: "Kim - Super Cargo Service", recorded_at: "2026-04-13T14:15:00Z" },
      { id: 2, name: "Kim Lee", first_email_at: "2026-04-13T14:00:00Z" },
      2,
    );
    expect(r.confidence).toBe(100);
    expect(r.method).toBe("name_exact");
  });

  it("scores name_fuzzy when multiple name tokens overlap without first name", () => {
    const r = scoreGranolaMatch(
      { id: "uuid-2b", title: "Lee Super Service", recorded_at: "2026-04-13T14:15:00Z" },
      { id: 2, name: "Kim Lee", first_email_at: "2026-04-13T14:00:00Z" },
      2,
    );
    expect(r.confidence).toBeGreaterThanOrEqual(60);
    expect(r.confidence).toBeLessThan(100);
    expect(r.method).toBe("name_fuzzy");
  });

  it("returns 0 confidence for no name overlap and out-of-window date", () => {
    const r = scoreGranolaMatch(
      { id: "uuid-3", title: "Random Stranger", recorded_at: "2026-01-01T00:00:00Z" },
      { id: 3, name: "Prasath", first_email_at: "2026-04-13T18:00:00Z" },
      2,
    );
    expect(r.confidence).toBe(0);
    expect(r.method).toBe("none");
  });

  it("returns 0 for null contact name", () => {
    const r = scoreGranolaMatch(
      { id: "uuid-4", title: "Whatever", recorded_at: "2026-04-13T00:00:00Z" },
      { id: 4, name: null, first_email_at: null },
      2,
    );
    expect(r.confidence).toBe(0);
  });

  it("uses date_buffer_days for window check", () => {
    const within = scoreGranolaMatch(
      { id: "uuid-5", title: "Alice", recorded_at: "2026-04-13T00:00:00Z" },
      { id: 5, name: "Alice", first_email_at: "2026-04-14T00:00:00Z" },
      2,
    );
    const outside = scoreGranolaMatch(
      { id: "uuid-6", title: "Alice", recorded_at: "2026-04-13T00:00:00Z" },
      { id: 6, name: "Alice", first_email_at: "2026-04-20T00:00:00Z" },
      2,
    );
    expect(within.confidence).toBe(100);
    expect(outside.method).not.toBe("name_exact");  // date out of window
  });

  it("treats unknown contact-side date as in-window (no penalty)", () => {
    const r = scoreGranolaMatch(
      { id: "uuid-7", title: "Bob", recorded_at: "2026-04-13T00:00:00Z" },
      { id: 7, name: "Bob", first_email_at: null },
      2,
    );
    expect(r.confidence).toBe(100);
    expect(r.method).toBe("name_exact");
  });

  it("name_and_date method when first name in title but date out of window", () => {
    const r = scoreGranolaMatch(
      { id: "uuid-8", title: "Carol", recorded_at: "2026-04-13T00:00:00Z" },
      { id: 8, name: "Carol", first_email_at: "2026-05-01T00:00:00Z" },
      2,
    );
    expect(r.confidence).toBe(60);
    expect(r.method).toBe("name_and_date");
  });
});
