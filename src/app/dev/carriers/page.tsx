"use client";

/**
 * Visual mock-up of the carrier rolodex - the AI's pool to choose from
 * when fanning out an RFQ.
 *
 * Static page, no backend calls. Production will read from
 * partners.carriers + partners.scorecards + partners.lane_stats.
 */

import { useMemo, useRef, useState } from "react";
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
  AlertTriangle,
  Check,
  Download,
  Mail,
  Plane,
  Plus,
  Search,
  Ship,
  Sparkles,
  Truck,
  Upload,
  Users,
  X,
} from "lucide-react";
import { downloadCsv, parseCsv, serializeCsv, type CsvRow } from "@/lib/csv";

const PILL_SM =
  "text-[10px] px-1.5 py-0 leading-[18px] h-[18px] font-normal tracking-normal";

// ============================================================
// Mock data
// ============================================================

type Mode = "sea_fcl" | "sea_lcl" | "air" | "road" | "rail";
type Kind = "carrier" | "agent" | "broker" | "nvocc" | "aggregator";

interface Carrier {
  id: string;
  name: string;
  kind: Kind;
  scac?: string;
  iata?: string;
  modes: Mode[];
  contracting: "api" | "email" | "aggregator" | "portal";
  composite: number;
  suitability: number;
  speed: number;
  accuracy: number;
  price: number;
  service: number;
  rfq90d: number;
  reply90d: number;
  medianReplyMin: number;
  laneCount: number; // distinct (origin_country, dest_country) pairs with history
  lastUsedDays: number;
  manual: boolean;
  notes?: string;
}

