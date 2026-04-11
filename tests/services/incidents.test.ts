// tests/services/incidents.test.ts
import { describe, it, expect } from "vitest";
import { getEscalationTargets, INCIDENT_TRIGGER_WORDS } from "@/services/incidents";

describe("getEscalationTargets", () => {
  it("returns branch roles for amber", () => {
    const targets = getEscalationTargets("amber");
    expect(targets).toEqual(["ops", "manager"]);
  });

  it("returns manager roles for red", () => {
    const targets = getEscalationTargets("red");
    expect(targets).toEqual(["manager", "branch_md"]);
  });

  it("returns all leadership for black", () => {
    const targets = getEscalationTargets("black");
    expect(targets).toEqual(["manager", "branch_md", "admin", "super_admin"]);
  });
});

describe("INCIDENT_TRIGGER_WORDS", () => {
  it("has amber triggers", () => {
    expect(INCIDENT_TRIGGER_WORDS.amber.length).toBeGreaterThan(5);
    expect(INCIDENT_TRIGGER_WORDS.amber).toContain("delay");
    expect(INCIDENT_TRIGGER_WORDS.amber).toContain("rolled");
  });

  it("has red triggers", () => {
    expect(INCIDENT_TRIGGER_WORDS.red).toContain("damage");
    expect(INCIDENT_TRIGGER_WORDS.red).toContain("claim");
  });

  it("has black triggers", () => {
    expect(INCIDENT_TRIGGER_WORDS.black).toContain("bankruptcy");
    expect(INCIDENT_TRIGGER_WORDS.black).toContain("failure to pay");
    expect(INCIDENT_TRIGGER_WORDS.black).toContain("fraud");
  });
});
