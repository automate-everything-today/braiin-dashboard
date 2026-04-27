"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageGuard } from "@/components/page-guard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw } from "lucide-react";
import {
  inferCarrierFromMawb as inferAirline,
  inferCarrierFromMbol as inferOceanCarrier,
  inferOwnerFromContainerNumber as inferContainerOwner,
} from "@/lib/tms/cargowise/carrier-lookup";

interface RecentEvent {
  event_id: string;
  provider_id: string;
  event_type: string;
  event_time: string | null;
  received_at: string;
  client_reference: string | null;
  tms_ref: string | null;
  tms_ref_type: string | null;
  status: string;
  error_message: string | null;
}

interface RecentSubscription {
  subscription_id: string;
  provider_id: string;
  tms_ref: string;
  tms_ref_type: string;
  carrier_code: string | null;
  transport_mode: string | null;
  client_reference: string;
  status: string;
  rejection_reason: string | null;
  created_at: string;
  acknowledged_at: string | null;
  rejected_at: string | null;
}

interface ConnectionRow {
  connection_id: string;
  provider_id: string;
  name: string;
  auth_method: string;
  enabled: boolean;
  created_at: string;
}

interface AuditCall {
  call_id: string;
  operation: string;
  requested_by: string;
  request_summary: string | null;
  requested_at: string;
  duration_ms: number | null;
  status: string;
  http_status: number | null;
  error_message: string | null;
}

interface FetchedShipment {
  providerId: string;
  tmsRef: string;
  tmsRefType: string;
  jobNumber?: string;
  consolNumber?: string;
  mbolNumber?: string;
  hbolNumber?: string;
  transportMode: string | null;
  containerMode: string | null;
  origin?: { unlocode?: string };
  destination?: { unlocode?: string };
  carrierCode?: string;
  carrierName?: string;
  vesselName?: string;
  voyageNumber?: string;
  eta?: string;
  etd?: string;
  ata?: string;
  atd?: string;
}

interface StatusResp {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

const EVENT_BADGE: Record<string, string> = {
  IRA: "bg-emerald-100 text-emerald-800",
  IRJ: "bg-rose-100 text-rose-800",
  ARV: "bg-blue-100 text-blue-800",
  DEP: "bg-blue-100 text-blue-800",
  GIN: "bg-violet-100 text-violet-800",
  GOU: "bg-violet-100 text-violet-800",
  FLO: "bg-cyan-100 text-cyan-800",
  FUL: "bg-cyan-100 text-cyan-800",
  PARSE_FAILED: "bg-rose-100 text-rose-800",
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  acknowledged: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
  cancelled: "bg-zinc-100 text-zinc-700",
  parsed: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
  received: "bg-zinc-100 text-zinc-700",
};

function fmtMaybeTime(iso: string | undefined): string {
  return iso ? fmtTime(iso) : "";
}

function Field({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="border-l-2 border-zinc-200 pl-2">
      <div className="text-zinc-500 text-[10px] uppercase tracking-wide">{label}</div>
      <div className={mono ? "font-mono" : ""}>{value || "-"}</div>
    </div>
  );
}

function fmtTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { hour12: false });
}

