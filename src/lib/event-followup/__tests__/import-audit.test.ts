/**
 * Tests for importEventContacts (Task 3.3): audit-aware importer.
 *
 * Mocks the supabase client to avoid hitting real services. Fixture records
 * are injected via the optional _fetchRecords test-seam parameter so we
 * never touch the Airtable API or the real fetchAllRecords implementation.
 *
 * Exercises:
 *   - Normal import (email + resolved event)
 *   - needs_attention surfacing (no email, no event, unmapped event)
 *   - Per-record audit log rows written in one batched insert per chunk
 *   - Re-import dedupe for no-email records via airtable_record_id lookup
 *   - seniority_score computed and persisted on every row
 *   - Synthesised emails are lowercase and encode the Airtable record id
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RulesSnapshot } from "@/lib/system-rules/types";

// ---------------------------------------------------------------------------
// Hoisted state (accessible inside vi.mock factories at module init time).
// ---------------------------------------------------------------------------
const { supabaseCalls, existingNeedsAttentionRowRef } = vi.hoisted(() => {
  interface TrackedCall {
    table: string;
    method: string;
    payload?: unknown;
  }
  const supabaseCalls: TrackedCall[] = [];
  // Wrapping in an object so tests can mutate .value between runs.
  const existingNeedsAttentionRowRef: { value: { id: number } | null } = { value: null };
  return { supabaseCalls, existingNeedsAttentionRowRef };
});

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------
vi.mock("@/services/base", () => {
  function resolved(data: unknown = null, error: unknown = null, count?: number) {
    return Promise.resolve({ data, error, count: count ?? null });
  }

  function makeChain(table: string) {
    let isNeedsAttentionLookup = false;

    const chain: Record<string, unknown> = {};

    chain.eq = vi.fn((col: string, _val: unknown) => {
      if (col === "airtable_record_id") isNeedsAttentionLookup = true;
      if (col === "id") return resolved(null, null);
      return chain;
    });

    chain.is = vi.fn(() => chain);

    chain.limit = vi.fn((_n: number) => {
      if (isNeedsAttentionLookup) {
        const existing = existingNeedsAttentionRowRef.value;
        return resolved(existing ? [existing] : [], null);
      }
      return resolved(null, null);
    });

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
      chain.insert = vi.fn((payload: unknown) => {
        supabaseCalls.push({ table, method: "insert", payload });
        return resolved(null, null);
      });
      chain.select = vi.fn(() => chain);
    } else if (table === "event_contacts") {
      chain.select = vi.fn((cols: string) => {
        supabaseCalls.push({ table, method: "select", payload: cols });
        return chain;
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
        };
      });

      chain.insert = vi.fn((payload: unknown) => {
        supabaseCalls.push({ table, method: "insert", payload });
        return {
          select: (_cols: string) => ({
            limit: (_n: number) => resolved([{ id: 999 }], null),
          }),
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
// Fixture Airtable records
// ---------------------------------------------------------------------------
const REC_NORMAL = {
  id: "rec_normal_001",
  fields: {
    Name: "Alice Smith",
    Email: "alice@example.com",
    Title: "Director of Logistics",
    Company: "Acme Freight",
    Event: ["Intermodal 2026"],
    "Met By": ["Rob"],
  },
};

const REC_NO_EVENT = {
  id: "rec_noevent_002",
  fields: {
    Name: "Bob Jones",
    Email: "bob@example.com",
    Title: "Manager",
    Company: "Freight Co",
    Event: [],
  },
};

const REC_NO_EMAIL = {
  id: "rec_noemail_003",
  fields: {
    Name: "Charlie Brown",
    Title: "CEO",
    Company: "Mystery Ltd",
    Event: ["Intermodal 2026"],
  },
};

const DEFAULT_FIXTURES = [REC_NORMAL, REC_NO_EVENT, REC_NO_EMAIL];

// ---------------------------------------------------------------------------
// Mock RulesSnapshot
// ---------------------------------------------------------------------------
function makeSnapshot(): RulesSnapshot {
  const weights: Record<string, number> = {
    ceo: 100,
    founder: 95,
    director: 80,
    manager: 60,
    default_unknown: 20,
  };
  return {
    id: "test-snapshot-id",
    modelFor: (task: string) =>
      task === "draft_email" ? "claude-sonnet-4-6" : "claude-haiku-4-5",
    seniority: (kw: string) => weights[kw.toLowerCase()] ?? 20,
    companyMatch: {
      strip_suffixes: ["Ltd", "Inc"],
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
// Import the real function (after mocks are registered).
// ---------------------------------------------------------------------------
import { importEventContacts } from "@/lib/airtable/event-contacts";

// ---------------------------------------------------------------------------
// Helper: inject fixture records via the optional _fetchRecords seam.
// ---------------------------------------------------------------------------
type AirtableRecord = (typeof DEFAULT_FIXTURES)[number];
function injectRecords(records: AirtableRecord[] = DEFAULT_FIXTURES) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return () => Promise.resolve(records as any);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("importEventContacts (audit-aware)", () => {
  beforeEach(() => {
    supabaseCalls.length = 0;
    existingNeedsAttentionRowRef.value = null;
    vi.clearAllMocks();
  });

  it("imports normal records, surfaces drops as needs_attention, writes one batched audit insert per chunk", async () => {
    const snapshot = makeSnapshot();
    const result = await importEventContacts(
      { runId: "test-run-id", snapshot },
      injectRecords(),
    );

    expect(result.fetched).toBe(3);
    // Alice: normal. Bob: no event -> needs_attention. Charlie: no email -> needs_attention.
    expect(result.needs_attention).toBe(2);
    expect(result.run_id).toBe("test-run-id");
    // imported_event_ids should contain the resolved event id for Alice.
    expect(result.imported_event_ids).toContain(42);

    // Exactly one batched audit insert for this chunk (3 records fit in 1 chunk).
    const auditInserts = supabaseCalls.filter(
      (c) => c.table === "import_audit_log" && c.method === "insert",
    );
    expect(auditInserts).toHaveLength(1);

    const auditPayload = auditInserts[0].payload as Array<Record<string, unknown>>;
    expect(Array.isArray(auditPayload)).toBe(true);
    // Should have exactly 3 audit rows (one per Airtable record).
    expect(auditPayload).toHaveLength(3);

    const results = auditPayload.map((r) => r.result as string);
    expect(results).toEqual(
      expect.arrayContaining(["imported", "needs_attention:no_event", "needs_attention:no_email"]),
    );

    // All audit rows should carry run_id and rules_snapshot.
    for (const row of auditPayload) {
      expect(row.run_id).toBe("test-run-id");
      expect(row.rules_snapshot).toEqual(snapshot.raw);
    }
  });

  it("re-import of a no-email record updates the existing row by airtable_record_id, not insert a duplicate", async () => {
    // Pre-seed: the existing row for the no-email record is already in the DB.
    existingNeedsAttentionRowRef.value = { id: 77 };

    const snapshot = makeSnapshot();
    await importEventContacts({ runId: "run-2", snapshot }, injectRecords());

    // An UPDATE call should have happened for the no-email record.
    const updateCalls = supabaseCalls.filter(
      (c) => c.table === "event_contacts" && c.method === "update",
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);

    // Confirm the update payload contains the synthesised placeholder email.
    const noEmailUpdate = updateCalls.find((c) => {
      const p = c.payload as Record<string, unknown>;
      return typeof p.email === "string" && p.email.includes("@needs-attention.local");
    });
    expect(noEmailUpdate).toBeDefined();

    // No INSERT should have occurred for the no-email record since it already exists.
    const noEmailInserts = supabaseCalls.filter(
      (c) =>
        c.table === "event_contacts" &&
        c.method === "insert" &&
        typeof (c.payload as Record<string, unknown>)?.email === "string" &&
        ((c.payload as Record<string, unknown>).email as string).includes("@needs-attention.local"),
    );
    expect(noEmailInserts).toHaveLength(0);
  });

  it("sets seniority_score on every row using snapshot weights", async () => {
    const snapshot = makeSnapshot();
    await importEventContacts({ runId: "run-seniority", snapshot }, injectRecords());

    // Normal row (Alice, "Director of Logistics" -> director -> 80).
    const upsertCall = supabaseCalls.find(
      (c) => c.table === "event_contacts" && c.method === "upsert",
    );
    expect(upsertCall).toBeDefined();
    const upsertRows = upsertCall!.payload as Array<Record<string, unknown>>;
    const aliceRow = upsertRows.find((r) => r.email === "alice@example.com");
    expect(aliceRow?.seniority_score).toBe(80);

    // Charlie (no-email, CEO -> 100).
    const insertCalls = supabaseCalls.filter(
      (c) => c.table === "event_contacts" && c.method === "insert",
    );
    const charlieInsert = insertCalls.find((c) => {
      const p = c.payload as Record<string, unknown>;
      return typeof p.email === "string" && p.email.includes("rec_noemail_003");
    });
    expect(charlieInsert?.payload).toMatchObject({ seniority_score: 100 });
  });

  it("synthesised emails are lowercase and unique per airtable record", async () => {
    const snapshot = makeSnapshot();
    await importEventContacts({ runId: "run-email", snapshot }, injectRecords());

    const insertCalls = supabaseCalls.filter(
      (c) => c.table === "event_contacts" && c.method === "insert",
    );
    const noEmailInserts = insertCalls.filter((c) => {
      const p = c.payload as Record<string, unknown>;
      return typeof p.email === "string" && p.email.includes("@needs-attention.local");
    });
    // Charlie produces exactly one insert (new row, since existingNeedsAttentionRowRef.value is null).
    expect(noEmailInserts).toHaveLength(1);
    const email = (noEmailInserts[0].payload as Record<string, unknown>).email as string;
    // Must be lowercase.
    expect(email).toBe(email.toLowerCase());
    // Must encode the airtable record id.
    expect(email).toContain("rec_noemail_003");
  });

  it("result shape has no skipped/skip_reasons fields and includes new required fields", async () => {
    const snapshot = makeSnapshot();
    const result = await importEventContacts({ runId: "run-shape", snapshot }, injectRecords());

    expect(result).not.toHaveProperty("skipped");
    expect(result).not.toHaveProperty("skip_reasons");
    expect(result).toHaveProperty("needs_attention");
    expect(result).toHaveProperty("imported_event_ids");
    expect(result).toHaveProperty("run_id");
    expect(Array.isArray(result.imported_event_ids)).toBe(true);
  });

  it("audit log for no-email record includes synthesised email in fields_landed", async () => {
    const snapshot = makeSnapshot();
    await importEventContacts({ runId: "run-audit-fields", snapshot }, injectRecords());

    const auditInserts = supabaseCalls.filter(
      (c) => c.table === "import_audit_log" && c.method === "insert",
    );
    expect(auditInserts).toHaveLength(1);

    const auditPayload = auditInserts[0].payload as Array<Record<string, unknown>>;
    const noEmailAuditRow = auditPayload.find(
      (row) => row.result === "needs_attention:no_email",
    );
    expect(noEmailAuditRow).toBeDefined();

    // The synthesised email should be included in fields_landed.
    const fieldsLanded = noEmailAuditRow!.fields_landed as string[];
    expect(fieldsLanded).toContain("email");
  });

  it("audit log for record with email includes email in fields_landed without duplication", async () => {
    const snapshot = makeSnapshot();
    await importEventContacts({ runId: "run-audit-dedup", snapshot }, injectRecords());

    const auditInserts = supabaseCalls.filter(
      (c) => c.table === "import_audit_log" && c.method === "insert",
    );
    expect(auditInserts).toHaveLength(1);

    const auditPayload = auditInserts[0].payload as Array<Record<string, unknown>>;
    const normalAuditRow = auditPayload.find((row) => row.result === "imported");
    expect(normalAuditRow).toBeDefined();

    // The real email should be included exactly once.
    const fieldsLanded = normalAuditRow!.fields_landed as string[];
    const emailCount = fieldsLanded.filter((f) => f === "email").length;
    expect(emailCount).toBe(1);
    expect(fieldsLanded).toContain("email");
  });
});
