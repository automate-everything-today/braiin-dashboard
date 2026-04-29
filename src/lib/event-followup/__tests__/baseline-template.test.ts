import { describe, it, expect } from "vitest";
import { renderBaselineTemplate } from "../baseline-template";

describe("renderBaselineTemplate", () => {
  it("substitutes placeholders deterministically", () => {
    const tpl = {
      greeting: "Hi {first_name}",
      ask: "Send any active lanes through.",
      signoff: "Best regards",
      length_cap_lines: 6,
      include_country_hook: false,
    };
    const out = renderBaselineTemplate(tpl, {
      first_name: "Adrià",
      company: "Krom Global",
      event_name: "Intermodal 2026",
      rep_first_name: "Rob",
      country: "Spain",
    });
    expect(out.body).toContain("Hi Adrià");
    expect(out.body).toContain("Best regards");
    expect(out.body).toContain("Rob");
    expect(out.body).toContain("Intermodal 2026");
    expect(out.subject).toMatch(/Intermodal/i);
  });

  it("includes country hook when enabled and country known", () => {
    const tpl = {
      greeting: "Hi {first_name}",
      ask: "Send any active lanes through.",
      signoff: "Best regards",
      length_cap_lines: 8,
      include_country_hook: true,
      country_hook_template: "{country} is one of our active lanes - happy to chat anytime.",
    };
    const out = renderBaselineTemplate(tpl, {
      first_name: "Adrià",
      company: "Krom",
      event_name: "Intermodal 2026",
      rep_first_name: "Rob",
      country: "Spain",
    });
    expect(out.body).toContain("Spain is one of our active lanes");
  });

  it("omits country hook when include_country_hook is true but country is null", () => {
    const tpl = {
      greeting: "Hi {first_name}",
      ask: "Send any active lanes through.",
      signoff: "Best regards",
      length_cap_lines: 8,
      include_country_hook: true,
      country_hook_template: "{country} hook line.",
    };
    const out = renderBaselineTemplate(tpl, {
      first_name: "X",
      company: "Y",
      event_name: "Z",
      rep_first_name: "Rob",
      country: null,
    });
    expect(out.body).not.toContain("{country}");
    expect(out.body).not.toContain("hook line");
  });

  it("subject mentions the event name", () => {
    const tpl = {
      greeting: "Hi {first_name}",
      ask: "ask line",
      signoff: "Best regards",
      length_cap_lines: 6,
      include_country_hook: false,
    };
    const out = renderBaselineTemplate(tpl, {
      first_name: "X",
      company: "Y",
      event_name: "GKF Summit 2026",
      rep_first_name: "Rob",
      country: null,
    });
    expect(out.subject).toContain("GKF Summit 2026");
  });

  it("rep first name appears as the signature line", () => {
    const tpl = {
      greeting: "Hi {first_name}",
      ask: "ask",
      signoff: "Best regards",
      length_cap_lines: 8,
      include_country_hook: false,
    };
    const out = renderBaselineTemplate(tpl, {
      first_name: "X",
      company: "Y",
      event_name: "Z",
      rep_first_name: "Bruna",
      country: null,
    });
    // Last non-empty line should be the rep first name.
    const lines = out.body.split("\n").filter(Boolean);
    expect(lines[lines.length - 1]).toBe("Bruna");
  });

  it("never leaves an unfilled placeholder in the body", () => {
    const tpl = {
      greeting: "Hi {first_name}",
      ask: "Send any active lanes through. Any in {country}?",
      signoff: "Best regards",
      length_cap_lines: 8,
      include_country_hook: false,
    };
    const out = renderBaselineTemplate(tpl, {
      first_name: "X",
      company: "Y",
      event_name: "Z",
      rep_first_name: "Rob",
      country: null,
    });
    // {country} should be substituted to empty string when country is null.
    expect(out.body).not.toContain("{");
  });
});
