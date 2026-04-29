import { describe, it, expect } from "vitest";
import { canonicalCompany } from "../company-canonical";

const rules = {
  strip_suffixes: ["Ltd", "Inc", "SA", "Group", "Logistics"],
  treat_and_equal: true,
  strip_punctuation: true,
  lowercase: true,
};

describe("canonicalCompany", () => {
  it("strips suffix tokens (case-insensitive)", () => {
    expect(canonicalCompany("Krom Global Logistics", rules)).toBe(
      canonicalCompany("KROM GLOBAL", rules),
    );
  });

  it("equates & with 'and'", () => {
    expect(canonicalCompany("Smith & Jones", rules)).toBe(
      canonicalCompany("Smith and Jones", rules),
    );
  });

  it("normalises whitespace", () => {
    expect(canonicalCompany("  ATOS  Shipping ", rules)).toBe(
      canonicalCompany("Atos Shipping", rules),
    );
  });

  it("returns empty string for null/empty input", () => {
    expect(canonicalCompany(null, rules)).toBe("");
    expect(canonicalCompany("", rules)).toBe("");
    expect(canonicalCompany(undefined, rules)).toBe("");
  });

  it("strips punctuation when configured", () => {
    expect(canonicalCompany("S.A. Cargo, Inc.", rules)).toBe(
      canonicalCompany("SA Cargo Inc", rules),
    );
  });

  it("preserves distinct names that share a suffix", () => {
    expect(canonicalCompany("Acme Logistics", rules)).not.toBe(
      canonicalCompany("Beta Logistics", rules),
    );
  });

  it("respects rules.lowercase=false (preserves original case after suffix strip)", () => {
    const noLowerRules = { ...rules, lowercase: false };
    const out = canonicalCompany("Krom Global Logistics", noLowerRules);
    expect(out).not.toBe(out.toLowerCase());
  });

  it("respects rules.treat_and_equal=false (& and 'and' differ)", () => {
    const strictRules = { ...rules, treat_and_equal: false };
    expect(canonicalCompany("Smith & Jones", strictRules)).not.toBe(
      canonicalCompany("Smith and Jones", strictRules),
    );
  });
});