const CARRIERS: Carrier[] = [
  // Ocean
  { id: "MAEU", name: "Maersk Line", kind: "carrier", scac: "MAEU", modes: ["sea_fcl"], contracting: "api", composite: 84, suitability: 92, speed: 88, accuracy: 86, price: 76, service: 79, rfq90d: 142, reply90d: 132, medianReplyMin: 24, laneCount: 38, lastUsedDays: 1, manual: false },
  { id: "HLCU", name: "Hapag-Lloyd", kind: "carrier", scac: "HLCU", modes: ["sea_fcl"], contracting: "email", composite: 82, suitability: 88, speed: 81, accuracy: 91, price: 71, service: 90, rfq90d: 118, reply90d: 109, medianReplyMin: 31, laneCount: 32, lastUsedDays: 0, manual: false },
  { id: "MSCU", name: "MSC", kind: "carrier", scac: "MSCU", modes: ["sea_fcl"], contracting: "email", composite: 79, suitability: 90, speed: 76, accuracy: 81, price: 84, service: 71, rfq90d: 156, reply90d: 138, medianReplyMin: 38, laneCount: 41, lastUsedDays: 0, manual: false },
  { id: "CMDU", name: "CMA CGM", kind: "carrier", scac: "CMDU", modes: ["sea_fcl"], contracting: "api", composite: 85, suitability: 87, speed: 84, accuracy: 88, price: 79, service: 84, rfq90d: 132, reply90d: 124, medianReplyMin: 22, laneCount: 35, lastUsedDays: 2, manual: false },
  { id: "ONEY", name: "Ocean Network Express", kind: "carrier", scac: "ONEY", modes: ["sea_fcl"], contracting: "email", composite: 71, suitability: 78, speed: 62, accuracy: 79, price: 70, service: 76, rfq90d: 84, reply90d: 71, medianReplyMin: 88, laneCount: 26, lastUsedDays: 4, manual: false },
  { id: "EGLV", name: "Evergreen Marine", kind: "carrier", scac: "EGLV", modes: ["sea_fcl"], contracting: "email", composite: 76, suitability: 80, speed: 71, accuracy: 80, price: 78, service: 72, rfq90d: 92, reply90d: 79, medianReplyMin: 62, laneCount: 21, lastUsedDays: 5, manual: false },

  // Air
  { id: "LH", name: "Lufthansa Cargo", kind: "carrier", iata: "020", modes: ["air"], contracting: "api", composite: 87, suitability: 91, speed: 92, accuracy: 88, price: 78, service: 86, rfq90d: 96, reply90d: 91, medianReplyMin: 18, laneCount: 24, lastUsedDays: 1, manual: false },
  { id: "EK", name: "Emirates SkyCargo", kind: "carrier", iata: "176", modes: ["air"], contracting: "api", composite: 85, suitability: 88, speed: 88, accuracy: 84, price: 76, service: 87, rfq90d: 88, reply90d: 81, medianReplyMin: 22, laneCount: 22, lastUsedDays: 2, manual: false },
  { id: "BA", name: "British Airways World Cargo", kind: "carrier", iata: "125", modes: ["air"], contracting: "email", composite: 74, suitability: 78, speed: 72, accuracy: 80, price: 64, service: 78, rfq90d: 64, reply90d: 51, medianReplyMin: 62, laneCount: 18, lastUsedDays: 6, manual: false },
  { id: "QR", name: "Qatar Airways Cargo", kind: "carrier", iata: "157", modes: ["air"], contracting: "email", composite: 78, suitability: 84, speed: 78, accuracy: 79, price: 70, service: 81, rfq90d: 51, reply90d: 42, medianReplyMin: 45, laneCount: 16, lastUsedDays: 4, manual: false, notes: "Apex Pharma's preferred Singapore carrier" },
  { id: "CV", name: "Cargolux", kind: "carrier", iata: "172", modes: ["air"], contracting: "email", composite: 82, suitability: 86, speed: 79, accuracy: 86, price: 75, service: 84, rfq90d: 72, reply90d: 64, medianReplyMin: 31, laneCount: 19, lastUsedDays: 3, manual: false },

  // Aggregators
  { id: "AGG-CARGOAI", name: "CargoAI (aggregator)", kind: "aggregator", modes: ["air"], contracting: "aggregator", composite: 88, suitability: 95, speed: 99, accuracy: 82, price: 80, service: 78, rfq90d: 412, reply90d: 408, medianReplyMin: 4, laneCount: 88, lastUsedDays: 0, manual: false, notes: "Bundles top 3 carriers per lane automatically" },
  { id: "AGG-CARGOONE", name: "Cargo.one (aggregator)", kind: "aggregator", modes: ["air"], contracting: "aggregator", composite: 86, suitability: 93, speed: 97, accuracy: 80, price: 79, service: 76, rfq90d: 384, reply90d: 380, medianReplyMin: 6, laneCount: 76, lastUsedDays: 0, manual: false },

  // Road
  { id: "ROAD-MARITIME", name: "Maritime Transport", kind: "carrier", modes: ["road"], contracting: "email", composite: 81, suitability: 86, speed: 84, accuracy: 88, price: 72, service: 84, rfq90d: 78, reply90d: 71, medianReplyMin: 26, laneCount: 12, lastUsedDays: 1, manual: false },
  { id: "ROAD-DSV", name: "DSV Road UK", kind: "carrier", modes: ["road"], contracting: "email", composite: 78, suitability: 82, speed: 79, accuracy: 84, price: 70, service: 81, rfq90d: 64, reply90d: 58, medianReplyMin: 35, laneCount: 14, lastUsedDays: 2, manual: false },
  { id: "ROAD-LEEDS", name: "Northern Pallet (Leeds)", kind: "broker", modes: ["road"], contracting: "email", composite: 62, suitability: 78, speed: 71, accuracy: 70, price: 76, service: 64, rfq90d: 18, reply90d: 14, medianReplyMin: 88, laneCount: 4, lastUsedDays: 12, manual: true, notes: "Added by Marcus 2026-04-21 - covers LS/BD postcodes" },

  // Manual one-off
  { id: "BLU-AIR", name: "Bluewater Air Cargo", kind: "carrier", modes: ["air"], contracting: "email", composite: 50, suitability: 50, speed: 50, accuracy: 50, price: 50, service: 50, rfq90d: 1, reply90d: 0, medianReplyMin: 0, laneCount: 0, lastUsedDays: 0, manual: true, notes: "Added by Rob 2026-04-28 from Apex Pharma RFQ - no replies yet" },
];

// ============================================================
// Helpers
// ============================================================

