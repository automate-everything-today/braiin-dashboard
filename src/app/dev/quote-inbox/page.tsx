"use client";

/**
 * Visual mock-up of the Braiin RFQ triage inbox.
 *
 * Static page, no backend calls. Hardcoded data so we can react to the
 * design before committing to the build. Sits ABOVE the per-quote
 * workspace at /dev/quote-preview - this is the air-traffic-control view
 * across all open RFQs, not the deep-work view.
 *
 * Two slide-out panels demonstrated:
 *   - "Send RFQ" composer for a `ready` row (AI-suggested carriers, editable email)
 *   - "Ask for more info" panel for a `gathering` row (missing fields prompt)
 */

import { useMemo, useState } from "react";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageGuard } from "@/components/page-guard";
import {
  ArrowDownUp,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Clock,
  Filter,
  Inbox,
  Layers,
  Mail,
  Phone,
  Search,
  Send,
  Sparkles,
  Star,
  X,
  Zap,
} from "lucide-react";

// ============================================================
// Mock data
// ============================================================

type DraftStatus =
  | "new"
  | "gathering"
  | "ready"
  | "sourcing"
  | "recommended"
  | "sent"
  | "won"
  | "lost"
  | "expired";

type SourceType = "email" | "manual" | "portal" | "phone";

interface InboxRow {
  id: string;
  customer: string;
  customerYTD?: string;
  origin: string;
  destination: string;
  mode: string;
  equipment?: string;
  status: DraftStatus;
  source: SourceType;
  sourceInbox?: string;
  enteredStateAt: number; // minutes ago
  receivedAt: number; // minutes ago
  carriersInvited?: number;
  carriersResponded?: number;
  topRecommendation?: string;
  margin?: string;
  missing?: string[];
  // Sibling-group support: when N quote drafts come from one email
  siblingIntent?: string; // e.g. "Express", "Standard", "LCL option"
}

interface SiblingGroup {
  groupId: string;
  customer: string;
  customerYTD?: string;
  origin: string;
  destination: string;
  source: SourceType;
  sourceInbox?: string;
  receivedAt: number;
  splitConfidence: number; // 0-1, surfaced when AI made the split call
  children: InboxRow[];
}

type InboxEntry =
  | { kind: "single"; row: InboxRow }
  | { kind: "group"; group: SiblingGroup };

// "now" in mock minutes
const ROWS: InboxRow[] = [
  {
    id: "BR-2026-0428-1239",
    customer: "Whitelane Logistics",
    customerYTD: "£42k",
    origin: "DEHAM",
    destination: "USNYC",
    mode: "Sea FCL",
    equipment: "1× 40HC",
    status: "new",
    source: "email",
    sourceInbox: "quotes@",
    enteredStateAt: 2,
    receivedAt: 2,
    missing: ["collection date", "commodity", "incoterms"],
  },
  {
    id: "BR-2026-0428-1238",
    customer: "Northwind Foods",
    customerYTD: "£218k",
    origin: "GBLGP",
    destination: "ESBCN",
    mode: "Road",
    equipment: "13.6m curtainsider",
    status: "gathering",
    source: "email",
    sourceInbox: "ops@",
    enteredStateAt: 11,
    receivedAt: 14,
    missing: ["stackability", "tail-lift?"],
  },
  {
    id: "BR-2026-0428-1237",
    customer: "Apex Pharma",
    customerYTD: "£91k",
    origin: "GBLHR",
    destination: "SGSIN",
    mode: "Air",
    equipment: "850 kg, 3.2 CBM",
    status: "ready",
    source: "portal",
    enteredStateAt: 4,
    receivedAt: 22,
  },
  {
    id: "BR-2026-0428-1236",
    customer: "ABC Manufacturing Ltd",
    customerYTD: "£187k",
    origin: "GBFXT",
    destination: "CNSHA",
    mode: "Sea FCL",
    equipment: "2× 40HC",
    status: "sourcing",
    source: "email",
    sourceInbox: "rob@",
    enteredStateAt: 19,
    receivedAt: 74,
    carriersInvited: 8,
    carriersResponded: 4,
  },
  {
    id: "BR-2026-0428-1235",
    customer: "Brightline Retail",
    customerYTD: "£64k",
    origin: "CNSZX",
    destination: "GBSOU",
    mode: "Sea LCL",
    equipment: "1.8 CBM",
    status: "sourcing",
    source: "email",
    sourceInbox: "quotes@",
    enteredStateAt: 32,
    receivedAt: 96,
    carriersInvited: 6,
    carriersResponded: 2,
  },
  {
    id: "BR-2026-0428-1234",
    customer: "Crestwood Engineering",
    customerYTD: "£156k",
    origin: "DEFRA",
    destination: "USORD",
    mode: "Air",
    equipment: "1,240 kg, 4.5 CBM",
    status: "recommended",
    source: "email",
    sourceInbox: "rob@",
    enteredStateAt: 7,
    receivedAt: 53,
    carriersInvited: 5,
    carriersResponded: 5,
    topRecommendation: "Lufthansa Cargo · £4,210",
    margin: "+13%",
  },
  {
    id: "BR-2026-0428-1230",
    customer: "Marina Surplus",
    customerYTD: "£28k",
    origin: "GBLGP",
    destination: "NLRTM",
    mode: "Road",
    equipment: "1× pallet",
    status: "sent",
    source: "phone",
    enteredStateAt: 145,
    receivedAt: 220,
    topRecommendation: "DSV Road · £312",
    margin: "+22%",
  },
  {
    id: "BR-2026-0428-1228",
    customer: "Halcyon Beverages",
    customerYTD: "£312k",
    origin: "GBFXT",
    destination: "USLAX",
    mode: "Sea FCL",
    equipment: "1× 40HC",
    status: "won",
    source: "email",
    sourceInbox: "rob@",
    enteredStateAt: 240,
    receivedAt: 1440,
    topRecommendation: "Hapag-Lloyd · £2,510",
    margin: "+14%",
  },
  {
    id: "BR-2026-0428-1226",
    customer: "Verde Cosmetics",
    customerYTD: "£12k",
    origin: "ITGOA",
    destination: "GBSOU",
    mode: "Sea LCL",
    equipment: "0.6 CBM",
    status: "lost",
    source: "email",
    sourceInbox: "quotes@",
    enteredStateAt: 380,
    receivedAt: 2100,
    topRecommendation: "MSC Standard · £180",
  },
  {
    id: "BR-2026-0428-1220",
    customer: "Foundry Imports",
    customerYTD: "£8k",
    origin: "CNNGB",
    destination: "GBFXT",
    mode: "Sea FCL",
    equipment: "1× 20DV",
    status: "expired",
    source: "manual",
    enteredStateAt: 4320,
    receivedAt: 7200,
  },
];

