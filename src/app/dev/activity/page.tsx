"use client";

import { useEffect, useState, useCallback } from "react";
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

interface ActivityEvent {
  event_id: string;
  occurred_at: string;
  direction: string;
  channel: string;
  event_type: string;
  subject_type: string;
  subject_id: string;
  title: string;
  counterparty_email: string | null;
  correlation_key: string | null;
  status: string;
  created_by: string;
}

type RowKind = "orphan" | "matched_inbound" | "outbound" | "default";

const ROW_COLORS: Record<Exclude<RowKind, "default">, string> = {
  orphan: "bg-orange-50 hover:bg-orange-100",
  matched_inbound: "bg-green-50 hover:bg-green-100",
  outbound: "bg-blue-50 hover:bg-blue-100",
};

function rowKind(e: ActivityEvent): RowKind {
  if (e.subject_type === "orphan_inbound") return "orphan";
  if (e.direction === "inbound") return "matched_inbound";
  if (e.direction === "outbound") return "outbound";
  return "default";
}

export default function DevActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/dev/activity-recent");
      const d = (await r.json()) as { events?: ActivityEvent[]; error?: string };
      if (!r.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setEvents(d.events ?? []);
      setLastRefresh(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown fetch error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const orphans = events.filter((e) => e.subject_type === "orphan_inbound").length;
  const inboundMatched = events.filter(
    (e) => e.direction === "inbound" && e.subject_type !== "orphan_inbound",
  ).length;
  const outboundCount = events.filter((e) => e.direction === "outbound").length;

  return (
    <PageGuard pageId="dev_activity">
      <div className="container mx-auto py-8 max-w-7xl px-4">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Activity Stream - Dev Smoke Test</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Last 50 events from{" "}
              <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-xs">activity.events</code>.
              Auto-refreshes every 10 seconds. Send an email to{" "}
              <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-xs">test@inbound.braiin.app</code>{" "}
              to populate.
            </p>
          </div>
          <Button onClick={refresh} disabled={loading} size="sm" variant="outline">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-zinc-500 font-medium">Outbound</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-600">{outboundCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-zinc-500 font-medium">
                Inbound (matched)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600">{inboundMatched}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-zinc-500 font-medium">
                Inbound (orphan)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-600">{orphans}</div>
            </CardContent>
          </Card>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4 text-sm">
            {error}
          </div>
        )}

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">When</TableHead>
                  <TableHead className="w-[80px]">Dir</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Counterparty</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-zinc-400 py-12">
                      No events yet. Send an email to test@inbound.braiin.app, or trigger an
                      outbound from /api/send-email, to populate the stream.
                    </TableCell>
                  </TableRow>
                )}
                {events.map((e) => {
                  const kind = rowKind(e);
                  const cls = kind !== "default" ? ROW_COLORS[kind] : "";
                  return (
                    <TableRow key={e.event_id} className={cls}>
                      <TableCell className="text-xs whitespace-nowrap align-top">
                        <div>{new Date(e.occurred_at).toLocaleTimeString()}</div>
                        <div className="text-zinc-400">
                          {new Date(e.occurred_at).toLocaleDateString()}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant="outline" className="text-xs">
                          {e.direction}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs align-top">{e.event_type}</TableCell>
                      <TableCell className="text-xs align-top">
                        {e.counterparty_email ?? "-"}
                      </TableCell>
                      <TableCell className="text-xs align-top">
                        <code className="bg-zinc-100 px-1 rounded">{e.subject_type}</code>
                        <div className="text-zinc-500 mt-0.5 break-all">{e.subject_id}</div>
                      </TableCell>
                      <TableCell className="text-xs align-top max-w-xs truncate">
                        {e.title}
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant="secondary" className="text-xs">
                          {e.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {lastRefresh && (
          <div className="text-xs text-zinc-400 mt-4 text-right">
            Last refresh: {lastRefresh.toLocaleTimeString()}
          </div>
        )}
      </div>
    </PageGuard>
  );
}