export default function DevCargowisePage() {
  const [events, setEvents] = useState<RecentEvent[]>([]);
  const [subs, setSubs] = useState<RecentSubscription[]>([]);
  const [conns, setConns] = useState<ConnectionRow[]>([]);
  const [outboundCalls, setOutboundCalls] = useState<AuditCall[]>([]);
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch shipment form
  const [fetchTarget, setFetchTarget] = useState<"ForwardingShipment" | "ForwardingConsol" | "CustomsDeclaration">("ForwardingShipment");
  const [fetchKey, setFetchKey] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchedShipment, setFetchedShipment] = useState<FetchedShipment | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // subscribe form
  type RefType = "mbol" | "awb" | "container" | "booking";
  const [tmsRef, setTmsRef] = useState("");
  const [tmsRefType, setTmsRefType] = useState<RefType>("mbol");
  const [carrierCode, setCarrierCode] = useState("");
  const [carrierName, setCarrierName] = useState<string | null>(null);
  const [transportMode, setTransportMode] = useState<"SEA" | "AIR" | "">("SEA");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  // Auto-detect carrier from MBOL/MAWB/container prefix client-side.
  // Tables are bundled with the page module; no API roundtrip.
  useEffect(() => {
    if (!tmsRef.trim()) {
      setCarrierName(null);
      return;
    }
    const cleaned = tmsRef.trim().toUpperCase();
    let inferred: { code: string; name: string } | null = null;
    if (tmsRefType === "mbol") {
      inferred = inferOceanCarrier(cleaned);
    } else if (tmsRefType === "awb") {
      inferred = inferAirline(cleaned);
    } else if (tmsRefType === "container") {
      inferred = inferContainerOwner(cleaned);
    }
    if (inferred && !carrierCode) {
      setCarrierCode(inferred.code);
    }
    setCarrierName(inferred?.name ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmsRef, tmsRefType]);

  const refLabel: Record<RefType, string> = {
    mbol: "Master Bill (MBOL)",
    awb: "Master Air Waybill (MAWB)",
    container: "Container number",
    booking: "Booking ref (SI / SO / SE / PO)",
  };
  const refPlaceholder: Record<RefType, string> = {
    mbol: "MAEU224278608",
    awb: "020-12345678",
    container: "TRHU1919450",
    booking: "BKG-12345 / SI-9876",
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, s] = await Promise.all([
        fetch("/api/dev/cargowise-recent").then((x) => x.json()),
        fetch("/api/dev/cargowise-status").then((x) => x.json()),
      ]);
      if (r.error) setError(r.error);
      else {
        setEvents(r.events ?? []);
        setSubs(r.subscriptions ?? []);
        setConns(r.connections ?? []);
        setOutboundCalls(r.outboundCalls ?? []);
      }
      if (s.error) setStatus({ ok: false, message: s.error });
      else setStatus(s);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Fetch error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  const fetchShipment = async () => {
    if (!fetchKey.trim()) return;
    setFetching(true);
    setFetchError(null);
    setFetchedShipment(null);
    try {
      const r = await fetch("/api/dev/cargowise-fetch-shipment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataTargetType: fetchTarget, key: fetchKey.trim() }),
      });
      const d = await r.json();
      if (!r.ok) {
        setFetchError(d.error ?? `HTTP ${r.status}`);
      } else {
        setFetchedShipment(d.shipment ?? null);
      }
      refresh();
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setFetching(false);
    }
  };

  const submit = async () => {
    if (!tmsRef.trim()) {
      setSubmitMsg("Reference is required");
      return;
    }
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const r = await fetch("/api/dev/cargowise-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmsRef: tmsRef.trim(),
          tmsRefType,
          carrierCode: carrierCode.trim() || undefined,
          transportMode: transportMode || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setSubmitMsg(d.error ?? `HTTP ${r.status}`);
      } else {
        setSubmitMsg(`Subscription ${d.status} - ref=${d.clientReference.slice(0, 8)}...`);
        setTmsRef("");
        refresh();
      }
    } catch (e: unknown) {
      setSubmitMsg(e instanceof Error ? e.message : "Subscribe failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageGuard pageId="dev_cargowise">
      <div className="container mx-auto py-8 max-w-7xl px-4">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Cargowise TMS - Dev Smoke Test</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Last 50 events from{" "}
              <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-xs">tms.events</code>{" "}
              and subscriptions from{" "}
              <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-xs">tms.subscriptions</code>.
              Auto-refreshes every 10 seconds.
            </p>
          </div>
          <Button onClick={refresh} disabled={loading} size="sm" variant="outline">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            <span className="ml-1.5">Refresh</span>
          </Button>
        </div>

        {error && (
          <Card className="mb-4 border-rose-200 bg-rose-50">
            <CardContent className="pt-4 text-sm text-rose-800">{error}</CardContent>
          </Card>
        )}

        {/* Status row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Cargo Visibility auth</CardTitle>
            </CardHeader>
            <CardContent>
              {status === null ? (
                <span className="text-zinc-400 text-sm">checking...</span>
              ) : status.ok ? (
                <div>
                  <Badge className="bg-emerald-100 text-emerald-800">OK</Badge>
                  <p className="text-xs text-zinc-500 mt-2">{status.message}</p>
                </div>
              ) : (
                <div>
                  <Badge className="bg-rose-100 text-rose-800">FAIL</Badge>
                  <p className="text-xs text-rose-700 mt-2 break-words">{status.message}</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Connections</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{conns.length}</div>
              <p className="text-xs text-zinc-500 mt-1">
                {conns.length === 0
                  ? "Using env-default synthetic connection"
                  : conns.map((c) => c.name).join(", ")}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Webhook URL</CardTitle>
            </CardHeader>
            <CardContent>
              <code className="text-xs text-zinc-700 break-all">
                /api/inbound/cargowise-events
              </code>
              <p className="text-xs text-zinc-500 mt-2">
                Bearer{" "}
                <code className="bg-zinc-100 px-1 rounded">INBOUND_WEBHOOK_SECRET</code>
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Subscribe form */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Manual subscription test</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
              <div>
                <label htmlFor="ref-type" className="text-xs text-zinc-700 block mb-1">Type</label>
                <select
                  id="ref-type"
                  value={tmsRefType}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                    const v = e.target.value as RefType;
                    setTmsRefType(v);
                    // Sensible default mode per type
                    if (v === "awb") setTransportMode("AIR");
                    else if (v === "mbol" || v === "container") setTransportMode("SEA");
                  }}
                  className="w-full h-9 rounded border border-zinc-300 px-2 text-sm"
                >
                  <option value="mbol">MBOL</option>
                  <option value="awb">MAWB</option>
                  <option value="container">Container</option>
                  <option value="booking">Booking (SI/SO/SE/PO)</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label htmlFor="ref" className="text-xs text-zinc-700 block mb-1">{refLabel[tmsRefType]}</label>
                <input
                  id="ref"
                  type="text"
                  placeholder={refPlaceholder[tmsRefType]}
                  value={tmsRef}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTmsRef(e.target.value)}
                  className="w-full h-9 rounded border border-zinc-300 px-2 text-sm uppercase"
                />
                {carrierName && (
                  <p className="text-[11px] text-emerald-700 mt-1">Detected: {carrierName}</p>
                )}
              </div>
              <div>
                <label htmlFor="carrier" className="text-xs text-zinc-700 block mb-1">Carrier (SCAC/IATA)</label>
                <input
                  id="carrier"
                  type="text"
                  placeholder="auto"
                  value={carrierCode}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCarrierCode(e.target.value)}
                  className="w-full h-9 rounded border border-zinc-300 px-2 text-sm uppercase"
                />
              </div>
              <div>
                <label htmlFor="mode" className="text-xs text-zinc-700 block mb-1">Mode</label>
                <select
                  id="mode"
                  value={transportMode}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTransportMode(e.target.value as "SEA" | "AIR" | "")}
                  className="w-full h-9 rounded border border-zinc-300 px-2 text-sm"
                >
                  <option value="SEA">SEA</option>
                  <option value="AIR">AIR</option>
                  <option value="">(unset)</option>
                </select>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Button onClick={submit} disabled={submitting || !tmsRef.trim()} size="sm">
                {submitting ? "Submitting..." : "Subscribe"}
              </Button>
              {submitMsg && <span className="text-sm text-zinc-600">{submitMsg}</span>}
            </div>
          </CardContent>
        </Card>

        {/* eAdaptor: fetch shipment by key */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Fetch shipment / job (eAdaptor)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <label className="text-xs text-zinc-700 block mb-1">Module</label>
                <select
                  value={fetchTarget}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    setFetchTarget(e.target.value as typeof fetchTarget)
                  }
                  className="w-full h-9 rounded border border-zinc-300 px-2 text-sm"
                >
                  <option value="ForwardingShipment">Forwarding Shipment</option>
                  <option value="ForwardingConsol">Forwarding Consol</option>
                  <option value="CustomsDeclaration">Customs Declaration</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-zinc-700 block mb-1">Job number / key</label>
                <input
                  type="text"
                  placeholder="AS123456"
                  value={fetchKey}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFetchKey(e.target.value)}
                  className="w-full h-9 rounded border border-zinc-300 px-2 text-sm uppercase"
                />
              </div>
              <div>
                <Button onClick={fetchShipment} disabled={fetching || !fetchKey.trim()} size="sm" className="w-full">
                  {fetching ? "Fetching..." : "Fetch"}
                </Button>
              </div>
            </div>
            {fetchError && (
              <p className="text-sm text-rose-700 mt-3">{fetchError}</p>
            )}
            {fetchedShipment && (
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <Field label="Job number" value={fetchedShipment.jobNumber} />
                <Field label="Consol" value={fetchedShipment.consolNumber} />
                <Field label="MBOL" value={fetchedShipment.mbolNumber} mono />
                <Field label="HBOL" value={fetchedShipment.hbolNumber} mono />
                <Field label="Mode" value={fetchedShipment.transportMode} />
                <Field label="Container mode" value={fetchedShipment.containerMode} />
                <Field label="Origin" value={fetchedShipment.origin?.unlocode} mono />
                <Field label="Destination" value={fetchedShipment.destination?.unlocode} mono />
                <Field label="Carrier" value={`${fetchedShipment.carrierName ?? ""} ${fetchedShipment.carrierCode ? `(${fetchedShipment.carrierCode})` : ""}`.trim()} />
                <Field label="Vessel / Voyage" value={[fetchedShipment.vesselName, fetchedShipment.voyageNumber].filter(Boolean).join(" / ")} />
                <Field label="ETA / ATA" value={[fetchedShipment.eta, fetchedShipment.ata].map(fmtMaybeTime).filter(Boolean).join(" / ")} />
                <Field label="ETD / ATD" value={[fetchedShipment.etd, fetchedShipment.atd].map(fmtMaybeTime).filter(Boolean).join(" / ")} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Outbound audit */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Outbound calls (audit)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Operation</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead>HTTP</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outboundCalls.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-zinc-400 text-sm">
                      No outbound calls yet
                    </TableCell>
                  </TableRow>
                )}
                {outboundCalls.map((c) => (
                  <TableRow key={c.call_id}>
                    <TableCell>
                      <Badge className={c.status === "success" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}>
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.operation}</TableCell>
                    <TableCell className="text-xs">{c.requested_by}</TableCell>
                    <TableCell className="font-mono text-xs">{c.request_summary ?? "-"}</TableCell>
                    <TableCell className="text-xs">{c.http_status ?? "-"}</TableCell>
                    <TableCell className="text-xs">{c.duration_ms != null ? `${c.duration_ms}ms` : "-"}</TableCell>
                    <TableCell className="text-xs">{fmtTime(c.requested_at)}</TableCell>
                    <TableCell className="text-xs text-rose-700 truncate max-w-xs">{c.error_message ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Subscriptions */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Recent subscriptions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Ref</TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-zinc-400 text-sm">
                      No subscriptions yet
                    </TableCell>
                  </TableRow>
                )}
                {subs.map((s) => (
                  <TableRow key={s.subscription_id}>
                    <TableCell>
                      <Badge className={STATUS_BADGE[s.status] ?? "bg-zinc-100"}>
                        {s.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs uppercase">{s.tms_ref_type}</TableCell>
                    <TableCell className="font-mono text-xs">{s.tms_ref}</TableCell>
                    <TableCell className="font-mono text-xs">{s.carrier_code ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{s.transport_mode ?? "-"}</TableCell>
                    <TableCell className="text-xs">{fmtTime(s.created_at)}</TableCell>
                    <TableCell className="text-xs text-rose-700 truncate max-w-xs">
                      {s.rejection_reason ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Events */}
        <Card>
          <CardHeader>
            <CardTitle>Recent events</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Event time</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Ref</TableHead>
                  <TableHead>Client ref</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-zinc-400 text-sm">
                      No events yet
                    </TableCell>
                  </TableRow>
                )}
                {events.map((e) => (
                  <TableRow key={e.event_id}>
                    <TableCell>
                      <Badge className={EVENT_BADGE[e.event_type] ?? "bg-zinc-100"}>
                        {e.event_type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_BADGE[e.status] ?? "bg-zinc-100"}>
                        {e.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{fmtTime(e.event_time)}</TableCell>
                    <TableCell className="text-xs">{fmtTime(e.received_at)}</TableCell>
                    <TableCell className="font-mono text-xs">{e.tms_ref ?? "-"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {e.client_reference ? e.client_reference.slice(0, 8) + "..." : "-"}
                    </TableCell>
                    <TableCell className="text-xs text-rose-700 truncate max-w-xs">
                      {e.error_message ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </PageGuard>
  );
}
