"use client";

/**
 * Visual mock-up of the margin rule engine.
 *
 * Two views in one page:
 *   - **Matrix view** - the 3x3 (mode x direction) grid showing the
 *     default rule for each section in each mode, mirroring the Wisor
 *     Profit Guide layout that Corten built up over years.
 *   - **Rules list** - all rules, scope-and-precedence ordered, with
 *     filter + add rule.
 *
 * Static page; production reads quotes.margin_rules with rule_priority
 * computed by the schema (most non-NULL scope fields wins).
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
  ArrowLeftRight,
  ArrowRight,
  Calculator,
  Layers,
  Percent,
  Plane,
  Plus,
  Search,
  Settings2,
  Ship,
  Sparkles,
  Truck,
} from "lucide-react";

const PILL_SM =
  "text-[10px] px-1.5 py-0 leading-[18px] h-[18px] font-normal tracking-normal";

// ============================================================
// Types
// ============================================================

type Mode = "sea_fcl" | "sea_lcl" | "air" | "road" | "rail";
type Direction = "import" | "export" | "crosstrade";
type MacroGroup = "origin_exw" | "freight" | "destination_delivery" | "insurance_other";
type MarkupMethod =
  | "pct"
  | "flat"
  | "per_cbm"
  | "per_kg"
  | "per_chargeable_weight"
  | "per_wm"
  | "per_container"
  | "per_container_20"
  | "per_container_40"
  | "per_pallet"
  | "per_bill"
  | "per_hs_code"
  | "per_shipment"
  | "pct_of_line"
  | "currency_conditional"
  | "override"
  | "on_cost";

interface MarginRule {
  ruleId: string;
  name: string;
  description?: string;
  // Scope
  customerName?: string; // displayed; FK in production
  carrierName?: string;
  mode?: Mode;
  direction?: Direction;
  originCountry?: string;
  destinationCountry?: string;
  macroGroup?: MacroGroup;
  chargeCode?: string;
  // Markup
  markupMethod: MarkupMethod;
  markupValue: number;
  markupCurrency: string;
  currencyRates?: Record<string, number>;
  minChargeAmount?: number;
  minChargeCurrency?: string;
  isActive: boolean;
}

const METHOD_LABEL: Record<MarkupMethod, string> = {
  pct: "%",
  flat: "Flat",
  per_cbm: "/CBM",
  per_kg: "/kg",
  per_chargeable_weight: "/chgwt",
  per_wm: "/W/M",
  per_container: "/cont",
  per_container_20: "/20'",
  per_container_40: "/40'",
  per_pallet: "/pallet",
  per_bill: "/BL",
  per_hs_code: "/HS",
  per_shipment: "/shipment",
  pct_of_line: "% of line",
  currency_conditional: "By currency",
  override: "Set sell",
  on_cost: "On cost",
};

const MODE_LABEL: Record<Mode, string> = {
  sea_fcl: "Sea FCL",
  sea_lcl: "Sea LCL",
  air: "Air",
  road: "Road",
  rail: "Rail",
};

const DIRECTION_LABEL: Record<Direction, string> = {
  import: "Import",
  export: "Export",
  crosstrade: "Crosstrade",
};

const MACRO_LABEL: Record<MacroGroup, string> = {
  origin_exw: "Origin & EXW",
  freight: "Freight",
  destination_delivery: "Destination & Delivery",
  insurance_other: "Insurance & Other",
};

const MACRO_TONE: Record<MacroGroup, string> = {
  origin_exw: "border-l-amber-300 bg-amber-50/40",
  freight: "border-l-violet-300 bg-violet-50/40",
  destination_delivery: "border-l-cyan-300 bg-cyan-50/40",
  insurance_other: "border-l-zinc-300 bg-zinc-50/40",
};

function ModeIcon({ mode }: { mode: Mode }) {
  if (mode === "air") return <Plane className="size-3.5" />;
  if (mode === "road" || mode === "rail") return <Truck className="size-3.5" />;
  return <Ship className="size-3.5" />;
}

function fmtMarkup(r: MarginRule): string {
  const cur = r.markupCurrency;
  const sym = cur === "GBP" ? "£" : cur === "USD" ? "$" : cur === "EUR" ? "€" : cur;
  switch (r.markupMethod) {
    case "pct":
      return `+${r.markupValue}%`;
    case "flat":
      return `+${sym}${r.markupValue}`;
    case "per_cbm":
      return `+${sym}${r.markupValue}/CBM`;
    case "per_kg":
      return `+${sym}${r.markupValue}/kg`;
    case "per_chargeable_weight":
      return `+${sym}${r.markupValue}/chargeable kg`;
    case "per_wm":
      return `+${r.markupValue}% on W/M`;
    case "per_container":
      return `+${sym}${r.markupValue}/container`;
    case "per_container_20":
      return `+${sym}${r.markupValue}/20'`;
    case "per_container_40":
      return `+${sym}${r.markupValue}/40'`;
    case "per_pallet":
      return `+${sym}${r.markupValue}/pallet`;
    case "per_bill":
      return `+${sym}${r.markupValue}/BL`;
    case "per_hs_code":
      return `+${sym}${r.markupValue}/extra HS`;
    case "per_shipment":
      return `+${sym}${r.markupValue}/shipment`;
    case "pct_of_line":
      return `+${r.markupValue}% of line`;
    case "currency_conditional":
      if (r.currencyRates) {
        return Object.entries(r.currencyRates)
          .map(([c, v]) => `${c} +${v}`)
          .join(" / ");
      }
      return "By currency";
    case "override":
      return `Set ${sym}${r.markupValue}`;
    case "on_cost":
      return "On cost";
  }
}

// ============================================================
// Seed data - rules from the Wisor "Margin Template" matrix
// ============================================================

const RULES: MarginRule[] = [
  // ---- Defaults (no specific scope) ----
  {
    ruleId: "RULE-001",
    name: "Default - all charges",
    description: "Catch-all 100% markup across the board",
    markupMethod: "pct",
    markupValue: 100,
    markupCurrency: "GBP",
    isActive: true,
  },

  // ---- FCL rules ----
  {
    ruleId: "RULE-101",
    name: "FCL Export - Collection",
    mode: "sea_fcl",
    direction: "export",
    chargeCode: "collection",
    markupMethod: "flat",
    markupValue: 50,
    markupCurrency: "GBP",
    isActive: true,
  },
  {
    ruleId: "RULE-102",
    name: "FCL Crosstrade - Collection",
    mode: "sea_fcl",
    direction: "crosstrade",
    chargeCode: "collection",
    markupMethod: "pct",
    markupValue: 15,
    markupCurrency: "GBP",
    isActive: true,
  },
  {
    ruleId: "RULE-103",
    name: "FCL Export - Export Customs Clearance",
    description: "Per BL, currency-conditional",
    mode: "sea_fcl",
    direction: "export",
    chargeCode: "export_customs_clearance_fee",
    markupMethod: "currency_conditional",
    markupValue: 0,
    markupCurrency: "GBP",
    currencyRates: { GBP: 10, USD: 15, EUR: 15 },
    isActive: true,
  },
  {
    ruleId: "RULE-104",
    name: "FCL Export - VGM",
    mode: "sea_fcl",
    direction: "export",
    chargeCode: "vgm_fee",
    markupMethod: "per_container",
    markupValue: 36,
    markupCurrency: "GBP",
    isActive: true,
  },
  {
    ruleId: "RULE-105",
    name: "FCL EXW",
    mode: "sea_fcl",
    chargeCode: "exw_charges",
    markupMethod: "pct",
    markupValue: 10,
    markupCurrency: "GBP",
    isActive: true,
  },
  {
    ruleId: "RULE-110",
    name: "FCL - Ocean freight",
    mode: "sea_fcl",
    chargeCode: "ocean_freight",
    markupMethod: "per_container",
    markupValue: 100,
    markupCurrency: "USD",
    isActive: true,
  },
  {
    ruleId: "RULE-120",
    name: "FCL Import - Import Customs Clearance",
    mode: "sea_fcl",
    direction: "import",
    chargeCode: "import_customs_clearance_fee",
    markupMethod: "flat",
    markupValue: 10,
    markupCurrency: "GBP",
    isActive: true,
  },
  {
    ruleId: "RULE-121",
    name: "FCL Import - DDOC",
    mode: "sea_fcl",
    direction: "import",
    chargeCode: "destination_documentation_fee",
    markupMethod: "override",
    markupValue: 60,
    markupCurrency: "GBP",
    isActive: true,
  },
  {
    ruleId: "RULE-122",
    name: "FCL Import - LO/LO",
    mode: "sea_fcl",
    direction: "import",
    chargeCode: "lo_lo",
    markupMethod: "override",
    markupValue: 95,
    markupCurrency: "GBP",
    isActive: true,
  },
  {
    ruleId: "RULE-123",
    name: "FCL - Destination charges",
    mode: "sea_fcl",
    macroGroup: "destination_delivery",
    markupMethod: "pct",
    markupValue: 10,
    markupCurrency: "GBP",
    isActive: true,
  },
  {
    ruleId: "RULE-124",
    name: "FCL Import - Delivery",
    mode: "sea_fcl",
    direction: "import",
    chargeCode: "delivery",
    markupMethod: "per_container",
    markupValue: 50,
    markupCurrency: "GBP",
    isActive: true,
  },

  // ---- LCL rules ----
  {
    ruleId: "RULE-201",
    name: "LCL Export - Export Customs Clearance",
    mode: "sea_lcl",
    direction: "export",
    chargeCode: "export_customs_clearance_fee",
    markupMethod: "override",
    markupValue: 55,
    markupCurrency: "GBP",
    isActive: true,
  },
  {
    ruleId: "RULE-210",
    name: "LCL - Freight (W/M)",
    mode: "sea_lcl",
    chargeCode: "ocean_freight",
    markupMethod: "per_wm",
    markupValue: 10,
    markupCurrency: "GBP",
    isActive: true,
  },
  {
    ruleId: "RULE-220",
    name: "LCL Import - Coloader Admin Fee",
    description: "10% on top, min GBP 35",
    mode: "sea_lcl",
    direction: "import",
    chargeCode: "co_loader_costs",
    markupMethod: "pct",
    markupValue: 10,
    markupCurrency: "GBP",
    minChargeAmount: 35,
    minChargeCurrency: "GBP",
    isActive: true,
  },

  // ---- Air rules ----
  {
    ruleId: "RULE-301",
    name: "Air Export - Export Customs Clearance",
    mode: "air",
    direction: "export",
    chargeCode: "export_customs_clearance_fee",
    markupMethod: "override",
    markupValue: 25,
    markupCurrency: "GBP",
    isActive: true,
  },
  {
    ruleId: "RULE-302",
    name: "Air Export - AMS",
    mode: "air",
    direction: "export",
    chargeCode: "ams_aci_fee",
    markupMethod: "override",
    markupValue: 30,
    markupCurrency: "GBP",
    isActive: true,
  },
  {
    ruleId: "RULE-303",
    name: "Air Export - Primary Screening",
    description: "0.13 GBP/kg, min GBP 35",
    mode: "air",
    direction: "export",
    chargeCode: "primary_screening",
    markupMethod: "per_chargeable_weight",
    markupValue: 0.13,
    markupCurrency: "GBP",
    minChargeAmount: 35,
    minChargeCurrency: "GBP",
    isActive: true,
  },
  {
    ruleId: "RULE-310",
    name: "Air Import - Airline handling",
    description: "0.38/kg, min 80 GBP",
    mode: "air",
    direction: "import",
    chargeCode: "airline_handling",
    markupMethod: "per_kg",
    markupValue: 0.38,
    markupCurrency: "GBP",
    minChargeAmount: 80,
    minChargeCurrency: "GBP",
    isActive: true,
  },
  {
    ruleId: "RULE-320",
    name: "Air Import - Delivery",
    mode: "air",
    direction: "import",
    chargeCode: "delivery",
    markupMethod: "flat",
    markupValue: 60,
    markupCurrency: "GBP",
    isActive: true,
  },

  // ---- Customer-specific override ----
  {
    ruleId: "RULE-901",
    name: "ABC Manufacturing - Freight discount",
    description: "Strategic account; freight at 8% on top regardless of mode",
    customerName: "ABC Manufacturing Ltd",
    macroGroup: "freight",
    markupMethod: "pct",
    markupValue: 8,
    markupCurrency: "GBP",
    isActive: true,
  },

  // ---- Disbursement (no markup) ----
  {
    ruleId: "RULE-501",
    name: "All disbursements - on cost",
    description: "DUTY, VAT, demurrage, detention, storage charged at cost",
    markupMethod: "on_cost",
    markupValue: 0,
    markupCurrency: "GBP",
    isActive: true,
  },
];

function rulePriority(r: MarginRule): number {
  let n = 0;
  if (r.customerName) n++;
  if (r.carrierName) n++;
  if (r.mode) n++;
  if (r.direction) n++;
  if (r.originCountry) n++;
  if (r.destinationCountry) n++;
  if (r.macroGroup) n++;
  if (r.chargeCode) n++;
  return n;
}

// ============================================================
// Page
// ============================================================

export default function MarginsPage() {
  const [view, setView] = useState<"matrix" | "list">("matrix");
  const [query, setQuery] = useState("");

  const sortedRules = useMemo(
    () =>
      [...RULES].sort((a, b) => rulePriority(b) - rulePriority(a) || a.name.localeCompare(b.name)),
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return sortedRules;
    return sortedRules.filter((r) => {
      const hay = [
        r.name,
        r.description,
        r.customerName,
        r.carrierName,
        r.chargeCode,
        r.mode,
        r.direction,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [sortedRules, query]);

  // Build the matrix - rules that scope to a (mode, direction) cell
  const MODES: Mode[] = ["sea_fcl", "sea_lcl", "air"];
  const DIRECTIONS: Direction[] = ["import", "export", "crosstrade"];

  function rulesFor(mode: Mode, direction: Direction): MarginRule[] {
    return sortedRules.filter(
      (r) => (r.mode === mode || r.mode === undefined && r.macroGroup) === false
        ? false
        : (r.mode === mode || r.mode === undefined) &&
          (r.direction === direction || r.direction === undefined) &&
          !r.customerName,
    );
  }
  // Simpler: rules where mode and direction both match (or null)
  function matrixRulesFor(mode: Mode, direction: Direction): MarginRule[] {
    return sortedRules
      .filter(
        (r) =>
          !r.customerName &&
          !r.carrierName &&
          (r.mode === mode || (r.mode === undefined && rulePriority(r) > 0)) &&
          (r.direction === direction || r.direction === undefined),
      )
      .filter((r) => r.mode === mode); // tighten - only rules explicit to this mode
  }

  return (
    <PageGuard pageId="dev_margins">
      <div className="min-h-screen bg-zinc-50">
        {/* Top bar */}
        <div className="border-b bg-white">
          <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Percent className="size-5 text-zinc-600" />
              <h1 className="text-lg font-medium">Margin rules</h1>
              <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono`}>
                /margins
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">
                <Calculator className="size-3.5 mr-1.5" />
                Test calculator
              </Button>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
                <Plus className="size-3.5 mr-1.5" />
                Add rule
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
                  How rules resolve: most-specific wins
                </div>
                Each rule's <span className="font-mono">rule_priority</span> is the count
                of non-NULL scope fields (customer / carrier / mode / direction /
                origin / destination / macro_group / charge_code). When a quote
                line needs a margin, the engine picks the highest-priority rule
                whose every set scope matches. Equal-priority ties break by{" "}
                <span className="font-mono">created_at</span> descending. Default
                rule (priority 0) catches everything else.
              </div>
            </CardContent>
          </Card>

          {/* View switcher */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 border rounded p-1 bg-white">
              <button
                onClick={() => setView("matrix")}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  view === "matrix"
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                <Layers className="size-3 inline mr-1" /> Matrix view
              </button>
              <button
                onClick={() => setView("list")}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  view === "list"
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                <Settings2 className="size-3 inline mr-1" /> Rules list ({sortedRules.length})
              </button>
            </div>

            {view === "list" && (
              <div className="relative flex-1 max-w-md">
                <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Search rule name, customer, charge code..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full h-9 pl-8 pr-3 rounded border border-zinc-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
              </div>
            )}
          </div>

          {view === "matrix" ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  Mode × Direction matrix
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-zinc-500">
                      <th className="text-left px-3 py-2 w-[120px]">Mode</th>
                      {DIRECTIONS.map((d) => (
                        <th key={d} className="text-left px-3 py-2">
                          {DIRECTION_LABEL[d]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MODES.map((m) => (
                      <tr key={m} className="border-t">
                        <td className="px-3 py-3 font-medium align-top">
                          <div className="inline-flex items-center gap-1.5">
                            <ModeIcon mode={m} />
                            {MODE_LABEL[m]}
                          </div>
                        </td>
                        {DIRECTIONS.map((d) => {
                          const cellRules = matrixRulesFor(m, d).filter(
                            (r) => r.direction === d,
                          );
                          return (
                            <td
                              key={`${m}-${d}`}
                              className="px-3 py-3 align-top border-l"
                            >
                              {cellRules.length === 0 ? (
                                <span className="text-[10px] text-zinc-400 italic">
                                  inherits default
                                </span>
                              ) : (
                                <div className="space-y-1">
                                  {cellRules.map((r) => (
                                    <div
                                      key={r.ruleId}
                                      className={`border-l-2 ${
                                        r.macroGroup
                                          ? MACRO_TONE[r.macroGroup]
                                          : "border-l-zinc-200 bg-zinc-50"
                                      } pl-2 py-1 rounded-r`}
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-zinc-700 truncate text-[11px]">
                                          {r.chargeCode ??
                                            (r.macroGroup
                                              ? MACRO_LABEL[r.macroGroup]
                                              : r.name)}
                                        </span>
                                        <Badge
                                          className={`${PILL_SM} bg-emerald-100 text-emerald-800 font-mono`}
                                        >
                                          {fmtMarkup(r)}
                                        </Badge>
                                      </div>
                                      {r.minChargeAmount && (
                                        <div className="text-[10px] text-zinc-500">
                                          min {r.minChargeCurrency}{" "}
                                          {r.minChargeAmount}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-[11px] text-zinc-400 italic mt-3">
                  Crosstrade column shows rules that apply when both origin AND
                  destination are abroad (third-country movement).
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm">
                  All rules ({filtered.length})
                </CardTitle>
                <div className="text-[11px] text-zinc-500 font-mono">
                  sorted by precedence desc
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow className="text-[10px] uppercase tracking-wide">
                      <TableHead className="w-[40px]">#</TableHead>
                      <TableHead>Rule</TableHead>
                      <TableHead className="w-[200px]">Scope</TableHead>
                      <TableHead className="w-[200px]">Markup</TableHead>
                      <TableHead className="w-[130px]">Guardrail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow key={r.ruleId} className="hover:bg-zinc-50">
                        <TableCell>
                          <Badge
                            className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono`}
                            title={`${rulePriority(r)} non-NULL scope fields`}
                          >
                            {rulePriority(r)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">{r.name}</div>
                          {r.description && (
                            <div className="text-[11px] text-zinc-500 italic mt-0.5">
                              {r.description}
                            </div>
                          )}
                          <div className="text-[10px] text-zinc-400 font-mono mt-0.5">
                            {r.ruleId}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            {r.customerName && (
                              <Badge className={`${PILL_SM} bg-emerald-100 text-emerald-800`}>
                                {r.customerName}
                              </Badge>
                            )}
                            {r.carrierName && (
                              <Badge className={`${PILL_SM} bg-violet-100 text-violet-800`}>
                                {r.carrierName}
                              </Badge>
                            )}
                            {r.mode && (
                              <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-700`}>
                                {MODE_LABEL[r.mode]}
                              </Badge>
                            )}
                            {r.direction && (
                              <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-700`}>
                                {DIRECTION_LABEL[r.direction]}
                              </Badge>
                            )}
                            {r.macroGroup && (
                              <Badge
                                className={`${PILL_SM} ${
                                  r.macroGroup === "origin_exw"
                                    ? "bg-amber-100 text-amber-800"
                                    : r.macroGroup === "freight"
                                      ? "bg-violet-100 text-violet-800"
                                      : r.macroGroup === "destination_delivery"
                                        ? "bg-cyan-100 text-cyan-800"
                                        : "bg-zinc-100 text-zinc-700"
                                }`}
                              >
                                {MACRO_LABEL[r.macroGroup]}
                              </Badge>
                            )}
                            {r.chargeCode && (
                              <span className="text-[10px] font-mono text-zinc-600">
                                {r.chargeCode}
                              </span>
                            )}
                            {!r.customerName &&
                              !r.carrierName &&
                              !r.mode &&
                              !r.direction &&
                              !r.macroGroup &&
                              !r.chargeCode && (
                                <span className="text-[10px] text-zinc-400 italic">
                                  catch-all
                                </span>
                              )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-mono text-xs text-emerald-700">
                            {fmtMarkup(r)}
                          </div>
                          <div className="text-[10px] text-zinc-500">
                            {METHOD_LABEL[r.markupMethod]} · {r.markupCurrency}
                          </div>
                        </TableCell>
                        <TableCell>
                          {r.minChargeAmount ? (
                            <div className="text-[11px] text-zinc-700">
                              min{" "}
                              <span className="font-mono">
                                {r.minChargeCurrency} {r.minChargeAmount}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-zinc-400">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Method legend */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ArrowLeftRight className="size-4 text-zinc-600" />
                Markup methods
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 grid grid-cols-3 gap-x-6 gap-y-1.5 text-[11px]">
              {(Object.keys(METHOD_LABEL) as MarkupMethod[]).map((m) => (
                <div key={m} className="flex items-center gap-2 text-zinc-700">
                  <Badge
                    className={`${PILL_SM} bg-zinc-100 text-zinc-700 font-mono w-[68px] justify-center`}
                  >
                    {METHOD_LABEL[m]}
                  </Badge>
                  <span className="text-[11px] text-zinc-500">
                    {m === "pct" && "% of cost"}
                    {m === "flat" && "Fixed amount"}
                    {m === "per_cbm" && "× volume CBM"}
                    {m === "per_kg" && "× weight kg"}
                    {m === "per_chargeable_weight" && "× chargeable weight"}
                    {m === "per_wm" && "weight or measure (LCL)"}
                    {m === "per_container" && "× containers"}
                    {m === "per_container_20" && "× 20' containers only"}
                    {m === "per_container_40" && "× 40' containers only"}
                    {m === "per_pallet" && "× pallets"}
                    {m === "per_bill" && "per BL/HBL"}
                    {m === "per_hs_code" && "per extra HS code"}
                    {m === "per_shipment" && "per quote, flat"}
                    {m === "pct_of_line" && "% of another line's cost"}
                    {m === "currency_conditional" && "by cost currency"}
                    {m === "override" && "set sell directly"}
                    {m === "on_cost" && "no markup (disbursement)"}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="text-[11px] text-zinc-400 text-center pb-6">
            Mock-up · static data · production reads{" "}
            <span className="font-mono">quotes.margin_rules</span> with{" "}
            <span className="font-mono">rule_priority</span> auto-computed by
            schema. Rules seeded from the Wisor Profit Guide template in{" "}
            <span className="font-mono">docs/wisor/Margin Template for Wisor.xlsx</span>.
          </div>
        </div>
      </div>
    </PageGuard>
  );
}
