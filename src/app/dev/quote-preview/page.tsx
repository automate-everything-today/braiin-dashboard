"use client";

/**
 * Visual mock-up of the Braiin quoting workspace.
 *
 * Static page, no backend calls. Hardcoded data so we can react to the
 * design without committing to the full build. Uses real shadcn primitives
 * + Open Sans + Geist Mono + the pulsing brain loader so what you see
 * here is what the production page will look like.
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
  ArrowRight,
  CheckCircle2,
  Container,
  Eye,
  EyeOff,
  Mail,
  Merge,
  Package,
  Receipt,
  Ship,
  Sparkles,
  Star,
  TrendingUp,
  Truck,
  User,
  X,
  XCircle,
} from "lucide-react";

// ----------------- Mock data -----------------

const QUOTE = {
  id: "BR-2026-0428-1234",
  customer: "ABC Manufacturing Ltd",
  customerYTD: "£187k",
  customerWinRate: "62%",
  origin: { code: "GBFXT", name: "Felixstowe" },
  destination: { code: "CNSHA", name: "Shanghai" },
  mode: "Sea FCL",
  equipment: "2× 40HC",
  volume: "~50 CBM, 18,000 kg",
  commodity: "Electronics, non-haz",
  incoterms: "DDP",
  collectionDate: "Wed 3 May",
  validityNeeded: "14 days",
  status: "sourcing",
  priorityProfile: { price: 0.55, speed: 0.15, service: 0.25, match: 0.05 },
  priorityNote: "Last 5 wins were cheapest. Asks 'is this carrier reliable?' on every quote.",
};

const CONVERSATION = [
  {
    role: "ai" as const,
    time: "09:14",
    body: (
      <>
        Got an RFQ from <b>ABC Manufacturing</b> — Felixstowe → Shanghai, 2×40HC, electronics, urgent.
        Pulled their priority profile: price-led (55%), service-aware (25%). Last 5 wins were
        cheapest carrier.
        <br />
        <br />
        Missing: <span className="text-amber-700">collection date</span>,{" "}
        <span className="text-amber-700">stackability</span>,{" "}
        <span className="text-amber-700">DDP duty handling confirmed?</span>
      </>
    ),
  },
  {
    role: "user" as const,
    time: "09:15",
    body: <>Wed 3 May collection, stackable, ABC handles their own duty under DDP.</>,
  },
  {
    role: "ai" as const,
    time: "09:15",
    body: (
      <>
        Got it. Fanning out to top 8 carriers for this lane plus live API rates. Standard FXT-CNSHA
        carrier mix:
        <ul className="list-disc pl-5 mt-2 text-zinc-600 text-[13px]">
          <li>Maersk Spot API · MSC e-Booking · CMA API · ONE</li>
          <li>Hapag-Lloyd Quick Quotes · Evergreen E-Quote · OOCL</li>
          <li>Cargo.one aggregator (top 3 returned)</li>
        </ul>
      </>
    ),
  },
  {
    role: "ai" as const,
    time: "09:23",
    body: (
      <>
        4 of 8 back. <b>Hapag, Maersk, MSC, CMA</b> all returned. Waiting on ONE, Evergreen, OOCL,
        Cargo.one. Live grid below — I'll surface a recommendation once 6+ are in.
      </>
    ),
  },
];

interface RfqRow {
  carrierCode: string;
  carrierName: string;
  score: number;
  options: Array<{
    product: string;
    amount: number;
    valid: string;
    transit: string;
    note?: string;
    recommended?: boolean;
  }>;
  status: "received" | "waiting" | "timeout" | "in_progress";
  source: "API" | "Email" | "Aggregator";
  margin?: string;
}

const RFQ_ROWS: RfqRow[] = [
  {
    carrierCode: "HLCU",
    carrierName: "Hapag-Lloyd",
    score: 82,
    source: "API",
    status: "received",
    margin: "+14%",
    options: [
      { product: "Standard", amount: 2510, valid: "14d", transit: "32d", recommended: true },
    ],
  },
  {
    carrierCode: "MSCU",
    carrierName: "MSC",
    score: 79,
    source: "API",
    status: "received",
    margin: "+18%",
    options: [
      { product: "Standard", amount: 2450, valid: "7d", transit: "33d" },
      { product: "Premium fixed", amount: 2680, valid: "21d", transit: "31d" },
    ],
  },
  {
    carrierCode: "MAEU",
    carrierName: "Maersk",
    score: 82,
    source: "API",
    status: "received",
    margin: "+9%",
    options: [
      { product: "Maersk Spot", amount: 2580, valid: "10d", transit: "32d", note: "Subject to space" },
    ],
  },
  {
    carrierCode: "CMDU",
    carrierName: "CMA CGM",
    score: 85,
    source: "API",
    status: "received",
    margin: "+13%",
    options: [
      { product: "Standard", amount: 2620, valid: "14d", transit: "31d" },
    ],
  },
  {
    carrierCode: "ONEY",
    carrierName: "Ocean Network Express",
    score: 71,
    source: "Email",
    status: "in_progress",
    options: [],
  },
  {
    carrierCode: "EGLV",
    carrierName: "Evergreen Marine",
    score: 76,
    source: "Email",
    status: "in_progress",
    options: [],
  },
  {
    carrierCode: "OOLU",
    carrierName: "OOCL",
    score: 73,
    source: "Email",
    status: "in_progress",
    options: [],
  },
  {
    carrierCode: "AGG",
    carrierName: "Cargo.one (aggregated)",
    score: 0,
    source: "Aggregator",
    status: "in_progress",
    options: [],
  },
];

const RECENT_FEEDBACK = [
  { customer: "ABC", carrier: "Hapag-Lloyd", outcome: "won", note: "Customer flagged Hapag's reliability stat as decisive" },
  { customer: "ABC", carrier: "MSC", outcome: "lost", note: "Lost on transit — customer pushed back on 33d" },
  { customer: "ABC", carrier: "Maersk", outcome: "won", note: "Won on schedule alignment" },
];

// ----------------- Helpers -----------------

// Shared small-pill class so badges don't compete with action buttons
// for attention. Matches the same constant in /dev/quote-inbox.
const PILL_SM = "text-[10px] px-1.5 py-0 leading-[18px] h-[18px] font-normal tracking-normal";

function fmtMoney(n: number, cur = "£") {
  return `${cur}${n.toLocaleString()}`;
}

function ScoreBadge({ score }: { score: number }) {
  if (score === 0) return <span className="text-zinc-400 text-xs">—</span>;
  const tone =
    score >= 80
      ? "bg-emerald-100 text-emerald-800"
      : score >= 70
        ? "bg-amber-100 text-amber-800"
        : "bg-rose-100 text-rose-800";
  return <Badge className={`${tone} ${PILL_SM} font-mono`}>{score}</Badge>;
}

function StatusPill({ status }: { status: RfqRow["status"] }) {
  if (status === "received") return <Badge className={`${PILL_SM} bg-emerald-100 text-emerald-800`}>received</Badge>;
  if (status === "timeout") return <Badge className={`${PILL_SM} bg-rose-100 text-rose-800`}>timeout</Badge>;
  return null; // in_progress shown with brain animation
}

function PulsingBrain({ size = 24, message }: { size?: number; message?: string }) {
  return (
    <div className="inline-flex items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <span
          className="absolute inset-0 rounded-full bg-zinc-200/70 animate-ping"
          style={{ animationDuration: "2s" }}
        />
        <Image
          src="/brain-icon.png"
          alt="loading"
          width={size}
          height={size}
          className="relative animate-pulse"
          style={{ animationDuration: "1.5s" }}
        />
      </div>
      {message && <span className="text-xs text-zinc-500">{message}</span>}
    </div>
  );
}

// ============================================================
// Quote breakdown - charge-line data + slide-in panel
// ============================================================

type ChargeCategory =
  | "origin"
  | "pickup"
  | "freight"
  | "surcharges"
  | "destination"
  | "delivery"
  | "customs"
  | "insurance"
  | "other";

interface ChargeLine {
  id: string;
  category: ChargeCategory;
  code: string;
  description: string;
  costAmount: number;
  currency: "GBP" | "USD" | "EUR";
  // Defaults applied when the line is rendered. Operator can override
  // any of these.
  defaultMarginPct: number;
  defaultVisible: boolean;
  // Optional grouping label that consolidates this line under a
  // single rolled-up entry on the customer view.
  defaultConsolidateAs: string | null;
}

const CATEGORY_LABEL: Record<ChargeCategory, string> = {
  origin: "Origin",
  pickup: "Pickup / collection",
  freight: "Freight",
  surcharges: "Surcharges",
  destination: "Destination",
  delivery: "Delivery",
  customs: "Customs",
  insurance: "Insurance",
  other: "Other",
};

const CATEGORY_TONE: Record<ChargeCategory, string> = {
  origin: "border-l-amber-300",
  pickup: "border-l-amber-300",
  freight: "border-l-violet-300",
  surcharges: "border-l-rose-300",
  destination: "border-l-cyan-300",
  delivery: "border-l-cyan-300",
  customs: "border-l-emerald-300",
  insurance: "border-l-zinc-300",
  other: "border-l-zinc-300",
};

// Hapag-Lloyd Standard cost basis broken down to charge level.
// Total cost £2,510 = sum of these lines.
const HAPAG_LINES: ChargeLine[] = [
  // Origin
  { id: "ORG-THC", category: "origin", code: "THC", description: "Terminal handling - Felixstowe", costAmount: 195, currency: "GBP", defaultMarginPct: 14, defaultVisible: true, defaultConsolidateAs: "Origin charges" },
  { id: "ORG-DOC", category: "origin", code: "DOC", description: "Documentation fee", costAmount: 60, currency: "GBP", defaultMarginPct: 14, defaultVisible: true, defaultConsolidateAs: "Origin charges" },
  { id: "ORG-EXA", category: "origin", code: "EXA", description: "Container examination charge (UK)", costAmount: 25, currency: "GBP", defaultMarginPct: 14, defaultVisible: true, defaultConsolidateAs: "Origin charges" },
  { id: "ORG-AMS", category: "origin", code: "AMS", description: "AMS / ENS filing fee", costAmount: 35, currency: "GBP", defaultMarginPct: 14, defaultVisible: false, defaultConsolidateAs: "Origin charges" },

  // Pickup
  { id: "PCK-HAUL", category: "pickup", code: "HAUL", description: "Haulage supplier door to FXT", costAmount: 220, currency: "GBP", defaultMarginPct: 14, defaultVisible: true, defaultConsolidateAs: null },

  // Freight
  { id: "FRT-OCEAN", category: "freight", code: "OCN", description: "Ocean freight - all-in basic", costAmount: 1320, currency: "GBP", defaultMarginPct: 12, defaultVisible: true, defaultConsolidateAs: null },

  // Surcharges
  { id: "SCH-BAF", category: "surcharges", code: "BAF", description: "Bunker adjustment factor", costAmount: 180, currency: "GBP", defaultMarginPct: 14, defaultVisible: false, defaultConsolidateAs: "Surcharges" },
  { id: "SCH-LSF", category: "surcharges", code: "LSF", description: "Low sulphur fuel surcharge", costAmount: 75, currency: "GBP", defaultMarginPct: 14, defaultVisible: false, defaultConsolidateAs: "Surcharges" },
  { id: "SCH-PSS", category: "surcharges", code: "PSS", description: "Peak season surcharge", costAmount: 90, currency: "GBP", defaultMarginPct: 14, defaultVisible: false, defaultConsolidateAs: "Surcharges" },
  { id: "SCH-WAR", category: "surcharges", code: "WAR", description: "War risk / piracy surcharge", costAmount: 30, currency: "GBP", defaultMarginPct: 14, defaultVisible: false, defaultConsolidateAs: "Surcharges" },

  // Destination
  { id: "DST-THC", category: "destination", code: "DTHC", description: "Destination terminal handling - Shanghai", costAmount: 220, currency: "GBP", defaultMarginPct: 14, defaultVisible: true, defaultConsolidateAs: "Destination charges" },
  { id: "DST-DOC", category: "destination", code: "DOC", description: "Destination documentation fee", costAmount: 45, currency: "GBP", defaultMarginPct: 14, defaultVisible: true, defaultConsolidateAs: "Destination charges" },

  // Delivery (deliberately deferred - customer arranges import side)
  // (none for this lane)

  // Customs
  { id: "CST-CLR", category: "customs", code: "CLR", description: "UK export customs clearance", costAmount: 15, currency: "GBP", defaultMarginPct: 14, defaultVisible: true, defaultConsolidateAs: null },
];

// ----- Charge state machine for the panel -----

interface LineState {
  marginPct: number;
  visible: boolean;
  consolidateAs: string | null;
}

function fmtCurrency(amount: number, currency: string) {
  const sym = currency === "USD" ? "$" : currency === "EUR" ? "€" : "£";
  return `${sym}${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

interface BreakdownPanelProps {
  open: boolean;
  onClose: () => void;
}

function BreakdownPanel({ open, onClose }: BreakdownPanelProps) {
  const [state, setState] = useState<Record<string, LineState>>(() =>
    HAPAG_LINES.reduce(
      (acc, l) => ({
        ...acc,
        [l.id]: {
          marginPct: l.defaultMarginPct,
          visible: l.defaultVisible,
          consolidateAs: l.defaultConsolidateAs,
        },
      }),
      {},
    ),
  );

  function update(id: string, patch: Partial<LineState>) {
    setState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  }

  // Operator-facing totals
  const totals = useMemo(() => {
    let cost = 0;
    let sell = 0;
    for (const l of HAPAG_LINES) {
      const s = state[l.id];
      cost += l.costAmount;
      sell += l.costAmount * (1 + s.marginPct / 100);
    }
    const margin = sell - cost;
    const marginPct = cost > 0 ? (margin / cost) * 100 : 0;
    return { cost, sell, margin, marginPct };
  }, [state]);

  // Customer-facing rolled-up view: lines that are visible. Consolidated
  // groups roll up cost and use the worst-case margin so the operator
  // doesn't accidentally undersell.
  const customerView = useMemo(() => {
    interface OutLine {
      label: string;
      sell: number;
      hiddenLineIds: string[];
    }
    const grouped = new Map<string, OutLine>();
    const flat: OutLine[] = [];

    for (const l of HAPAG_LINES) {
      const s = state[l.id];
      if (!s.visible) continue;
      const sell = l.costAmount * (1 + s.marginPct / 100);
      if (s.consolidateAs) {
        const existing = grouped.get(s.consolidateAs);
        if (existing) {
          existing.sell += sell;
          existing.hiddenLineIds.push(l.id);
        } else {
          const o: OutLine = {
            label: s.consolidateAs,
            sell,
            hiddenLineIds: [l.id],
          };
          grouped.set(s.consolidateAs, o);
          flat.push(o);
        }
      } else {
        flat.push({ label: l.description, sell, hiddenLineIds: [l.id] });
      }
    }
    return flat;
  }, [state]);

  if (!open) return null;

  // Group lines by category for the operator view.
  const byCategory = HAPAG_LINES.reduce(
    (acc, l) => {
      (acc[l.category] = acc[l.category] ?? []).push(l);
      return acc;
    },
    {} as Record<ChargeCategory, ChargeLine[]>,
  );

  const orderedCategories: ChargeCategory[] = [
    "origin",
    "pickup",
    "freight",
    "surcharges",
    "destination",
    "delivery",
    "customs",
    "insurance",
    "other",
  ];

  // Pre-existing consolidation labels - operator can pick from these or type new
  const existingGroups = Array.from(
    new Set(HAPAG_LINES.map((l) => l.defaultConsolidateAs).filter(Boolean) as string[]),
  );

  const visibleCount = HAPAG_LINES.filter((l) => state[l.id].visible).length;
  const hiddenCount = HAPAG_LINES.length - visibleCount;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-zinc-900/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="w-[860px] bg-white border-l border-zinc-200 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="border-b px-5 py-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
              <Receipt className="size-3.5 text-zinc-700" />
              Quote breakdown
              <span className="text-zinc-300">·</span>
              <span className="font-mono">Hapag-Lloyd Standard · BR-2026-0428-1234</span>
            </div>
            <div className="font-medium">
              GBFXT <span className="text-zinc-400 mx-1">→</span> CNSHA · 2× 40HC
            </div>
            <div className="text-xs text-zinc-600 mt-1 flex items-center gap-3">
              <span>{HAPAG_LINES.length} charge lines</span>
              <span className="text-zinc-300">·</span>
              <span>
                <span className="text-emerald-700 font-medium">{visibleCount}</span> visible
              </span>
              <span className="text-zinc-300">·</span>
              <span>
                <span className="text-zinc-500">{hiddenCount}</span> hidden
              </span>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} className="size-8 p-0">
            <X className="size-4" />
          </Button>
        </div>

        {/* Top totals strip */}
        <div className="px-5 py-3 grid grid-cols-4 gap-3 border-b bg-zinc-50">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Cost</div>
            <div className="font-mono text-lg">{fmtCurrency(totals.cost, "GBP")}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Margin</div>
            <div className="font-mono text-lg text-emerald-700">
              +{totals.marginPct.toFixed(1)}%
            </div>
            <div className="text-[10px] text-zinc-500">{fmtCurrency(totals.margin, "GBP")} GP</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Sell</div>
            <div className="font-mono text-lg">{fmtCurrency(totals.sell, "GBP")}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">
              Customer sees
            </div>
            <div className="font-mono text-lg">{customerView.length} line{customerView.length === 1 ? "" : "s"}</div>
            <div className="text-[10px] text-zinc-500">after hide / consolidate</div>
          </div>
        </div>

        {/* Two-column body */}
        <div className="flex-1 overflow-y-auto grid grid-cols-12 gap-0">
          {/* OPERATOR VIEW */}
          <div className="col-span-7 border-r overflow-y-auto">
            <div className="px-5 py-3 border-b bg-white sticky top-0 z-10">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500 flex items-center gap-1.5">
                <Sparkles className="size-3 text-violet-600" />
                Operator detail · {HAPAG_LINES.length} lines
              </div>
            </div>

            {orderedCategories.map((cat) => {
              const lines = byCategory[cat];
              if (!lines || lines.length === 0) return null;
              const tone = CATEGORY_TONE[cat];
              const subTotal = lines.reduce((n, l) => n + l.costAmount, 0);

              return (
                <div key={cat} className="px-5 py-3 border-b">
                  <div className="flex items-center justify-between mb-2">
                    <div className={`text-xs font-medium border-l-4 ${tone} pl-2 text-zinc-800`}>
                      {CATEGORY_LABEL[cat]}
                    </div>
                    <div className="text-[11px] text-zinc-500 font-mono">
                      {fmtCurrency(subTotal, "GBP")}
                    </div>
                  </div>

                  <div className="space-y-1">
                    {lines.map((l) => {
                      const s = state[l.id];
                      const sell = l.costAmount * (1 + s.marginPct / 100);
                      return (
                        <div
                          key={l.id}
                          className={`grid grid-cols-12 gap-2 items-center text-xs px-2 py-1.5 rounded ${
                            !s.visible ? "opacity-50 bg-zinc-50" : "hover:bg-zinc-50"
                          }`}
                        >
                          <div className="col-span-5">
                            <div className="flex items-center gap-1.5">
                              <Badge
                                className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono`}
                              >
                                {l.code}
                              </Badge>
                              <span className="text-zinc-700">{l.description}</span>
                            </div>
                            {s.consolidateAs && (
                              <div className="text-[10px] text-violet-700 mt-0.5">
                                ↳ rolled up as {s.consolidateAs}
                              </div>
                            )}
                          </div>

                          <div className="col-span-2 text-right font-mono text-zinc-600">
                            {fmtCurrency(l.costAmount, l.currency)}
                          </div>

                          <div className="col-span-2 flex items-center gap-1">
                            <input
                              type="number"
                              value={s.marginPct}
                              step={0.5}
                              onChange={(e) =>
                                update(l.id, { marginPct: Number(e.target.value) })
                              }
                              className="w-14 h-7 px-1 text-right rounded border border-zinc-300 text-xs font-mono"
                            />
                            <span className="text-zinc-400 text-[11px]">%</span>
                          </div>

                          <div className="col-span-2 text-right font-mono text-emerald-700">
                            {fmtCurrency(sell, l.currency)}
                          </div>

                          <div className="col-span-1 flex items-center justify-end gap-0.5">
                            <button
                              onClick={() => update(l.id, { visible: !s.visible })}
                              title={s.visible ? "Hide from customer" : "Show to customer"}
                              className={`size-6 rounded inline-flex items-center justify-center ${
                                s.visible
                                  ? "text-emerald-700 hover:bg-emerald-50"
                                  : "text-zinc-400 hover:bg-zinc-100"
                              }`}
                            >
                              {s.visible ? (
                                <Eye className="size-3.5" />
                              ) : (
                                <EyeOff className="size-3.5" />
                              )}
                            </button>
                            <button
                              onClick={() => {
                                const next =
                                  s.consolidateAs === null
                                    ? existingGroups[0] ?? "Group"
                                    : null;
                                update(l.id, { consolidateAs: next });
                              }}
                              title={
                                s.consolidateAs
                                  ? "Un-consolidate"
                                  : "Roll into a group on the customer view"
                              }
                              className={`size-6 rounded inline-flex items-center justify-center ${
                                s.consolidateAs
                                  ? "text-violet-700 hover:bg-violet-50"
                                  : "text-zinc-400 hover:bg-zinc-100"
                              }`}
                            >
                              <Merge className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* CUSTOMER VIEW */}
          <div className="col-span-5 bg-zinc-50 overflow-y-auto">
            <div className="px-5 py-3 border-b bg-white sticky top-0 z-10">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500 flex items-center gap-1.5">
                <Eye className="size-3 text-emerald-700" />
                Customer view (live preview)
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="bg-white border rounded p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between text-zinc-500 text-[11px] uppercase tracking-wide pb-1 border-b">
                  <span>Description</span>
                  <span>Amount</span>
                </div>
                {customerView.map((line, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 py-0.5">
                    <span className="text-zinc-700">{line.label}</span>
                    <span className="font-mono">{fmtCurrency(line.sell, "GBP")}</span>
                  </div>
                ))}
                <Separator />
                <div className="flex items-start justify-between font-medium">
                  <span>Total all-in</span>
                  <span className="font-mono">{fmtCurrency(totals.sell, "GBP")}</span>
                </div>
                <div className="text-[10px] text-zinc-400 italic pt-1">
                  Sample - exact wording matches the PDF / email cover.
                </div>
              </div>

              <div className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
                Lines marked hidden are kept on file for audit / margin
                analysis but never shown to the customer. Consolidated
                lines are summed and shown under the group label only.
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3 flex items-center justify-between bg-white">
          <div className="text-xs text-zinc-500">
            Saved as{" "}
            <span className="font-mono">quotes.charge_lines</span> + per-line{" "}
            <span className="font-mono">visible_to_customer</span> /{" "}
            <span className="font-mono">consolidated_into_group</span> /{" "}
            <span className="font-mono">margin_pct_override</span>.
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
              Save breakdown
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: RfqRow["source"] }) {
  const tone =
    source === "API"
      ? "bg-violet-100 text-violet-800"
      : source === "Aggregator"
        ? "bg-cyan-100 text-cyan-800"
        : "bg-zinc-100 text-zinc-700";
  return <Badge className={`${tone} ${PILL_SM} uppercase tracking-wide`}>{source}</Badge>;
}

// ----------------- Page -----------------

export default function QuotePreviewPage() {
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  return (
    <PageGuard pageId="dev_quote_preview">
      <div className="min-h-screen bg-zinc-50">
        {/* ---- Top bar ---- */}
        <div className="border-b bg-white">
          <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Ship className="size-5 text-zinc-600" />
                <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-700 font-mono`}>
                  {QUOTE.id}
                </Badge>
              </div>
              <Separator orientation="vertical" className="h-6" />
              <div className="text-sm font-medium">{QUOTE.customer}</div>
              <Separator orientation="vertical" className="h-6" />
              <div className="flex items-center gap-2 text-sm text-zinc-700">
                <span className="font-mono">{QUOTE.origin.code}</span>
                <ArrowRight className="size-3.5 text-zinc-400" />
                <span className="font-mono">{QUOTE.destination.code}</span>
                <span className="text-zinc-400">·</span>
                <span>{QUOTE.mode}</span>
                <span className="text-zinc-400">·</span>
                <span>{QUOTE.equipment}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={`${PILL_SM} bg-amber-100 text-amber-800`}>sourcing</Badge>
              <span className="text-xs text-zinc-500">4 of 8 carriers responded</span>
            </div>
          </div>
        </div>

        {/* ---- 3-column workspace ---- */}
        <div className="max-w-[1600px] mx-auto px-6 py-6 grid grid-cols-12 gap-6">
          {/* ===== LEFT: Quote summary ===== */}
          <div className="col-span-3 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <User className="size-4" /> Customer
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div>
                  <div className="text-sm font-medium">{QUOTE.customer}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">YTD value {QUOTE.customerYTD}</div>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-zinc-500">Win rate</div>
                    <div className="font-mono">{QUOTE.customerWinRate}</div>
                  </div>
                  <div>
                    <div className="text-zinc-500">Profile</div>
                    <div>price-led</div>
                  </div>
                </div>
                <div className="text-[11px] text-zinc-500 italic border-l-2 border-zinc-200 pl-2">
                  {QUOTE.priorityNote}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Container className="size-4" /> Routing
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-zinc-500">Origin</div>
                    <div className="font-mono">{QUOTE.origin.code}</div>
                    <div className="text-zinc-700">{QUOTE.origin.name}</div>
                  </div>
                  <div>
                    <div className="text-zinc-500">Destination</div>
                    <div className="font-mono">{QUOTE.destination.code}</div>
                    <div className="text-zinc-700">{QUOTE.destination.name}</div>
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-zinc-500">Mode</div>
                    <div>{QUOTE.mode}</div>
                  </div>
                  <div>
                    <div className="text-zinc-500">Equipment</div>
                    <div>{QUOTE.equipment}</div>
                  </div>
                </div>
                <Separator />
                <div>
                  <div className="text-zinc-500">Volume</div>
                  <div>{QUOTE.volume}</div>
                </div>
                <div>
                  <div className="text-zinc-500">Commodity</div>
                  <div>{QUOTE.commodity}</div>
                </div>
                <div>
                  <div className="text-zinc-500">Incoterms</div>
                  <div>{QUOTE.incoterms}</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Package className="size-4" /> Timing
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Collection</span>
                  <span>{QUOTE.collectionDate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Validity needed</span>
                  <span>{QUOTE.validityNeeded}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="size-4" /> Estimate (pre-fan-out)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-lg font-mono">£2,400 – £2,650</div>
                <div className="text-[11px] text-zinc-500 mt-1">
                  Based on 23 observed jobs FXT-CNSHA 40HC last 90d. Trend +3%.
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ===== CENTRE: Conversation + Live RFQ grid ===== */}
          <div className="col-span-6 space-y-6">
            {/* Conversation */}
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sparkles className="size-4 text-violet-600" /> Conversation
                </CardTitle>
                <span className="text-[11px] text-zinc-400">decision-loop active</span>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                {CONVERSATION.map((msg, i) => (
                  <div key={i} className="flex gap-3">
                    <div
                      className={`size-7 rounded-full flex items-center justify-center text-[11px] font-medium shrink-0 ${
                        msg.role === "ai"
                          ? "bg-violet-100 text-violet-700"
                          : "bg-zinc-200 text-zinc-700"
                      }`}
                    >
                      {msg.role === "ai" ? "AI" : "RD"}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-medium">
                          {msg.role === "ai" ? "Braiin" : "Rob Donald"}
                        </span>
                        <span className="text-[10px] text-zinc-400 font-mono">{msg.time}</span>
                      </div>
                      <div className="text-sm text-zinc-700 mt-0.5 leading-relaxed">{msg.body}</div>
                    </div>
                  </div>
                ))}
                <div className="flex gap-3 pt-2">
                  <div className="size-7 rounded-full flex items-center justify-center text-[11px] font-medium shrink-0 bg-violet-100 text-violet-700">
                    AI
                  </div>
                  <div className="flex-1">
                    <PulsingBrain size={20} message="watching for more responses..." />
                  </div>
                </div>

                <Separator />

                {/* Composer */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Reply to Braiin..."
                    className="flex-1 h-9 px-3 rounded border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                  />
                  <Button size="sm" variant="outline">
                    Override carrier list
                  </Button>
                  <Button size="sm">Send</Button>
                </div>
              </CardContent>
            </Card>

            {/* Live RFQ grid */}
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Live RFQ grid</CardTitle>
                <div className="text-[11px] text-zinc-500 font-mono">8 invited · 4 received · 4 waiting</div>
              </CardHeader>
              <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow className="text-[11px] uppercase tracking-wide">
                      <TableHead>Carrier</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead>Valid</TableHead>
                      <TableHead>Transit</TableHead>
                      <TableHead>Margin</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {RFQ_ROWS.flatMap((r) => {
                      if (r.options.length === 0) {
                        return (
                          <TableRow key={r.carrierCode} className="text-zinc-400">
                            <TableCell>
                              <div className="font-medium text-zinc-700">{r.carrierName}</div>
                              <div className="font-mono text-[10px] text-zinc-400">{r.carrierCode}</div>
                            </TableCell>
                            <TableCell>
                              <ScoreBadge score={r.score} />
                            </TableCell>
                            <TableCell>
                              <SourceBadge source={r.source} />
                            </TableCell>
                            <TableCell colSpan={5}>
                              <PulsingBrain size={20} message="awaiting reply..." />
                            </TableCell>
                            <TableCell></TableCell>
                          </TableRow>
                        );
                      }
                      return r.options.map((o, idx) => {
                        const recommended = !!o.recommended;
                        return (
                          <TableRow
                            key={`${r.carrierCode}-${o.product}`}
                            className={recommended ? "bg-emerald-50/60 hover:bg-emerald-50" : ""}
                          >
                            <TableCell>
                              {idx === 0 ? (
                                <>
                                  <div className="font-medium flex items-center gap-1.5">
                                    {r.carrierName}
                                    {recommended && <Star className="size-3.5 fill-emerald-500 text-emerald-500" />}
                                  </div>
                                  <div className="font-mono text-[10px] text-zinc-400">{r.carrierCode}</div>
                                </>
                              ) : (
                                <div className="text-zinc-300 text-xs pl-2">↳</div>
                              )}
                            </TableCell>
                            <TableCell>
                              {idx === 0 ? <ScoreBadge score={r.score} /> : null}
                            </TableCell>
                            <TableCell>{idx === 0 ? <SourceBadge source={r.source} /> : null}</TableCell>
                            <TableCell className="text-sm">
                              <div>{o.product}</div>
                              {o.note && <div className="text-[10px] text-zinc-500">{o.note}</div>}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {fmtMoney(o.amount)}
                            </TableCell>
                            <TableCell className="text-xs font-mono">{o.valid}</TableCell>
                            <TableCell className="text-xs font-mono">{o.transit}</TableCell>
                            <TableCell className="text-xs font-mono text-emerald-700">
                              {idx === 0 ? r.margin : ""}
                            </TableCell>
                            <TableCell>
                              {recommended ? (
                                <Badge className={`${PILL_SM} bg-emerald-100 text-emerald-800`}>pick</Badge>
                              ) : (
                                <Button size="sm" variant="ghost" className="h-6 text-xs">
                                  use
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      });
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* ===== RIGHT: Recommendation ===== */}
          <div className="col-span-3 space-y-4">
            <Card className="border-emerald-200 bg-emerald-50/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Star className="size-4 fill-emerald-500 text-emerald-500" />
                  Recommendation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div>
                  <div className="text-lg font-medium">Hapag-Lloyd</div>
                  <div className="font-mono text-2xl mt-1">£2,510</div>
                  <div className="text-xs text-zinc-500 mt-1">Standard · 14d valid · 32d transit</div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wide text-zinc-500">Why</div>
                  <ul className="space-y-1.5 text-xs text-zinc-700">
                    <li className="flex gap-2">
                      <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      <span>94% on-time on this lane (last 90d) · industry avg 81%</span>
                    </li>
                    <li className="flex gap-2">
                      <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      <span>0 incidents in last 12 jobs together</span>
                    </li>
                    <li className="flex gap-2">
                      <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      <span>14d validity gives ABC time to confirm</span>
                    </li>
                    <li className="flex gap-2">
                      <CheckCircle2 className="size-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      <span>Within target margin (14%)</span>
                    </li>
                  </ul>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                    Margin
                  </div>
                  <button
                    onClick={() => setBreakdownOpen(true)}
                    className="text-[11px] text-emerald-700 hover:underline inline-flex items-center gap-1"
                  >
                    <Receipt className="size-3" />
                    View full breakdown
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="border rounded p-2 bg-white">
                    <div className="text-[10px] text-zinc-500">Cost</div>
                    <div className="font-mono text-xs">£2,510</div>
                  </div>
                  <div className="border rounded p-2 bg-white">
                    <div className="text-[10px] text-zinc-500">Margin</div>
                    <div className="font-mono text-xs text-emerald-700">+14%</div>
                  </div>
                  <div className="border rounded p-2 bg-white">
                    <div className="text-[10px] text-zinc-500">Sell</div>
                    <div className="font-mono text-xs">£2,861</div>
                  </div>
                </div>

                <Button className="w-full mt-2">
                  Use this · Send to ABC
                </Button>
                <Button variant="outline" className="w-full">
                  Override / pick alternative
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Alternatives</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3 text-xs">
                <div className="border-l-2 border-zinc-200 pl-3">
                  <div className="font-medium flex items-center justify-between">
                    <span>MSC Standard</span>
                    <span className="font-mono">£2,450</span>
                  </div>
                  <div className="text-zinc-500 mt-0.5">
                    Cheapest · margin +18% · BUT validity only 7d, service score 12pts lower
                  </div>
                </div>
                <div className="border-l-2 border-zinc-200 pl-3">
                  <div className="font-medium flex items-center justify-between">
                    <span>Maersk Spot</span>
                    <span className="font-mono">£2,580</span>
                  </div>
                  <div className="text-zinc-500 mt-0.5">
                    Slim margin · "subject to space" caveat
                  </div>
                </div>
                <div className="border-l-2 border-zinc-200 pl-3">
                  <div className="font-medium flex items-center justify-between">
                    <span>CMA Standard</span>
                    <span className="font-mono">£2,620</span>
                  </div>
                  <div className="text-zinc-500 mt-0.5">
                    Best score (85) · 31d transit beats Hapag by 1d · margin +13%
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Mail className="size-4" /> Customer-facing draft
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="border rounded bg-white p-3 text-xs text-zinc-700 space-y-2">
                  <div>Hi Jane,</div>
                  <div>
                    Quote attached for your 2×40HC Felixstowe → Shanghai shipment, collection Wed 3
                    May.
                  </div>
                  <div>
                    Headline: <b>£2,861 all-in</b>, valid 14 days, 32-day transit. Recommended carrier
                    Hapag-Lloyd selected on the basis of 94% on-time delivery on this lane (vs ~81%
                    industry average) and zero incidents across our last 12 sailings together. Two
                    alternatives also available — happy to discuss if a different balance suits.
                  </div>
                  <div>Best,</div>
                  <div>Rob</div>
                </div>
                <Button variant="outline" size="sm" className="w-full mt-2">
                  Edit cover
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  Recent feedback signal
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {RECENT_FEEDBACK.map((f, i) => (
                  <div key={i} className="text-[11px] flex items-start gap-2 border-l-2 border-zinc-200 pl-2">
                    {f.outcome === "won" ? (
                      <CheckCircle2 className="size-3 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="size-3 text-rose-600 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div>
                        <span className="text-zinc-700 font-medium">{f.customer}</span>
                        <span className="text-zinc-400 mx-1">·</span>
                        <span>{f.carrier}</span>
                      </div>
                      <div className="text-zinc-500 mt-0.5">{f.note}</div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ---- Footer disclaimer ---- */}
        <div className="max-w-[1600px] mx-auto px-6 pb-8">
          <div className="text-[11px] text-zinc-400 text-center">
            Mock-up · static data, no backend calls · uses real shadcn primitives + Open Sans + Geist
            Mono + pulsing brain loader · production page will look identical
          </div>
        </div>

        {/* Slide-in: full quote breakdown */}
        <BreakdownPanel
          open={breakdownOpen}
          onClose={() => setBreakdownOpen(false)}
        />
      </div>
    </PageGuard>
  );
}
