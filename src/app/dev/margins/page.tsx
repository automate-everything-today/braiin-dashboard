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
  ArrowLeftRight,
  Calculator,
  Layers,
  Pencil,
  Percent,
  Plane,
  Plus,
  Search,
  Settings2,
  Ship,
  Sparkles,
  Trash2,
  Truck,
  X,
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

// ============================================================
// Edit / add slide-in
// ============================================================

const ALL_METHODS: MarkupMethod[] = [
  "pct",
  "flat",
  "per_cbm",
  "per_kg",
  "per_chargeable_weight",
  "per_wm",
  "per_container",
  "per_container_20",
  "per_container_40",
  "per_pallet",
  "per_bill",
  "per_hs_code",
  "per_shipment",
  "pct_of_line",
  "currency_conditional",
  "override",
  "on_cost",
];

interface RuleEditPanelProps {
  draft: MarginRule | null;
  isNew: boolean;
  onClose: () => void;
  onSave: (next: MarginRule) => void;
  onDelete: ((ruleId: string) => void) | null;
}

function MarginRuleEditPanel({
  draft,
  isNew,
  onClose,
  onSave,
  onDelete,
}: RuleEditPanelProps) {
  const [working, setWorking] = useState<MarginRule | null>(draft);
  const draftKey = draft ? `${draft.ruleId}-${isNew}` : "";
  const [boundKey, setBoundKey] = useState(draftKey);
  if (draftKey !== boundKey) {
    setBoundKey(draftKey);
    setWorking(draft);
  }

  if (!working) return null;

  const set = <K extends keyof MarginRule>(k: K, v: MarginRule[K]) =>
    setWorking({ ...working, [k]: v });

  const setOptional = <K extends keyof MarginRule>(
    k: K,
    raw: string,
    asNumber = false,
  ) => {
    if (raw === "") {
      const next = { ...working };
      delete next[k];
      setWorking(next);
    } else {
      set(k, (asNumber ? Number(raw) : raw) as MarginRule[K]);
    }
  };

  const priorityNow = rulePriority(working);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-zinc-900/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="w-[680px] bg-white border-l border-zinc-200 flex flex-col shadow-2xl">
        <div className="border-b px-5 py-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
              <Percent className="size-3.5" />
              {isNew ? "Add margin rule" : "Edit margin rule"}
              {!isNew && (
                <>
                  <span className="text-zinc-300">·</span>
                  <span className="font-mono">{working.ruleId}</span>
                </>
              )}
            </div>
            <div className="font-medium">{working.name || "(unnamed rule)"}</div>
            <div className="text-[11px] text-zinc-500 mt-1">
              Precedence:{" "}
              <span className="font-mono text-zinc-700">{priorityNow}</span>{" "}
              non-NULL scope field{priorityNow === 1 ? "" : "s"} ·{" "}
              {priorityNow === 0 ? "catch-all default" : "more specific = higher priority"}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} className="size-8 p-0">
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Identity */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">
              Identity
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-zinc-600 block">Rule name</label>
              <input
                type="text"
                value={working.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="FCL Export - Collection per container"
                className="w-full h-9 px-2 rounded border border-zinc-300 text-sm bg-white"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-zinc-600 block">
                Description (optional, shown to operator)
              </label>
              <input
                type="text"
                value={working.description ?? ""}
                onChange={(e) => set("description", e.target.value)}
                placeholder="0.13 GBP/kg with min charge of GBP 35"
                className="w-full h-9 px-2 rounded border border-zinc-300 text-sm bg-white"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
              <input
                type="checkbox"
                checked={working.isActive}
                onChange={(e) => set("isActive", e.target.checked)}
                className="size-3.5 accent-violet-600"
              />
              Active (uncheck to soft-disable without deleting)
            </label>
          </div>

          <Separator />

          {/* Scope */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">
              Scope (every set field must match for the rule to apply)
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-600 block">Customer</label>
                <input
                  type="text"
                  value={working.customerName ?? ""}
                  onChange={(e) => setOptional("customerName", e.target.value)}
                  placeholder="(any)"
                  className="w-full h-9 px-2 rounded border border-zinc-300 text-sm bg-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-600 block">Carrier</label>
                <input
                  type="text"
                  value={working.carrierName ?? ""}
                  onChange={(e) => setOptional("carrierName", e.target.value)}
                  placeholder="(any)"
                  className="w-full h-9 px-2 rounded border border-zinc-300 text-sm bg-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-600 block">Mode</label>
                <select
                  value={working.mode ?? ""}
                  onChange={(e) =>
                    setOptional("mode", e.target.value)
                  }
                  className="w-full h-9 px-2 rounded border border-zinc-300 text-sm bg-white"
                >
                  <option value="">(any)</option>
                  <option value="sea_fcl">Sea FCL</option>
                  <option value="sea_lcl">Sea LCL</option>
                  <option value="air">Air</option>
                  <option value="road">Road</option>
                  <option value="rail">Rail</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-600 block">Direction</label>
                <select
                  value={working.direction ?? ""}
                  onChange={(e) => setOptional("direction", e.target.value)}
                  className="w-full h-9 px-2 rounded border border-zinc-300 text-sm bg-white"
                >
                  <option value="">(any)</option>
                  <option value="import">Import</option>
                  <option value="export">Export</option>
                  <option value="crosstrade">Crosstrade</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-600 block">
                  Origin country (ISO-2)
                </label>
                <input
                  type="text"
                  value={working.originCountry ?? ""}
                  onChange={(e) => setOptional("originCountry", e.target.value.toUpperCase())}
                  placeholder="GB"
                  maxLength={2}
                  className="w-full h-9 px-2 rounded border border-zinc-300 text-sm font-mono bg-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-600 block">
                  Destination country (ISO-2)
                </label>
                <input
                  type="text"
                  value={working.destinationCountry ?? ""}
                  onChange={(e) => setOptional("destinationCountry", e.target.value.toUpperCase())}
                  placeholder="CN"
                  maxLength={2}
                  className="w-full h-9 px-2 rounded border border-zinc-300 text-sm font-mono bg-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-600 block">Section</label>
                <select
                  value={working.macroGroup ?? ""}
                  onChange={(e) => setOptional("macroGroup", e.target.value)}
                  className="w-full h-9 px-2 rounded border border-zinc-300 text-sm bg-white"
                >
                  <option value="">(any)</option>
                  <option value="origin_exw">Origin &amp; EXW</option>
                  <option value="freight">Freight</option>
                  <option value="destination_delivery">
                    Destination &amp; Delivery
                  </option>
                  <option value="insurance_other">Insurance &amp; Other</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-600 block">
                  Charge code (Braiin canonical)
                </label>
                <input
                  type="text"
                  value={working.chargeCode ?? ""}
                  onChange={(e) => setOptional("chargeCode", e.target.value)}
                  placeholder="(any)"
                  className="w-full h-9 px-2 rounded border border-zinc-300 text-sm font-mono bg-white"
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Markup */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">
              Markup
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1 col-span-2">
                <label className="text-[11px] text-zinc-600 block">Method</label>
                <select
                  value={working.markupMethod}
                  onChange={(e) =>
                    set("markupMethod", e.target.value as MarkupMethod)
                  }
                  className="w-full h-9 px-2 rounded border border-zinc-300 text-sm bg-white"
                >
                  {ALL_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m} - {METHOD_LABEL[m]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-600 block">Currency</label>
                <select
                  value={working.markupCurrency}
                  onChange={(e) => set("markupCurrency", e.target.value)}
                  className="w-full h-9 px-2 rounded border border-zinc-300 text-sm bg-white"
                >
                  <option value="GBP">GBP £</option>
                  <option value="USD">USD $</option>
                  <option value="EUR">EUR €</option>
                  <option value="AUD">AUD A$</option>
                </select>
              </div>
            </div>
            {working.markupMethod !== "currency_conditional" &&
              working.markupMethod !== "on_cost" && (
                <div className="space-y-1">
                  <label className="text-[11px] text-zinc-600 block">Value</label>
                  <input
                    type="number"
                    value={working.markupValue}
                    step={0.01}
                    onChange={(e) => set("markupValue", Number(e.target.value))}
                    className="w-32 h-9 px-2 text-right rounded border border-zinc-300 text-sm font-mono bg-white"
                  />
                  <span className="text-[11px] text-zinc-500 ml-2">
                    {METHOD_LABEL[working.markupMethod]}
                  </span>
                </div>
              )}
            {working.markupMethod === "currency_conditional" && (
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-600 block">
                  Per-currency rates (e.g. GBP=10, USD=15, EUR=15)
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(["GBP", "USD", "EUR", "AUD"] as const).map((c) => (
                    <div key={c}>
                      <label className="text-[10px] text-zinc-500">
                        {c}
                      </label>
                      <input
                        type="number"
                        value={working.currencyRates?.[c] ?? ""}
                        step={0.01}
                        onChange={(e) => {
                          const next = { ...(working.currencyRates ?? {}) };
                          if (e.target.value === "") delete next[c];
                          else next[c] = Number(e.target.value);
                          setWorking({ ...working, currencyRates: next });
                        }}
                        className="w-full h-8 px-2 text-right rounded border border-zinc-300 text-xs font-mono bg-white"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Guardrails */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">
              Guardrails
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-600 block">
                  Min charge amount
                </label>
                <input
                  type="number"
                  value={working.minChargeAmount ?? ""}
                  step={0.01}
                  onChange={(e) =>
                    setOptional("minChargeAmount", e.target.value, true)
                  }
                  placeholder="(none)"
                  className="w-full h-9 px-2 text-right rounded border border-zinc-300 text-sm font-mono bg-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-600 block">
                  Min charge currency
                </label>
                <select
                  value={working.minChargeCurrency ?? ""}
                  onChange={(e) =>
                    setOptional("minChargeCurrency", e.target.value)
                  }
                  className="w-full h-9 px-2 rounded border border-zinc-300 text-sm bg-white"
                >
                  <option value="">(none)</option>
                  <option value="GBP">GBP</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="AUD">AUD</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t px-5 py-3 flex items-center justify-between bg-zinc-50">
          <div>
            {!isNew && onDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="text-rose-700 hover:bg-rose-50"
                onClick={() => {
                  onDelete(working.ruleId);
                  onClose();
                }}
              >
                <Trash2 className="size-3.5 mr-1.5" />
                Delete rule
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!working.name.trim()}
              onClick={() => {
                onSave(working);
                onClose();
              }}
            >
              {isNew ? "Create rule" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

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

const EMPTY_RULE: MarginRule = {
  ruleId: "",
  name: "",
  markupMethod: "pct",
  markupValue: 10,
  markupCurrency: "GBP",
  isActive: true,
};

function nextRuleId(existing: MarginRule[]): string {
  const max = existing.reduce((n, r) => {
    const m = r.ruleId.match(/RULE-(\d+)/);
    if (!m) return n;
    return Math.max(n, parseInt(m[1], 10));
  }, 0);
  return `RULE-${String(max + 1).padStart(3, "0")}`;
}

export default function MarginsPage() {
  const [view, setView] = useState<"matrix" | "list">("matrix");
  const [query, setQuery] = useState("");

  // Mutable state - edits persist within session.
  const [rules, setRules] = useState<MarginRule[]>(RULES);
  const [editing, setEditing] = useState<{ draft: MarginRule; isNew: boolean } | null>(
    null,
  );

  function saveRule(next: MarginRule) {
    setRules((prev) => {
      const existing = prev.findIndex((r) => r.ruleId === next.ruleId);
      if (existing >= 0) {
        const copy = [...prev];
        copy[existing] = next;
        return copy;
      }
      const idAssigned = next.ruleId
        ? next
        : { ...next, ruleId: nextRuleId(prev) };
      return [...prev, idAssigned];
    });
  }

  function deleteRule(ruleId: string) {
    setRules((prev) => prev.filter((r) => r.ruleId !== ruleId));
  }

  const sortedRules = useMemo(
    () =>
      [...rules].sort(
        (a, b) => rulePriority(b) - rulePriority(a) || a.name.localeCompare(b.name),
      ),
    [rules],
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
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() =>
                  setEditing({
                    draft: { ...EMPTY_RULE, ruleId: nextRuleId(rules) },
                    isNew: true,
                  })
                }
              >
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
                                      onClick={() =>
                                        setEditing({ draft: r, isNew: false })
                                      }
                                      className={`border-l-2 ${
                                        r.macroGroup
                                          ? MACRO_TONE[r.macroGroup]
                                          : "border-l-zinc-200 bg-zinc-50"
                                      } pl-2 py-1 rounded-r cursor-pointer hover:ring-1 hover:ring-violet-300`}
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
                      <TableRow
                        key={r.ruleId}
                        className="hover:bg-zinc-50 cursor-pointer group"
                        onClick={() => setEditing({ draft: r, isNew: false })}
                      >
                        <TableCell>
                          <Badge
                            className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono`}
                            title={`${rulePriority(r)} non-NULL scope fields`}
                          >
                            {rulePriority(r)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-sm inline-flex items-center gap-1.5">
                            {r.name}
                            <Pencil className="size-3 text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
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
            Click any rule (matrix cell or row) to edit · changes persist
            for this session only · production reads{" "}
            <span className="font-mono">quotes.margin_rules</span> with{" "}
            <span className="font-mono">rule_priority</span> auto-computed by
            schema. Rules seeded from the Wisor Profit Guide template in{" "}
            <span className="font-mono">docs/wisor/Margin Template for Wisor.xlsx</span>.
          </div>
        </div>

        <MarginRuleEditPanel
          draft={editing?.draft ?? null}
          isNew={editing?.isNew ?? false}
          onClose={() => setEditing(null)}
          onSave={saveRule}
          onDelete={editing && !editing.isNew ? deleteRule : null}
        />
      </div>
    </PageGuard>
  );
}