function ScorePill({ value }: { value: number }) {
  const tone =
    value >= 80
      ? "bg-emerald-100 text-emerald-800"
      : value >= 70
        ? "bg-amber-100 text-amber-800"
        : value >= 60
          ? "bg-orange-100 text-orange-800"
          : "bg-zinc-100 text-zinc-600";
  return <Badge className={`${PILL_SM} ${tone} font-mono`}>{value}</Badge>;
}

function ModeIcon({ mode, className = "" }: { mode: Mode; className?: string }) {
  if (mode === "air") return <Plane className={`size-3.5 ${className}`} />;
  if (mode === "road") return <Truck className={`size-3.5 ${className}`} />;
  return <Ship className={`size-3.5 ${className}`} />;
}

const KIND_LABEL: Record<Kind, string> = {
  carrier: "carrier",
  agent: "agent",
  broker: "broker",
  nvocc: "NVOCC",
  aggregator: "aggregator",
};

const KIND_TONE: Record<Kind, string> = {
  carrier: "bg-zinc-100 text-zinc-700",
  agent: "bg-amber-100 text-amber-800",
  broker: "bg-violet-100 text-violet-800",
  nvocc: "bg-cyan-100 text-cyan-800",
  aggregator: "bg-cyan-100 text-cyan-800",
};

const MODE_LABEL: Record<Mode, string> = {
  sea_fcl: "Sea FCL",
  sea_lcl: "Sea LCL",
  air: "Air",
  road: "Road",
  rail: "Rail",
};

// ============================================================
// CSV import / export
// ============================================================

const CSV_HEADERS = [
  "id",
  "name",
  "kind",
  "modes",
  "scac",
  "iata",
  "contracting",
  "manual",
  "notes",
] as const;

const VALID_KIND = ["carrier", "agent", "broker", "nvocc", "aggregator"];
const VALID_CONTRACTING = ["api", "email", "aggregator", "portal"];
const VALID_MODE = ["sea_fcl", "sea_lcl", "air", "road", "rail"];

interface UploadIssue {
  rowNumber: number;
  level: "error" | "warning";
  message: string;
}

interface ParsedUpload {
  rows: Carrier[];
  issues: UploadIssue[];
  totalParsed: number;
  newRows: number;
  updatedRows: number;
}

function carrierToCsv(c: Carrier): CsvRow {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    modes: c.modes.join("|"),
    scac: c.scac ?? "",
    iata: c.iata ?? "",
    contracting: c.contracting,
    manual: c.manual ? "true" : "false",
    notes: c.notes ?? "",
  };
}

function csvToCarrier(
  row: CsvRow,
  rowNumber: number,
  existing: Carrier[],
): { carrier: Carrier | null; issues: UploadIssue[] } {
  const issues: UploadIssue[] = [];
  const id = (row.id ?? "").trim();
  const name = (row.name ?? "").trim();
  if (!name) {
    issues.push({ rowNumber, level: "error", message: "name is required" });
    return { carrier: null, issues };
  }
  const kind = (row.kind ?? "carrier").trim() as Kind;
  if (!VALID_KIND.includes(kind)) {
    issues.push({
      rowNumber,
      level: "error",
      message: `${name}: kind must be one of ${VALID_KIND.join(", ")}`,
    });
    return { carrier: null, issues };
  }
  const contracting = (row.contracting ?? "email").trim() as Carrier["contracting"];
  if (!VALID_CONTRACTING.includes(contracting)) {
    issues.push({
      rowNumber,
      level: "error",
      message: `${name}: contracting must be one of ${VALID_CONTRACTING.join(", ")}`,
    });
    return { carrier: null, issues };
  }
  const modesRaw = (row.modes ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const m of modesRaw) {
    if (!VALID_MODE.includes(m)) {
      issues.push({
        rowNumber,
        level: "error",
        message: `${name}: mode "${m}" not one of ${VALID_MODE.join(", ")}`,
      });
      return { carrier: null, issues };
    }
  }

  // Auto-id if blank: name initials + 4-digit random
  const finalId =
    id ||
    name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 4) +
      "-" +
      Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, "0");

  if (id && existing.some((e) => e.id === id)) {
    issues.push({
      rowNumber,
      level: "warning",
      message: `${id}: existing carrier will be UPDATED`,
    });
  }

  // Manually-added carriers default to neutral 50 scores until they
  // gather data; existing carriers keep their existing scores.
  const existingMatch = existing.find((e) => e.id === finalId);
  const defaults = existingMatch ?? {
    composite: 50,
    suitability: 50,
    speed: 50,
    accuracy: 50,
    price: 50,
    service: 50,
    rfq90d: 0,
    reply90d: 0,
    medianReplyMin: 0,
    laneCount: 0,
    lastUsedDays: 0,
  };

  return {
    carrier: {
      id: finalId,
      name,
      kind,
      scac: (row.scac ?? "").trim() || undefined,
      iata: (row.iata ?? "").trim() || undefined,
      modes: modesRaw as Mode[],
      contracting,
      composite: defaults.composite,
      suitability: defaults.suitability,
      speed: defaults.speed,
      accuracy: defaults.accuracy,
      price: defaults.price,
      service: defaults.service,
      rfq90d: defaults.rfq90d,
      reply90d: defaults.reply90d,
      medianReplyMin: defaults.medianReplyMin,
      laneCount: defaults.laneCount,
      lastUsedDays: defaults.lastUsedDays,
      manual: (row.manual ?? "true").trim().toLowerCase() !== "false",
      notes: (row.notes ?? "").trim() || undefined,
    },
    issues,
  };
}

