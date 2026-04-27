"use client";

/**
 * Visual mock-up of the Braiin quoting workspace.
 *
 * Static page, no backend calls. Hardcoded data so we can react to the
 * design without committing to the full build. Uses real shadcn primitives
 * + Open Sans + Geist Mono + the pulsing brain loader so what you see
 * here is what the production page will look like.
 */

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
  Mail,
  Package,
  Ship,
  Sparkles,
  Star,
  TrendingUp,
  Truck,
  User,
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
  return <Badge className={`${tone} font-mono`}>{score}</Badge>;
}

function StatusPill({ status }: { status: RfqRow["status"] }) {
  if (status === "received") return <Badge className="bg-emerald-100 text-emerald-800">received</Badge>;
  if (status === "timeout") return <Badge className="bg-rose-100 text-rose-800">timeout</Badge>;
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

function SourceBadge({ source }: { source: RfqRow["source"] }) {
  const tone =
    source === "API"
      ? "bg-violet-100 text-violet-800"
      : source === "Aggregator"
        ? "bg-cyan-100 text-cyan-800"
        : "bg-zinc-100 text-zinc-700";
  return <Badge className={`${tone} text-[10px] uppercase tracking-wide`}>{source}</Badge>;
}

// ----------------- Page -----------------

export default function QuotePreviewPage() {
  return (
    <PageGuard pageId="dev_quote_preview">
      <div className="min-h-screen bg-zinc-50">
        {/* ---- Top bar ---- */}
        <div className="border-b bg-white">
          <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Ship className="size-5 text-zinc-600" />
                <span className="font-mono text-xs bg-zinc-100 px-2 py-0.5 rounded">
                  {QUOTE.id}
                </span>
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
              <Badge className="bg-amber-100 text-amber-800">sourcing</Badge>
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
                                <Badge className="bg-emerald-100 text-emerald-800">pick</Badge>
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

                <div className="text-[11px] uppercase tracking-wide text-zinc-500">Margin</div>
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
      </div>
    </PageGuard>
  );
}
