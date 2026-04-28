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
  Info,
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

type Currency = "GBP" | "USD" | "EUR" | "AUD";

// Five margin types matching the migration 039 enum.
//   pct           - sell = cost * (1 + value/100)
//   flat          - sell = cost + value (in margin_currency)
//   per_cbm       - sell = cost + (value * draft.volume_cbm)
//   per_kg        - sell = cost + (value * draft.weight_kg)
//   per_container - sell = cost + (value * draft.container_count)
//   per_pallet    - sell = cost + (value * draft.pallet_count)
//   override      - sell = sell_amount_override (ignore cost entirely)
type MarginType =
  | "pct"
  | "flat"
  | "per_cbm"
  | "per_kg"
  | "per_container"
  | "per_pallet"
  | "override";

interface ChargeLine {
  id: string;
  category: ChargeCategory;
  code: string;
  description: string;
  costAmount: number;
  currency: Currency;
  // Defaults applied when the line is rendered. Operator can override
  // any of these.
  defaultMarginType: MarginType;
  defaultMarginValue: number;
  defaultVisible: boolean;
  // Optional grouping label that consolidates this line under a
  // single rolled-up entry on the customer view.
  defaultConsolidateAs: string | null;
  // Indicative charges ride the quote as a caveat - they do not add
  // to the total, but the customer sees them with the caveat note so
  // they understand the conditional cost.
  defaultIsIndicative?: boolean;
  defaultCaveatNote?: string;
}

// ----- FX rates (faked for the mock - production reads geo.fx_rates) -----
// Stored as base->GBP rates; cross-pair conversion goes via GBP.
// Rates as of mock 2026-04-28.
const FX_AS_OF = "2026-04-28 09:14 UTC";
const FX_TO_GBP: Record<Currency, number> = {
  GBP: 1.0,
  USD: 0.795,
  EUR: 0.857,
  AUD: 0.519,
};

function convert(amount: number, from: Currency, to: Currency): number {
  if (from === to) return amount;
  const inGbp = amount * FX_TO_GBP[from];
  return inGbp / FX_TO_GBP[to];
}

const CURRENCY_SYMBOL: Record<Currency, string> = {
  GBP: "£",
  USD: "$",
  EUR: "€",
  AUD: "A$",
};

// ----- Draft quantity context (for per-unit margins) -----
const DRAFT_QUANTITIES = {
  volumeCbm: 50,
  weightKg: 18000,
  containerCount: 2,
  palletCount: 0,
};

const MARGIN_TYPE_LABEL: Record<MarginType, string> = {
  pct: "%",
  flat: "flat",
  per_cbm: "/CBM",
  per_kg: "/kg",
  per_container: "/cont",
  per_pallet: "/pallet",
  override: "set sell",
};

const MARGIN_TYPE_FULL_LABEL: Record<MarginType, string> = {
  pct: "% of cost",
  flat: "Flat amount",
  per_cbm: "Per CBM",
  per_kg: "Per kg",
  per_container: "Per container",
  per_pallet: "Per pallet",
  override: "Override sell",
};

function unitCountFor(type: MarginType): number {
  if (type === "per_cbm") return DRAFT_QUANTITIES.volumeCbm;
  if (type === "per_kg") return DRAFT_QUANTITIES.weightKg;
  if (type === "per_container") return DRAFT_QUANTITIES.containerCount;
  if (type === "per_pallet") return DRAFT_QUANTITIES.palletCount;
  return 0;
}

// ----- Macro-groups: how the operator + customer see charges grouped -----

type MacroGroup =
  | "origin_exw"
  | "freight"
  | "destination_delivery"
  | "insurance_other";

const MACRO_GROUP_LABEL: Record<MacroGroup, string> = {
  origin_exw: "Origin and EXW",
  freight: "Freight",
  destination_delivery: "Destination and Delivery",
  insurance_other: "Insurance and Other",
};

const MACRO_GROUP_TONE: Record<MacroGroup, string> = {
  origin_exw: "border-l-amber-400 bg-amber-50/40",
  freight: "border-l-violet-400 bg-violet-50/40",
  destination_delivery: "border-l-cyan-400 bg-cyan-50/40",
  insurance_other: "border-l-zinc-400 bg-zinc-50/40",
};

const MACRO_GROUP_ORDER: MacroGroup[] = [
  "origin_exw",
  "freight",
  "destination_delivery",
  "insurance_other",
];

// Category -> macro-group default mapping. Customs export goes to
// origin_exw; customs import would go to destination_delivery (operator
// can override per line in production via charge_lines.macro_group).
const CATEGORY_TO_MACRO: Record<ChargeCategory, MacroGroup> = {
  origin: "origin_exw",
  pickup: "origin_exw",
  customs: "origin_exw", // default - operator can override per line
  freight: "freight",
  surcharges: "freight",
  destination: "destination_delivery",
  delivery: "destination_delivery",
  insurance: "insurance_other",
  other: "insurance_other",
};

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