// Sibling group: customer asks for N quote options in one email.
// AI splits into N sibling drafts that share a group_id but progress
// through statuses independently. Parent row in inbox shows a summary,
// children expand below.
const SIBLING_GROUPS: SiblingGroup[] = [
  {
    groupId: "GRP-2026-0428-AP01",
    customer: "Apex Pharma",
    customerYTD: "£91k",
    origin: "DEFRA",
    destination: "USORD",
    source: "email",
    sourceInbox: "rob@",
    receivedAt: 26,
    splitConfidence: 0.94,
    children: [
      {
        id: "BR-2026-0428-1244-1",
        customer: "Apex Pharma",
        customerYTD: "£91k",
        origin: "DEFRA",
        destination: "USORD",
        mode: "Air",
        equipment: "1,240 kg / 4.5 CBM",
        status: "ready",
        source: "email",
        sourceInbox: "rob@",
        enteredStateAt: 18,
        receivedAt: 26,
        siblingIntent: "Express",
      },
      {
        id: "BR-2026-0428-1244-2",
        customer: "Apex Pharma",
        customerYTD: "£91k",
        origin: "DEFRA",
        destination: "USORD",
        mode: "Air",
        equipment: "1,240 kg / 4.5 CBM",
        status: "sourcing",
        source: "email",
        sourceInbox: "rob@",
        enteredStateAt: 12,
        receivedAt: 26,
        carriersInvited: 6,
        carriersResponded: 3,
        siblingIntent: "Standard",
      },
      {
        id: "BR-2026-0428-1244-3",
        customer: "Apex Pharma",
        customerYTD: "£91k",
        origin: "DEFRA",
        destination: "USORD",
        mode: "Air",
        equipment: "1,240 kg / 4.5 CBM",
        status: "sourcing",
        source: "email",
        sourceInbox: "rob@",
        enteredStateAt: 12,
        receivedAt: 26,
        carriersInvited: 6,
        carriersResponded: 4,
        siblingIntent: "Economy",
      },
      {
        id: "BR-2026-0428-1244-4",
        customer: "Apex Pharma",
        customerYTD: "£91k",
        origin: "DEFRA",
        destination: "USORD",
        mode: "Air",
        equipment: "1,240 kg / 4.5 CBM",
        status: "gathering",
        source: "email",
        sourceInbox: "rob@",
        enteredStateAt: 21,
        receivedAt: 26,
        siblingIntent: "Charter",
        missing: ["aircraft type preference", "loading-time tolerance"],
      },
      {
        id: "BR-2026-0428-1244-5",
        customer: "Apex Pharma",
        customerYTD: "£91k",
        origin: "DEFRA",
        destination: "USORD",
        mode: "Air",
        equipment: "1,240 kg / 4.5 CBM",
        status: "recommended",
        source: "email",
        sourceInbox: "rob@",
        enteredStateAt: 3,
        receivedAt: 26,
        carriersInvited: 4,
        carriersResponded: 4,
        topRecommendation: "Lufthansa Cargo · £4,210",
        margin: "+13%",
        siblingIntent: "Hand-carry",
      },
    ],
  },
];

// Build the unified entries list: groups first, then singletons.
const ENTRIES: InboxEntry[] = [
  ...SIBLING_GROUPS.map((g) => ({ kind: "group" as const, group: g })),
  ...ROWS.map((r) => ({ kind: "single" as const, row: r })),
];

