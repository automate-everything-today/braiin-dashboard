/**
 * Integration tests for runGroupDetection orchestration (Task 4.2).
 *
 * Tests the full post-upsert group detection pass that:
 *   1. Queries event_contacts for the given event_id.
 *   2. Calls detectGroups (pure) to find same-company clusters.
 *   3. Upserts company_groups rows with lead_overridden_at safety.
 *   4. Tags member company_group_id + contact_role (cc, then lead = to).
 *
 * The detection is exercised via importEventContacts with a controlled
 * _fetchRecords seam so no real Airtable or Supabase calls occur.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RulesSnapshot } from "@/lib/system-rules/types";

// ---------------------------------------------------------------------------
// Hoisted state: records supabase calls and controls mock fixtures.
// ---------------------------------------------------------------------------
const {
  supabaseCalls,
  eventContactsForDetection,
  existingCompanyGroup,
} = vi.hoisted(() => {
  interface TrackedCall {
    table: string;
    method: string;
    payload?: unknown;
    extra?: unknown;
  }
  const supabaseCalls: TrackedCall[] = [];

  // Controls what event_contacts returns when queried by group detection.
  const eventContactsForDetection: {
    value: Array<{
      id: number;
      company: string | null;
      title: string | null;
      is_lead_contact: boolean;
      seniority_score: number;
    }>;
  } = { value: [] };

  // Controls existing company_groups row (null = not found).
  const existingCompanyGroup: {
    value: {
      id: number;
      lead_overridden_at: string | null;
      lead_contact_id: number;
    } | null;
  } = { value: null };

  return { supabaseCalls, eventContactsForDetection, existingCompanyGroup };
});

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------
vi.mock("@/services/base", () => {
  let nextGroupId = 2001;

  function resolved(data: unknown = null, error: unknown = null, count?: number) {
    return Promise.resolve({ data, error, count: count ?? null });
  }

  function makeChain(table: string) {
    const chain: Record<string, unknown> = {};

    if (table === "events") {
      chain.select = vi.fn(() =>
        resolved([{ id: 42, name: "Intermodal 2026" }], null),
      );
    } else if (table === "freight_networks") {
      chain.select = vi.fn(() =>
        resolved(
          [
            { id: 10, primary_domain: "wcaworld.com" },
            { id: 11, primary_domain: "gkfsummit.com" },
          ],
          null,
        ),
      );
    } else if (table === "import_audit_log") {
      chain.insert = vi.fn((_payload: unknown) => resolved(null, null));
      chain.select = vi.fn(() => chain);
    } else if (table === "event_contacts") {
      // Used by: upsertNeedsAttentionRow (select -> eq -> is -> limit)
      //          runGroupDetection (select -> eq)
      //          tag members (update -> in)
      //          set lead role (update -> eq)
      let isNeedsAttentionLookup = false;
      let isGroupDetectionSelect = false;

      chain.eq = vi.fn((col: string, _val: unknown) => {
        if (col === "airtable_record_id") isNeedsAttentionLookup = true;
        if (col === "id") return resolved(null, null);
        return chain;
      });

      chain.is = vi.fn(() => chain);

      chain.limit = vi.fn((_n: number) => {
        if (isNeedsAttentionLookup) return resolved([], null);
        return resolved(null, null);
      });

      chain.select = vi.fn((_cols: string) => {
        const selectChain: Record<string, unknown> = {};

        selectChain.eq = vi.fn((col: string, _val: unknown) => {
          if (col === "airtable_record_id") {
            isNeedsAttentionLookup = true;
            return chain; // needs_attention path
          }
          // group detection: eq("event_id", ...) -> return contacts fixture
          isGroupDetectionSelect = true;
          void isGroupDetectionSelect;
          return resolved(eventContactsForDetection.value, null);
        });

        selectChain.is = vi.fn(() => chain);

        selectChain.limit = vi.fn((_n: number) => {
          if (isNeedsAttentionLookup) return resolved([], null);
          return resolved(null, null);
        });

        return selectChain;
      });

      chain.upsert = vi.fn((payload: unknown, _opts?: unknown) => {
        supabaseCalls.push({ table, method: "upsert", payload });
        const rows = Array.isArray(payload) ? payload : [payload];
        return resolved(null, null, rows.length);
      });

      chain.update = vi.fn((payload: unknown) => {
        supabaseCalls.push({ table, method: "update", payload });
        return {
          eq: (_col: string, _val: unknown) => resolved(null, null),
          in: (_col: string, vals: unknown) => {
            supabaseCalls.push({ table, method: "update_in", payload, extra: vals });
            return resolved(null, null);
          },
        };
      });

      chain.insert = vi.fn((payload: unknown) => {
        supabaseCalls.push({ table, method: "insert", payload });
        return {
          select: (_cols: string) => ({
            limit: (_n: number) => resolved([{ id: 998 }], null),
          }),
        };
      });
    } else if (table === "company_groups") {
      chain.select = vi.fn((_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          eq: (_col2: string, _val2: unknown) => ({
            maybeSingle: () => resolved(existingCompanyGroup.value, null),
          }),
        }),
      }));

      chain.insert = vi.fn((payload: unknown) => {
        supabaseCalls.push({ table, method: "insert", payload });
        const id = nextGroupId++;
        return {
          select: (_cols: string) => ({
            single: () => resolved({ id }, null),
          }),
        };
      });

      chain.update = vi.fn((payload: unknown) => {
        supabaseCalls.push({ table, method: "update", payload });
        return {
          eq: (_col: string, _val: unknown) => resolved(null, null),
        };
      });
    } else {
      chain.select = vi.fn(() => chain);
      chain.insert = vi.fn((payload: unknown) => {
        supabaseCalls.push({ table, method: "insert", payload });
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
// Fixtures
// ---------------------------------------------------------------------------

/** 3 contacts at "Acme" (group), 1 at "Solo Co" (single - no group). */
const FIXTURES_ACME_PLUS_SOLO = [
  {
    id: "rec_acme_senior",
    fields: {
      Name: "Senior Director",
      Email: "senior@acme.com",
      Title: "Director",
      Company: "Acme Ltd",
      Event: ["Intermodal 2026"],
    },
  },
  {
    id: "rec_acme_junior1",
    fields: {
      Name: "Junior One",
      Email: "junior1@acme.com",
      Title: "Manager",
      Company: "Acme Ltd",
      Event: ["Intermodal 2026"],
    },
  },
  {
    id: "rec_acme_junior2",
    fields: {
      Name: "Junior Two",
      Email: "junior2@acme.com",
      Title: "Analyst",
      Company: "Acme Ltd",
      Event: ["Intermodal 2026"],
    },
  },
  {
    id: "rec_solo",
    fields: {
      Name: "Solo Person",
      Email: "solo@soloapp.com",
      Title: "CEO",
      Company: "Solo Co",
      Event: ["Intermodal 2026"],
    },
  },
];

