import { describe, it, expect } from "vitest";
import { scoreTitle } from "../seniority";

const weights = {
  ceo: 100,
  founder: 95,
  director: 80,
  head: 75,
  manager: 60,
  coordinator: 40,
  default_unknown: 20,
};

describe("scoreTitle", () => {
  it("returns CEO score for 'Chief Executive Officer'", () => {
    expect(scoreTitle("Chief Executive Officer", weights)).toBe(100);
  });

  it("returns director score for 'Marketing Director'", () => {
    expect(scoreTitle("Marketing Director", weights)).toBe(80);
  });

  it("returns highest match when multiple keywords match", () => {
    expect(scoreTitle("Founder & CEO", weights)).toBe(100);
  });

  it("returns default_unknown for empty/null/unknown title", () => {
    expect(scoreTitle("", weights)).toBe(20);
    expect(scoreTitle(null, weights)).toBe(20);
    expect(scoreTitle("Sales Specialist", weights)).toBe(20);
  });

  it("is case-insensitive", () => {
    expect(scoreTitle("ceo", weights)).toBe(100);
    expect(scoreTitle("CEO", weights)).toBe(100);
    expect(scoreTitle("CeO", weights)).toBe(100);
  });

  it("matches multi-word phrases", () => {
    expect(scoreTitle("Managing Director", weights)).toBe(80); // director word match
  });

  it("falls back to 20 if default_unknown is missing in weights", () => {
    expect(scoreTitle("Unknown", { ceo: 100 })).toBe(20);
  });
});
