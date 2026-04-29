"use client";

/**
 * /events
 *
 * Events directory + per-event ROI cards. Operator surface for adding new
 * events (trade shows, conferences, network meetings) with currency-aware
 * cost tracking. ROI rolls up from event_contacts -> deals.attributed_event_contact_id.
 *
 * Auth: PageGuard (manager+).
 */

import { useEffect, useMemo, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageGuard } from "@/components/page-guard";
import { BraiinLoader } from "@/components/braiin-loader";
import { Plus, RefreshCw, ExternalLink, Pencil, X, Save, Trophy } from "lucide-react";

interface MediaRow {
  id: number;
  signed_url: string | null;
  caption: string | null;
}

type Currency = "GBP" | "USD" | "EUR";
type EventType = "trade_show" | "conference" | "network_meeting" | "agm" | "other";

interface EventRow {
  id: number;
  name: string;
  event_type: EventType;
  start_date: string;
  end_date: string | null;
  location: string | null;
  via_network_id: number | null;
  cost_amount: number | null;
  cost_currency: Currency;
  attendees: string[];
  notes: string | null;
  context_brief: string | null;
  active: boolean;
}

interface EventSummary {
  contacts: number;
  sent: number;
  replied: number;
  bounced: number;
  deal_count: number;
  revenue_gbp: number;
  cost_gbp: number | null;
  roi_gbp: number | null;
}

interface NetworkLite {
  id: number;
  name: string;
}

const TYPE_LABEL: Record<EventType, string> = {
  trade_show: "Trade show",
  conference: "Conference",
  network_meeting: "Network meeting",
  agm: "AGM",
  other: "Other",
};

const TYPE_TONE: Record<EventType, string> = {
  trade_show: "bg-violet-100 text-violet-700",
  conference: "bg-blue-100 text-blue-700",
  network_meeting: "bg-emerald-100 text-emerald-700",
  agm: "bg-amber-100 text-amber-700",
  other: "bg-zinc-100 text-zinc-700",
};

const formatMoney = (amount: number | null, currency: Currency) =>
  amount == null
    ? "-"
    : new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(amount);

const formatGBP = (v: number | null) =>
  v == null
    ? "-"
    : new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 0,
      }).format(v);