function makeCarrierTemplate(): string {
  const examples: Carrier[] = [
    {
      id: "EXAMPLE-OCN",
      name: "Example Ocean Lines",
      kind: "carrier",
      scac: "EXOL",
      modes: ["sea_fcl"],
      contracting: "email",
      composite: 50,
      suitability: 50,
      speed: 50,
      accuracy: 50,
      price: 50,
      service: 50,
      rfq90d: 0,
      reply90d: 0,
      medianReplyMin: 0,
      laneCount: 0,
      lastUsedDays: 0,
      manual: true,
      notes: "Replace with real ocean carrier",
    },
    {
      id: "EXAMPLE-AIR",
      name: "Example Air Cargo",
      kind: "carrier",
      iata: "999",
      modes: ["air"],
      contracting: "api",
      composite: 50,
      suitability: 50,
      speed: 50,
      accuracy: 50,
      price: 50,
      service: 50,
      rfq90d: 0,
      reply90d: 0,
      medianReplyMin: 0,
      laneCount: 0,
      lastUsedDays: 0,
      manual: true,
    },
    {
      id: "EXAMPLE-ROAD",
      name: "Example Road Haulier",
      kind: "broker",
      modes: ["road"],
      contracting: "email",
      composite: 50,
      suitability: 50,
      speed: 50,
      accuracy: 50,
      price: 50,
      service: 50,
      rfq90d: 0,
      reply90d: 0,
      medianReplyMin: 0,
      laneCount: 0,
      lastUsedDays: 0,
      manual: true,
      notes: "UK road network coverage",
    },
  ];
  return serializeCsv([...CSV_HEADERS], examples.map(carrierToCsv));
}