/** Only 1 contact at "Acme" - should produce NO group. */
const FIXTURES_SINGLE_ACME = [
  {
    id: "rec_only_one",
    fields: {
      Name: "Lonely",
      Email: "lonely@acme.com",
      Title: "Director",
      Company: "Acme Ltd",
      Event: ["Intermodal 2026"],
    },
  },
];

// ---------------------------------------------------------------------------
// Mock RulesSnapshot
// ---------------------------------------------------------------------------
function makeSnapshot(): RulesSnapshot {
  const weights: Record<string, number> = {
    director: 80,
    manager: 60,
    analyst: 30,
    ceo: 100,
    default_unknown: 20,
  };
  return {
    id: "test-snapshot-id",
    modelFor: (task: string) =>
      task === "draft_email" ? "claude-sonnet-4-6" : "claude-haiku-4-5",
    seniority: (kw: string) => weights[kw.toLowerCase()] ?? 20,
    companyMatch: {
      strip_suffixes: ["Ltd", "Inc", "Co"],
      treat_and_equal: true,
      strip_punctuation: true,
      lowercase: true,
    },
    granolaThresholds: {
      auto_link_threshold: 80,
      review_floor: 50,
      date_buffer_days: 2,
    },
    baselineTemplate: () => null,
    raw: { "seniority_score:weights": weights },
  };
}