// Hapag-Lloyd Standard cost basis broken down to charge level. A real
// shipment quote mixes currencies: ocean freight is typically quoted
// in USD by the carrier, local UK / Chinese charges in GBP, occasionally
// EUR. The output currency chooser at the top of the panel decides how
// the customer sees the total.
const HAPAG_LINES: ChargeLine[] = [
  // Origin (UK side - GBP)
  { id: "ORG-THC", category: "origin", code: "THC", description: "Terminal handling - Felixstowe", costAmount: 195, currency: "GBP", defaultMarginType: "pct", defaultMarginValue: 14, defaultVisible: true, defaultConsolidateAs: "Origin charges" },
  { id: "ORG-DOC", category: "origin", code: "DOC", description: "Documentation fee", costAmount: 60, currency: "GBP", defaultMarginType: "flat", defaultMarginValue: 25, defaultVisible: true, defaultConsolidateAs: "Origin charges" },
  { id: "ORG-EXA", category: "origin", code: "EXA", description: "Container examination charge (UK)", costAmount: 25, currency: "GBP", defaultMarginType: "pct", defaultMarginValue: 14, defaultVisible: true, defaultConsolidateAs: "Origin charges" },
  { id: "ORG-AMS", category: "origin", code: "AMS", description: "AMS / ENS filing fee", costAmount: 45, currency: "USD", defaultMarginType: "pct", defaultMarginValue: 14, defaultVisible: false, defaultConsolidateAs: "Origin charges" },

  // Pickup
  { id: "PCK-HAUL", category: "pickup", code: "HAUL", description: "Haulage supplier door to FXT", costAmount: 220, currency: "GBP", defaultMarginType: "per_container", defaultMarginValue: 50, defaultVisible: true, defaultConsolidateAs: null },

  // Freight (typically quoted in USD by ocean carriers)
  { id: "FRT-OCEAN", category: "freight", code: "OCN", description: "Ocean freight - all-in basic FXT-CNSHA", costAmount: 1660, currency: "USD", defaultMarginType: "pct", defaultMarginValue: 12, defaultVisible: true, defaultConsolidateAs: null },

  // Surcharges
  { id: "SCH-BAF", category: "surcharges", code: "BAF", description: "Bunker adjustment factor", costAmount: 226, currency: "USD", defaultMarginType: "pct", defaultMarginValue: 14, defaultVisible: false, defaultConsolidateAs: "Surcharges" },
  { id: "SCH-LSF", category: "surcharges", code: "LSF", description: "Low sulphur fuel surcharge", costAmount: 95, currency: "USD", defaultMarginType: "pct", defaultMarginValue: 14, defaultVisible: false, defaultConsolidateAs: "Surcharges" },
  { id: "SCH-PSS", category: "surcharges", code: "PSS", description: "Peak season surcharge", costAmount: 113, currency: "USD", defaultMarginType: "pct", defaultMarginValue: 14, defaultVisible: false, defaultConsolidateAs: "Surcharges" },
  { id: "SCH-WAR", category: "surcharges", code: "WAR", description: "War risk / piracy surcharge", costAmount: 38, currency: "USD", defaultMarginType: "pct", defaultMarginValue: 14, defaultVisible: false, defaultConsolidateAs: "Surcharges" },

  // Destination (CN side - USD as charged by carrier)
  { id: "DST-THC", category: "destination", code: "DTHC", description: "Destination terminal handling - Shanghai", costAmount: 277, currency: "USD", defaultMarginType: "pct", defaultMarginValue: 14, defaultVisible: true, defaultConsolidateAs: "Destination charges" },
  { id: "DST-DOC", category: "destination", code: "DOC", description: "Destination documentation fee", costAmount: 57, currency: "USD", defaultMarginType: "pct", defaultMarginValue: 14, defaultVisible: true, defaultConsolidateAs: "Destination charges" },

  // Customs
  { id: "CST-CLR", category: "customs", code: "CLR", description: "UK export customs clearance", costAmount: 15, currency: "GBP", defaultMarginType: "flat", defaultMarginValue: 10, defaultVisible: true, defaultConsolidateAs: null },

  // Indicative charges - caveats. Visible on the quote but do NOT
  // contribute to the total. Each carries a customer-facing note.
  {
    id: "IND-DEM",
    category: "destination",
    code: "DEM",
    description: "Destination demurrage",
    costAmount: 200,
    currency: "USD",
    defaultMarginType: "flat",
    defaultMarginValue: 0,
    defaultVisible: true,
    defaultConsolidateAs: null,
    defaultIsIndicative: true,
    defaultCaveatNote: "Charged at USD 200 per container per day after 7 free days at Shanghai port",
  },
  {
    id: "IND-DET",
    category: "delivery",
    code: "DET",
    description: "Container detention",
    costAmount: 80,
    currency: "USD",
    defaultMarginType: "flat",
    defaultMarginValue: 0,
    defaultVisible: true,
    defaultConsolidateAs: null,
    defaultIsIndicative: true,
    defaultCaveatNote: "Charged at USD 80 per container per day after 4 free days at consignee premises",
  },
  {
    id: "IND-DUTY",
    category: "customs",
    code: "DUTY",
    description: "Import customs duty (China)",
    costAmount: 0,
    currency: "GBP",
    defaultMarginType: "flat",
    defaultMarginValue: 0,
    defaultVisible: true,
    defaultConsolidateAs: null,
    defaultIsIndicative: true,
    defaultCaveatNote: "Estimated 5-12% of CIF value, payable directly to Chinese customs at clearance. HS code dependent",
  },
];

// ----- Charge state machine for the panel -----

