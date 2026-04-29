/**
 * Tests for importGranolaForEvent (Task 5.2).
 *
 * Mocks supabase and injects a fake GranolaApiClient so no real network
 * calls occur.
 *
 * Exercises:
 *   1. Happy path: auto-linked high-confidence pair
 *   2. Pending review band: link written with match_method='pending_review'
 *   3. Below review_floor: no link row written
 *   4. getTranscript error: pushed to errors, loop continues
 *   5. Empty meetings list: all counters 0, no errors
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RulesSnapshot } from "@/lib/system-rules/types";

// ---------------------------------------------------------------------------
// Hoisted state
// ---------------------------------------------------------------------------
const {
  supabaseCalls,
  eventRowRef,
  contactsRef,
  upsertErrorRef,
} = vi.hoisted(() => {
  interface TrackedCall {
    table: string;
    method: string;
    payload?: unknown;
  }
  const supabaseCalls: TrackedCall[] = [];

  // Controls the event returned by .maybeSingle()
  const eventRowRef: {
    value: { id: number; start_date: string; end_date: string | null } | null;
  } = {
    value: { id: 1, start_date: "2026-04-13T00:00:00Z", end_date: "2026-04-14T00:00:00Z" },
  };

  // Controls what event_contacts returns
  const contactsRef: {
    value: Array<{
      id: number;
      name: string | null;
      last_inbound_at: string | null;
      sent_at: string | null;
    }>;
  } = { value: [] };

  // When set, granola_meetings upsert returns this error
  const upsertErrorRef: { value: string | null } = { value: null };

  return { supabaseCalls, eventRowRef, contactsRef, upsertErrorRef };
});

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------
vi.mock("@/services/base", () => {
  function resolved(data: unknown = null, error: unknown = null) {
    return Promise.resolve({ data, error });
  }

  function makeChain(table: string) {
    const chain: Record<string, unknown> = {};

    if (table === "events") {
      // .select(...).eq("id", ...).maybeSingle()
      chain.select = vi.fn(() => ({
        eq: vi.fn((_col: string, _val: unknown) => ({
          maybeSingle: vi.fn(() => resolved(eventRowRef.value, null)),
        })),
      }));
    } else if (table === "granola_meetings") {
      chain.upsert = vi.fn((payload: unknown) => {
        supabaseCalls.push({ table, method: "upsert", payload });
        const err = upsertErrorRef.value ? { message: upsertErrorRef.value } : null;
        return resolved(null, err);
      });
    } else if (table === "event_contacts") {
      // .select(...).eq("event_id", ...)
      chain.select = vi.fn(() => ({
        eq: vi.fn((_col: string, _val: unknown) =>
          resolved(contactsRef.value, null),
        ),
      }));
    } else if (table === "event_contact_granola_links") {
      chain.upsert = vi.fn((payload: unknown) => {
        supabaseCalls.push({ table, method: "upsert", payload });
        return resolved(null, null);
      });
    } else {
      chain.select = vi.fn(() => chain);
      chain.upsert = vi.fn((payload: unknown) => {
        supabaseCalls.push({ table, method: "upsert", payload });
        return resolved(null, null);
      });
    }

    return chain;
  }

  return {
    supabase: {
      from: (table: string) => makeChain(table),
    },
  };
});

// ---------------------------------------------------------------------------
// Import the real function (after mocks registered).
// ---------------------------------------------------------------------------
import { importGranolaForEvent, type GranolaApiClient } from "../granola-import";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeSnapshot(
  thresholds = { auto_link_threshold: 80, review_floor: 50, date_buffer_days: 2 },
): RulesSnapshot {
  return {
    id: "snap-id",
    modelFor: () => "claude-haiku-4-5",
    seniority: () => 0,
    companyMatch: {
      strip_suffixes: [],
      treat_and_equal: true,
      strip_punctuation: true,
      lowercase: true,
    },
    granolaThresholds: thresholds,
    baselineTemplate: () => null,
    raw: {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("importGranolaForEvent", () => {
  beforeEach(() => {
    supabaseCalls.length = 0;
    upsertErrorRef.value = null;
    // Reset to sensible defaults
    eventRowRef.value = {
      id: 1,
      start_date: "2026-04-13T00:00:00Z",
      end_date: "2026-04-14T00:00:00Z",
    };
    contactsRef.value = [];
    vi.clearAllMocks();
  });

  it("auto-links high-confidence pairs", async () => {
    // Contact "Prasath" at the same date as the meeting -> name_exact (100)
    // Contact "Nobody" has no name match -> none (0)
    contactsRef.value = [
      { id: 10, name: "Prasath", last_inbound_at: "2026-04-13T12:00:00Z", sent_at: null },
      { id: 11, name: "Nobody", last_inbound_at: "2026-04-13T12:00:00Z", sent_at: null },
    ];

    const granola: GranolaApiClient = {
      listMeetings: vi.fn().mockResolvedValue([
        { id: "uuid-1", title: "Prasath", recorded_at: "2026-04-13T12:00:00Z" },
        { id: "uuid-2", title: "Random Stranger", recorded_at: "2026-04-13T13:00:00Z" },
      ]),
      getTranscript: vi.fn().mockResolvedValue({ transcript: "...", summary: null }),
    };

    const result = await importGranolaForEvent(1, granola, makeSnapshot());

    expect(result.ingested_meetings).toBe(2);
    expect(result.auto_linked).toBe(1);
    expect(result.pending_review).toBe(0);
    expect(result.errors).toHaveLength(0);

    // The auto-link row should have the real match_method (name_exact), not 'pending_review'
    const linkUpserts = supabaseCalls.filter(
      (c) => c.table === "event_contact_granola_links" && c.method === "upsert",
    );
    expect(linkUpserts).toHaveLength(1);
    const linkPayload = linkUpserts[0].payload as Record<string, unknown>;
    expect(linkPayload.match_method).toBe("name_exact");
    expect(linkPayload.match_confidence).toBe(100);
    expect(linkPayload.event_contact_id).toBe(10);
    expect(linkPayload.granola_meeting_id).toBe("uuid-1");
  });

  it("pending review band: link written with match_method='pending_review'", async () => {
    // "Kim Lee" -> "Lee Super Service" gives name_fuzzy (overlap=0.5, score=75).
    // With auto_link_threshold=80 and review_floor=50 this lands in review band.
    contactsRef.value = [
      { id: 20, name: "Kim Lee", last_inbound_at: "2026-04-13T14:00:00Z", sent_at: null },
    ];

    const granola: GranolaApiClient = {
      listMeetings: vi.fn().mockResolvedValue([
        { id: "uuid-3", title: "Lee Super Service", recorded_at: "2026-04-13T14:15:00Z" },
      ]),
      getTranscript: vi.fn().mockResolvedValue({ transcript: "notes", summary: "summary" }),
    };

    const result = await importGranolaForEvent(1, granola, makeSnapshot());

    expect(result.ingested_meetings).toBe(1);
    expect(result.auto_linked).toBe(0);
    expect(result.pending_review).toBe(1);
    expect(result.errors).toHaveLength(0);

    const linkUpserts = supabaseCalls.filter(
      (c) => c.table === "event_contact_granola_links" && c.method === "upsert",
    );
    expect(linkUpserts).toHaveLength(1);
    const linkPayload = linkUpserts[0].payload as Record<string, unknown>;
    expect(linkPayload.match_method).toBe("pending_review");
    expect(linkPayload.event_contact_id).toBe(20);
  });

  it("below review_floor: no link row written", async () => {
    // "Nobody" has no match with "Random Stranger" -> confidence=0, below floor=50
    contactsRef.value = [
      { id: 30, name: "Nobody", last_inbound_at: null, sent_at: null },
    ];

    const granola: GranolaApiClient = {
      listMeetings: vi.fn().mockResolvedValue([
        { id: "uuid-4", title: "Random Stranger", recorded_at: "2026-04-13T12:00:00Z" },
      ]),
      getTranscript: vi.fn().mockResolvedValue({ transcript: "...", summary: null }),
    };

    const result = await importGranolaForEvent(1, granola, makeSnapshot());

    expect(result.ingested_meetings).toBe(1);
    expect(result.auto_linked).toBe(0);
    expect(result.pending_review).toBe(0);
    expect(result.errors).toHaveLength(0);

    // No link rows written
    const linkUpserts = supabaseCalls.filter(
      (c) => c.table === "event_contact_granola_links",
    );
    expect(linkUpserts).toHaveLength(0);
  });

  it("getTranscript error: pushed to errors, loop continues with other meetings", async () => {
    contactsRef.value = [
      { id: 40, name: "Alice", last_inbound_at: "2026-04-13T12:00:00Z", sent_at: null },
    ];

    // Meeting 1 throws on getTranscript; meeting 2 succeeds.
    const granola: GranolaApiClient = {
      listMeetings: vi.fn().mockResolvedValue([
        { id: "uuid-fail", title: "Bad Meeting", recorded_at: "2026-04-13T10:00:00Z" },
        { id: "uuid-ok", title: "Alice", recorded_at: "2026-04-13T12:00:00Z" },
      ]),
      getTranscript: vi.fn().mockImplementation((id: string) => {
        if (id === "uuid-fail") return Promise.reject(new Error("API timeout"));
        return Promise.resolve({ transcript: "ok transcript", summary: null });
      }),
    };

    const result = await importGranolaForEvent(1, granola, makeSnapshot());

    // Only the successful meeting is ingested
    expect(result.ingested_meetings).toBe(1);
    // The error is captured
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("API timeout");
    // The Alice meeting still scores and auto-links
    expect(result.auto_linked).toBe(1);
  });

  it("empty meetings list: all counters 0, no errors", async () => {
    contactsRef.value = [
      { id: 50, name: "Prasath", last_inbound_at: "2026-04-13T12:00:00Z", sent_at: null },
    ];

    const granola: GranolaApiClient = {
      listMeetings: vi.fn().mockResolvedValue([]),
      getTranscript: vi.fn(),
    };

    const result = await importGranolaForEvent(1, granola, makeSnapshot());

    expect(result.ingested_meetings).toBe(0);
    expect(result.auto_linked).toBe(0);
    expect(result.pending_review).toBe(0);
    expect(result.errors).toHaveLength(0);

    // getTranscript should never have been called
    expect(granola.getTranscript).not.toHaveBeenCalled();
  });
});