interface UploadPreviewProps {
  parsed: ParsedUpload | null;
  onClose: () => void;
  onConfirm: (rows: Carrier[]) => void;
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
              <span className="text-emerald-700">{parsed.newRows} new</span> +{" "}
              <span className="text-amber-700">{parsed.updatedRows} update</span>
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
                Carriers ready to import ({parsed.rows.length})
              </div>
              {parsed.rows.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 text-xs px-3 py-1.5 rounded border border-zinc-200 hover:bg-zinc-50"
                >
                  <span className="font-medium text-zinc-800 truncate flex-1">
                    {c.name}
                  </span>
                  <Badge className={`${PILL_SM} ${KIND_TONE[c.kind]}`}>
                    {KIND_LABEL[c.kind]}
                  </Badge>
                  <div className="inline-flex items-center gap-0.5 text-zinc-500">
                    {c.modes.map((m) => (
                      <ModeIcon key={m} mode={m} />
                    ))}
                  </div>
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
              Import {parsed.rows.length} carrier{parsed.rows.length === 1 ? "" : "s"}
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

export default function CarriersPage() {
  // Mutable state - edits persist within session.
  const [carriers, setCarriers] = useState<Carrier[]>(CARRIERS);
  const [upload, setUpload] = useState<ParsedUpload | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleTemplate() {
    downloadCsv("carriers-template.csv", makeCarrierTemplate());
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const csvRows = parseCsv(text);
      const allIssues: UploadIssue[] = [];
      const parsed: Carrier[] = [];
      let newCount = 0;
      let updateCount = 0;
      csvRows.forEach((row, idx) => {
        const { carrier, issues } = csvToCarrier(row, idx + 2, carriers);
        allIssues.push(...issues);
        if (carrier) {
          parsed.push(carrier);
          if (carriers.some((c) => c.id === carrier.id)) updateCount++;
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
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  }

  function handleConfirmImport(rows: Carrier[]) {
    setCarriers((prev) => {
      const map = new Map(prev.map((c) => [c.id, c]));
      for (const r of rows) map.set(r.id, r);
      return Array.from(map.values());
    });
  }

  const [query, setQuery] = useState("");
  const [modeFilter, setModeFilter] = useState<Mode | "all">("all");
  const [kindFilter, setKindFilter] = useState<Kind | "all">("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return carriers
      .filter((c) => {
        if (modeFilter !== "all" && !c.modes.includes(modeFilter)) return false;
        if (kindFilter !== "all" && c.kind !== kindFilter) return false;
        if (q.length > 0) {
          const hay = [c.name, c.scac ?? "", c.iata ?? "", c.notes ?? ""]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.composite - a.composite);
  }, [carriers, query, modeFilter, kindFilter]);

  const counts = useMemo(() => {
    return {
      total: carriers.length,
      manual: carriers.filter((c) => c.manual).length,
      aggregator: carriers.filter((c) => c.kind === "aggregator").length,
      api: carriers.filter((c) => c.contracting === "api").length,
    };
  }, [carriers]);

  return (
    <PageGuard pageId="dev_carriers">
      <div className="min-h-screen bg-zinc-50">
        {/* Top bar */}
        <div className="border-b bg-white">
          <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Users className="size-5 text-zinc-600" />
              <h1 className="text-lg font-medium">Carrier rolodex</h1>
              <Badge className={`${PILL_SM} bg-zinc-100 text-zinc-600 font-mono`}>
                /carriers
              </Badge>
            </div>
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
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700">
              <Plus className="size-3.5 mr-1.5" />
              Add carrier
            </Button>
          </div>
        </div>

        <div className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">
          {/* KPI strip */}
          <div className="grid grid-cols-4 gap-3">
            <Card>
              <CardContent className="py-3 px-4">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                  Total carriers
                </div>
                <div className="text-2xl font-mono">{counts.total}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                  Manually added
                </div>
                <div className="text-2xl font-mono text-emerald-700">
                  {counts.manual}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                  Aggregators
                </div>
                <div className="text-2xl font-mono text-cyan-700">
                  {counts.aggregator}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                  API integrations
                </div>
                <div className="text-2xl font-mono text-violet-700">{counts.api}</div>
              </CardContent>
            </Card>
          </div>

          {/* Filter row */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Search name, SCAC, IATA, notes..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full h-9 pl-8 pr-3 rounded border border-zinc-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
            </div>
            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value as Mode | "all")}
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
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as Kind | "all")}
              className="h-9 px-2 rounded border border-zinc-300 bg-white text-sm"
            >
              <option value="all">All kinds</option>
              <option value="carrier">Carriers</option>
              <option value="agent">Agents</option>
              <option value="broker">Brokers</option>
              <option value="nvocc">NVOCCs</option>
              <option value="aggregator">Aggregators</option>
            </select>
          </div>

          {/* Table */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">
                Carriers ({filtered.length})
              </CardTitle>
              <div className="text-[11px] text-zinc-500 font-mono">
                sorted by composite score desc
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow className="text-[10px] uppercase tracking-wide">
                    <TableHead>Carrier</TableHead>
                    <TableHead className="w-[80px]">Modes</TableHead>
                    <TableHead className="w-[80px]">Composite</TableHead>
                    <TableHead className="w-[60px]">Suit.</TableHead>
                    <TableHead className="w-[60px]">Speed</TableHead>
                    <TableHead className="w-[60px]">Acc.</TableHead>
                    <TableHead className="w-[60px]">Price</TableHead>
                    <TableHead className="w-[60px]">Svc.</TableHead>
                    <TableHead className="w-[110px]">90d activity</TableHead>
                    <TableHead className="w-[100px]">Method</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id} className="hover:bg-zinc-50 cursor-pointer">
                      {/* Name + kind + codes */}
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="font-medium text-sm">{c.name}</div>
                          <Badge className={`${PILL_SM} ${KIND_TONE[c.kind]}`}>
                            {KIND_LABEL[c.kind]}
                          </Badge>
                          {c.manual && (
                            <Badge
                              className={`${PILL_SM} bg-emerald-100 text-emerald-800 uppercase tracking-wide`}
                            >
                              manual
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-zinc-500 mt-0.5">
                          {c.scac && <span className="font-mono">SCAC {c.scac}</span>}
                          {c.iata && <span className="font-mono">IATA {c.iata}</span>}
                          <span>· {c.laneCount} lanes</span>
                          {c.lastUsedDays === 0 ? (
                            <span className="text-emerald-700">· used today</span>
                          ) : (
                            <span>· last {c.lastUsedDays}d ago</span>
                          )}
                        </div>
                        {c.notes && (
                          <div className="text-[11px] text-zinc-500 italic mt-0.5">
                            {c.notes}
                          </div>
                        )}
                      </TableCell>

                      {/* Modes */}
                      <TableCell>
                        <div className="flex items-center gap-1 text-zinc-600">
                          {c.modes.map((m) => (
                            <ModeIcon key={m} mode={m} />
                          ))}
                        </div>
                      </TableCell>

                      {/* Composite + axes */}
                      <TableCell>
                        <ScorePill value={c.composite} />
                      </TableCell>
                      <TableCell>
                        <ScorePill value={c.suitability} />
                      </TableCell>
                      <TableCell>
                        <ScorePill value={c.speed} />
                      </TableCell>
                      <TableCell>
                        <ScorePill value={c.accuracy} />
                      </TableCell>
                      <TableCell>
                        <ScorePill value={c.price} />
                      </TableCell>
                      <TableCell>
                        <ScorePill value={c.service} />
                      </TableCell>

                      {/* 90d */}
                      <TableCell>
                        <div className="text-xs font-mono text-zinc-700">
                          {c.reply90d}/{c.rfq90d} replies
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {c.medianReplyMin > 0
                            ? `~${c.medianReplyMin}m median`
                            : "no data"}
                        </div>
                      </TableCell>

                      {/* Contracting method */}
                      <TableCell>
                        <Badge
                          className={`${PILL_SM} uppercase tracking-wide ${
                            c.contracting === "api"
                              ? "bg-violet-100 text-violet-800"
                              : c.contracting === "aggregator"
                                ? "bg-cyan-100 text-cyan-800"
                                : c.contracting === "portal"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-zinc-100 text-zinc-700"
                          }`}
                        >
                          {c.contracting}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="border-violet-200 bg-violet-50/30">
            <CardContent className="py-4 px-5 flex items-start gap-3">
              <Sparkles className="size-4 text-violet-600 shrink-0 mt-0.5" />
              <div className="text-xs text-zinc-700 leading-relaxed">
                <div className="font-medium text-violet-900 mb-1">
                  Scorecards recompute nightly
                </div>
                The composite score is{" "}
                <span className="font-mono">w_suit*Suit + w_speed*Speed + w_acc*Acc + w_price*Price + w_svc*Svc</span>{" "}
                with org-configurable weights (currently 0.20 each). Manual
                additions start at 50/50/50/50/50 and gather data from the first
                RFQ they're invited to. Lane-specific suitability comes from{" "}
                <span className="font-mono">partners.lane_stats</span> per (origin
                country, destination country, mode).
              </div>
            </CardContent>
          </Card>

          <div className="text-[11px] text-zinc-400 text-center pb-6">
            Mock-up · static data + session-only edits · production reads{" "}
            <span className="font-mono">partners.carriers</span> +{" "}
            <span className="font-mono">partners.scorecards</span> +{" "}
            <span className="font-mono">partners.lane_stats</span>.
          </div>
        </div>

        <UploadPreviewPanel
          parsed={upload}
          onClose={() => setUpload(null)}
          onConfirm={handleConfirmImport}
        />
      </div>
    </PageGuard>
  );
}