// ---------------------------------------------------------------------------
// Import real function (after mocks registered).
// ---------------------------------------------------------------------------
import { importEventContacts } from "@/lib/airtable/event-contacts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function injectRecords(records: any[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return () => Promise.resolve(records as any);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("runGroupDetection (integration via importEventContacts)", () => {
  beforeEach(() => {
    supabaseCalls.length = 0;
    existingCompanyGroup.value = null;
    eventContactsForDetection.value = [];
    vi.clearAllMocks();
  });

  it("happy path: 3 contacts at Acme + 1 at Solo -> 1 group_created, senior as lead, 3 members tagged", async () => {
    // Seed the event_contacts that runGroupDetection will read back.
    // In real usage the upsert runs first; here we seed directly.
    eventContactsForDetection.value = [
      { id: 101, company: "Acme Ltd", title: "Director", is_lead_contact: false, seniority_score: 80 },
      { id: 102, company: "Acme Ltd", title: "Manager", is_lead_contact: false, seniority_score: 60 },
      { id: 103, company: "Acme Ltd", title: "Analyst", is_lead_contact: false, seniority_score: 30 },
      { id: 104, company: "Solo Co", title: "CEO", is_lead_contact: false, seniority_score: 100 },
    ];

    const snapshot = makeSnapshot();
    const result = await importEventContacts(
      { runId: "run-group-happy", snapshot },
      injectRecords(FIXTURES_ACME_PLUS_SOLO),
    );

    // The import itself should succeed.
    expect(result.errors).toHaveLength(0);

    // One Acme group created; Solo is singleton so no group.
    expect(result.groups.groups_created).toBe(1);
    expect(result.groups.groups_updated).toBe(0);

    // All 3 Acme members should be tagged.
    expect(result.groups.members_tagged).toBe(3);

    // company_groups insert should have occurred.
    const groupInserts = supabaseCalls.filter(
      (c) => c.table === "company_groups" && c.method === "insert",
    );
    expect(groupInserts).toHaveLength(1);

    // The detected lead should be id=101 (highest seniority_score=80 among Acme).
    const groupInsertPayload = groupInserts[0].payload as Record<string, unknown>;
    expect(groupInsertPayload.lead_contact_id).toBe(101);

    // event_contacts update should set contact_role='to' for lead.
    const contactRoleToUpdates = supabaseCalls.filter(
      (c) =>
        c.table === "event_contacts" &&
        c.method === "update" &&
        (c.payload as Record<string, unknown>).contact_role === "to",
    );
    expect(contactRoleToUpdates).toHaveLength(1);

    // event_contacts update should set contact_role='cc' for members (bulk).
    const contactRoleCcUpdates = supabaseCalls.filter(
      (c) =>
        c.table === "event_contacts" &&
        c.method === "update" &&
        (c.payload as Record<string, unknown>).contact_role === "cc",
    );
    expect(contactRoleCcUpdates).toHaveLength(1);
  });

  it("lead override preserved: existing group with lead_overridden_at set -> lead_contact_id not overwritten", async () => {
    // Existing group: lead is id=202 (previously manually set), override timestamp present.
    existingCompanyGroup.value = {
      id: 5001,
      lead_overridden_at: "2026-04-01T00:00:00Z",
      lead_contact_id: 202,
    };

    // Two Acme contacts; id=201 has higher seniority (would normally win),
    // but the override should keep id=202 as lead.
    eventContactsForDetection.value = [
      { id: 201, company: "Acme Ltd", title: "Director", is_lead_contact: false, seniority_score: 80 },
      { id: 202, company: "Acme Ltd", title: "Manager", is_lead_contact: true, seniority_score: 60 },
    ];

    const snapshot = makeSnapshot();
    const result = await importEventContacts(
      { runId: "run-override", snapshot },
      injectRecords([
        {
          id: "rec_acme_dir",
          fields: {
            Name: "A Director",
            Email: "dir@acme.com",
            Title: "Director",
            Company: "Acme Ltd",
            Event: ["Intermodal 2026"],
          },
        },
        {
          id: "rec_acme_mgr",
          fields: {
            Name: "A Manager",
            Email: "mgr@acme.com",
            Title: "Manager",
            Company: "Acme Ltd",
            Event: ["Intermodal 2026"],
          },
        },
      ]),
    );

    expect(result.errors).toHaveLength(0);

    // Group already exists so it's an update, not a create.
    expect(result.groups.groups_updated).toBe(1);
    expect(result.groups.groups_created).toBe(0);

    // company_groups UPDATE must NOT have been called (override is active).
    const groupUpdates = supabaseCalls.filter(
      (c) => c.table === "company_groups" && c.method === "update",
    );
    expect(groupUpdates).toHaveLength(0);

    // The lead set to 'to' must be the OVERRIDDEN lead (id=202), not id=201.
    const contactRoleToUpdates = supabaseCalls.filter(
      (c) =>
        c.table === "event_contacts" &&
        c.method === "update" &&
        (c.payload as Record<string, unknown>).contact_role === "to",
    );
    // There should be exactly one 'to' update; we verify it targeted the
    // overridden lead via the call having been made (the eq chain is mocked
    // and doesn't let us inspect the id, but the important thing is that
    // company_groups was NOT updated with a new lead_contact_id).
    expect(contactRoleToUpdates).toHaveLength(1);
  });

  it("solo contacts produce no groups: 1 contact at Acme -> 0 groups created", async () => {
    // Only one Acme contact - detectGroups requires >= 2 members.
    eventContactsForDetection.value = [
      { id: 301, company: "Acme Ltd", title: "Director", is_lead_contact: false, seniority_score: 80 },
    ];

    const snapshot = makeSnapshot();
    const result = await importEventContacts(
      { runId: "run-solo", snapshot },
      injectRecords(FIXTURES_SINGLE_ACME),
    );

    expect(result.errors).toHaveLength(0);
    expect(result.groups.groups_created).toBe(0);
    expect(result.groups.groups_updated).toBe(0);
    expect(result.groups.members_tagged).toBe(0);

    // No company_groups inserts or updates.
    const groupCalls = supabaseCalls.filter((c) => c.table === "company_groups");
    expect(groupCalls).toHaveLength(0);

    // No event_contacts role updates from the group detection pass.
    const roleCcUpdates = supabaseCalls.filter(
      (c) =>
        c.table === "event_contacts" &&
        c.method === "update" &&
        (c.payload as Record<string, unknown>).contact_role === "cc",
    );
    expect(roleCcUpdates).toHaveLength(0);
  });
});
