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
  company: string | null;
  country: string | null;
  tier: number | null;
  met_by: string[] | null;
  follow_up_status: string;
  draft_subject: string | null;
  draft_body: string | null;
  send_from_email: string | null;
  engagement_summary: string | null;
  last_inbound_at: string | null;
  sent_at: string | null;
  events: { id: number; name: string } | null;
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
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

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

  useEffect(() => {
    loadEvents();
  }, []);

  useEffect(() => {
    if (selectedEventId) loadContacts(selectedEventId);
  }, [selectedEventId]);

  const filtered = useMemo(() => {
    if (!contacts) return [];
    const q = search.toLowerCase().trim();
    return contacts
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
        `Imported ${r.imported} contacts (${r.fetched} fetched, ${r.skipped} skipped).`,
      ];
      if (r.skip_reasons && Object.keys(r.skip_reasons).length > 0) {
        const reasonStr = Object.entries(r.skip_reasons as Record<string, number>)
          .map(([reason, count]) => `${count} ${reason}`)
          .join(", ");
        parts.push(`Skip reasons: ${reasonStr}.`);
      }
      if (r.errors && r.errors.length > 0) {
        parts.push(`Errors: ${r.errors.slice(0, 3).join("; ")}${r.errors.length > 3 ? ` (+${r.errors.length - 3} more)` : ""}`);
      }
      setActionResult(parts.join(" "));

      await loadEvents();
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
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
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
          onClick={() => selectedEventId && loadContacts(selectedEventId)}
        >
          <RefreshCw className="h-4 w-4 mr-1" /> Reload
        </Button>
      </div>

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
                  <TableHead className="w-16">Tier</TableHead>
                  <TableHead className="w-32">Met by</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead className="w-40">Engagement</TableHead>
                  <TableHead className="w-44 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => {
                  const isExpanded = expandedId === c.id;
                  const repFirst = c.send_from_email
                    ? c.send_from_email.split("@")[0].split(".")[0]
                    : c.met_by?.[0]?.split("@")[0].split(".")[0] ?? "—";
                  return (
                    <>
                      <TableRow
                        key={c.id}
                        onClick={() => setExpandedId(isExpanded ? null : c.id)}
                        className="cursor-pointer"
                      >
                        <TableCell className="font-medium">
                          {c.name ?? c.email}
                        </TableCell>
                        <TableCell className="text-sm">{c.company ?? "—"}</TableCell>
                        <TableCell>
                          {c.tier ? (
                            <Badge className="bg-zinc-200 text-zinc-800">{c.tier}</Badge>
                          ) : (
                            <span className="text-zinc-400 text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm capitalize">{repFirst}</TableCell>
                        <TableCell>
                          <Badge className={STATUS_TONE[c.follow_up_status] ?? "bg-zinc-100"}>
                            {c.follow_up_status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-zinc-600">
                          {c.engagement_summary ?? (c.last_inbound_at ? "had inbound" : "—")}
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
                          <TableCell colSpan={7} className="bg-zinc-50">
                            <ExpandedDraft
                              contact={c}
                              onSave={saveDraftEdit}
                              onRedraft={draftOne}
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
  busyAction,
  onChanged,
}: {
  contact: ContactRow;
  onSave: (id: number, subject: string, body: string) => Promise<void>;
  onRedraft: (id: number) => Promise<void>;
  busyAction: string | null;
  onChanged: () => Promise<void>;
}) {
  const [subject, setSubject] = useState(contact.draft_subject ?? "");
  const [body, setBody] = useState(contact.draft_body ?? "");
  const [sendFrom, setSendFrom] = useState(
    contact.send_from_email ?? "rob.donald@cortenlogistics.com",
  );
  const [savingFrom, setSavingFrom] = useState(false);
  const [fromErr, setFromErr] = useState<string | null>(null);

  useEffect(() => {
    setSubject(contact.draft_subject ?? "");
    setBody(contact.draft_body ?? "");
    setSendFrom(contact.send_from_email ?? "rob.donald@cortenlogistics.com");
  }, [contact.id, contact.draft_subject, contact.draft_body, contact.send_from_email]);

  // Compute auto-CC list (the OTHER two Corten reps + nothing else here -
  // internal_cc isn't shown in the contact row but the send route will add it
  // automatically). UI is informational; the actual CC is built server-side
  // at send time.
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
      // revert local state
      setSendFrom(contact.send_from_email ?? "rob.donald@cortenlogistics.com");
    } else {
      await onChanged();
    }
  }

  if (!contact.draft_body) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-3 text-sm">
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
            CC: {autoCcLabels.join(", ")}
          </span>
        </div>
        {fromErr && <div className="text-xs text-red-700">{fromErr}</div>}
        <div className="text-sm text-zinc-500">
          No draft yet. Click &quot;Draft&quot; to generate.
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
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
          CC on send: {autoCcLabels.join(", ")} + any Internal CC from Airtable
        </span>
        {savingFrom && <span className="text-xs text-zinc-400">saving...</span>}
      </div>
      {fromErr && <div className="text-xs text-red-700">{fromErr}</div>}
      <div>
        <label className="text-xs uppercase tracking-wide text-zinc-500">Subject</label>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full mt-1 px-3 py-2 text-sm border rounded-md"
        />
      </div>
      <div>
        <label className="text-xs uppercase tracking-wide text-zinc-500">Body</label>
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
          disabled={busyAction === `draft-one-${contact.id}`}
        >
          {busyAction === `draft-one-${contact.id}` ? "Regenerating..." : "Regenerate"}
        </Button>
        <Button
          size="sm"
          onClick={() => onSave(contact.id, subject, body)}
          disabled={busyAction === `save-${contact.id}`}
        >
          {busyAction === `save-${contact.id}` ? "Saving..." : "Save edit"}
        </Button>
      </div>
    </div>
  );
}