// All draft rows flattened — used for KPI counts.
const ALL_ROWS: InboxRow[] = [
  ...ROWS,
  ...SIBLING_GROUPS.flatMap((g) => g.children),
];

// ============================================================
// Status presentation
// ============================================================

const STATUS_LABEL: Record<DraftStatus, string> = {
  new: "new",
  gathering: "gathering",
  ready: "ready",
  sourcing: "sourcing",
  recommended: "recommended",
  sent: "sent",
  won: "won",
  lost: "lost",
  expired: "expired",
};

const STATUS_TONE: Record<DraftStatus, string> = {
  new: "bg-zinc-100 text-zinc-700",
  gathering: "bg-amber-100 text-amber-800",
  ready: "bg-sky-100 text-sky-800",
  sourcing: "bg-violet-100 text-violet-800",
  recommended: "bg-emerald-100 text-emerald-800",
  sent: "bg-indigo-100 text-indigo-800",
  won: "bg-emerald-200 text-emerald-900",
  lost: "bg-rose-100 text-rose-800",
  expired: "bg-zinc-200 text-zinc-500",
};

const STATUS_GROUPS: Array<{ id: string; label: string; statuses: DraftStatus[] }> = [
  { id: "open", label: "Open", statuses: ["new", "gathering", "ready", "sourcing", "recommended"] },
  { id: "sent", label: "Awaiting", statuses: ["sent"] },
  { id: "closed", label: "Closed", statuses: ["won", "lost", "expired"] },
  { id: "all", label: "All", statuses: [
    "new", "gathering", "ready", "sourcing", "recommended", "sent", "won", "lost", "expired",
  ] },
];

// ============================================================
// Helpers
// ============================================================

function formatTime(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

function timeTone(minutes: number, status: DraftStatus): string {
  // Highlight stale states. "ready" should not sit > 30 min before sourcing.
  // "gathering" should not sit > 60 min waiting on operator.
  if (status === "ready" && minutes > 30) return "text-rose-700 font-medium";
  if (status === "gathering" && minutes > 60) return "text-rose-700 font-medium";
  if (status === "sourcing" && minutes > 120) return "text-amber-700";
  return "text-zinc-600";
}

function oldestEnteredAt(e: InboxEntry): number {
  if (e.kind === "single") return e.row.enteredStateAt;
  return Math.max(...e.group.children.map((c) => c.enteredStateAt));
}

function summarizeGroupStatus(children: InboxRow[]): string {
  const counts: Partial<Record<DraftStatus, number>> = {};
  for (const c of children) counts[c.status] = (counts[c.status] ?? 0) + 1;
  return Object.entries(counts)
    .map(([s, n]) => `${n} ${s}`)
    .join(" · ");
}

function SourceIcon({ source }: { source: SourceType }) {
  if (source === "email") return <Mail className="size-3.5 text-zinc-500" />;
  if (source === "phone") return <Phone className="size-3.5 text-zinc-500" />;
  if (source === "portal")
    return <span className="font-mono text-[10px] text-zinc-500">PRT</span>;
  return <span className="font-mono text-[10px] text-zinc-500">MAN</span>;
}

function PulsingBrain({ size = 18 }: { size?: number }) {
  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      <span
        className="absolute inset-0 rounded-full bg-violet-200/50 animate-ping"
        style={{ animationDuration: "2s" }}
      />
      <Image
        src="/brain-icon.png"
        alt="working"
        width={size}
        height={size}
        className="relative animate-pulse"
        style={{ animationDuration: "1.5s" }}
      />
    </div>
  );
}

// ============================================================
// Slide-out: Send RFQ composer
// ============================================================

interface SuggestedCarrier {
  code: string;
  name: string;
  score: number;
  lastResponseMinutes: number;
  responseRate: number; // 0-100
  source: "API" | "Email" | "Aggregator";
  customerNominated?: boolean;
}

const SUGGESTED_CARRIERS: SuggestedCarrier[] = [
  { code: "LH", name: "Lufthansa Cargo", score: 87, lastResponseMinutes: 18, responseRate: 92, source: "API" },
  { code: "EK", name: "Emirates SkyCargo", score: 85, lastResponseMinutes: 22, responseRate: 88, source: "API" },
  { code: "CV", name: "Cargolux", score: 82, lastResponseMinutes: 31, responseRate: 84, source: "Email" },
  { code: "AGG1", name: "Cargo.one (top 3)", score: 0, lastResponseMinutes: 4, responseRate: 99, source: "Aggregator" },
  { code: "AGG2", name: "CargoAI (top 3)", score: 0, lastResponseMinutes: 6, responseRate: 97, source: "Aggregator" },
  { code: "QR", name: "Qatar Airways Cargo", score: 78, lastResponseMinutes: 45, responseRate: 76, source: "Email", customerNominated: true },
  { code: "BA", name: "British Airways World Cargo", score: 74, lastResponseMinutes: 62, responseRate: 71, source: "Email" },
  { code: "TK", name: "Turkish Cargo", score: 71, lastResponseMinutes: 88, responseRate: 64, source: "Email" },
];

