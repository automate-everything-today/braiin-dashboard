"use client";

/**
 * /dev/event-followup
 *
 * Operator surface for the post-conference follow-up build.
 *
 * Top: event selector + per-event status counts.
 * Action bar: Import from Airtable, Scan engagement, Draft batch.
 * Body: contact list with inline expand-to-edit-and-send.
 *
 * Auth: PageGuard (manager / sales_manager / super_admin).
 */

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageGuard } from "@/components/page-guard";
import { BraiinLoader } from "@/components/braiin-loader";
import {
  ArrowDownToLine,
  Send,
  Sparkles,
  Search,
  RefreshCw,
  Mail,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";

interface EventSummary {
  event_id: number;
  event_name: string;
  total: number;
  by_status: Record<string, number>;
}

interface ContactRow {
  id: number;
  email: string;
  name: string | null;
  title: string | null;
  company: string | null;
  company_type: string | null;
  country: string | null;
  region: string | null;
  tier: number | null;
  met_by: string[] | null;
  meeting_notes: string | null;
  company_info: string | null;
  follow_up_status: string;
  attention_reason: string | null;
  draft_subject: string | null;
  draft_body: string | null;
  send_from_email: string | null;
  engagement_summary: string | null;
  last_inbound_at: string | null;
  sent_at: string | null;
  events: { id: number; name: string } | null;
  co_company_contacts?: Array<{
    id: number;
    name: string | null;
    email: string;
    company: string | null;
    follow_up_status: string;
    event_id: number | null;
    event_name: string | null;
  }>;
}

const MET_BY_OPTIONS = [
  { value: "Rob", label: "Rob", isPerson: true },
  { value: "Sam", label: "Sam", isPerson: true },
  { value: "Bruna", label: "Bruna", isPerson: true },
  { value: "GKF Directory", label: "GKF Directory", isPerson: false },
  { value: "Business Card", label: "Business Card", isPerson: false },
];

const NAME_TO_EMAIL: Record<string, string> = {
  Rob: "rob.donald@cortenlogistics.com",
  Sam: "sam.yauner@cortenlogistics.com",
  Bruna: "bruna.natale@cortenlogistics.com",
};

/**
 * Normalise ALL-CAPS or weirdly-cased company / person names to Title Case.
 * Preserves common abbreviations (LTD, S.A., GmbH, Inc, LLC, USA, UK, EU, BV).
 * Detection: if the string is mostly uppercase letters, retitle. If it
 * already has mixed case, leave it alone.
 */
const PRESERVE_TOKENS = new Set([
  "LTD","LLC","INC","CORP","CO","S.A.","SA","SAS","SL","SLU","BV","NV","GMBH",
  "AG","AB","OY","LDA","SRL","SPA","KG","UK","USA","EU","UAE","DDP","DDU","DAP",
  "FCL","LCL","B2B","B2C","API","ETA","ETD","BL","HBL","MBL","HQ","BD","II","III","IV",
]);

function toProperCase(input: string | null | undefined): string {
  if (!input) return "";
  const trimmed = input.trim();
  if (!trimmed) return "";
  // Only re-case if the string is mostly uppercase. Mixed-case stays as-is.
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length === 0) return trimmed;
  const upperRatio =
    letters.split("").filter((c) => c === c.toUpperCase()).length / letters.length;
  if (upperRatio < 0.7) return trimmed;
  return trimmed
    .split(/(\s+)/)
    .map((tok) => {
      if (/^\s+$/.test(tok)) return tok;
      const upper = tok.toUpperCase();
      if (PRESERVE_TOKENS.has(upper)) return upper;
      // Hyphenated / dotted segments: title each part.
      return tok
        .split(/([-/.])/)
        .map((part) => {
          if (/^[-/.]$/.test(part)) return part;
          if (PRESERVE_TOKENS.has(part.toUpperCase())) return part.toUpperCase();
          if (part.length === 0) return part;
          return part[0].toUpperCase() + part.slice(1).toLowerCase();
        })
        .join("");
    })
    .join("");
}

