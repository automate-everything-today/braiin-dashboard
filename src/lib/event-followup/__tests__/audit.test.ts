import { describe, it, expect } from "vitest";
import { diffAirtableVsDb } from "../audit";

describe("diffAirtableVsDb", () => {
  it("counts matched, lists missing, finds field mismatches", () => {
    const airtable = [
      { id: "rec1", email: "a@b.com", event_name: "Intermodal 2026", name: "Alice", meeting_notes: "rich" },
      { id: "rec2", email: "c@d.com", event_name: "Intermodal 2026", name: "Bob", meeting_notes: null },
      { id: "rec3", email: "e@f.com", event_name: "Intermodal 2026", name: "Carol", meeting_notes: "more" },
    ];
    const db = [
      { airtable_record_id: "rec1", email: "a@b.com", event_id: 1, name: "Alice", meeting_notes: null }, // notes mismatch
      { airtable_record_id: "rec2", email: "c@d.com", event_id: 1, name: "Bob", meeting_notes: null }, // match
    ];
    const eventsByLowerName = new Map([["intermodal 2026", 1]]);
    const out = diffAirtableVsDb(airtable, db, eventsByLowerName);
    expect(out.matched).toBe(1); // rec2
    expect(out.missing).toEqual(["rec3"]);
    expect(out.field_mismatches).toContainEqual(
      expect.objectContaining({ airtable_id: "rec1", field: "meeting_notes" }),
    );
  });

  it("skips records without email or event (those go to needs_attention, not 'missing')", () => {
    const airtable = [
      { id: "no_email", email: null, event_name: "Intermodal 2026", name: "X", meeting_notes: null },
      { id: "no_event", email: "x@y.com", event_name: null, name: "Y", meeting_notes: null },
    ];
    const out = diffAirtableVsDb(airtable, [], new Map([["intermodal 2026", 1]]));
    expect(out.matched).toBe(0);
    expect(out.missing).toEqual([]);
  });

  it("flags missing when event name doesn't resolve to an event_id", () => {
    const airtable = [
      { id: "rec1", email: "a@b.com", event_name: "Unknown Event", name: "X", meeting_notes: null },
    ];
    const out = diffAirtableVsDb(airtable, [], new Map([["intermodal 2026", 1]]));
    expect(out.missing).toEqual(["rec1"]);
  });
});
