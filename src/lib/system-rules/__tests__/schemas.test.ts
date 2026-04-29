import { describe, it, expect } from "vitest";
import {
  seniorityScoreSchema,
  companyMatchSchema,
  granolaMatchSchema,
  modelRoutingSchema,
  baselineTemplateSchema,
} from "../schemas";

describe("system_rules Zod schemas", () => {
  it("seniorityScoreSchema requires default_unknown and at least one role weight", () => {
    expect(() => seniorityScoreSchema.parse({ default_unknown: 20 })).toThrow();
    expect(seniorityScoreSchema.parse({ ceo: 100, default_unknown: 20 })).toBeTruthy();
  });

  it("companyMatchSchema requires strip_suffixes array", () => {
    expect(companyMatchSchema.parse({
      strip_suffixes: ["Ltd"],
      treat_and_equal: true,
      strip_punctuation: true,
      lowercase: true,
    })).toBeTruthy();
    expect(() => companyMatchSchema.parse({ treat_and_equal: true })).toThrow();
  });

  it("granolaMatchSchema enforces threshold ordering", () => {
    expect(granolaMatchSchema.parse({
      auto_link_threshold: 80, review_floor: 50, date_buffer_days: 2
    })).toBeTruthy();
    expect(() => granolaMatchSchema.parse({
      auto_link_threshold: 50, review_floor: 80, date_buffer_days: 2
    })).toThrow();
  });

  it("modelRoutingSchema requires draft_email key", () => {
    expect(() => modelRoutingSchema.parse({ seniority_score: "claude-haiku-4-5" })).toThrow();
  });

  it("baselineTemplateSchema requires greeting + ask + signoff", () => {
    expect(baselineTemplateSchema.parse({
      greeting: "Hi {first_name}",
      ask: "Send any active lanes through.",
      signoff: "Best regards",
      length_cap_lines: 4,
      include_country_hook: false,
    })).toBeTruthy();
  });

  it("baselineTemplateSchema requires country_hook_template when include_country_hook is true", () => {
    expect(() => baselineTemplateSchema.parse({
      greeting: "Hi {first_name}",
      ask: "Send any active lanes through.",
      signoff: "Best regards",
      length_cap_lines: 4,
      include_country_hook: true,  // ON but no template
    })).toThrow(/country_hook_template/);

    expect(baselineTemplateSchema.parse({
      greeting: "Hi {first_name}",
      ask: "Send any active lanes through.",
      signoff: "Best regards",
      length_cap_lines: 4,
      include_country_hook: true,
      country_hook_template: "{country} is one of our active lanes.",
    })).toBeTruthy();
  });
});