/** Truncate to N chars with ellipsis. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

const STATUS_TONE: Record<string, string> = {
  pending: "bg-zinc-100 text-zinc-700",
  already_engaged: "bg-blue-100 text-blue-700",
  drafted: "bg-amber-100 text-amber-800",
  reviewed: "bg-violet-100 text-violet-700",
  queued: "bg-cyan-100 text-cyan-700",
  sent: "bg-emerald-100 text-emerald-700",
  replied: "bg-emerald-200 text-emerald-900",
  bounced: "bg-red-100 text-red-700",
  opted_out: "bg-zinc-200 text-zinc-700",
  cancelled: "bg-zinc-100 text-zinc-500",
};

export default function EventFollowupPage() {
  return (
    <PageGuard pageId="event-followup">
      <Inner />
    </PageGuard>
  );
}

function Inner() {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [contacts, setContacts] = useState<ContactRow[] | null>(null);
  const [needsAttentionAll, setNeedsAttentionAll] = useState<ContactRow[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [view, setView] = useState<"active" | "needs_attention">("active");

  async function loadEvents() {
    try {
      const res = await fetch("/api/event-followup/import");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load events");
      setEvents(data.events || []);
      if (!selectedEventId && data.events?.length > 0) {
        setSelectedEventId(data.events[0].event_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load events");
      setEvents([]);
    }
  }

  async function loadContacts(eventId: number) {
    setContacts(null);
    try {
      const res = await fetch(
        `/api/event-followup/contacts?event_id=${eventId}`,
      );
      if (res.status === 404) {
        // Fallback - this endpoint may not exist yet; surface a friendly note.
        setContacts([]);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load contacts");
      setContacts(data.contacts || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contacts");
      setContacts([]);
    }
  }

  async function loadNeedsAttention() {
    try {
      const res = await fetch("/api/event-followup/contacts?status=needs_attention");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load needs-attention contacts");
      setNeedsAttentionAll(data.contacts || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load needs-attention contacts");
      setNeedsAttentionAll([]);
    }
  }

  useEffect(() => {
    loadEvents();
    loadNeedsAttention();
  }, []);

  useEffect(() => {
    if (selectedEventId) loadContacts(selectedEventId);
  }, [selectedEventId]);

  const filtered = useMemo(() => {
    if (!contacts) return [];
    const q = search.toLowerCase().trim();
    return contacts
      .filter((c) => c.follow_up_status !== "needs_attention")
      .filter((c) =>
        statusFilter === "all" ? true : c.follow_up_status === statusFilter,
      )
      .filter((c) => {
        if (!q) return true;
        return (
          (c.name ?? "").toLowerCase().includes(q) ||
          (c.company ?? "").toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const ta = a.tier ?? 99;
        const tb = b.tier ?? 99;
        if (ta !== tb) return ta - tb;
        return (a.name ?? "").localeCompare(b.name ?? "");
      });
  }, [contacts, statusFilter, search]);

  const needsAttentionContacts = useMemo(() => {
    if (!needsAttentionAll) return [];
    return [...needsAttentionAll].sort((a, b) => {
      const ra = a.attention_reason ?? "";
      const rb = b.attention_reason ?? "";
      if (ra !== rb) return ra.localeCompare(rb);
      return (a.name ?? a.email).localeCompare(b.name ?? b.email);
    });
  }, [needsAttentionAll]);

  async function runAction(label: string, fn: () => Promise<void>) {
    setBusyAction(label);
    setError(null);
    setActionResult(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label} failed`);
    } finally {
      setBusyAction(null);
    }
  }

  async function importFromAirtable() {
    return runAction("import", async () => {
      const res = await fetch("/api/event-followup/import", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      const r = data.result;

      // Build a richer summary so 0-imported runs explain themselves.
      const parts: string[] = [
        `Imported ${r.imported} contacts (${r.fetched} fetched).`,
      ];
      if (r.needs_attention > 0) {
        parts.push(`${r.needs_attention} need attention (missing email or event).`);
      }
      if (r.imported_event_ids && r.imported_event_ids.length > 0) {
        parts.push(`Events updated: ${r.imported_event_ids.length}.`);
      }
      if (data.granola) {
        const g = data.granola;
        if (g.ingested_meetings > 0) {
          parts.push(`Granola: ${g.ingested_meetings} meetings ingested, ${g.auto_linked} auto-linked.`);
        }
      }
      if (r.errors && r.errors.length > 0) {
        parts.push(`Errors: ${r.errors.slice(0, 3).join("; ")}${r.errors.length > 3 ? ` (+${r.errors.length - 3} more)` : ""}`);
      }
      setActionResult(parts.join(" "));

      await loadEvents();
      await loadNeedsAttention();
      if (selectedEventId) await loadContacts(selectedEventId);
    });
  }

  async function scanEngagement() {
    if (!selectedEventId) return;
    return runAction("scan", async () => {
      const res = await fetch("/api/event-followup/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: selectedEventId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      const r = data.result;
      setActionResult(
        `Scanned ${r.scanned}; flagged ${r.flagged_engaged} as already engaged.`,
      );
      await loadContacts(selectedEventId);
    });
  }

  async function draftBatch(limit: number) {
    if (!selectedEventId) return;
    return runAction(`draft-${limit}`, async () => {
      const res = await fetch("/api/event-followup/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: selectedEventId, limit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Draft failed");
      setActionResult(
        `Drafted ${data.drafted} (${data.skipped} skipped, ${data.errors} errors).`,
      );
      await loadContacts(selectedEventId);
    });
  }

  async function draftOne(contactId: number) {
    return runAction(`draft-one-${contactId}`, async () => {
      const res = await fetch("/api/event-followup/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId, force: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Draft failed");
      setActionResult("Draft regenerated.");
      if (selectedEventId) await loadContacts(selectedEventId);
    });
  }

  async function draftOneWithFeedback(contactId: number, feedback: string, previousDraft: string) {
    return runAction(`feedback-${contactId}`, async () => {
      const res = await fetch("/api/event-followup/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_id: contactId,
          force: true,
          feedback,
          previous_draft: previousDraft,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Draft failed");
      setActionResult("Regenerated with feedback applied.");
      if (selectedEventId) await loadContacts(selectedEventId);
    });
  }

  async function sendOne(contactId: number) {
    return runAction(`send-${contactId}`, async () => {
      const res = await fetch("/api/event-followup/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      setActionResult(`Sent. Message id: ${data.result.messageId}`);
      if (selectedEventId) await loadContacts(selectedEventId);
    });
  }

  async function saveDraftEdit(contactId: number, subject: string, body: string) {
    return runAction(`save-${contactId}`, async () => {
      const res = await fetch("/api/event-followup/contacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: contactId,
          draft_subject: subject,
          draft_body: body,
          follow_up_status: "reviewed",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setActionResult("Draft saved.");
      if (selectedEventId) await loadContacts(selectedEventId);
    });
  }

  if (events === null) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <BraiinLoader />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 w-full">
      <div>
        <h1 className="text-2xl font-semibold">Event follow-ups</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Post-conference contact pipeline. Import from Airtable -&gt; scan engagement -&gt; draft -&gt; review -&gt; send.
        </p>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-800 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </CardContent>
        </Card>
      )}
      {actionResult && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="p-4 text-sm text-emerald-800 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{actionResult}</span>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {events.length === 0 ? (
          <Card className="md:col-span-3">
            <CardContent className="p-6 text-center text-sm text-zinc-500">
              No events found. Run the seed migration (058) and import from Airtable to populate.
            </CardContent>
          </Card>
        ) : (
          events.map((e) => (
            <button
              key={e.event_id}
              type="button"
              onClick={() => setSelectedEventId(e.event_id)}
              className={`text-left rounded-lg border p-4 transition ${
                selectedEventId === e.event_id
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-200 hover:border-zinc-400"
              }`}
            >
              <div className="font-medium">{e.event_name}</div>
              <div className="text-2xl font-semibold mt-1">{e.total} contacts</div>
              <div
                className={`text-xs mt-1 ${
                  selectedEventId === e.event_id ? "opacity-80" : "text-zinc-500"
                }`}
              >
                {Object.entries(e.by_status)
                  .map(([k, v]) => `${v} ${k}`)
                  .join(" · ")}
              </div>
            </button>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busyAction === "import"}
          onClick={importFromAirtable}
        >
          <ArrowDownToLine className="h-4 w-4 mr-1" />
          {busyAction === "import" ? "Importing..." : "Import from Airtable"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!selectedEventId || busyAction === "scan"}
          onClick={scanEngagement}
        >
          <Mail className="h-4 w-4 mr-1" />
          {busyAction === "scan" ? "Scanning..." : "Scan engagement"}
        </Button>
        <Button
          size="sm"
          disabled={!selectedEventId || busyAction === "draft-10"}
          onClick={() => draftBatch(10)}
        >
          <Sparkles className="h-4 w-4 mr-1" />
          {busyAction === "draft-10" ? "Drafting..." : "Draft batch (10)"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!selectedEventId || busyAction === "draft-50"}
          onClick={() => draftBatch(50)}
        >
          <Sparkles className="h-4 w-4 mr-1" />
          {busyAction === "draft-50" ? "Drafting..." : "Draft batch (50)"}
        </Button>
        <div className="flex-1"></div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            loadNeedsAttention();
            if (selectedEventId) loadContacts(selectedEventId);
          }}
        >
          <RefreshCw className="h-4 w-4 mr-1" /> Reload
        </Button>
      </div>

      {/* View toggle: Active vs Needs attention */}
      <div className="flex items-center gap-1 border rounded-md w-fit p-1 bg-zinc-50">
        <Button
          size="sm"
          variant={view === "active" ? "default" : "ghost"}
          onClick={() => setView("active")}
          className="h-7 px-3 text-xs"
        >
          Active
          {contacts !== null && filtered.length > 0 && (
            <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${view === "active" ? "bg-white/20" : "bg-zinc-200 text-zinc-600"}`}>
              {filtered.length}
            </span>
          )}
        </Button>
        <Button
          size="sm"
          variant={view === "needs_attention" ? "default" : "ghost"}
          onClick={() => setView("needs_attention")}
          className="h-7 px-3 text-xs"
        >
          Needs attention
          {contacts !== null && needsAttentionContacts.length > 0 && (
            <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${view === "needs_attention" ? "bg-white/20" : "bg-amber-100 text-amber-700"}`}>
              {needsAttentionContacts.length}
            </span>
          )}
        </Button>
      </div>

      {view === "needs_attention" ? (
        <NeedsAttentionView
          contacts={needsAttentionContacts}
          events={events ?? []}
          busyAction={busyAction}
          onAssignEvent={async (contactId, eventId) => {
            return runAction(`assign-event-${contactId}`, async () => {
              const res = await fetch("/api/event-followup/contacts", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  id: contactId,
                  event_id: eventId,
                  follow_up_status: "pending",
                  attention_reason: null,
                }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || "Assign failed");
              setActionResult("Contact assigned to event.");
              await loadNeedsAttention();
              if (selectedEventId) await loadContacts(selectedEventId);
              await loadEvents();
            });
          }}
          onMarkJunk={async (contactId) => {
            return runAction(`junk-${contactId}`, async () => {
              const res = await fetch("/api/event-followup/contacts", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  id: contactId,
                  follow_up_status: "cancelled",
                }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || "Mark junk failed");
              setActionResult("Contact marked as cancelled.");
              await loadNeedsAttention();
            });
          }}
          onBulkMergeIntoColleagues={async (sources) => {
            return runAction(`bulk-merge-${sources.length}`, async () => {
              let merged = 0;
              let skipped = 0;
              const errors: string[] = [];
              for (const s of sources) {
                if (!s.targetId) {
                  skipped++;
                  continue;
                }
                const res = await fetch("/api/event-followup/contacts/merge", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ source_id: s.sourceId, target_id: s.targetId }),
                });
                if (res.ok) merged++;
                else {
                  const data = await res.json().catch(() => ({}));
                  errors.push(`#${s.sourceId}: ${data.error ?? "unknown"}`);
                }
              }
              const parts = [`Merged ${merged} contacts.`];
              if (skipped > 0) parts.push(`${skipped} skipped (no colleague to merge into).`);
              if (errors.length > 0) parts.push(`${errors.length} failed (${errors.slice(0, 2).join("; ")}${errors.length > 2 ? "..." : ""}).`);
              setActionResult(parts.join(" "));
              await loadNeedsAttention();
              if (selectedEventId) await loadContacts(selectedEventId);
            });
          }}
          onMergeInto={async (sourceId, targetId) => {
            return runAction(`merge-${sourceId}`, async () => {
              const res = await fetch("/api/event-followup/contacts/merge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ source_id: sourceId, target_id: targetId }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || "Merge failed");
              const fields = (data.fields_merged ?? []) as string[];
              setActionResult(
                fields.length > 0
                  ? `Merged into existing contact (${fields.join(", ")} carried over).`
                  : "Merged into existing contact (no new fields to carry over).",
              );
              await loadNeedsAttention();
              if (selectedEventId) await loadContacts(selectedEventId);
            });
          }}
          onBulkAssignEvent={async (ids, eventId) => {
            return runAction(`bulk-assign-${ids.length}`, async () => {
              const res = await fetch("/api/event-followup/contacts/bulk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ids,
                  event_id: eventId,
                  follow_up_status: "pending",
                  attention_reason: null,
                }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || "Bulk assign failed");
              const updated = data.updated ?? 0;
              const merged = data.merged_away ?? 0;
              const failedCount = data.failed_count ?? 0;
              const parts: string[] = [`Assigned ${updated} contacts.`];
              if (merged > 0) {
                parts.push(`${merged} merged into existing colleagues.`);
              }
              if (failedCount > 0) {
                const reasons = (data.failed as Array<{ id: number; reason: string }> | undefined)
                  ?.slice(0, 3)
                  .map((f) => `#${f.id}: ${f.reason}`)
                  .join("; ");
                parts.push(`${failedCount} failed${reasons ? ` (${reasons}${failedCount > 3 ? `, +${failedCount - 3} more` : ""})` : ""}.`);
              }
              setActionResult(parts.join(" "));
              await loadNeedsAttention();
              if (selectedEventId) await loadContacts(selectedEventId);
              await loadEvents();
            });
          }}
          onBulkMarkJunk={async (ids) => {
            return runAction(`bulk-junk-${ids.length}`, async () => {
              const res = await fetch("/api/event-followup/contacts/bulk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ids,
                  follow_up_status: "cancelled",
                }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || "Bulk mark junk failed");
              const failedCount = data.failed_count ?? 0;
              setActionResult(
                failedCount > 0
                  ? `Marked ${data.updated} as cancelled. ${failedCount} failed.`
                  : `Marked ${data.updated} contacts as cancelled.`,
              );
              await loadNeedsAttention();
            });
          }}
          loading={needsAttentionAll === null}
        />
      ) : (
        <>
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, company, email..."
            className="w-full pl-8 pr-3 py-2 text-sm border rounded-md"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border rounded-md"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="already_engaged">Already engaged</option>
          <option value="drafted">Drafted</option>
          <option value="reviewed">Reviewed</option>
          <option value="sent">Sent</option>
          <option value="replied">Replied</option>
          <option value="bounced">Bounced</option>
        </select>
      </div>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Contacts ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {contacts === null ? (
            <div className="p-12 flex items-center justify-center">
              <BraiinLoader />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead className="w-24">Country</TableHead>
                  <TableHead className="w-12">Tier</TableHead>
                  <TableHead className="w-36">Met by</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead>Notes preview</TableHead>
                  <TableHead className="w-44 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => {
                  const isExpanded = expandedId === c.id;
                  const metByList = (c.met_by ?? []).map((v) => {
                    if (v === "Rob" || v === "Sam" || v === "Bruna") return v;
                    if (v === "GKF Directory") return "GKF";
                    if (v === "Business Card") return "Card";
                    if (v.includes("@")) {
                      const first = v.split("@")[0].split(".")[0];
                      return first[0].toUpperCase() + first.slice(1).toLowerCase();
                    }
                    return toProperCase(v);
                  });
                  const displayName = toProperCase(c.name ?? c.email);
                  const displayCompany = c.company ? toProperCase(c.company) : null;
                  const displayTitle = c.title ? toProperCase(c.title) : null;
                  const notesFull = c.meeting_notes ?? "";
                  const notesPreview = notesFull
                    ? truncate(notesFull, 90)
                    : null;
                  return (
                    <>
                      <TableRow
                        key={c.id}
                        onClick={() => setExpandedId(isExpanded ? null : c.id)}
                        className="cursor-pointer"
                      >
                        <TableCell className="font-medium align-top max-w-[14rem]">
                          <div className="truncate" title={displayName}>{displayName}</div>
                          {displayTitle && (
                            <div className="text-xs text-zinc-500 mt-0.5 truncate" title={displayTitle}>
                              {displayTitle}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm align-top max-w-[18rem]">
                          <div className="truncate" title={displayCompany ?? ""}>
                            {displayCompany ?? "—"}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm align-top">{c.country ?? "—"}</TableCell>
                        <TableCell className="align-top" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={c.tier ?? ""}
                            onChange={async (ev) => {
                              const v = ev.target.value ? Number(ev.target.value) : null;
                              await fetch("/api/event-followup/contacts", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ id: c.id, tier: v }),
                              });
                              if (selectedEventId) await loadContacts(selectedEventId);
                            }}
                            className="px-1.5 py-0.5 text-xs border rounded bg-white"
                          >
                            <option value="">—</option>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <option key={n} value={n}>{n}</option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell
                          className="text-xs align-top"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex flex-wrap gap-1">
                            {MET_BY_OPTIONS.map((opt) => {
                              const ticked = (c.met_by ?? []).includes(opt.value);
                              const label = opt.value === "GKF Directory" ? "GKF" : opt.value === "Business Card" ? "Card" : opt.label;
                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={async () => {
                                    const next = ticked
                                      ? (c.met_by ?? []).filter((v) => v !== opt.value)
                                      : [...(c.met_by ?? []), opt.value];
                                    await fetch("/api/event-followup/contacts", {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ id: c.id, met_by: next }),
                                    });
                                    if (selectedEventId) await loadContacts(selectedEventId);
                                  }}
                                  className={`px-1.5 py-0.5 rounded text-[11px] border transition ${
                                    ticked
                                      ? opt.isPerson
                                        ? "bg-emerald-100 border-emerald-400 text-emerald-800"
                                        : "bg-zinc-200 border-zinc-400 text-zinc-700"
                                      : "bg-white border-zinc-200 text-zinc-400 hover:border-zinc-400"
                                  }`}
                                  title={opt.value}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge className={STATUS_TONE[c.follow_up_status] ?? "bg-zinc-100"}>
                            {c.follow_up_status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-zinc-600 align-top max-w-[24rem]">
                          {notesPreview ? (
                            <div
                              className="line-clamp-2 leading-snug"
                              title={notesFull}
                            >
                              {notesPreview}
                            </div>
                          ) : (
                            <span className="text-zinc-400 italic">no notes</span>
                          )}
                          {c.engagement_summary && (
                            <div className="text-[10px] text-blue-700 mt-1 line-clamp-1">
                              {c.engagement_summary}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {c.follow_up_status === "pending" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  draftOne(c.id);
                                }}
                                disabled={busyAction === `draft-one-${c.id}`}
                              >
                                Draft
                              </Button>
                            )}
                            {(c.follow_up_status === "drafted" ||
                              c.follow_up_status === "reviewed") && (
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  sendOne(c.id);
                                }}
                                disabled={busyAction === `send-${c.id}`}
                              >
                                <Send className="h-3 w-3 mr-1" />
                                {busyAction === `send-${c.id}` ? "..." : "Send"}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={8} className="bg-zinc-50">
                            <ExpandedDraft
                              contact={c}
                              onSave={saveDraftEdit}
                              onRedraft={draftOne}
                              onRedraftWithFeedback={draftOneWithFeedback}
                              busyAction={busyAction}
                              onChanged={async () => {
                                if (selectedEventId) await loadContacts(selectedEventId);
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center text-sm text-zinc-500 py-6"
                    >
                      No contacts match. Import from Airtable, or relax the filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
        </>
      )}
    </div>
  );
}

// ---- Needs-attention pile ----

const ATTENTION_REASON_LABELS: Record<string, string> = {
  no_event: "No event",
  no_email: "No email",
};

function attentionReasonLabel(reason: string | null): string {
  if (!reason) return "Unknown";
  // unmapped_event:<name> pattern
  if (reason.startsWith("unmapped_event:")) {
    const name = reason.slice("unmapped_event:".length);
    return `Unmapped event: ${name}`;
  }
  return ATTENTION_REASON_LABELS[reason] ?? reason;
}

function attentionReasonBadgeClass(reason: string | null): string {
  if (!reason) return "bg-zinc-100 text-zinc-600";
  if (reason === "no_event" || reason.startsWith("unmapped_event:"))
    return "bg-amber-100 text-amber-800";
  if (reason === "no_email") return "bg-red-100 text-red-700";
  return "bg-zinc-100 text-zinc-600";
}

function NeedsAttentionView({
  contacts,
  events,
  busyAction,
  onAssignEvent,
  onMarkJunk,
  onMergeInto,
  onBulkAssignEvent,
  onBulkMarkJunk,
  onBulkMergeIntoColleagues,
  loading,
}: {
  contacts: ContactRow[];
  events: EventSummary[];
  busyAction: string | null;
  onAssignEvent: (contactId: number, eventId: number) => Promise<void>;
  onMarkJunk: (contactId: number) => Promise<void>;
  onMergeInto: (sourceId: number, targetId: number) => Promise<void>;
  onBulkAssignEvent: (ids: number[], eventId: number) => Promise<void>;
  onBulkMarkJunk: (ids: number[]) => Promise<void>;
  onBulkMergeIntoColleagues: (sources: Array<{ sourceId: number; targetId: number | null }>) => Promise<void>;
  loading: boolean;
}) {
  // Count by reason for the summary badges
  const reasonCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of contacts) {
      const r = c.attention_reason ?? "unknown";
      counts[r] = (counts[r] ?? 0) + 1;
    }
    return counts;
  }, [contacts]);

  // Multi-select state for bulk operations.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkEventId, setBulkEventId] = useState<string>("");
  // Anchor for shift-click range selection (last individually-clicked row).
  const [lastClickedId, setLastClickedId] = useState<number | null>(null);

  // Reset selection if the contact list changes underneath us (e.g. after a refresh).
  useEffect(() => {
    setSelectedIds((prev) => {
      const visible = new Set(contacts.map((c) => c.id));
      const next = new Set<number>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next;
    });
  }, [contacts]);

  const visibleIds = useMemo(() => contacts.map((c) => c.id), [contacts]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(visibleIds));
  };
  // Click handler supports shift-click range selection. If shiftKey is held
  // and there's a previous anchor, toggle every row between the anchor and
  // the current row to MATCH the current row's new state.
  const handleRowCheckboxClick = (id: number, e: React.MouseEvent<HTMLInputElement>) => {
    const shift = e.shiftKey;
    if (shift && lastClickedId !== null && lastClickedId !== id) {
      const startIdx = visibleIds.indexOf(lastClickedId);
      const endIdx = visibleIds.indexOf(id);
      if (startIdx !== -1 && endIdx !== -1) {
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const range = visibleIds.slice(from, to + 1);
        // Direction of toggle = opposite of current state for `id` BEFORE this click.
        // After this click, `id` will flip; we want the rest of the range to match.
        const willBeSelected = !selectedIds.has(id);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const rangeId of range) {
            if (willBeSelected) next.add(rangeId);
            else next.delete(rangeId);
          }
          return next;
        });
        setLastClickedId(id);
        return;
      }
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastClickedId(id);
  };

  const bulkBusy =
    busyAction === `bulk-assign-${selectedIds.size}` || busyAction === `bulk-junk-${selectedIds.size}`;

  if (loading) {
    return (
      <div className="p-12 flex items-center justify-center">
        <BraiinLoader />
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-zinc-500">
          No contacts need attention. Import from Airtable to surface any with missing email or event.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary badges */}
      <div className="flex flex-wrap gap-2 text-xs text-zinc-600">
        {Object.entries(reasonCounts).map(([reason, count]) => (
          <span
            key={reason}
            className={`px-2 py-1 rounded-full font-medium ${attentionReasonBadgeClass(reason)}`}
          >
            {count} {attentionReasonLabel(reason)}
          </span>
        ))}
      </div>

      {/* Bulk action bar - only visible when at least one row is selected */}
      {selectedIds.size > 0 && (
        <Card className="border-zinc-300 bg-zinc-50">
          <CardContent className="p-3 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-zinc-800">
              {selectedIds.size} selected
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-600">Assign to event:</span>
              <select
                value={bulkEventId}
                onChange={(e) => setBulkEventId(e.target.value)}
                className="px-2 py-1 text-xs border rounded-md bg-white max-w-[200px]"
                disabled={bulkBusy}
              >
                <option value="">Pick event...</option>
                {events.map((e) => (
                  <option key={e.event_id} value={String(e.event_id)}>
                    {e.event_name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={!bulkEventId || bulkBusy}
                onClick={async () => {
                  if (!bulkEventId) return;
                  await onBulkAssignEvent(
                    Array.from(selectedIds),
                    Number(bulkEventId),
                  );
                  setSelectedIds(new Set());
                  setBulkEventId("");
                }}
              >
                {busyAction === `bulk-assign-${selectedIds.size}`
                  ? "Assigning..."
                  : `Assign ${selectedIds.size}`}
              </Button>
            </div>
            <span className="text-zinc-300">|</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={bulkBusy}
              onClick={async () => {
                await onBulkMarkJunk(Array.from(selectedIds));
                setSelectedIds(new Set());
              }}
            >
              {busyAction === `bulk-junk-${selectedIds.size}`
                ? "Marking..."
                : `Mark ${selectedIds.size} as junk`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs ml-auto"
              onClick={() => setSelectedIds(new Set())}
              disabled={bulkBusy}
            >
              Clear selection
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                    className="cursor-pointer"
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead className="w-44">Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead className="w-52">Email</TableHead>
                <TableHead className="w-52">Reason</TableHead>
                <TableHead className="w-56 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((c) => {
                const displayName = toProperCase(c.name ?? c.email);
                const displayCompany = c.company ? toProperCase(c.company) : null;
                const isSynthesisedEmail = c.email.startsWith("noemail+");
                const reason = c.attention_reason ?? null;
                const needsEvent =
                  reason === "no_event" || (reason?.startsWith("unmapped_event:") ?? false);
                const needsEmail = reason === "no_email";

                return (
                  <TableRow
                    key={c.id}
                    className={selectedIds.has(c.id) ? "bg-blue-50/40" : ""}
                  >
                    <TableCell className="align-top">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.id)}
                        onClick={(e) => handleRowCheckboxClick(c.id, e)}
                        onChange={() => { /* handled by onClick to access shiftKey */ }}
                        className="cursor-pointer"
                        aria-label={`Select ${displayName}`}
                        title="Shift-click to select range"
                      />
                    </TableCell>
                    <TableCell className="font-medium align-top max-w-[12rem]">
                      <div className="truncate" title={displayName}>
                        {displayName}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm align-top max-w-[18rem]">
                      <div className="truncate" title={displayCompany ?? ""}>
                        {displayCompany ?? "-"}
                      </div>
                      {(c.co_company_contacts?.length ?? 0) > 0 && (
                        <div className="text-[11px] text-zinc-500 mt-0.5 leading-tight">
                          <span className="font-medium text-zinc-600">also at this company:</span>{" "}
                          {c.co_company_contacts!.map((cc, i) => (
                            <span key={cc.id}>
                              {i > 0 && ", "}
                              <span title={`${cc.email}${cc.event_name ? ` · ${cc.event_name}` : ""} · ${cc.follow_up_status}`}>
                                {toProperCase(cc.name ?? cc.email.split("@")[0])}
                                <span className="text-zinc-400">
                                  {" "}({cc.event_name ? cc.event_name.split(" ")[0] : "no event"}, {cc.follow_up_status})
                                </span>
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs align-top max-w-[14rem]">
                      {isSynthesisedEmail ? (
                        <span className="text-zinc-400 italic">(missing)</span>
                      ) : (
                        <span className="truncate block font-mono text-[11px]" title={c.email}>
                          {c.email}
                        </span>
                      )}
                      {/* Show conflicting colleague emails inline so the operator can see why a bulk-assign would collide */}
                      {(c.co_company_contacts?.some((cc) => cc.email === c.email) ?? false) && (
                        <div className="text-[10px] text-amber-700 mt-0.5">
                          shared mailbox with colleague
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <span
                        className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${attentionReasonBadgeClass(reason)}`}
                      >
                        {attentionReasonLabel(reason)}
                      </span>
                    </TableCell>
                    <TableCell className="align-top text-right">
                      <div className="flex justify-end items-center gap-2">
                        {needsEvent && (
                          <EventAssignDropdown
                            contactId={c.id}
                            events={events}
                            busy={busyAction === `assign-event-${c.id}`}
                            onAssign={onAssignEvent}
                          />
                        )}
                        {(c.co_company_contacts?.length ?? 0) > 0 && (
                          <select
                            className="px-2 py-1 text-xs border rounded-md bg-white max-w-[160px]"
                            disabled={busyAction === `merge-${c.id}`}
                            value=""
                            onChange={(e) => {
                              const targetId = parseInt(e.target.value, 10);
                              if (targetId) onMergeInto(c.id, targetId);
                            }}
                          >
                            <option value="">Merge into...</option>
                            {c.co_company_contacts!.map((cc) => (
                              <option key={cc.id} value={String(cc.id)}>
                                {(cc.name ?? cc.email.split("@")[0]).slice(0, 30)} ({cc.event_name?.split(" ")[0] ?? "no event"})
                              </option>
                            ))}
                          </select>
                        )}
                        {needsEmail && (
                          <>
                            <a
                              href="https://airtable.com"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 underline"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Edit in Airtable
                            </a>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              disabled={busyAction === `junk-${c.id}`}
                              onClick={() => onMarkJunk(c.id)}
                            >
                              {busyAction === `junk-${c.id}` ? "..." : "Mark junk"}
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function EventAssignDropdown({
  contactId,
  events,
  busy,
  onAssign,
}: {
  contactId: number;
  events: EventSummary[];
  busy: boolean;
  onAssign: (contactId: number, eventId: number) => Promise<void>;
}) {
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  return (
    <div className="flex items-center gap-1">
      <select
        value={selectedEventId}
        onChange={(e) => setSelectedEventId(e.target.value)}
        className="px-2 py-1 text-xs border rounded-md bg-white max-w-[140px]"
        disabled={busy}
      >
        <option value="">Pick event...</option>
        {events.map((e) => (
          <option key={e.event_id} value={String(e.event_id)}>
            {e.event_name}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        className="h-7 text-xs"
        disabled={!selectedEventId || busy}
        onClick={() => {
          if (selectedEventId) {
            onAssign(contactId, Number(selectedEventId));
          }
        }}
      >
        {busy ? "..." : "Assign"}
      </Button>
    </div>
  );
}

const REP_OPTIONS = [
  { email: "rob.donald@cortenlogistics.com", label: "Rob" },
  { email: "sam.yauner@cortenlogistics.com", label: "Sam" },
  { email: "bruna.natale@cortenlogistics.com", label: "Bruna" },
];

async function patchContact(
  contactId: number,
  fields: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/event-followup/contacts", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: contactId, ...fields }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data.error };
  return { ok: true };
}

function ExpandedDraft({
  contact,
  onSave,
  onRedraft,
  onRedraftWithFeedback,
  busyAction,
  onChanged,
}: {
  contact: ContactRow;
  onSave: (id: number, subject: string, body: string) => Promise<void>;
  onRedraft: (id: number) => Promise<void>;
  onRedraftWithFeedback: (id: number, feedback: string, previousDraft: string) => Promise<void>;
  busyAction: string | null;
  onChanged: () => Promise<void>;
}) {
  const [subject, setSubject] = useState(contact.draft_subject ?? "");
  const [body, setBody] = useState(contact.draft_body ?? "");
  const [sendFrom, setSendFrom] = useState(
    contact.send_from_email ?? "rob.donald@cortenlogistics.com",
  );
  const [feedback, setFeedback] = useState("");
  const [savingFrom, setSavingFrom] = useState(false);
  const [fromErr, setFromErr] = useState<string | null>(null);

  // Editable context fields. Initialised from the contact, persisted on blur.
  const [metBy, setMetBy] = useState<string[]>(contact.met_by ?? []);
  const [meetingNotes, setMeetingNotes] = useState(contact.meeting_notes ?? "");
  const [companyInfo, setCompanyInfo] = useState(contact.company_info ?? "");
  const [tier, setTier] = useState<number | null>(contact.tier);

  useEffect(() => {
    setSubject(contact.draft_subject ?? "");
    setBody(contact.draft_body ?? "");
    setSendFrom(contact.send_from_email ?? "rob.donald@cortenlogistics.com");
    setMetBy(contact.met_by ?? []);
    setMeetingNotes(contact.meeting_notes ?? "");
    setCompanyInfo(contact.company_info ?? "");
    setTier(contact.tier);
    setFeedback("");
  }, [contact.id, contact.draft_subject, contact.draft_body, contact.send_from_email, contact.met_by, contact.meeting_notes, contact.company_info, contact.tier]);

  const autoCcLabels = REP_OPTIONS
    .filter((r) => r.email !== sendFrom)
    .map((r) => r.label);

  async function changeSender(newEmail: string) {
    setSendFrom(newEmail);
    setSavingFrom(true);
    setFromErr(null);
    const result = await patchContact(contact.id, { send_from_email: newEmail });
    setSavingFrom(false);
    if (!result.ok) {
      setFromErr(result.error ?? "Save failed");
      setSendFrom(contact.send_from_email ?? "rob.donald@cortenlogistics.com");
    } else {
      await onChanged();
    }
  }

  async function toggleMetBy(value: string) {
    const next = metBy.includes(value)
      ? metBy.filter((v) => v !== value)
      : [...metBy, value];
    setMetBy(next);
    // Auto-update send_from_email if a person was newly ticked or the
    // current sender was un-ticked.
    let newSendFrom = sendFrom;
    const firstPerson = next.find((v) => NAME_TO_EMAIL[v]);
    if (firstPerson) {
      const personEmail = NAME_TO_EMAIL[firstPerson];
      // Only override if the current sender is NOT already in the new list.
      const currentInList = next.some((v) => NAME_TO_EMAIL[v] === sendFrom);
      if (!currentInList) {
        newSendFrom = personEmail;
        setSendFrom(personEmail);
      }
    }
    const result = await patchContact(contact.id, {
      met_by: next,
      send_from_email: newSendFrom,
    });
    if (!result.ok) setFromErr(result.error ?? "Save failed");
    else await onChanged();
  }

  async function saveContextField(field: string, value: unknown) {
    const result = await patchContact(contact.id, { [field]: value });
    if (!result.ok) setFromErr(result.error ?? "Save failed");
    else await onChanged();
  }

  const draftBusy = busyAction === `draft-one-${contact.id}` || busyAction === `feedback-${contact.id}`;

  return (
    <div className="p-4 space-y-6 w-full">
      {/* === CONTACT CONTEXT (no inner card - flat layout for max width) === */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between border-b pb-2">
          <h4 className="text-sm font-semibold uppercase tracking-wide">Contact context</h4>
          <span className="text-xs text-zinc-500">{contact.email}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <ContextStat label="Name" value={contact.name} />
          <ContextStat label="Title" value={contact.title} />
          <ContextStat label="Company" value={contact.company} />
          <ContextStat label="Type" value={contact.company_type} />
          <ContextStat label="Country" value={contact.country} />
          <ContextStat label="Region" value={contact.region} />
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">Tier</div>
            <select
              value={tier ?? ""}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : null;
                setTier(v);
                saveContextField("tier", v);
              }}
              className="mt-1 px-2 py-1 text-sm border rounded-md w-full"
            >
              <option value="">-</option>
              <option value={1}>1 (A+)</option>
              <option value={2}>2 (A)</option>
              <option value={3}>3 (B)</option>
              <option value={4}>4 (C)</option>
              <option value={5}>5 (D)</option>
            </select>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">Status</div>
            <div className="mt-1">
              <Badge className={STATUS_TONE[contact.follow_up_status] ?? "bg-zinc-100"}>
                {contact.follow_up_status}
              </Badge>
            </div>
          </div>
        </div>
        {contact.engagement_summary && (
          <div className="text-xs text-zinc-600 border-t pt-2">
            <span className="font-medium">Engagement:</span> {contact.engagement_summary}
          </div>
        )}

        {/* Met By multi-select */}
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">
            Met by (tick everyone who was there)
          </div>
          <div className="flex flex-wrap gap-2">
            {MET_BY_OPTIONS.map((opt) => {
              const ticked = metBy.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleMetBy(opt.value)}
                  className={`px-2 py-1 text-xs rounded-md border transition ${
                    ticked
                      ? opt.isPerson
                        ? "bg-emerald-100 border-emerald-400 text-emerald-800"
                        : "bg-zinc-200 border-zinc-400 text-zinc-700"
                      : "bg-white border-zinc-300 text-zinc-500 hover:border-zinc-500"
                  }`}
                >
                  {ticked ? "✓ " : ""}{opt.label}
                  {!opt.isPerson && <span className="ml-1 text-[10px] opacity-70">(source)</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Meeting notes editor */}
        <div>
          <label className="block text-xs uppercase tracking-wide text-zinc-500">
            Meeting notes (what was discussed - the AI uses this verbatim)
          </label>
          <textarea
            value={meetingNotes}
            onChange={(e) => setMeetingNotes(e.target.value)}
            onBlur={() => {
              if (meetingNotes !== (contact.meeting_notes ?? "")) {
                saveContextField("meeting_notes", meetingNotes || null);
              }
            }}
            rows={3}
            placeholder="What was discussed at the booth, lanes mentioned, follow-up commitments. Edit freely - saved on blur."
            className="w-full mt-1 px-3 py-2 text-sm border rounded-md"
          />
        </div>

        {/* Company info editor */}
        <div>
          <label className="block text-xs uppercase tracking-wide text-zinc-500">
            Company info (background, used by AI for awareness)
          </label>
          <textarea
            value={companyInfo}
            onChange={(e) => setCompanyInfo(e.target.value)}
            onBlur={() => {
              if (companyInfo !== (contact.company_info ?? "")) {
                saveContextField("company_info", companyInfo || null);
              }
            }}
            rows={2}
            placeholder="Anything about the company - their lanes, scale, focus."
            className="w-full mt-1 px-3 py-2 text-sm border rounded-md"
          />
        </div>
      </div>

      {/* === SENDER + DRAFT (flat) === */}
      <div className="space-y-3">
        <div className="border-b pb-2">
          <h4 className="text-sm font-semibold uppercase tracking-wide">Draft</h4>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Send from</span>
          <select
            value={sendFrom}
            onChange={(e) => changeSender(e.target.value)}
            disabled={savingFrom}
            className="px-2 py-1 text-sm border rounded-md"
          >
            {REP_OPTIONS.map((r) => (
              <option key={r.email} value={r.email}>
                {r.label} ({r.email})
              </option>
            ))}
          </select>
          <span className="text-xs text-zinc-500">
            CC on send: {autoCcLabels.join(", ")} + any Internal CC
          </span>
          {savingFrom && <span className="text-xs text-zinc-400">saving...</span>}
        </div>
        {fromErr && <div className="text-xs text-red-700">{fromErr}</div>}

        {!contact.draft_body ? (
          <div className="text-sm text-zinc-500">
            No draft yet. Click &quot;Draft&quot; to generate.
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs uppercase tracking-wide text-zinc-500">Subject</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide text-zinc-500">Body</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md font-mono"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRedraft(contact.id)}
                disabled={draftBusy}
              >
                {busyAction === `draft-one-${contact.id}` ? "Regenerating..." : "Regenerate from scratch"}
              </Button>
              <Button
                size="sm"
                onClick={() => onSave(contact.id, subject, body)}
                disabled={busyAction === `save-${contact.id}`}
              >
                {busyAction === `save-${contact.id}` ? "Saving..." : "Save edit"}
              </Button>
            </div>

            {/* Feedback to AI */}
            <div className="border-t pt-3">
              <label className="block text-xs uppercase tracking-wide text-zinc-500">
                Feedback for the AI (regenerate with these instructions)
              </label>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={2}
                placeholder="e.g. Make it shorter. Mention the Brazil reefer angle. Drop the apology. Lead with the UK->India lane."
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md"
              />
              <div className="flex justify-end mt-2">
                <Button
                  size="sm"
                  onClick={() => {
                    if (feedback.trim()) {
                      onRedraftWithFeedback(contact.id, feedback.trim(), body);
                      setFeedback("");
                    }
                  }}
                  disabled={!feedback.trim() || draftBusy}
                >
                  {busyAction === `feedback-${contact.id}` ? "Regenerating..." : "Regenerate with feedback"}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ContextStat({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-sm mt-0.5">{value ?? <span className="text-zinc-400">-</span>}</div>
    </div>
  );
}
