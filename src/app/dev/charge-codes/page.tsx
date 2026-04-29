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

import { useEffect, useMemo, useRef, useState } from "react";
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
  AlertTriangle,
  ArrowRight,
  Check,
  Download,
  ListChecks,
  Pencil,
  Plane,
  Plus,
  Search,
  Ship,
  Sparkles,
  Tag,
  Trash2,
  Truck,
  Upload,
  X,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { downloadCsv, parseCsv, serializeCsv, type CsvRow } from "@/lib/csv";
import {
  CHARGE_CODES,
  type ChargeCode,
  type TmsOrigin,
} from "@/lib/quotes/charge-codes-data";
import { PILL_SM } from "@/lib/ui-constants";
import { BraiinLoader } from "@/components/braiin-loader";

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

// TMS origin presentation. tms_origin records which TMS dictionary a
// canonical Braiin code was lifted from. New TMS adapters (Magaya,
// Descartes...) will add codes with their own origin tag. 'native'
// is reserved for codes Braiin defines without a TMS counterpart.
const TMS_ORIGIN_LABEL: Record<TmsOrigin, string> = {
  cargowise: "Cargowise",
  magaya: "Magaya",
  descartes: "Descartes",
  native: "Braiin native",
};

const TMS_ORIGIN_TONE: Record<TmsOrigin, string> = {
  cargowise: "bg-violet-50 text-violet-800 border border-violet-200",
  magaya: "bg-cyan-50 text-cyan-800 border border-cyan-200",
  descartes: "bg-emerald-50 text-emerald-800 border border-emerald-200",
  native: "bg-zinc-50 text-zinc-700 border border-zinc-200",
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

// ============================================================
// Edit / add slide-in
// ============================================================

const ALL_MODES = ["sea_fcl", "sea_lcl", "air", "road", "rail"] as const;
const ALL_DIRECTIONS = ["import", "export", "crosstrade"] as const;

interface EditPanelProps {
  draft: ChargeCode | null;
  isNew: boolean;
  onClose: () => void;
  onSave: (next: ChargeCode) => void;
  onDelete: ((braiinCode: string) => void) | null;
}

function ChargeCodeEditPanel({
  draft,
  isNew,
  onClose,
  onSave,
  onDelete,
}: EditPanelProps) {
  const [working, setWorking] = useState<ChargeCode | null>(draft);

  // Reset form whenever the draft changes (new row clicked).
  const draftKey = draft ? `${draft.braiinCode}-${isNew}` : "";
  const [boundKey, setBoundKey] = useState(draftKey);
  if (draftKey !== boundKey) {
    setBoundKey(draftKey);
    setWorking(draft);
  }

  if (!working) return null;

  const set = <K extends keyof ChargeCode>(k: K, v: ChargeCode[K]) =>
    setWorking({ ...working, [k]: v });

  function toggleMode(m: string) {
    if (!working) return;
    const next = working.applicableModes.includes(m)
      ? working.applicableModes.filter((x) => x !== m)
      : [...working.applicableModes, m];
    setWorking({ ...working, applicableModes: next });
  }

  function toggleDirection(d: string) {
    if (!working) return;
    const next = working.applicableDirections.includes(d)
      ? working.applicableDirections.filter((x) => x !== d)
      : [...working.applicableDirections, d];
    setWorking({ ...working, applicableDirections: next });
  }

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
              <ListChecks className="size-3.5" />
              {isNew ? "Add charge code" : "Edit charge code"}
              {!isNew && (
                <>
                  <span className="text-zinc-300">·</span>
                  <span className="font-mono">{working.braiinCode}</span>
                </>
              )}
            </div>
            <div className="font-medium">{working.description || "(unnamed)"}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} className="size-8 p-0">
            <X className="size-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Identity */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">
              Identity
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-zinc-600 block">
                Braiin code{" "}
                {isNew ? (
                  ""
                ) : (
                  <span className="text-zinc-400">(read-only after create)</span>
                )}
              </label>
              <input
                type="text"
                value={working.braiinCode}
                onChange={(e) => set("braiinCode", e.target.value)}
                disabled={!isNew}
                placeholder="origin_thc"
                className="w-full h-9 px-2 rounded border border-zinc-300 text-sm font-mono bg-white disabled:bg-zinc-100 disabled:text-zinc-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-zinc-600 block">Description</label>
              <input
                type="text"
                value={working.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Origin terminal handling charges"
                className="w-full h-9 px-2 rounded border border-zinc-300 text-sm bg-white"
              />
            </div>
          </div>

          <Separator />

          {/* Classification */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">
              Classification
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-600 block">
                  Billing type
                </label>
                <select
                  value={working.billingType}
                  onChange={(e) =>
                    set("billingType", e.target.value as ChargeCode["billingType"])
                  }
                  className="w-full h-9 px-2 rounded border border-zinc-300 text-sm bg-white"
                >
                  <option value="margin">Margin (marked up)</option>
                  <option value="revenue">Revenue (flat fee)</option>
                  <option value="disbursement">Disbursement (pass-through)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-600 block">Section</label>
                <select
                  value={working.macroGroup}
                  onChange={(e) =>
                    set("macroGroup", e.target.value as ChargeCode["macroGroup"])
                  }
                  className="w-full h-9 px-2 rounded border border-zinc-300 text-sm bg-white"
                >
                  <option value="origin_exw">Origin &amp; EXW</option>
                  <option value="freight">Freight</option>
                  <option value="destination_delivery">
                    Destination &amp; Delivery
                  </option>
                  <option value="insurance_other">Insurance &amp; Other</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-zinc-600 block">
                Default markup % (overridable per quote / per rule)
              </label>
              <input
                type="number"
                value={working.defaultMarginPct}
                step={0.5}
                onChange={(e) =>
                  set("defaultMarginPct", Number(e.target.value))
                }
                className="w-32 h-9 px-2 text-right rounded border border-zinc-300 text-sm font-mono bg-white"
              />
              <span className="text-[11px] text-zinc-500 ml-2">%</span>
            </div>
          </div>

          <Separator />

          {/* Applicability */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">
              Applicable modes
            </div>
            <div className="grid grid-cols-3 gap-1">
              {ALL_MODES.map((m) => (
                <label
                  key={m}
                  className="flex items-center gap-2 text-xs cursor-pointer hover:bg-zinc-50 px-2 py-1 rounded border border-zinc-200"
                >
                  <input
                    type="checkbox"
                    checked={working.applicableModes.includes(m)}
                    onChange={() => toggleMode(m)}
                    className="size-3.5 accent-violet-600"
                  />
                  <span>{m.replace("_", " ")}</span>
                </label>
              ))}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 mt-3">
              Applicable directions
            </div>
            <div className="grid grid-cols-3 gap-1">
              {ALL_DIRECTIONS.map((d) => (
                <label
                  key={d}
                  className="flex items-center gap-2 text-xs cursor-pointer hover:bg-zinc-50 px-2 py-1 rounded border border-zinc-200"
                >
                  <input
                    type="checkbox"
                    checked={working.applicableDirections.includes(d)}
                    onChange={() => toggleDirection(d)}
                    className="size-3.5 accent-violet-600"
                  />
                  <span>{d}</span>
                </label>
              ))}
            </div>
          </div>

          <Separator />

          {/* Source TMS */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">
              Source TMS provenance
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-600 block">
                  Source TMS
                </label>
                <select
                  value={working.tmsOrigin}
                  onChange={(e) => set("tmsOrigin", e.target.value as TmsOrigin)}
                  className="w-full h-9 px-2 rounded border border-zinc-300 text-sm bg-white"
                >
                  <option value="cargowise">Cargowise</option>
                  <option value="magaya">Magaya</option>
                  <option value="descartes">Descartes</option>
                  <option value="native">Braiin native</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-600 block">
                  TMS code
                </label>
                <input
                  type="text"
                  value={working.cwCode}
                  onChange={(e) => set("cwCode", e.target.value)}
                  placeholder="AFRT"
                  className="w-full h-9 px-2 rounded border border-zinc-300 text-sm font-mono bg-white"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-zinc-600 block">
                Source TMS metadata (CW department filter, etc.)
              </label>
              <input
                type="text"
                value={working.cwDepartments.join(", ")}
                onChange={(e) =>
                  set(
                    "cwDepartments",
                    e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
                placeholder="FEA, FIA, ALL"
                className="w-full h-9 px-2 rounded border border-zinc-300 text-sm font-mono bg-white"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3 flex items-center justify-between bg-zinc-50">
          <div>
            {!isNew && onDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="text-rose-700 hover:bg-rose-50"
                onClick={() => {
                  onDelete(working.braiinCode);
                  onClose();
                }}
              >
                <Trash2 className="size-3.5 mr-1.5" />
                Delete
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
              disabled={!working.braiinCode || !working.description}
              onClick={() => {
                onSave(working);
                onClose();
              }}
            >
              {isNew ? "Create code" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Page
// ============================================================

// ============================================================
// CSV import / export
// ============================================================

const CSV_HEADERS = [
  "braiin_code",
  "description",
  "billing_type",
  "macro_group",
  "default_margin_pct",
  "applicable_modes",
  "applicable_directions",
  "tms_origin",
  "tms_code",
  "tms_metadata",
] as const;

const VALID_BILLING = ["margin", "revenue", "disbursement"];
const VALID_MACRO = ["origin_exw", "freight", "destination_delivery", "insurance_other"];
const VALID_ORIGIN = ["cargowise", "magaya", "descartes", "native"];

interface UploadIssue {
  rowNumber: number;
  level: "error" | "warning";
  message: string;
}

interface ParsedUpload {
  rows: ChargeCode[];
  issues: UploadIssue[];
  totalParsed: number;
  newRows: number;
  updatedRows: number;
}

function chargeCodeToCsv(c: ChargeCode): CsvRow {
  return {
    braiin_code: c.braiinCode,
    description: c.description,
    billing_type: c.billingType,
    macro_group: c.macroGroup,
    default_margin_pct: String(c.defaultMarginPct),
    applicable_modes: c.applicableModes.join("|"),
    applicable_directions: c.applicableDirections.join("|"),
    tms_origin: c.tmsOrigin,
    tms_code: c.cwCode,
    tms_metadata: c.cwDepartments.join("|"),
  };
}

function csvToChargeCode(
  row: CsvRow,
  rowNumber: number,
  existing: ChargeCode[],
): { code: ChargeCode | null; issues: UploadIssue[] } {
  const issues: UploadIssue[] = [];
  const code = (row.braiin_code ?? "").trim();
  if (!code) {
    issues.push({
      rowNumber,
      level: "error",
      message: "braiin_code is required",
    });
    return { code: null, issues };
  }
  const description = (row.description ?? "").trim();
  if (!description) {
    issues.push({
      rowNumber,
      level: "error",
      message: `${code}: description is required`,
    });
    return { code: null, issues };
  }
  const billing = (row.billing_type ?? "margin").trim() as ChargeCode["billingType"];
  if (!VALID_BILLING.includes(billing)) {
    issues.push({
      rowNumber,
      level: "error",
      message: `${code}: billing_type must be one of ${VALID_BILLING.join(", ")}`,
    });
    return { code: null, issues };
  }
  const macro = (row.macro_group ?? "insurance_other").trim() as ChargeCode["macroGroup"];
  if (!VALID_MACRO.includes(macro)) {
    issues.push({
      rowNumber,
      level: "error",
      message: `${code}: macro_group must be one of ${VALID_MACRO.join(", ")}`,
    });
    return { code: null, issues };
  }
  const pctRaw = (row.default_margin_pct ?? "0").trim();
  const pct = Number(pctRaw);
  if (!Number.isFinite(pct)) {
    issues.push({
      rowNumber,
      level: "warning",
      message: `${code}: default_margin_pct "${pctRaw}" is not a number, defaulting to 0`,
    });
  }
  const modes = (row.applicable_modes ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  const dirs = (row.applicable_directions ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = (row.tms_origin ?? "native").trim() as TmsOrigin;
  if (!VALID_ORIGIN.includes(origin)) {
    issues.push({
      rowNumber,
      level: "error",
      message: `${code}: tms_origin must be one of ${VALID_ORIGIN.join(", ")}`,
    });
    return { code: null, issues };
  }
  const tmsCode = (row.tms_code ?? "").trim();
  const meta = (row.tms_metadata ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  if (existing.some((e) => e.braiinCode === code)) {
    // Update existing - flag as such
    issues.push({
      rowNumber,
      level: "warning",
      message: `${code}: existing entry will be UPDATED`,
    });
  }

  return {
    code: {
      braiinCode: code,
      description,
      billingType: billing,
      macroGroup: macro,
      defaultMarginPct: Number.isFinite(pct) ? pct : 0,
      applicableModes: modes,
      applicableDirections: dirs,
      tmsOrigin: origin,
      cwCode: tmsCode,
      cwDepartments: meta.length > 0 ? meta : ["ALL"],
    },
    issues,
  };
}

function makeTemplate(): string {
  const examples: ChargeCode[] = [
    {
      braiinCode: "example_origin_thc",
      description: "Origin Terminal Handling - example",
      billingType: "margin",
      macroGroup: "origin_exw",
      defaultMarginPct: 100,
      applicableModes: ["sea_fcl", "sea_lcl"],
      applicableDirections: ["export"],
      tmsOrigin: "native",
      cwCode: "OTHC",
      cwDepartments: ["FES", "FIS"],
    },
    {
      braiinCode: "example_admin_fee",
      description: "Booking / admin fee - flat with no markup",
      billingType: "revenue",
      macroGroup: "insurance_other",
      defaultMarginPct: 0,
      applicableModes: ["sea_fcl", "sea_lcl", "air", "road", "rail"],
      applicableDirections: ["import", "export", "crosstrade"],
      tmsOrigin: "native",
      cwCode: "",
      cwDepartments: ["ALL"],
    },
    {
      braiinCode: "example_demurrage",
      description: "Demurrage - pass-through to customer at cost",
      billingType: "disbursement",
      macroGroup: "destination_delivery",
      defaultMarginPct: 0,
      applicableModes: ["sea_fcl", "sea_lcl"],
      applicableDirections: ["import"],
      tmsOrigin: "native",
      cwCode: "CDEM",
      cwDepartments: ["FIS"],
    },
  ];
  const rows = examples.map(chargeCodeToCsv);
  return serializeCsv([...CSV_HEADERS], rows);
}

// ============================================================
// Upload preview slide-in
// ============================================================

interface UploadPreviewProps {
  parsed: ParsedUpload | null;
  onClose: () => void;
  onConfirm: (rows: ChargeCode[]) => void;
}

function UploadPreviewPanel({ parsed, onClose, onConfirm }: UploadPreviewProps) {
  if (!parsed) return null;
  const errorCount = parsed.issues.filter((i) => i.level === "error").length;
  const warningCount = parsed.issues.filter((i) => i.level === "warning").length;

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
              <Upload className="size-3.5" />
              Upload preview
            </div>
            <div className="font-medium">
              {parsed.totalParsed} rows parsed ·{" "}
              <span className="text-emerald-700">{parsed.newRows} new</span>{" "}
              + <span className="text-amber-700">{parsed.updatedRows} update</span>
            </div>
            <div className="text-[11px] text-zinc-500 mt-1 inline-flex items-center gap-3">
              {errorCount > 0 && (
                <span className="text-rose-700">
                  <AlertTriangle className="size-3 inline" /> {errorCount} error
                  {errorCount === 1 ? "" : "s"}
                </span>
              )}
              {warningCount > 0 && (
                <span className="text-amber-700">
                  {warningCount} warning{warningCount === 1 ? "" : "s"}
                </span>
              )}
              {errorCount === 0 && warningCount === 0 && (
                <span className="text-emerald-700">
                  <Check className="size-3 inline" /> All rows valid
                </span>
              )}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} className="size-8 p-0">
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {parsed.issues.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                Issues
              </div>
              {parsed.issues.map((iss, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 text-xs px-3 py-1.5 rounded border ${
                    iss.level === "error"
                      ? "bg-rose-50/60 border-rose-200 text-rose-800"
                      : "bg-amber-50/60 border-amber-200 text-amber-800"
                  }`}
                >
                  <span className="font-mono text-[10px] shrink-0">
                    row {iss.rowNumber}
                  </span>
                  <span>{iss.message}</span>
                </div>
              ))}
            </div>
          )}

          {parsed.rows.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                Rows ready to import ({parsed.rows.length})
              </div>
              {parsed.rows.map((c) => (
                <div
                  key={c.braiinCode}
                  className="flex items-center gap-2 text-xs px-3 py-1.5 rounded border border-zinc-200 hover:bg-zinc-50"
                >
                  <span className="font-mono text-zinc-700">{c.braiinCode}</span>
                  <span className="text-zinc-500 truncate flex-1">
                    {c.description}
                  </span>
                  <Badge className={`${PILL_SM} ${BILLING_TONE[c.billingType]}`}>
                    {BILLING_LABEL[c.billingType]}
                  </Badge>
                  <Badge className={`${PILL_SM} ${MACRO_TONE[c.macroGroup]}`}>
                    {MACRO_LABEL[c.macroGroup]}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t px-5 py-3 flex items-center justify-between bg-zinc-50">
          <div className="text-[11px] text-zinc-500">
            Errors block import. Warnings are informational.
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={errorCount > 0 || parsed.rows.length === 0}
              onClick={() => {
                onConfirm(parsed.rows);
                onClose();
              }}
            >
              <Upload className="size-3.5 mr-1.5" />
              Import {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const EMPTY_DRAFT: ChargeCode = {
  braiinCode: "",
  description: "",
  billingType: "margin",
  macroGroup: "origin_exw",
  defaultMarginPct: 100,
  applicableModes: ["sea_fcl", "sea_lcl", "air", "road", "rail"],
  applicableDirections: ["import", "export", "crosstrade"],
  tmsOrigin: "native",
  cwCode: "",
  cwDepartments: ["ALL"],
};

export default function ChargeCodesPage() {
  // Live dictionary loaded from /api/charge-codes on mount. Empty until the
  // first fetch resolves; the BraiinLoader covers the gap. We do NOT
  // pre-populate with seed data because that would mask a broken API.
  const [codes, setCodes] = useState<ChargeCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ draft: ChargeCode; isNew: boolean } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/charge-codes")
      .then(async (r) => {
        const data = (await r.json()) as { codes?: ChargeCode[]; error?: string };
        if (!r.ok) throw new Error(data.error ?? `Load failed (${r.status})`);
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        // Fail loud if the dictionary is genuinely empty - that almost
        // always means a missing migration, not "no codes yet".
        setCodes(data.codes ?? []);
        if ((data.codes ?? []).length === 0) {
          setCodes(CHARGE_CODES);
          setError(
            "Charge code dictionary is empty in the DB - showing seed data. Apply migration 040 + populate quotes.charge_codes.",
          );
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Load failed");
        setCodes(CHARGE_CODES);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function callApi(method: string, body: unknown): Promise<void> {
    const r = await fetch("/api/charge-codes", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `${method} failed (${r.status})`);
    }
  }

  async function persistOne(code: ChargeCode) {
    return callApi("POST", code);
  }

  async function persistDelete(braiinCode: string) {
    return callApi("DELETE", { braiinCode });
  }

  async function persistBulk(rows: ChargeCode[]) {
    return callApi("PATCH", { rows });
  }
  const [upload, setUpload] = useState<ParsedUpload | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleTemplate() {
    downloadCsv("charge-codes-template.csv", makeTemplate());
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const csvRows = parseCsv(text);
      const allIssues: UploadIssue[] = [];
      const parsed: ChargeCode[] = [];
      let newCount = 0;
      let updateCount = 0;
      csvRows.forEach((row, idx) => {
        const { code, issues } = csvToChargeCode(row, idx + 2, codes);
        allIssues.push(...issues);
        if (code) {
          parsed.push(code);
          if (codes.some((c) => c.braiinCode === code.braiinCode)) updateCount++;
          else newCount++;
        }
      });
      setUpload({
        rows: parsed,
        issues: allIssues,
        totalParsed: csvRows.length,
        newRows: newCount,
        updatedRows: updateCount,
      });
      // Clear the input so re-uploading the same file fires onChange.
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  }

  function handleConfirmImport(rows: ChargeCode[]) {
    setCodes((prev) => {
      const map = new Map(prev.map((c) => [c.braiinCode, c]));
      for (const r of rows) map.set(r.braiinCode, r);
      return Array.from(map.values());
    });
    persistBulk(rows).catch((e: unknown) => {
      setError(e instanceof Error ? `Bulk import failed: ${e.message}` : "Bulk import failed");
    });
  }

  const [query, setQuery] = useState("");
  const [billingFilter, setBillingFilter] =
    useState<"all" | ChargeCode["billingType"]>("all");
  const [macroFilter, setMacroFilter] =
    useState<"all" | ChargeCode["macroGroup"]>("all");
  const [modeFilter, setModeFilter] = useState<string>("all");
  const [originFilter, setOriginFilter] = useState<"all" | TmsOrigin>("all");

  function saveCode(next: ChargeCode) {
    setCodes((prev) => {
      const existing = prev.findIndex((c) => c.braiinCode === next.braiinCode);
      if (existing >= 0) {
        const copy = [...prev];
        copy[existing] = next;
        return copy;
      }
      return [next, ...prev];
    });
    persistOne(next).catch((e: unknown) => {
      setError(e instanceof Error ? `Save failed: ${e.message}` : "Save failed");
    });
  }

  function deleteCode(braiinCode: string) {
    setCodes((prev) => prev.filter((c) => c.braiinCode !== braiinCode));
    persistDelete(braiinCode).catch((e: unknown) => {
      setError(e instanceof Error ? `Delete failed: ${e.message}` : "Delete failed");
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return codes.filter((c) => {
      if (billingFilter !== "all" && c.billingType !== billingFilter) return false;
      if (macroFilter !== "all" && c.macroGroup !== macroFilter) return false;
      if (originFilter !== "all" && c.tmsOrigin !== originFilter) return false;
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
  }, [query, billingFilter, macroFilter, modeFilter, originFilter]);

  const counts = useMemo(() => {
    const byOrigin = new Map<TmsOrigin, number>();
    for (const c of codes) {
      byOrigin.set(c.tmsOrigin, (byOrigin.get(c.tmsOrigin) ?? 0) + 1);
    }
    return {
      total: codes.length,
      margin: codes.filter((c) => c.billingType === "margin").length,
      revenue: codes.filter((c) => c.billingType === "revenue").length,
      disbursement: codes.filter((c) => c.billingType === "disbursement").length,
      byOrigin: Array.from(byOrigin.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [codes]);

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
              <Button variant="outline" size="sm" onClick={handleTemplate}>
                <Download className="size-3.5 mr-1.5" />
                Template
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-3.5 mr-1.5" />
                Upload CSV
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleUpload}
                className="hidden"
              />
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => setEditing({ draft: { ...EMPTY_DRAFT }, isNew: true })}
              >
                <Plus className="size-3.5 mr-1.5" />
                Add code
              </Button>
            </div>
          </div>
        </div>

        <div className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">
          {error && (
            <div className="border border-rose-300 bg-rose-50 text-rose-800 text-xs px-3 py-2 rounded flex items-start gap-2">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
              <button
                onClick={() => setError(null)}
                className="text-rose-700 hover:text-rose-900 text-[11px] underline"
              >
                dismiss
              </button>
            </div>
          )}
          {loading && <BraiinLoader label="Loading charge codes..." />}

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
                codes (Cargowise <span className="font-mono">AFRT</span>, Magaya{" "}
                <span className="font-mono">FRT</span>, etc.) translate to these
                via <span className="font-mono">tms.charge_code_map</span> so the
                rate engine and quote document never know which TMS the cost came
                from.
                <br />
                <br />
                <span className="font-medium">Source provenance:</span> every code
                is tagged with{" "}
                <span className="font-mono">tms_origin</span> so we know which TMS
                dictionary the canonical code was lifted from. All 107 entries
                below are tagged{" "}
                <Badge
                  className={`${PILL_SM} ${TMS_ORIGIN_TONE.cargowise} font-mono`}
                >
                  Cargowise
                </Badge>
                {" "}(seeded from{" "}
                <span className="font-mono">
                  docs/wisor/Charge codes_CW(1)_UPDATED.xlsx
                </span>
                ). Future Magaya / Descartes seeds will land alongside with their
                own origin tag - operator can filter to see "Cargowise codes
                only" or "all sources" via the dropdown above.
              </div>
            </CardContent>
          </Card>

          {/* KPI strip */}
          <div className="grid grid-cols-5 gap-3">
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
            <Card>
              <CardContent className="py-3 px-4">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                  Sourced from
                </div>
                <div className="space-y-0.5 mt-1">
                  {counts.byOrigin.map(([origin, n]) => (
                    <div
                      key={origin}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <Badge className={`${PILL_SM} ${TMS_ORIGIN_TONE[origin]}`}>
                        {TMS_ORIGIN_LABEL[origin]}
                      </Badge>
                      <span className="font-mono text-zinc-700">{n}</span>
                    </div>
                  ))}
                </div>
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
            <select
              value={originFilter}
              onChange={(e) => setOriginFilter(e.target.value as "all" | TmsOrigin)}
              className="h-9 px-2 rounded border border-zinc-300 bg-white text-sm"
            >
              <option value="all">All TMS sources</option>
              <option value="cargowise">Cargowise</option>
              <option value="magaya">Magaya</option>
              <option value="descartes">Descartes</option>
              <option value="native">Braiin native</option>
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
                    <TableHead className="w-[110px]">Source TMS</TableHead>
                    <TableHead className="w-[140px]">TMS code</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow
                      key={c.braiinCode}
                      className="hover:bg-zinc-50 cursor-pointer group"
                      onClick={() => setEditing({ draft: c, isNew: false })}
                    >
                      <TableCell>
                        <div className="font-mono text-[12px] text-zinc-800 inline-flex items-center gap-1.5">
                          {c.braiinCode}
                          <Pencil className="size-3 text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity" />
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
                        <Badge className={`${PILL_SM} ${TMS_ORIGIN_TONE[c.tmsOrigin]}`}>
                          {TMS_ORIGIN_LABEL[c.tmsOrigin]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="inline-flex items-center gap-1.5 text-xs">
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
            Click any row to edit · changes persist for this session only ·
            production reads{" "}
            <span className="font-mono">quotes.charge_codes</span> +{" "}
            <span className="font-mono">tms.charge_code_map</span> via API.
          </div>
        </div>

        <ChargeCodeEditPanel
          draft={editing?.draft ?? null}
          isNew={editing?.isNew ?? false}
          onClose={() => setEditing(null)}
          onSave={saveCode}
          onDelete={editing && !editing.isNew ? deleteCode : null}
        />
        <UploadPreviewPanel
          parsed={upload}
          onClose={() => setUpload(null)}
          onConfirm={handleConfirmImport}
        />
      </div>
    </PageGuard>
  );
}