interface LineState {
  // Cost (operator-editable - pulled from carrier extraction by default,
  // overridden flag set when operator changes it)
  costAmount: number;
  costCurrency: Currency;
  costOverridden: boolean;
  // Margin model
  marginType: MarginType;
  marginValue: number;
  // For 'override' type, the explicit sell amount in margin_currency
  sellOverride?: number;
  marginCurrency: Currency;
  // Customer-facing presentation
  visible: boolean;
  consolidateAs: string | null;
  // Indicative ("FYI" / caveat) lines do not contribute to totals.
  isIndicative: boolean;
  caveatNote: string;
}

function fmtCurrency(amount: number, currency: Currency, opts?: { sym?: boolean }) {
  const sym = opts?.sym === false ? "" : CURRENCY_SYMBOL[currency];
  return `${sym}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Compute sell from a line's state, in the cost currency.
function sellAmount(line: ChargeLine, s: LineState): number {
  if (s.marginType === "override" && s.sellOverride !== undefined) {
    // Override is in marginCurrency - convert into cost currency for
    // the operator-side number, then onward into output currency at
    // render time.
    return convert(s.sellOverride, s.marginCurrency, s.costCurrency);
  }
  if (s.marginType === "pct") {
    return s.costAmount * (1 + s.marginValue / 100);
  }
  // flat / per_unit - margin is in marginCurrency, convert before adding
  const unitCount = s.marginType === "flat" ? 1 : unitCountFor(s.marginType);
  const marginInMarginCcy = s.marginValue * unitCount;
  const marginInCostCcy = convert(marginInMarginCcy, s.marginCurrency, s.costCurrency);
  return s.costAmount + marginInCostCcy;
}

// Consolidate lines that share the same `consolidateAs` group label
// into a single row. Lines without a group label keep their own
// description and stand alone. Rolled descriptions are captured so the
// customer view can show an "includes X, Y, Z" caption beneath the
// consolidated row.
interface ConsolidatedRow {
  key: string;
  label: string;
  sellNative: number;
  lineCount: number;
  rolledDescriptions: string[];
}
function consolidateLines(
  lines: Array<{ line: ChargeLine; sellNative: number; sellOutput: number }>,
  state: Record<string, LineState>,
): ConsolidatedRow[] {
  const groups = new Map<string, ConsolidatedRow>();
  const standalone: ConsolidatedRow[] = [];
  let i = 0;
  for (const { line, sellNative } of lines) {
    const s = state[line.id];
    if (s.consolidateAs) {
      const existing = groups.get(s.consolidateAs);
      if (existing) {
        existing.sellNative += sellNative;
        existing.lineCount += 1;
        existing.rolledDescriptions.push(line.description);
      } else {
        const row: ConsolidatedRow = {
          key: `grp-${s.consolidateAs}`,
          label: s.consolidateAs,
          sellNative,
          lineCount: 1,
          rolledDescriptions: [line.description],
        };
        groups.set(s.consolidateAs, row);
        standalone.push(row);
      }
    } else {
      standalone.push({
        key: `${line.id}-${i++}`,
        label: line.description,
        sellNative,
        lineCount: 1,
        rolledDescriptions: [],
      });
    }
  }
  return standalone;
}

interface BreakdownPanelProps {
  open: boolean;
  onClose: () => void;
}

function BreakdownPanel({ open, onClose }: BreakdownPanelProps) {
  // Quote-level controls
  const [outputCurrency, setOutputCurrency] = useState<Currency>("GBP");
  const [validityMode, setValidityMode] = useState<"days" | "date">("days");
  const [validityDays, setValidityDays] = useState<7 | 14 | 21 | 30>(14);
  const [validityDate, setValidityDate] = useState<string>("2026-05-12");

  // Customer-view display toggles. Operator chooses what the customer
  // sees on the quote PDF / email cover.
  const [showMacroGroups, setShowMacroGroups] = useState(true);
  const [showCurrencySubtotals, setShowCurrencySubtotals] = useState(false);
  const [showCurrencyTotals, setShowCurrencyTotals] = useState(true);
  // All-in total is always shown and cannot be hidden - it's the
  // bottom line of the quote. (Kept as state-shaped placeholder for
  // schema parity but no toggle in the UI.)

  // Per-line state
  const [state, setState] = useState<Record<string, LineState>>(() =>
    HAPAG_LINES.reduce(
      (acc, l) => ({
        ...acc,
        [l.id]: {
          costAmount: l.costAmount,
          costCurrency: l.currency,
          costOverridden: false,
          marginType: l.defaultMarginType,
          marginValue: l.defaultMarginValue,
          marginCurrency: l.currency, // default to cost currency
          visible: l.defaultVisible,
          consolidateAs: l.defaultConsolidateAs,
          isIndicative: l.defaultIsIndicative ?? false,
          caveatNote: l.defaultCaveatNote ?? "",
        } as LineState,
      }),
      {},
    ),
  );

  // Show / hide the indicative caveats section in the customer view.
  const [showIndicativeCaveats, setShowIndicativeCaveats] = useState(true);

  function update(id: string, patch: Partial<LineState>) {
    setState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  }

  // Edit-cost: operator typed a new cost. Mark overridden, sell follows
  // the existing margin.
  function setCost(id: string, costAmount: number) {
    update(id, { costAmount, costOverridden: true });
  }

  // Edit-sell: operator typed a new sell amount in the line's currency.
  // We switch margin type to 'override' and persist the value so the
  // schema keeps a clean record of what the operator chose.
  function setSell(id: string, line: ChargeLine, sellInCostCurrency: number) {
    const s = state[line.id];
    update(id, {
      marginType: "override",
      sellOverride: convert(sellInCostCurrency, s.costCurrency, s.marginCurrency),
    });
  }

  function setMarginType(id: string, line: ChargeLine, t: MarginType) {
    const s = state[line.id];
    if (t === "override") {
      // Pre-populate sellOverride with the current computed sell so
      // toggling between margin types doesn't shock the customer total.
      const current = sellAmount(line, s);
      update(id, {
        marginType: t,
        sellOverride: convert(current, s.costCurrency, s.marginCurrency),
      });
    } else {
      update(id, { marginType: t });
    }
  }

  // Operator-facing totals (in output currency).
  // Indicative lines are EXCLUDED - they ride the quote as caveats
  // but never contribute to cost / margin / sell.
  const totals = useMemo(() => {
    let cost = 0;
    let sell = 0;
    for (const l of HAPAG_LINES) {
      const s = state[l.id];
      if (s.isIndicative) continue;
      cost += convert(s.costAmount, s.costCurrency, outputCurrency);
      sell += convert(sellAmount(l, s), s.costCurrency, outputCurrency);
    }
    const margin = sell - cost;
    const marginPct = cost > 0 ? (margin / cost) * 100 : 0;
    return { cost, sell, margin, marginPct };
  }, [state, outputCurrency]);

  // Customer view in OUTPUT currency
  const customerView = useMemo(() => {
    interface OutLine {
      label: string;
      sell: number;
      lines: number;
    }
    const grouped = new Map<string, OutLine>();
    const flat: OutLine[] = [];

    for (const l of HAPAG_LINES) {
      const s = state[l.id];
      if (!s.visible) continue;
      const sellInOut = convert(sellAmount(l, s), s.costCurrency, outputCurrency);
      if (s.consolidateAs) {
        const existing = grouped.get(s.consolidateAs);
        if (existing) {
          existing.sell += sellInOut;
          existing.lines += 1;
        } else {
          const o: OutLine = { label: s.consolidateAs, sell: sellInOut, lines: 1 };
          grouped.set(s.consolidateAs, o);
          flat.push(o);
        }
      } else {
        flat.push({ label: l.description, sell: sellInOut, lines: 1 });
      }
    }
    return flat;
  }, [state, outputCurrency]);

  // Computed valid-until date for the customer view
  const validUntilDisplay = useMemo(() => {
    if (validityMode === "date") return validityDate;
    const d = new Date();
    d.setDate(d.getDate() + validityDays);
    return d.toISOString().slice(0, 10);
  }, [validityMode, validityDays, validityDate]);

  // Lines grouped by macro_group, then sub-grouped by cost currency.
  // Per-currency subtotals computed on sell amounts in their native
  // currency; macro-group subtotal converted to output currency.
  const grouped = useMemo(() => {
    interface CurrencyBucket {
      currency: Currency;
      lines: Array<{ line: ChargeLine; sellNative: number; sellOutput: number }>;
      sellNative: number;
      sellOutput: number;
    }
    interface MacroBucket {
      group: MacroGroup;
      currencies: CurrencyBucket[];
      sellOutput: number;
      visibleLineCount: number;
    }
    interface CurrencyTotal {
      currency: Currency;
      sellNative: number;
      sellOutput: number;
    }

    const macroMap = new Map<MacroGroup, MacroBucket>();
    const totalsByCurrency = new Map<Currency, CurrencyTotal>();

    const indicativeLines: Array<{ line: ChargeLine; sellNative: number }> = [];

    for (const l of HAPAG_LINES) {
      const s = state[l.id];
      if (!s.visible) continue;
      const sellNative = sellAmount(l, s);

      // Indicative lines bypass the totals + macro / currency buckets
      // and live in their own list at the bottom of the quote.
      if (s.isIndicative) {
        indicativeLines.push({ line: l, sellNative });
        continue;
      }

      const sellOutput = convert(sellNative, s.costCurrency, outputCurrency);
      const macro = CATEGORY_TO_MACRO[l.category];

      // Currency total at the bottom
      const ct = totalsByCurrency.get(s.costCurrency);
      if (ct) {
        ct.sellNative += sellNative;
        ct.sellOutput += sellOutput;
      } else {
        totalsByCurrency.set(s.costCurrency, {
          currency: s.costCurrency,
          sellNative,
          sellOutput,
        });
      }

      // Macro bucket
      let mb = macroMap.get(macro);
      if (!mb) {
        mb = { group: macro, currencies: [], sellOutput: 0, visibleLineCount: 0 };
        macroMap.set(macro, mb);
      }
      mb.sellOutput += sellOutput;
      mb.visibleLineCount += 1;

      // Currency sub-bucket within the macro
      let cb = mb.currencies.find((c) => c.currency === s.costCurrency);
      if (!cb) {
        cb = {
          currency: s.costCurrency,
          lines: [],
          sellNative: 0,
          sellOutput: 0,
        };
        mb.currencies.push(cb);
      }
      cb.lines.push({ line: l, sellNative, sellOutput });
      cb.sellNative += sellNative;
      cb.sellOutput += sellOutput;
    }

    const macros = MACRO_GROUP_ORDER.map((g) => macroMap.get(g)).filter(
      (m): m is MacroBucket => m !== undefined,
    );

    return {
      macros,
      currencyTotals: Array.from(totalsByCurrency.values()),
      indicativeLines,
    };
  }, [state, outputCurrency]);

  if (!open) return null;

  // Group lines by category for the operator view.
  const byCategory = HAPAG_LINES.reduce(
    (acc, l) => {
      (acc[l.category] = acc[l.category] ?? []).push(l);
      return acc;
    },
    {} as Record<ChargeCategory, ChargeLine[]>,
  );

  // Categories ordered within each macro-group for the operator view.
  const CATEGORIES_BY_MACRO: Record<MacroGroup, ChargeCategory[]> = {
    origin_exw: ["origin", "pickup", "customs"],
    freight: ["freight", "surcharges"],
    destination_delivery: ["destination", "delivery"],
    insurance_other: ["insurance", "other"],
  };

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

        {/* Quote-level controls + totals - single compact row */}
        <div className="px-5 py-2.5 border-b bg-zinc-50">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Output currency */}
            <label className="inline-flex items-center gap-1.5 text-xs text-zinc-700">
              <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                Quote in
              </span>
              <select
                value={outputCurrency}
                onChange={(e) => setOutputCurrency(e.target.value as Currency)}
                className="h-7 px-1.5 rounded border border-zinc-300 text-xs font-medium bg-white"
              >
                {(["GBP", "USD", "EUR", "AUD"] as Currency[]).map((c) => (
                  <option key={c} value={c}>
                    {c} {CURRENCY_SYMBOL[c]}
                  </option>
                ))}
              </select>
            </label>

            {/* Validity */}
            <label className="inline-flex items-center gap-1.5 text-xs text-zinc-700">
              <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                Valid for
              </span>
              <select
                value={validityMode === "date" ? "custom" : String(validityDays)}
                onChange={(e) => {
                  if (e.target.value === "custom") {
                    setValidityMode("date");
                  } else {
                    setValidityMode("days");
                    setValidityDays(Number(e.target.value) as 7 | 14 | 21 | 30);
                  }
                }}
                className="h-7 px-1.5 rounded border border-zinc-300 text-xs bg-white"
              >
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="21">21 days</option>
                <option value="30">30 days</option>
                <option value="custom">Custom date</option>
              </select>
              {validityMode === "date" ? (
                <input
                  type="date"
                  value={validityDate}
                  onChange={(e) => setValidityDate(e.target.value)}
                  className="h-7 px-1 rounded border border-zinc-300 text-xs"
                />
              ) : (
                <span className="text-[11px] text-zinc-500">
                  until <span className="font-mono">{validUntilDisplay}</span>
                </span>
              )}
            </label>

            {/* Spacer pushes totals to the right */}
            <div className="flex-1" />

            {/* Cost / Margin / Sell - inline */}
            <div className="inline-flex items-center gap-3 text-xs">
              <div>
                <span className="text-[10px] uppercase tracking-wide text-zinc-500 mr-1">
                  Cost
                </span>
                <span className="font-mono text-zinc-700">
                  {fmtCurrency(totals.cost, outputCurrency)}
                </span>
              </div>
              <span className="text-zinc-300">·</span>
              <div>
                <span className="text-[10px] uppercase tracking-wide text-zinc-500 mr-1">
                  Margin
                </span>
                <span className="font-mono text-emerald-700">
                  +{totals.marginPct.toFixed(1)}%
                </span>
                <span className="text-[10px] text-zinc-400 ml-1">
                  ({fmtCurrency(totals.margin, outputCurrency)})
                </span>
              </div>
              <span className="text-zinc-300">·</span>
              <div>
                <span className="text-[10px] uppercase tracking-wide text-zinc-500 mr-1">
                  Sell
                </span>
                <span className="font-mono text-base font-medium">
                  {fmtCurrency(totals.sell, outputCurrency)}
                </span>
              </div>
            </div>
          </div>
          <div className="text-[10px] text-zinc-400 mt-1 inline-flex items-center gap-1">
            <Sparkles className="size-2.5 text-violet-600" />
            FX from XE · {FX_AS_OF} ·{" "}
            <span className="text-zinc-500">
              {customerView.length} customer line{customerView.length === 1 ? "" : "s"} after hide / consolidate
            </span>
          </div>
        </div>

        {/* Two-column body */}
        <div className="flex-1 overflow-y-auto grid grid-cols-12 gap-0">
          {/* OPERATOR VIEW */}
          <div className="col-span-7 border-r overflow-y-auto">
            <div className="px-5 py-3 border-b bg-white sticky top-0 z-10">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500 flex items-center gap-1.5">
                <Sparkles className="size-3 text-violet-600" />
                Operator detail · {HAPAG_LINES.length} lines · grouped by section
              </div>
            </div>

            {MACRO_GROUP_ORDER.map((mg) => {
              const macroCats = CATEGORIES_BY_MACRO[mg];
              const macroLines = HAPAG_LINES.filter((l) =>
                macroCats.includes(l.category),
              );
              if (macroLines.length === 0) return null;

              // Per-currency subtotals (visible non-indicative lines only)
              // for this macro. Indicative caveats live in their own
              // section at the bottom of the customer quote.
              const perCurrency = new Map<Currency, number>();
              for (const l of macroLines) {
                const s = state[l.id];
                if (!s.visible || s.isIndicative) continue;
                const sellNative = sellAmount(l, s);
                perCurrency.set(
                  s.costCurrency,
                  (perCurrency.get(s.costCurrency) ?? 0) + sellNative,
                );
              }
              const macroTotalOutput = Array.from(perCurrency.entries()).reduce(
                (n, [cur, amt]) => n + convert(amt, cur, outputCurrency),
                0,
              );

              return (
                <div key={mg} className={`border-b border-l-4 ${MACRO_GROUP_TONE[mg]}`}>
                  <div className="px-5 py-2 flex items-center justify-between">
                    <div className="text-[12px] font-semibold text-zinc-800 uppercase tracking-wide">
                      {MACRO_GROUP_LABEL[mg]}
                    </div>
                    <div className="text-[11px] text-zinc-600 inline-flex items-center gap-2">
                      {Array.from(perCurrency.entries()).map(([cur, amt]) => (
                        <span key={cur} className="font-mono">
                          {fmtCurrency(amt, cur)}
                        </span>
                      ))}
                      {perCurrency.size > 1 && (
                        <>
                          <span className="text-zinc-300">≈</span>
                          <span className="font-mono font-medium text-zinc-800">
                            {fmtCurrency(macroTotalOutput, outputCurrency)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {macroCats.map((cat) => {
              const lines = HAPAG_LINES.filter((l) => l.category === cat);
              if (!lines || lines.length === 0) return null;
              const tone = CATEGORY_TONE[cat];
              const subTotalInOutput = lines.reduce((n, l) => {
                const s = state[l.id];
                if (s.isIndicative) return n;
                return n + convert(s.costAmount, s.costCurrency, outputCurrency);
              }, 0);

              return (
                <div key={cat} className="px-5 py-3 border-b">
                  <div className="flex items-center justify-between mb-2">
                    <div className={`text-xs font-medium border-l-4 ${tone} pl-2 text-zinc-800`}>
                      {CATEGORY_LABEL[cat]}
                    </div>
                    <div className="text-[11px] text-zinc-500 font-mono">
                      {fmtCurrency(subTotalInOutput, outputCurrency)} cost
                    </div>
                  </div>

                  <div className="space-y-2">
                    {lines.map((l) => {
                      const s = state[l.id];
                      const sell = sellAmount(l, s);
                      const sellInOut = convert(sell, s.costCurrency, outputCurrency);
                      const showConvert = s.costCurrency !== outputCurrency;
                      return (
                        <div
                          key={l.id}
                          className={`px-2 py-2 rounded space-y-1.5 ${
                            !s.visible ? "opacity-50 bg-zinc-50" : "hover:bg-zinc-50"
                          }`}
                        >
                          {/* Row 1: code + description + actions */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              <Badge
                                className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono shrink-0`}
                              >
                                {l.code}
                              </Badge>
                              <span className="text-xs text-zinc-700 truncate">
                                {l.description}
                              </span>
                              {s.costOverridden && (
                                <Badge
                                  className={`${PILL_SM} bg-amber-100 text-amber-800 uppercase tracking-wide`}
                                  title="Cost overridden by operator"
                                >
                                  cost edited
                                </Badge>
                              )}
                              {s.marginType === "override" && (
                                <Badge
                                  className={`${PILL_SM} bg-amber-100 text-amber-800 uppercase tracking-wide`}
                                  title="Sell set directly - margin computed from cost"
                                >
                                  sell set
                                </Badge>
                              )}
                              {s.isIndicative && (
                                <Badge
                                  className={`${PILL_SM} bg-sky-100 text-sky-800 uppercase tracking-wide`}
                                  title="Indicative - shown as caveat, not in totals"
                                >
                                  indicative
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                              <button
                                onClick={() =>
                                  update(l.id, { isIndicative: !s.isIndicative })
                                }
                                title={
                                  s.isIndicative
                                    ? "Make this a real charge that adds to the total"
                                    : "Make this an indicative caveat (not in totals)"
                                }
                                className={`size-6 rounded inline-flex items-center justify-center ${
                                  s.isIndicative
                                    ? "text-sky-700 hover:bg-sky-50"
                                    : "text-zinc-400 hover:bg-zinc-100"
                                }`}
                              >
                                <Info className="size-3.5" />
                              </button>
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

                          {/* Row 2: editable cost + margin + sell */}
                          <div className="flex items-center gap-2 text-xs flex-wrap">
                            {/* Cost */}
                            <div className="inline-flex items-center gap-1">
                              <span className="text-[10px] text-zinc-500">Cost</span>
                              <select
                                value={s.costCurrency}
                                onChange={(e) =>
                                  update(l.id, {
                                    costCurrency: e.target.value as Currency,
                                  })
                                }
                                className="h-6 px-1 rounded border border-zinc-300 text-[11px] bg-white"
                              >
                                {(["GBP", "USD", "EUR", "AUD"] as Currency[]).map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="number"
                                value={s.costAmount}
                                step={0.01}
                                onChange={(e) => setCost(l.id, Number(e.target.value))}
                                className="w-20 h-6 px-1 text-right rounded border border-zinc-300 text-xs font-mono"
                              />
                            </div>

                            <span className="text-zinc-300">→</span>

                            {/* Margin */}
                            <div className="inline-flex items-center gap-1">
                              <span className="text-[10px] text-zinc-500">Margin</span>
                              <select
                                value={s.marginType}
                                onChange={(e) =>
                                  setMarginType(l.id, l, e.target.value as MarginType)
                                }
                                className="h-6 px-1 rounded border border-zinc-300 text-[11px] bg-white"
                                title={MARGIN_TYPE_FULL_LABEL[s.marginType]}
                              >
                                {(
                                  [
                                    "pct",
                                    "flat",
                                    "per_cbm",
                                    "per_kg",
                                    "per_container",
                                    "per_pallet",
                                    "override",
                                  ] as MarginType[]
                                ).map((t) => (
                                  <option key={t} value={t}>
                                    {MARGIN_TYPE_LABEL[t]}
                                  </option>
                                ))}
                              </select>
                              {s.marginType !== "override" && s.marginType !== "pct" && (
                                <select
                                  value={s.marginCurrency}
                                  onChange={(e) =>
                                    update(l.id, {
                                      marginCurrency: e.target.value as Currency,
                                    })
                                  }
                                  className="h-6 px-1 rounded border border-zinc-300 text-[11px] bg-white"
                                >
                                  {(["GBP", "USD", "EUR", "AUD"] as Currency[]).map((c) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {s.marginType !== "override" && (
                                <input
                                  type="number"
                                  value={s.marginValue}
                                  step={0.5}
                                  onChange={(e) =>
                                    update(l.id, { marginValue: Number(e.target.value) })
                                  }
                                  className="w-16 h-6 px-1 text-right rounded border border-zinc-300 text-xs font-mono"
                                />
                              )}
                              {s.marginType !== "pct" &&
                                s.marginType !== "flat" &&
                                s.marginType !== "override" && (
                                  <span className="text-[10px] text-zinc-500">
                                    × {unitCountFor(s.marginType)}
                                  </span>
                                )}
                            </div>

                            <span className="text-zinc-300">→</span>

                            {/* Sell (editable) */}
                            <div className="inline-flex items-center gap-1">
                              <span className="text-[10px] text-zinc-500">Sell</span>
                              <span className="text-[11px] text-emerald-700 font-mono">
                                {s.costCurrency}
                              </span>
                              <input
                                type="number"
                                value={Number(sell.toFixed(2))}
                                step={0.01}
                                onChange={(e) => setSell(l.id, l, Number(e.target.value))}
                                className="w-24 h-6 px-1 text-right rounded border border-emerald-300 bg-emerald-50/40 text-xs font-mono text-emerald-800"
                              />
                            </div>

                            {/* Convert preview */}
                            {showConvert && (
                              <span className="text-[11px] text-zinc-500 inline-flex items-center gap-0.5">
                                ≈
                                <span className="font-mono text-zinc-700">
                                  {fmtCurrency(sellInOut, outputCurrency)}
                                </span>
                              </span>
                            )}
                          </div>

                          {s.consolidateAs && (
                            <div className="text-[10px] text-violet-700">
                              ↳ rolled up as <b>{s.consolidateAs}</b> on customer view
                            </div>
                          )}
                          {s.isIndicative && (
                            <div className="flex items-start gap-1.5 mt-1">
                              <Info className="size-3 text-sky-600 shrink-0 mt-1" />
                              <input
                                type="text"
                                placeholder="Caveat shown to customer (e.g. 'USD 200 / day after 7 free days at port')"
                                value={s.caveatNote}
                                onChange={(e) =>
                                  update(l.id, { caveatNote: e.target.value })
                                }
                                className="flex-1 h-7 px-2 rounded border border-sky-200 bg-sky-50/30 text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-300"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
                </div>
              );
            })}

            {/* Display options - per-customer-view toggles */}
            <div className="px-5 py-3 border-t bg-zinc-50 space-y-1.5">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1">
                Customer view options
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showMacroGroups}
                  onChange={(e) => setShowMacroGroups(e.target.checked)}
                  className="size-3.5 accent-violet-600"
                />
                Show macro-group sections (Origin and EXW / Freight / Destination)
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCurrencySubtotals}
                  onChange={(e) => setShowCurrencySubtotals(e.target.checked)}
                  className="size-3.5 accent-violet-600"
                />
                Show per-currency subtotals inside each section
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCurrencyTotals}
                  onChange={(e) => setShowCurrencyTotals(e.target.checked)}
                  className="size-3.5 accent-violet-600"
                />
                Show charges-by-currency summary at the end
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showIndicativeCaveats}
                  onChange={(e) => setShowIndicativeCaveats(e.target.checked)}
                  className="size-3.5 accent-sky-600"
                />
                Show indicative charges section (caveats, not in total) ·{" "}
                <span className="text-[10px] text-zinc-400">
                  {grouped.indicativeLines.length} on this quote
                </span>
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-not-allowed">
                <input type="checkbox" checked disabled className="size-3.5" />
                Show all-in total in {outputCurrency}{" "}
                <span className="text-[10px]">(always shown)</span>
              </label>
            </div>
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
              <div className="bg-white border rounded p-4 space-y-3 text-xs">
                {/* Macro-group sections.
                    Within each currency bucket we consolidate lines
                    that share the same group label into a single row -
                    that's the whole point of consolidation. Lines
                    without a group label show their own description. */}
                {showMacroGroups ? (
                  grouped.macros.map((mb) => (
                    <div key={mb.group} className="space-y-1">
                      <div
                        className={`text-[10px] uppercase tracking-wide font-semibold border-l-4 ${MACRO_GROUP_TONE[mb.group]} pl-2 py-0.5`}
                      >
                        {MACRO_GROUP_LABEL[mb.group]}
                      </div>
                      {mb.currencies.map((cb) => {
                        const rolledUp = consolidateLines(cb.lines, state);
                        return (
                          <div key={cb.currency} className="space-y-0.5 pl-2">
                            {rolledUp.map((row) => (
                              <div key={row.key}>
                                <div className="flex items-start justify-between gap-2">
                                  <span className="text-zinc-700">
                                    {row.label}
                                    {row.lineCount > 1 && (
                                      <span className="text-[10px] text-zinc-400 ml-1">
                                        ({row.lineCount} charges)
                                      </span>
                                    )}
                                  </span>
                                  <span className="font-mono text-zinc-700">
                                    {fmtCurrency(row.sellNative, cb.currency)}
                                  </span>
                                </div>
                                {row.lineCount > 1 && (
                                  <div className="text-[10px] text-zinc-500 italic pl-2 leading-snug">
                                    includes {row.rolledDescriptions.join(", ")}
                                  </div>
                                )}
                              </div>
                            ))}
                            {showCurrencySubtotals && rolledUp.length > 1 && (
                              <div className="flex items-start justify-between gap-2 pt-0.5 text-[11px] text-zinc-500 italic">
                                <span>{cb.currency} subtotal</span>
                                <span className="font-mono">
                                  {fmtCurrency(cb.sellNative, cb.currency)}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <div className="flex items-start justify-between gap-2 pt-1 border-t border-dashed border-zinc-200 font-medium">
                        <span>{MACRO_GROUP_LABEL[mb.group]} total</span>
                        <span className="font-mono">
                          {fmtCurrency(mb.sellOutput, outputCurrency)}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  // Flat - no macro headers. Consolidate across the whole
                  // visible set within each currency.
                  (() => {
                    const byCurrency = new Map<
                      Currency,
                      Array<{ line: ChargeLine; sellNative: number; sellOutput: number }>
                    >();
                    for (const m of grouped.macros) {
                      for (const cb of m.currencies) {
                        const arr = byCurrency.get(cb.currency) ?? [];
                        arr.push(...cb.lines);
                        byCurrency.set(cb.currency, arr);
                      }
                    }
                    return (
                      <div className="space-y-1">
                        {Array.from(byCurrency.entries()).flatMap(([cur, lines]) =>
                          consolidateLines(lines, state).map((row) => (
                            <div key={`${cur}-${row.key}`}>
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-zinc-700">
                                  {row.label}
                                  {row.lineCount > 1 && (
                                    <span className="text-[10px] text-zinc-400 ml-1">
                                      ({row.lineCount} charges)
                                    </span>
                                  )}
                                </span>
                                <span className="font-mono text-zinc-700">
                                  {fmtCurrency(row.sellNative, cur)}
                                </span>
                              </div>
                              {row.lineCount > 1 && (
                                <div className="text-[10px] text-zinc-500 italic pl-2 leading-snug">
                                  includes {row.rolledDescriptions.join(", ")}
                                </div>
                              )}
                            </div>
                          )),
                        )}
                      </div>
                    );
                  })()
                )}

                {/* Indicative charges - caveats, NOT in totals */}
                {showIndicativeCaveats && grouped.indicativeLines.length > 0 && (
                  <div className="pt-2 border-t space-y-1">
                    <div className="text-[10px] uppercase tracking-wide text-sky-700 mb-1 inline-flex items-center gap-1">
                      <Info className="size-3" />
                      Indicative charges (not included in total)
                    </div>
                    {grouped.indicativeLines.map(({ line, sellNative }) => {
                      const s = state[line.id];
                      return (
                        <div key={line.id} className="space-y-0.5">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-zinc-700">{line.description}</span>
                            <span className="font-mono text-zinc-500">
                              {sellNative > 0
                                ? fmtCurrency(sellNative, s.costCurrency)
                                : "see note"}
                            </span>
                          </div>
                          {s.caveatNote && (
                            <div className="text-[10px] text-zinc-500 italic pl-2 leading-snug">
                              {s.caveatNote}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Charges by currency summary */}
                {showCurrencyTotals && grouped.currencyTotals.length > 1 && (
                  <div className="pt-2 border-t space-y-0.5">
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">
                      Charges by currency
                    </div>
                    {grouped.currencyTotals.map((ct) => (
                      <div
                        key={ct.currency}
                        className="flex items-start justify-between gap-2"
                      >
                        <span className="text-zinc-700">
                          {ct.currency} charges
                        </span>
                        <span className="font-mono">
                          {fmtCurrency(ct.sellNative, ct.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* All-in total */}
                <div className="pt-2 border-t flex items-start justify-between gap-2 font-medium text-sm">
                  <span>Total all-in ({outputCurrency})</span>
                  <span className="font-mono">
                    {fmtCurrency(totals.sell, outputCurrency)}
                  </span>
                </div>
                <div className="flex items-start justify-between text-[10px] text-zinc-500 pt-1">
                  <span>Quote valid until</span>
                  <span className="font-mono">{validUntilDisplay}</span>
                </div>
                <div className="text-[10px] text-zinc-400 italic pt-1 leading-relaxed">
                  Charges originally invoiced in their respective
                  currencies. Converted at today's mid-market rate.
                  Total is binding in {outputCurrency} until the
                  validity date above.
                </div>
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