const ALL_AIR_CARRIERS = [
  ...SUGGESTED_CARRIERS,
  { code: "AF", name: "Air France-KLM Cargo", score: 68, lastResponseMinutes: 110, responseRate: 58, source: "Email" as const },
  { code: "SQ", name: "Singapore Airlines Cargo", score: 66, lastResponseMinutes: 140, responseRate: 52, source: "Email" as const },
  { code: "EY", name: "Etihad Cargo", score: 62, lastResponseMinutes: 180, responseRate: 47, source: "Email" as const },
];

interface SendRfqPanelProps {
  row: InboxRow | null;
  onClose: () => void;
}

function SendRfqPanel({ row, onClose }: SendRfqPanelProps) {
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    SUGGESTED_CARRIERS.reduce((acc, c) => ({ ...acc, [c.code]: true }), {}),
  );

  const list = showAll ? ALL_AIR_CARRIERS : SUGGESTED_CARRIERS;

  const selectedCount = Object.values(selected).filter(Boolean).length;

  function toggle(code: string) {
    setSelected((s) => ({ ...s, [code]: !s[code] }));
  }

  function pickNominated() {
    const next: Record<string, boolean> = {};
    for (const c of ALL_AIR_CARRIERS) {
      next[c.code] = !!c.customerNominated;
    }
    setSelected(next);
  }

  if (!row) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-zinc-900/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="w-[640px] bg-white border-l border-zinc-200 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="border-b px-5 py-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
              <Send className="size-3.5" />
              Send RFQ
              <span className="text-zinc-300">·</span>
              <span className="font-mono">{row.id}</span>
            </div>
            <div className="font-medium">{row.customer}</div>
            <div className="text-xs text-zinc-600 mt-1 flex items-center gap-2">
              <span className="font-mono">{row.origin}</span>
              <ArrowRight className="size-3 text-zinc-400" />
              <span className="font-mono">{row.destination}</span>
              <span className="text-zinc-400">·</span>
              <span>{row.mode}</span>
              {row.equipment && (
                <>
                  <span className="text-zinc-400">·</span>
                  <span>{row.equipment}</span>
                </>
              )}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} className="size-8 p-0">
            <X className="size-4" />
          </Button>
        </div>

        {/* Scroll body */}
        <div className="flex-1 overflow-y-auto">
          {/* AI prep */}
          <div className="px-5 py-4 bg-violet-50/50 border-b border-violet-100">
            <div className="flex items-start gap-2 text-xs text-zinc-700">
              <Sparkles className="size-4 text-violet-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-violet-900 mb-1">
                  AI pre-selected 8 carriers for FRA-ORD air freight
                </div>
                <div className="text-zinc-600 leading-relaxed">
                  Top by composite score on this lane (last 90d). Two aggregators
                  bundled (returns top 3 each). Qatar appears because Apex
                  nominated them on previous Singapore lane.
                </div>
              </div>
            </div>
          </div>

          {/* Carrier list */}
          <div className="px-5 py-4 space-y-1">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                Carriers ({selectedCount} selected)
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={pickNominated}>
                  Customer nominated only
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show suggested" : "Show all carriers"}
                </Button>
              </div>
            </div>

            {list.map((c) => (
              <label
                key={c.code}
                className={`flex items-center gap-3 px-3 py-2 rounded border cursor-pointer hover:bg-zinc-50 ${
                  selected[c.code] ? "border-violet-200 bg-violet-50/40" : "border-zinc-200"
                }`}
              >
                <input
                  type="checkbox"
                  checked={!!selected[c.code]}
                  onChange={() => toggle(c.code)}
                  className="size-4 accent-violet-600"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{c.name}</span>
                    {c.customerNominated && (
                      <Badge className="bg-amber-100 text-amber-800 text-[9px] uppercase tracking-wide">
                        nominated
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 flex items-center gap-3 mt-0.5">
                    {c.score > 0 && (
                      <span>
                        score <span className="font-mono text-zinc-700">{c.score}</span>
                      </span>
                    )}
                    <span>last reply {formatTime(c.lastResponseMinutes)}</span>
                    <span>{c.responseRate}% reply</span>
                  </div>
                </div>
                <Badge
                  className={`text-[10px] uppercase tracking-wide ${
                    c.source === "API"
                      ? "bg-violet-100 text-violet-800"
                      : c.source === "Aggregator"
                        ? "bg-cyan-100 text-cyan-800"
                        : "bg-zinc-100 text-zinc-700"
                  }`}
                >
                  {c.source}
                </Badge>
              </label>
            ))}
          </div>

          {/* Email template */}
          <div className="px-5 py-4 border-t">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                Email template (auto-generated per carrier)
              </div>
              <Button size="sm" variant="ghost" className="h-7 text-xs">
                Edit
              </Button>
            </div>
            <div className="border rounded bg-zinc-50 p-3 text-xs text-zinc-700 leading-relaxed font-mono">
              <div>Subject: RFQ FRA-ORD air · 1,240 kg / 4.5 CBM · Apex Pharma</div>
              <div className="mt-2">Hi {`{carrier_contact}`},</div>
              <div className="mt-2">
                Looking for an air freight quote on the below for our client Apex Pharma:
              </div>
              <div className="mt-2 pl-3 border-l-2 border-zinc-300">
                Origin: Frankfurt (FRA)
                <br />
                Destination: Chicago O'Hare (ORD)
                <br />
                Weight / Volume: 1,240 kg / 4.5 CBM
                <br />
                Commodity: Pharmaceutical, non-haz, temp-controlled +2 to +8C
                <br />
                Ready: Wed 3 May
                <br />
                Required validity: 14 days
              </div>
              <div className="mt-2">
                Please quote your best Express, Standard and Economy products with transit and routing.
              </div>
              <div className="mt-2">Thanks, Rob</div>
            </div>
          </div>
        </div>

        {/* Footer action bar */}
        <div className="border-t px-5 py-3 flex items-center justify-between bg-zinc-50">
          <div className="text-xs text-zinc-500">
            Estimated responses: <span className="font-medium text-zinc-700">~6 of {selectedCount}</span> within 2h
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" disabled={selectedCount === 0}>
              <Send className="size-3.5 mr-1.5" />
              Send to {selectedCount} carriers
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Slide-out: Ask for more info (gathering rows)
// ============================================================

interface AskInfoPanelProps {
  row: InboxRow | null;
  onClose: () => void;
}

function AskInfoPanel({ row, onClose }: AskInfoPanelProps) {
  if (!row) return null;
  const missing = row.missing ?? [];

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-zinc-900/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="w-[560px] bg-white border-l border-zinc-200 flex flex-col shadow-2xl">
        <div className="border-b px-5 py-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
              <Mail className="size-3.5" />
              Ask for more info
              <span className="text-zinc-300">·</span>
              <span className="font-mono">{row.id}</span>
            </div>
            <div className="font-medium">{row.customer}</div>
            <div className="text-xs text-zinc-600 mt-1 flex items-center gap-2">
              <span className="font-mono">{row.origin}</span>
              <ArrowRight className="size-3 text-zinc-400" />
              <span className="font-mono">{row.destination}</span>
              <span className="text-zinc-400">·</span>
              <span>{row.mode}</span>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} className="size-8 p-0">
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">
              Missing fields ({missing.length})
            </div>
            <div className="space-y-2">
              {missing.map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm border rounded px-3 py-2 hover:bg-zinc-50 cursor-pointer">
                  <input type="checkbox" defaultChecked className="size-4 accent-violet-600" />
                  <span>{m}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">
              Reply draft (sent on customer's existing thread)
            </div>
            <textarea
              className="w-full border rounded px-3 py-2 text-sm font-mono leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-violet-200"
              rows={10}
              defaultValue={`Hi ${row.customer.split(" ")[0]},

Thanks for the RFQ. To get the best rate back to you, could you confirm:

  • ${missing.join("\n  • ")}

Will fan out to carriers once we have these.

Best,
Rob`}
            />
          </div>

          <div className="flex items-start gap-2 text-xs text-zinc-500 bg-zinc-50 border rounded p-3">
            <Sparkles className="size-3.5 text-violet-600 shrink-0 mt-0.5" />
            <div>
              Reply lands on the original email thread so the customer's reply
              auto-classifies and updates this draft. Decision-loop captures
              whether your edit changed the AI draft - feeds into next-time prompt.
            </div>
          </div>
        </div>

        <div className="border-t px-5 py-3 flex items-center justify-between bg-zinc-50">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm">
            <Send className="size-3.5 mr-1.5" />
            Send reply
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Header KPI cards
// ============================================================

function StatStrip({ rows }: { rows: InboxRow[] }) {
  const counts = useMemo(() => {
    const c: Partial<Record<DraftStatus, number>> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const stale = rows.filter(
    (r) =>
      (r.status === "ready" && r.enteredStateAt > 30) ||
      (r.status === "gathering" && r.enteredStateAt > 60),
  ).length;

  const open = (counts.new ?? 0) + (counts.gathering ?? 0) + (counts.ready ?? 0) + (counts.sourcing ?? 0) + (counts.recommended ?? 0);

  return (
    <div className="grid grid-cols-5 gap-3">
      <Card>
        <CardContent className="py-3 px-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Open RFQs</div>
          <div className="text-2xl font-mono">{open}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-3 px-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Awaiting customer</div>
          <div className="text-2xl font-mono">{counts.gathering ?? 0}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-3 px-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Sourcing</div>
          <div className="text-2xl font-mono flex items-center gap-2">
            {counts.sourcing ?? 0}
            <PulsingBrain size={16} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-3 px-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Ready to send</div>
          <div className="text-2xl font-mono text-emerald-700">{counts.recommended ?? 0}</div>
        </CardContent>
      </Card>
      <Card className={stale > 0 ? "border-rose-200 bg-rose-50/30" : ""}>
        <CardContent className="py-3 px-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">Stale &gt; SLA</div>
          <div className={`text-2xl font-mono ${stale > 0 ? "text-rose-700" : ""}`}>{stale}</div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Page
// ============================================================

export default function QuoteInboxPage() {
  const [groupId, setGroupId] = useState("open");
  const [query, setQuery] = useState("");
  const [sendRfqRow, setSendRfqRow] = useState<InboxRow | null>(null);
  const [askInfoRow, setAskInfoRow] = useState<InboxRow | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    "GRP-2026-0428-AP01": true, // expanded by default to demo the pattern
  });

  const group = STATUS_GROUPS.find((g) => g.id === groupId) ?? STATUS_GROUPS[0];

  const matchesText = (r: InboxRow, q: string) =>
    q.length === 0 ||
    r.customer.toLowerCase().includes(q) ||
    r.origin.toLowerCase().includes(q) ||
    r.destination.toLowerCase().includes(q) ||
    r.mode.toLowerCase().includes(q) ||
    r.id.toLowerCase().includes(q);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: InboxEntry[] = [];
    for (const e of ENTRIES) {
      if (e.kind === "single") {
        if (group.statuses.includes(e.row.status) && matchesText(e.row, q)) {
          out.push(e);
        }
      } else {
        // Group passes if ANY child passes both filters.
        const visibleKids = e.group.children.filter(
          (c) => group.statuses.includes(c.status) && matchesText(c, q),
        );
        if (visibleKids.length > 0) {
          out.push({ kind: "group", group: { ...e.group, children: visibleKids } });
        }
      }
    }
    // Sort by oldest in-state minute (groups use min child).
    return out.sort((a, b) => oldestEnteredAt(a) - oldestEnteredAt(b));
  }, [group, query]);

  const visibleRowCount = filtered.reduce(
    (n, e) => n + (e.kind === "single" ? 1 : e.group.children.length),
    0,
  );

  function toggleGroup(id: string) {
    setExpanded((s) => ({ ...s, [id]: !s[id] }));
  }

  function actionFor(row: InboxRow) {
    if (row.status === "new" || row.status === "gathering") {
      return (
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAskInfoRow(row)}>
          Ask for info
        </Button>
      );
    }
    if (row.status === "ready") {
      return (
        <Button size="sm" className="h-7 text-xs" onClick={() => setSendRfqRow(row)}>
          <Send className="size-3 mr-1" />
          Send RFQ
        </Button>
      );
    }
    if (row.status === "sourcing") {
      return (
        <Button size="sm" variant="outline" className="h-7 text-xs">
          View grid
        </Button>
      );
    }
    if (row.status === "recommended") {
      return (
        <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700">
          <Star className="size-3 mr-1 fill-white" />
          Review &amp; send
        </Button>
      );
    }
    if (row.status === "sent") {
      return (
        <Button size="sm" variant="ghost" className="h-7 text-xs">
          Mark won
        </Button>
      );
    }
    return (
      <Button size="sm" variant="ghost" className="h-7 text-xs text-zinc-400">
        Open
      </Button>
    );
  }

  return (
    <PageGuard pageId="dev_quote_inbox">
      <div className="min-h-screen bg-zinc-50">
        {/* Top bar */}
        <div className="border-b bg-white">
          <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Inbox className="size-5 text-zinc-600" />
              <h1 className="text-lg font-medium">RFQ inbox</h1>
              <Badge className="bg-zinc-100 text-zinc-600 font-mono text-[10px]">
                /quotes
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-zinc-500 inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                live · auto-refresh 10s
              </span>
              <Button size="sm" variant="outline">
                <Zap className="size-3.5 mr-1.5" />
                Manual entry
              </Button>
            </div>
          </div>
        </div>

        <div className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">
          {/* KPI strip */}
          <StatStrip rows={ALL_ROWS} />

          {/* Filter row */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 border rounded p-1 bg-white">
              {STATUS_GROUPS.map((g) => {
                const count = ALL_ROWS.filter((r) => g.statuses.includes(r.status)).length;
                const active = g.id === groupId;
                return (
                  <button
                    key={g.id}
                    onClick={() => setGroupId(g.id)}
                    className={`px-3 py-1.5 text-xs rounded transition-colors ${
                      active
                        ? "bg-zinc-900 text-white"
                        : "text-zinc-600 hover:bg-zinc-100"
                    }`}
                  >
                    {g.label}{" "}
                    <span className={active ? "text-zinc-300" : "text-zinc-400"}>
                      ({count})
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="relative flex-1 max-w-md">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Search customer, lane, ID..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full h-9 pl-8 pr-3 rounded border border-zinc-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
            </div>

            <Button variant="outline" size="sm">
              <Filter className="size-3.5 mr-1.5" />
              Filters
            </Button>
            <Button variant="outline" size="sm">
              <ArrowDownUp className="size-3.5 mr-1.5" />
              Time in state
            </Button>
          </div>

          {/* Table */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">
                {group.label} ({visibleRowCount})
              </CardTitle>
              <div className="text-[11px] text-zinc-500 font-mono">
                sorted by time-in-state asc · {filtered.filter((e) => e.kind === "group").length} grouped
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow className="text-[11px] uppercase tracking-wide">
                    <TableHead>Customer</TableHead>
                    <TableHead>Lane</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" /> Time in state
                      </span>
                    </TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.flatMap((entry) => {
                    if (entry.kind === "group") {
                      const g = entry.group;
                      const isOpen = !!expanded[g.groupId];
                      const oldestKid = g.children.reduce((a, b) =>
                        a.enteredStateAt > b.enteredStateAt ? a : b,
                      );
                      const parentRow = (
                        <TableRow
                          key={g.groupId}
                          className="hover:bg-violet-50/40 cursor-pointer bg-violet-50/20 border-l-2 border-l-violet-300"
                          onClick={() => toggleGroup(g.groupId)}
                        >
                          <TableCell>
                            <div className="flex items-start gap-2">
                              <span className="mt-0.5 text-violet-600">
                                {isOpen ? (
                                  <ChevronDown className="size-4" />
                                ) : (
                                  <ChevronRight className="size-4" />
                                )}
                              </span>
                              <div>
                                <div className="font-medium text-sm flex items-center gap-2">
                                  {g.customer}
                                  <Badge className="bg-violet-100 text-violet-800 text-[10px] uppercase tracking-wide flex items-center gap-1">
                                    <Layers className="size-2.5" />
                                    {g.children.length} options
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-2 text-[11px] text-zinc-500 font-mono">
                                  <span>{g.groupId}</span>
                                  {g.customerYTD && (
                                    <>
                                      <span className="text-zinc-300">·</span>
                                      <span>YTD {g.customerYTD}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 text-sm font-mono">
                              <span>{g.origin}</span>
                              <ArrowRight className="size-3 text-zinc-400" />
                              <span>{g.destination}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-xs text-zinc-500 italic">
                              {Array.from(new Set(g.children.map((c) => c.mode))).join(" / ")}
                            </div>
                            <div className="text-[10px] text-zinc-400">
                              {Array.from(new Set(g.children.map((c) => c.siblingIntent).filter(Boolean))).join(" · ")}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-[11px] text-zinc-600">
                              {summarizeGroupStatus(g.children)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <SourceIcon source={g.source} />
                              {g.sourceInbox && (
                                <span className="text-[11px] text-zinc-500 font-mono">
                                  {g.sourceInbox}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-violet-700 mt-0.5 flex items-center gap-1">
                              <Sparkles className="size-2.5" />
                              split by AI · {Math.round(g.splitConfidence * 100)}% confidence
                            </div>
                          </TableCell>
                          <TableCell>
                            <div
                              className={`text-sm font-mono ${timeTone(oldestKid.enteredStateAt, oldestKid.status)}`}
                            >
                              {formatTime(oldestKid.enteredStateAt)}
                            </div>
                            <div className="text-[10px] text-zinc-400">
                              email received {formatTime(g.receivedAt)} ago
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-[11px] text-zinc-600">
                              {g.children.filter((c) => c.status === "recommended").length} ready to send,{" "}
                              {g.children.filter((c) => c.status === "sourcing").length} sourcing
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleGroup(g.groupId);
                              }}
                            >
                              {isOpen ? "Collapse" : "Expand"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );

                      if (!isOpen) return [parentRow];

                      const childRows = g.children
                        .slice()
                        .sort((a, b) => a.enteredStateAt - b.enteredStateAt)
                        .map((c) => (
                          <TableRow
                            key={c.id}
                            className="hover:bg-zinc-50 cursor-pointer border-l-2 border-l-violet-100 bg-violet-50/[0.04]"
                          >
                            <TableCell>
                              <div className="pl-7">
                                <div className="text-sm flex items-center gap-2">
                                  <span className="text-zinc-400 font-mono text-[10px]">↳</span>
                                  <span className="font-medium">{c.siblingIntent ?? c.mode}</span>
                                </div>
                                <div className="text-[11px] text-zinc-500 font-mono pl-4">
                                  {c.id}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-[11px] text-zinc-400">same lane</span>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">{c.mode}</div>
                              {c.equipment && (
                                <div className="text-[11px] text-zinc-500">{c.equipment}</div>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge className={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                            </TableCell>
                            <TableCell>
                              <span className="text-[11px] text-zinc-400">via group</span>
                            </TableCell>
                            <TableCell>
                              <div
                                className={`text-sm font-mono ${timeTone(c.enteredStateAt, c.status)}`}
                              >
                                {formatTime(c.enteredStateAt)}
                              </div>
                            </TableCell>
                            <TableCell>
                              {c.status === "sourcing" && (
                                <div className="flex items-center gap-2 text-xs">
                                  <PulsingBrain size={14} />
                                  <span className="text-zinc-600 font-mono">
                                    {c.carriersResponded}/{c.carriersInvited}
                                  </span>
                                </div>
                              )}
                              {c.status === "recommended" && c.topRecommendation && (
                                <div>
                                  <div className="text-xs flex items-center gap-1">
                                    <Star className="size-3 fill-emerald-500 text-emerald-500" />
                                    <span className="font-mono">{c.topRecommendation}</span>
                                  </div>
                                  {c.margin && (
                                    <div className="text-[10px] text-emerald-700 font-mono">
                                      margin {c.margin}
                                    </div>
                                  )}
                                </div>
                              )}
                              {(c.status === "new" || c.status === "gathering") && c.missing && (
                                <div className="text-[11px] text-amber-700">
                                  missing: {c.missing.slice(0, 2).join(", ")}
                                  {c.missing.length > 2 && ` +${c.missing.length - 2}`}
                                </div>
                              )}
                              {c.status === "ready" && (
                                <div className="flex items-center gap-1.5 text-xs">
                                  <Sparkles className="size-3 text-violet-600" />
                                  <span className="text-zinc-600">prep done</span>
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">{actionFor(c)}</TableCell>
                          </TableRow>
                        ));

                      return [parentRow, ...childRows];
                    }

                    const r = entry.row;
                    return [(
                    <TableRow key={r.id} className="hover:bg-zinc-50 cursor-pointer">
                      <TableCell>
                        <div className="font-medium text-sm">{r.customer}</div>
                        <div className="flex items-center gap-2 text-[11px] text-zinc-500 font-mono">
                          <span>{r.id}</span>
                          {r.customerYTD && (
                            <>
                              <span className="text-zinc-300">·</span>
                              <span>YTD {r.customerYTD}</span>
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-sm font-mono">
                          <span>{r.origin}</span>
                          <ArrowRight className="size-3 text-zinc-400" />
                          <span>{r.destination}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{r.mode}</div>
                        {r.equipment && (
                          <div className="text-[11px] text-zinc-500">{r.equipment}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={STATUS_TONE[r.status]}>
                          {STATUS_LABEL[r.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <SourceIcon source={r.source} />
                          {r.sourceInbox && (
                            <span className="text-[11px] text-zinc-500 font-mono">
                              {r.sourceInbox}
                            </span>
                          )}
                          {!r.sourceInbox && (
                            <span className="text-[11px] text-zinc-500 capitalize">
                              {r.source}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className={`text-sm font-mono ${timeTone(r.enteredStateAt, r.status)}`}>
                          {formatTime(r.enteredStateAt)}
                        </div>
                        <div className="text-[10px] text-zinc-400">
                          received {formatTime(r.receivedAt)} ago
                        </div>
                      </TableCell>
                      <TableCell>
                        {r.status === "sourcing" && (
                          <div className="flex items-center gap-2 text-xs">
                            <PulsingBrain size={14} />
                            <span className="text-zinc-600 font-mono">
                              {r.carriersResponded}/{r.carriersInvited}
                            </span>
                          </div>
                        )}
                        {r.status === "recommended" && r.topRecommendation && (
                          <div>
                            <div className="text-xs flex items-center gap-1">
                              <Star className="size-3 fill-emerald-500 text-emerald-500" />
                              <span className="font-mono">{r.topRecommendation}</span>
                            </div>
                            {r.margin && (
                              <div className="text-[10px] text-emerald-700 font-mono">
                                margin {r.margin}
                              </div>
                            )}
                          </div>
                        )}
                        {r.status === "sent" && r.topRecommendation && (
                          <div className="text-xs text-zinc-600 font-mono">
                            {r.topRecommendation}
                          </div>
                        )}
                        {r.status === "won" && r.topRecommendation && (
                          <div className="text-xs text-emerald-700 font-mono">
                            {r.topRecommendation}
                          </div>
                        )}
                        {r.status === "lost" && r.topRecommendation && (
                          <div className="text-xs text-zinc-500 font-mono line-through">
                            {r.topRecommendation}
                          </div>
                        )}
                        {(r.status === "new" || r.status === "gathering") && r.missing && (
                          <div className="text-[11px] text-amber-700">
                            missing: {r.missing.slice(0, 2).join(", ")}
                            {r.missing.length > 2 && ` +${r.missing.length - 2}`}
                          </div>
                        )}
                        {r.status === "ready" && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <Sparkles className="size-3 text-violet-600" />
                            <span className="text-zinc-600">prep done · ready to fan out</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{actionFor(r)}</TableCell>
                    </TableRow>
                    )];
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Footer note */}
          <div className="text-[11px] text-zinc-400 text-center pb-6 max-w-3xl mx-auto leading-relaxed">
            Mock-up · static data, no backend calls. <em>Send RFQ</em> on a{" "}
            <span className="font-mono">ready</span> row opens the carrier slide-out;{" "}
            <em>Ask for info</em> on a <span className="font-mono">new</span> /{" "}
            <span className="font-mono">gathering</span> row opens the missing-fields panel.{" "}
            <span className="text-violet-700">Sibling groups</span> (e.g. Apex Pharma · 5 options)
            represent one inbound email split by classify-email into N quote drafts;
            click the chevron to expand. Per-quote workspace lives at{" "}
            <span className="font-mono">/dev/quote-preview</span>.
          </div>
        </div>

        {/* Slide-out panels */}
        <SendRfqPanel row={sendRfqRow} onClose={() => setSendRfqRow(null)} />
        <AskInfoPanel row={askInfoRow} onClose={() => setAskInfoRow(null)} />
      </div>
    </PageGuard>
  );
}