const formatDateRange = (start: string, end: string | null) => {
  const s = new Date(start).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  if (!end || end === start) return s;
  const e = new Date(end).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${s} - ${e}`;
};

export default function EventsPage() {
  return (
    <PageGuard pageId="events">
      <Inner />
    </PageGuard>
  );
}

function Inner() {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [summaries, setSummaries] = useState<Record<number, EventSummary>>({});
  const [networks, setNetworks] = useState<NetworkLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EventRow | "new" | null>(null);

  async function load() {
    try {
      const [eventsRes, networksRes] = await Promise.all([
        fetch("/api/events"),
        fetch("/api/networks"),
      ]);
      const eventsData = await eventsRes.json();
      const networksData = await networksRes.json();
      if (!eventsRes.ok) throw new Error(eventsData.error || "Events load failed");
      if (!networksRes.ok) throw new Error(networksData.error || "Networks load failed");
      setEvents(eventsData.events || []);
      setSummaries(eventsData.summaries || {});
      setNetworks(
        (networksData.networks || []).map((n: { id: number; name: string }) => ({
          id: n.id,
          name: n.name,
        })),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
      setEvents([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const networkNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const n of networks) m.set(n.id, n.name);
    return m;
  }, [networks]);

  if (events === null) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <BraiinLoader />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 w-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Trophy className="h-6 w-6" /> Events
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Trade shows, conferences, and network meetings - with multi-currency cost tracking + ROI rollup from contacts and deals.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4 mr-1" /> Add event
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-800">{error}</CardContent>
        </Card>
      )}

      {editing && (
        <EditForm
          existing={editing === "new" ? null : editing}
          networks={networks}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {events.length === 0 ? (
          <Card className="lg:col-span-2">
            <CardContent className="p-8 text-center text-sm text-zinc-500">
              No events yet. Click &quot;Add event&quot; to create one.
            </CardContent>
          </Card>
        ) : (
          events.map((e) => {
            const summary = summaries[e.id];
            const networkName = e.via_network_id
              ? networkNameById.get(e.via_network_id) ?? "(unknown)"
              : null;
            return (
              <Card key={e.id} className={!e.active ? "opacity-50" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{e.name}</CardTitle>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {formatDateRange(e.start_date, e.end_date)}
                        {e.location && ` · ${e.location}`}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Badge className={TYPE_TONE[e.event_type]}>{TYPE_LABEL[e.event_type]}</Badge>
                      {networkName && (
                        <Badge className="bg-zinc-100 text-zinc-700">via {networkName}</Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <Stat
                      label="Cost"
                      value={formatMoney(e.cost_amount, e.cost_currency)}
                      sub={
                        summary?.cost_gbp != null && e.cost_currency !== "GBP"
                          ? `${formatGBP(summary.cost_gbp)} GBP`
                          : null
                      }
                    />
                    <Stat
                      label="Contacts"
                      value={summary ? String(summary.contacts) : "0"}
                      sub={summary ? `${summary.sent} sent · ${summary.replied} replied` : null}
                    />
                    <Stat
                      label="Revenue"
                      value={formatGBP(summary?.revenue_gbp ?? 0)}
                      sub={summary ? `${summary.deal_count} deal${summary.deal_count === 1 ? "" : "s"}` : null}
                    />
                  </div>
                  <div className="border-t pt-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-zinc-500">ROI (GBP)</div>
                      <div
                        className={`text-2xl font-semibold ${
                          summary?.roi_gbp == null
                            ? "text-zinc-400"
                            : summary.roi_gbp >= 0
                              ? "text-emerald-700"
                              : "text-red-700"
                        }`}
                      >
                        {summary?.roi_gbp != null ? formatGBP(summary.roi_gbp) : "Set cost to compute"}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {e.notes && (
                        <Button size="sm" variant="outline" disabled className="text-xs">
                          {e.notes.length > 30 ? `${e.notes.slice(0, 30)}...` : e.notes}
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setEditing(e)}>
                        <Pencil className="h-3 w-3 mr-1" /> Edit
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string | null;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-base font-medium">{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function EditForm({
  existing,
  networks,
  onCancel,
  onSaved,
}: {
  existing: EventRow | null;
  networks: NetworkLite[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [eventType, setEventType] = useState<EventType>(existing?.event_type ?? "trade_show");
  const [startDate, setStartDate] = useState(existing?.start_date ?? "");
  const [endDate, setEndDate] = useState(existing?.end_date ?? "");
  const [location, setLocation] = useState(existing?.location ?? "");
  const [viaNetworkId, setViaNetworkId] = useState<number | null>(existing?.via_network_id ?? null);
  const [costAmount, setCostAmount] = useState<number | null>(existing?.cost_amount ?? null);
  const [costCurrency, setCostCurrency] = useState<Currency>(existing?.cost_currency ?? "GBP");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [contextBrief, setContextBrief] = useState(existing?.context_brief ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Photo uploader state
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadMedia() {
    if (!existing?.id) return;
    try {
      const res = await fetch(`/api/event-media?event_id=${existing.id}`);
      const data = await res.json();
      if (res.ok) setMedia((data.media ?? []).slice(0, 3));
    } catch {
      // non-fatal - media strip just stays empty
    }
  }

  useEffect(() => {
    loadMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id]);

  async function uploadPhoto() {
    if (!selectedFile || !existing?.id) return;
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const fd = new FormData();
      fd.append("event_id", String(existing.id));
      fd.append("file", selectedFile);
      if (caption.trim()) fd.append("caption", caption.trim());
      const res = await fetch("/api/event-media", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setUploadSuccess("Uploaded.");
      setSelectedFile(null);
      setCaption("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadMedia();
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setErr(null);
    if (!name.trim() || !startDate) {
      setErr("Name and start date are required");
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      name: name.trim(),
      event_type: eventType,
      start_date: startDate,
      end_date: endDate || null,
      location: location.trim() || null,
      via_network_id: viaNetworkId,
      cost_amount: costAmount,
      cost_currency: costCurrency,
      notes: notes.trim() || null,
      context_brief: contextBrief.trim() || null,
    };
    if (existing) payload.id = existing.id;
    const res = await fetch("/api/events", {
      method: existing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error || "Save failed");
      return;
    }
    onSaved();
  }

  return (
    <Card className="border-zinc-900">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{existing ? "Edit event" : "New event"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs uppercase tracking-wide text-zinc-500">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Intermodal Europe 2026"
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-zinc-500">Event type</label>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value as EventType)}
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md"
            >
              <option value="trade_show">Trade show</option>
              <option value="conference">Conference</option>
              <option value="network_meeting">Network meeting</option>
              <option value="agm">AGM</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-zinc-500">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-zinc-500">End date (optional)</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-zinc-500">Location</label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Sao Paulo, Brazil"
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-zinc-500">Via network (optional)</label>
            <select
              value={viaNetworkId ?? ""}
              onChange={(e) => setViaNetworkId(e.target.value ? Number(e.target.value) : null)}
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md"
            >
              <option value="">Standalone (no network)</option>
              {networks.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-zinc-500">Cost amount</label>
            <input
              type="number"
              step="1"
              value={costAmount ?? ""}
              onChange={(e) => setCostAmount(e.target.value ? Number(e.target.value) : null)}
              placeholder="e.g. 8500"
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-zinc-500">Cost currency</label>
            <select
              value={costCurrency}
              onChange={(e) => setCostCurrency(e.target.value as Currency)}
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md"
            >
              <option value="GBP">GBP (British Pound)</option>
              <option value="USD">USD (US Dollar)</option>
              <option value="EUR">EUR (Euro)</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-zinc-500">Notes (internal)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything internal worth remembering - not used by the AI."
            className="w-full mt-1 px-3 py-2 text-sm border rounded-md min-h-[60px]"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-zinc-500">
            Context brief for AI drafts
          </label>
          <p className="text-xs text-zinc-500 mt-0.5">
            Free-text. The AI uses this in EVERY follow-up draft for this event. Tell it the
            angle: stand position, focus lanes, what we&apos;re hunting for, what we offer.
          </p>
          <textarea
            value={contextBrief}
            onChange={(e) => setContextBrief(e.target.value)}
            placeholder="e.g. We were on the WCA stand. Main focus: signing up LATAM partners for Brazil-bound reefer volumes. Sam was hunting for Vietnam capacity. Open to UK-bound consols from anywhere."
            className="w-full mt-1 px-3 py-2 text-sm border rounded-md min-h-[100px]"
          />
        </div>
        {err && <div className="text-sm text-red-700">{err}</div>}

        {existing?.id && (
          <div className="space-y-3 border-t pt-4">
            <h4 className="text-sm font-semibold uppercase tracking-wide">Event photos</h4>
            <p className="text-xs text-zinc-500">
              Up to 3 images per event are passed to the AI as visual context for draft generation. Max 2MB each.
            </p>
            <div className="flex gap-3 flex-wrap">
              {media.map((m) => (
                <figure key={m.id} className="w-32">
                  <img
                    src={m.signed_url ?? ""}
                    alt={m.caption ?? "event photo"}
                    className="w-32 h-32 object-cover rounded border"
                  />
                  <figcaption
                    className="text-xs text-zinc-600 mt-1 truncate"
                    title={m.caption ?? ""}
                  >
                    {m.caption ?? "untitled"}
                  </figcaption>
                </figure>
              ))}
              {media.length === 0 && (
                <div className="text-xs text-zinc-400">No photos yet.</div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
              <input
                type="text"
                placeholder="Caption (optional)"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                className="px-2 py-1 text-sm border rounded"
              />
              <Button
                size="sm"
                onClick={uploadPhoto}
                disabled={!selectedFile || uploading}
              >
                {uploading ? "Uploading..." : "Upload"}
              </Button>
            </div>
            {uploadError && <div className="text-xs text-red-700">{uploadError}</div>}
            {uploadSuccess && <div className="text-xs text-emerald-700">{uploadSuccess}</div>}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            <X className="h-3 w-3 mr-1" /> Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            <Save className="h-3 w-3 mr-1" />
            {saving ? "Saving..." : existing ? "Save" : "Create"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
