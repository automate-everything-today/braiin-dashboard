"use client";

/**
 * Visual mock-up of the canonical Braiin charge code dictionary
 * + per-TMS code mappings.
 *
 * Live data is sourced from quotes.charge_codes (canonical) +
 * tms.charge_code_map (per-TMS translation). This page is the operator
 * surface for both - the single place to view, search, and manage codes.
 *
 * Static page; reads from the auto-generated charge-codes-data.ts that
 * was built from the Cargowise dictionary (107 codes) in the wisor folder.
 */

import { useMemo, useState } from "react";
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
import {
  ArrowRight,
  ListChecks,
  Plane,
  Plus,
  Search,
  Ship,
  Sparkles,
  Tag,
  Truck,
} from "lucide-react";
import { CHARGE_CODES, type ChargeCode } from "@/lib/quotes/charge-codes-data";

const PILL_SM =
  "text-[10px] px-1.5 py-0 leading-[18px] h-[18px] font-normal tracking-normal";

// ============================================================
// Presentation helpers
// ============================================================

const BILLING_LABEL: Record<ChargeCode["billingType"], string> = {
  margin: "margin",
  revenue: "revenue",
  disbursement: "disbursement",
};

const BILLING_TONE: Record<ChargeCode["billingType"], string> = {
  margin: "bg-emerald-100 text-emerald-800",
  revenue: "bg-violet-100 text-violet-800",
  disbursement: "bg-amber-100 text-amber-800",
};

const MACRO_LABEL: Record<ChargeCode["macroGroup"], string> = {
  origin_exw: "Origin & EXW",
  freight: "Freight",
  destination_delivery: "Destination & Delivery",
  insurance_other: "Insurance & Other",
};

const MACRO_TONE: Record<ChargeCode["macroGroup"], string> = {
  origin_exw: "bg-amber-100 text-amber-800",
  freight: "bg-violet-100 text-violet-800",
  destination_delivery: "bg-cyan-100 text-cyan-800",
  insurance_other: "bg-zinc-100 text-zinc-700",
};

function ModeIcons({ modes }: { modes: string[] }) {
  return (
    <div className="inline-flex items-center gap-1 text-zinc-500">
      {modes.includes("sea_fcl") || modes.includes("sea_lcl") ? (
        <Ship className="size-3.5" />
      ) : null}
      {modes.includes("air") ? <Plane className="size-3.5" /> : null}
      {modes.includes("road") ? <Truck className="size-3.5" /> : null}
    </div>
  );
}

// ============================================================
// Page
// ============================================================

