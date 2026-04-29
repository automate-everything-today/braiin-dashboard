import { describe, it, expect } from "vitest";
import { detectGroups } from "../group-detection";

const baseRules = {
  strip_suffixes: ["Logistics", "Group"],
  treat_and_equal: true,
  strip_punctuation: true,
  lowercase: true,
};

describe("detectGroups", () => {
  it("groups same-company contacts and picks senior as lead", () => {
    const contacts = [
      { id: 1, company: "Krom Global Logistics", title: "BD Manager", is_lead_contact: false, seniority_score: 60 },
      { id: 2, company: "Krom Global", title: "CEO", is_lead_contact: false, seniority_score: 100 },
      { id: 3, company: "Acme", title: "Manager", is_lead_contact: false, seniority_score: 60 },
    ];
    const groups = detectGroups(contacts, baseRules);
    expect(groups).toHaveLength(1);
    expect(groups[0].lead_contact_id).toBe(2);
    expect(groups[0].member_ids.sort()).toEqual([1, 2]);
    expect(groups[0].company_name_canonical).toBeTruthy();
  });

  it("returns no groups for solo contacts (one per canonical company)", () => {
    const contacts = [
      { id: 1, company: "Solo Inc", title: "Manager", is_lead_contact: false, seniority_score: 60 },
      { id: 2, company: "Other Co", title: "Manager", is_lead_contact: false, seniority_score: 60 },
    ];
    const groups = detectGroups(contacts, baseRules);
    expect(groups).toHaveLength(0);
  });

  it("respects is_lead_contact tie-breaker on equal seniority", () => {
    const contacts = [
      { id: 1, company: "Acme", title: "Manager", is_lead_contact: true, seniority_score: 60 },
      { id: 2, company: "Acme", title: "Manager", is_lead_contact: false, seniority_score: 60 },
    ];
    const groups = detectGroups(contacts, baseRules);
    expect(groups[0].lead_contact_id).toBe(1);
  });

  it("falls back to alphabetical id (lowest) on full tie", () => {
    const contacts = [
      { id: 5, company: "Acme", title: "Manager", is_lead_contact: false, seniority_score: 60 },
      { id: 2, company: "Acme", title: "Manager", is_lead_contact: false, seniority_score: 60 },
      { id: 9, company: "Acme", title: "Manager", is_lead_contact: false, seniority_score: 60 },
    ];
    const groups = detectGroups(contacts, baseRules);
    expect(groups[0].lead_contact_id).toBe(2);
  });

  it("ignores contacts with empty/null company", () => {
    const contacts = [
      { id: 1, company: null, title: "CEO", is_lead_contact: false, seniority_score: 100 },
      { id: 2, company: "", title: "CEO", is_lead_contact: false, seniority_score: 100 },
      { id: 3, company: "Real Co", title: "Manager", is_lead_contact: false, seniority_score: 60 },
    ];
    const groups = detectGroups(contacts, baseRules);
    expect(groups).toHaveLength(0);
  });

  it("groups three+ members and picks the most senior", () => {
    const contacts = [
      { id: 1, company: "BigCo", title: "Director", is_lead_contact: false, seniority_score: 80 },
      { id: 2, company: "BigCo", title: "CEO", is_lead_contact: false, seniority_score: 100 },
      { id: 3, company: "BigCo", title: "Manager", is_lead_contact: false, seniority_score: 60 },
      { id: 4, company: "BigCo", title: "Coordinator", is_lead_contact: false, seniority_score: 40 },
    ];
    const groups = detectGroups(contacts, baseRules);
    expect(groups[0].member_ids.length).toBe(4);
    expect(groups[0].lead_contact_id).toBe(2);
  });
});