export default function ChargeCodesPage() {
  const [query, setQuery] = useState("");
  const [billingFilter, setBillingFilter] =
    useState<"all" | ChargeCode["billingType"]>("all");
  const [macroFilter, setMacroFilter] =
    useState<"all" | ChargeCode["macroGroup"]>("all");
  const [modeFilter, setModeFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CHARGE_CODES.filter((c) => {
      if (billingFilter !== "all" && c.billingType !== billingFilter) return false;
      if (macroFilter !== "all" && c.macroGroup !== macroFilter) return false;
      if (modeFilter !== "all" && !c.applicableModes.includes(modeFilter))
        return false;
      if (q.length > 0) {
        const hay = [c.braiinCode, c.description, c.cwCode]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [query, billingFilter, macroFilter, modeFilter]);

  const counts = useMemo(() => {
    return {
      total: CHARGE_CODES.length,
      margin: CHARGE_CODES.filter((c) => c.billingType === "margin").length,
      revenue: CHARGE_CODES.filter((c) => c.billingType === "revenue").length,
      disbursement: CHARGE_CODES.filter((c) => c.billingType === "disbursement").length,
    };
  }, []);

  return (
    <PageGuard pageId="dev_charge_codes">
      <div className="min-h-screen bg-zinc-50">
        {/* Top bar */}
        <div className="border-b bg-white">
          <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ListChecks className="size-5 text-zinc-600" />
              <h1 className="text-lg font-medium">Charge codes</h1>
              <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono`}>
                /charge-codes
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">
                <ArrowRight className="size-3.5 mr-1.5" />
                TMS mappings
              </Button>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                <Plus className="size-3.5 mr-1.5" />
                Add code
              </Button>
            </div>
          </div>
        </div>

        <div className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">
          {/* Intro card */}
          <Card className="border-violet-200 bg-violet-50/40">
            <CardContent className="py-4 px-5 flex items-start gap-3">
              <Sparkles className="size-4 text-violet-600 shrink-0 mt-0.5" />
              <div className="text-xs text-zinc-700 leading-relaxed">
                <div className="font-medium text-violet-900 mb-1">
                  Canonical Braiin charge code dictionary
                </div>
                Each row is a Braiin-side charge that flows into{" "}
                <span className="font-mono">quotes.charge_lines</span>. TMS-specific
                codes (Cargowise <span className="font-mono">AFRT</span>, Magaya
                <span className="font-mono">FRT</span>, etc.) translate to these
                via <span className="font-mono">tms.charge_code_map</span> so the
                rate engine and quote document never know which TMS the cost came
                from. Below are 107 codes seeded from the Cargowise dictionary.
              </div>
            </CardContent>
          </Card>

          {/* KPI strip */}
          <div className="grid grid-cols-4 gap-3">
            <Card>
              <CardContent className="py-3 px-4">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                  Total codes
                </div>
                <div className="text-2xl font-mono">{counts.total}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                  Margin
                </div>
                <div className="text-2xl font-mono text-emerald-700">
                  {counts.margin}
                </div>
                <div className="text-[10px] text-zinc-500">marked up at sell</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                  Revenue
                </div>
                <div className="text-2xl font-mono text-violet-700">
                  {counts.revenue}
                </div>
                <div className="text-[10px] text-zinc-500">flat fee, no markup</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                  Disbursement
                </div>
                <div className="text-2xl font-mono text-amber-700">
                  {counts.disbursement}
                </div>
                <div className="text-[10px] text-zinc-500">pass-through cost</div>
              </CardContent>
            </Card>
          </div>

          {/* Filter row */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[280px] max-w-md">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Search code, description, CW code..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full h-9 pl-8 pr-3 rounded border border-zinc-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
            </div>
            <select
              value={billingFilter}
              onChange={(e) =>
                setBillingFilter(e.target.value as "all" | ChargeCode["billingType"])
              }
              className="h-9 px-2 rounded border border-zinc-300 bg-white text-sm"
            >
              <option value="all">All billing types</option>
              <option value="margin">Margin</option>
              <option value="revenue">Revenue</option>
              <option value="disbursement">Disbursement</option>
            </select>
            <select
              value={macroFilter}
              onChange={(e) =>
                setMacroFilter(e.target.value as "all" | ChargeCode["macroGroup"])
              }
              className="h-9 px-2 rounded border border-zinc-300 bg-white text-sm"
            >
              <option value="all">All sections</option>
              <option value="origin_exw">Origin &amp; EXW</option>
              <option value="freight">Freight</option>
              <option value="destination_delivery">Destination &amp; Delivery</option>
              <option value="insurance_other">Insurance &amp; Other</option>
            </select>
            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value)}
              className="h-9 px-2 rounded border border-zinc-300 bg-white text-sm"
            >
              <option value="all">All modes</option>
              <option value="sea_fcl">Sea FCL</option>
              <option value="sea_lcl">Sea LCL</option>
              <option value="air">Air</option>
              <option value="road">Road</option>
              <option value="rail">Rail</option>
            </select>
          </div>

          {/* Codes table */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Codes ({filtered.length})</CardTitle>
              <div className="text-[11px] text-zinc-500 font-mono">
                CW dictionary · seeded 2026-04-29
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow className="text-[10px] uppercase tracking-wide">
                    <TableHead className="w-[210px]">Braiin code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[110px]">Billing</TableHead>
                    <TableHead className="w-[140px]">Section</TableHead>
                    <TableHead className="w-[80px]">Modes</TableHead>
                    <TableHead className="w-[110px]">Directions</TableHead>
                    <TableHead className="w-[60px] text-right">Mkt %</TableHead>
                    <TableHead className="w-[140px]">CW mapping</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.braiinCode} className="hover:bg-zinc-50">
                      <TableCell>
                        <div className="font-mono text-[12px] text-zinc-800">
                          {c.braiinCode}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{c.description}</div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`${PILL_SM} ${BILLING_TONE[c.billingType]}`}>
                          {BILLING_LABEL[c.billingType]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`${PILL_SM} ${MACRO_TONE[c.macroGroup]}`}>
                          {MACRO_LABEL[c.macroGroup]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ModeIcons modes={c.applicableModes} />
                      </TableCell>
                      <TableCell>
                        <div className="text-[10px] text-zinc-500 inline-flex flex-wrap gap-0.5">
                          {c.applicableDirections.map((d) => (
                            <span
                              key={d}
                              className="px-1 py-0 rounded bg-zinc-100 text-zinc-700 font-mono"
                            >
                              {d.slice(0, 3)}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-zinc-600">
                        {c.defaultMarginPct}
                      </TableCell>
                      <TableCell>
                        <div className="inline-flex items-center gap-1.5 text-xs">
                          <Badge className={`${PILL_SM} bg-violet-50 text-violet-700 font-mono border border-violet-200`}>
                            CW
                          </Badge>
                          <span className="font-mono text-zinc-700">{c.cwCode}</span>
                          <span className="text-[10px] text-zinc-400">
                            ({c.cwDepartments.length === 1 && c.cwDepartments[0] === "ALL"
                              ? "ALL"
                              : c.cwDepartments.slice(0, 2).join(",") +
                                (c.cwDepartments.length > 2 ? "+" : "")})
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Tag className="size-4 text-emerald-700" /> Margin
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-zinc-700 leading-relaxed">
                Standard sell-side charge. Markup applied per the rule engine in{" "}
                <span className="font-mono">quotes.margin_rules</span>. Default
                markup % comes from the dictionary; per-quote override possible.
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Tag className="size-4 text-violet-700" /> Revenue
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-zinc-700 leading-relaxed">
                Flat fee with no markup (booking fee, agency fee, currency
                exposure). Counted as revenue at the quoted amount; appears on
                the customer document.
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Tag className="size-4 text-amber-700" /> Disbursement
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-zinc-700 leading-relaxed">
                Pass-through cost (DUTY, VAT, demurrage, detention, storage).
                Charged at cost, no markup. Often shown in the "If Applicable"
                section of the quote. Conditional ones can be flagged{" "}
                <span className="font-mono">is_indicative</span>.
              </CardContent>
            </Card>
          </div>

          <div className="text-[11px] text-zinc-400 text-center pb-6">
            Mock-up · static data · production reads{" "}
            <span className="font-mono">quotes.charge_codes</span> +{" "}
            <span className="font-mono">tms.charge_code_map</span>.
          </div>
        </div>
      </div>
    </PageGuard>
  );
}
