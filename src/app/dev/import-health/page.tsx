"use client";

/**
 * /dev/import-health
 *
 * Three-card audit + drops dashboard for the event-followup import pipeline.
 *
 * Card 1 - Latest audit run: GET /api/event-followup/audit -> result counts by status.
 * Card 2 - Fresh audit runner: POST /api/event-followup/audit -> diff result inline.
 * Card 3 - Granola pending review: deferred until the Granola integration is wired
 *           (currently a no-op client per Phase 5). Comment left inline.
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { BraiinLoader } from "@/components/braiin-loader";
import { RefreshCw, ChevronDown, ChevronRight, Activity } from "lucide-react";

// ---------------------------------------------------------------------------
// Types matching /api/event-followup/audit responses
// ---------------------------------------------------------------------------

interface AuditSummary {
  run_id: string;
  imported_at: string;
  counts: Record<string, number>;
}

interface FieldMismatch {
  airtable_id: string;
  field: string;
  airtable_value: string | null;
  db_value: string | null;
}

interface AuditDiff {
  matched: number;
  missing: string[];
  field_mismatches: FieldMismatch[];
}

// ---------------------------------------------------------------------------
// Page entry point
// ---------------------------------------------------------------------------

export default function ImportHealthPage() {
  return (
    <PageGuard pageId="import-health">
      <ImportHealthInner />
    </PageGuard>
  );
}

// ---------------------------------------------------------------------------
// Inner component
// ---------------------------------------------------------------------------

function ImportHealthInner() {
  const [summary, setSummary] = useState<AuditSummary | null | undefined>(
    undefined,
  );
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [diffLoading, setDiffLoading] = useState(false);
  const [diff, setDiff] = useState<AuditDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [missingOpen, setMissingOpen] = useState(false);

  // Load latest audit run summary on mount
  useEffect(() => {
    loadSummary();
  }, []);

  async function loadSummary() {
    setSummary(undefined); // reset to loading state
    setSummaryError(null);
    try {
      const res = await fetch("/api/event-followup/audit");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load audit summary");
      setSummary(data.recent ?? null);
    } catch (e: unknown) {
      setSummaryError(e instanceof Error ? e.message : "Failed to load");
      setSummary(null);
    }
  }

  async function runFreshAudit() {
    setDiffLoading(true);
    setDiff(null);
    setDiffError(null);
    setMissingOpen(false);
    try {
      const res = await fetch("/api/event-followup/audit", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Audit failed");
      setDiff(data.diff ?? null);
      // Refresh the summary card after a fresh audit
      loadSummary();
    } catch (e: unknown) {
      setDiffError(e instanceof Error ? e.message : "Audit failed");
    } finally {
      setDiffLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-6 w-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Activity className="h-6 w-6 text-violet-600" />
            Import health
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Audit the event-followup import pipeline. View the latest run
            summary, diff Airtable vs DB on demand, and inspect any records that
            need attention.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadSummary}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh summary
        </Button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Card 1 - Latest audit run summary                                   */}
      {/* ------------------------------------------------------------------ */}
      <LatestRunCard
        summary={summary}
        error={summaryError}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Card 2 - Fresh audit runner (manager+)                              */}
      {/* ------------------------------------------------------------------ */}
      <FreshAuditCard
        loading={diffLoading}
        diff={diff}
        error={diffError}
        missingOpen={missingOpen}
        onToggleMissing={() => setMissingOpen((v) => !v)}
        onRunAudit={runFreshAudit}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Card 3 - Granola pending review (deferred)                         */}
      {/*                                                                     */}
      {/* Granola pending-review counter ships when an integration is wired  */}
      {/* (currently a no-op client per Phase 5). Skipped in v1.             */}
      {/* ------------------------------------------------------------------ */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card 1 - Latest audit run summary
// ---------------------------------------------------------------------------

function LatestRunCard({
  summary,
  error,
}: {
  summary: AuditSummary | null | undefined;
  error: string | null;
}) {
  return (
    <Card>
      <CardHeader className="py-4">
        <CardTitle className="text-base">Latest audit run</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
            {error}
          </div>
        )}

        {summary === undefined && !error && (
          <div className="flex items-center justify-center py-6">
            <BraiinLoader />
          </div>
        )}

        {summary === null && !error && (
          <p className="text-sm text-zinc-500 py-4">No imports run yet.</p>
        )}

        {summary && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="block text-xs uppercase tracking-wide text-zinc-400 mb-0.5">
                  Run ID
                </span>
                <span
                  className="font-mono text-xs text-zinc-700 truncate block"
                  title={summary.run_id}
                >
                  {summary.run_id}
                </span>
              </div>
              <div>
                <span className="block text-xs uppercase tracking-wide text-zinc-400 mb-0.5">
                  Imported at
                </span>
                <span className="text-zinc-700">
                  {new Date(summary.imported_at).toLocaleString()}
                </span>
              </div>
            </div>

            <div>
              <span className="block text-xs uppercase tracking-wide text-zinc-400 mb-2">
                Result breakdown
              </span>
              <ResultBreakdown counts={summary.counts} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Result breakdown - renders counts keyed by result string
// ---------------------------------------------------------------------------

function ResultBreakdown({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return <p className="text-sm text-zinc-500">No records logged.</p>;
  }

  const total = entries.reduce((s, [, n]) => s + n, 0);

  return (
    <div className="space-y-1">
      <p className="text-sm text-zinc-600 font-medium mb-2">
        Total: {total.toLocaleString()}
      </p>
      <div className="flex flex-wrap gap-2">
        {entries.map(([result, count]) => {
          const isAttention = result.startsWith("needs_attention");
          const isImported = result === "imported";
          return (
            <span
              key={result}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                isImported
                  ? "bg-emerald-100 text-emerald-800"
                  : isAttention
                    ? "bg-amber-100 text-amber-800"
                    : "bg-zinc-100 text-zinc-700"
              }`}
            >
              <span className="font-semibold">{count.toLocaleString()}</span>
              <span className="opacity-80">{result}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card 2 - Fresh audit runner
// ---------------------------------------------------------------------------

function FreshAuditCard({
  loading,
  diff,
  error,
  missingOpen,
  onToggleMissing,
  onRunAudit,
}: {
  loading: boolean;
  diff: AuditDiff | null;
  error: string | null;
  missingOpen: boolean;
  onToggleMissing: () => void;
  onRunAudit: () => void;
}) {
  return (
    <Card>
      <CardHeader className="py-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Run fresh audit</CardTitle>
          <Button
            size="sm"
            onClick={onRunAudit}
            disabled={loading}
            className="min-w-[120px]"
          >
            {loading ? (
              <>
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> Running...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-1" /> Run now
              </>
            )}
          </Button>
        </div>
        <p className="text-xs text-zinc-500 mt-1">
          Manager+ only. Fetches all Airtable records and diffs against the DB.
          Takes ~5-15 seconds depending on Airtable response time.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
            {error}
          </div>
        )}

        {loading && !diff && (
          <div className="flex items-center justify-center py-6">
            <BraiinLoader />
          </div>
        )}

        {diff && (
          <div className="space-y-4">
            {/* Summary row */}
            <div className="flex flex-wrap gap-3">
              <StatPill label="Matched" value={diff.matched} tone="emerald" />
              <StatPill
                label="Missing from DB"
                value={diff.missing.length}
                tone={diff.missing.length > 0 ? "amber" : "emerald"}
              />
              <StatPill
                label="Field mismatches"
                value={diff.field_mismatches.length}
                tone={diff.field_mismatches.length > 0 ? "amber" : "emerald"}
              />
            </div>

            {/* Missing records collapsible */}
            {diff.missing.length > 0 && (
              <div className="border rounded-md overflow-hidden">
                <button
                  type="button"
                  onClick={onToggleMissing}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium bg-amber-50 hover:bg-amber-100 transition-colors text-amber-900"
                >
                  <span>
                    {diff.missing.length} record
                    {diff.missing.length !== 1 ? "s" : ""} missing from DB
                  </span>
                  {missingOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
                {missingOpen && (
                  <div className="px-4 py-3 bg-white">
                    <ul className="space-y-1">
                      {diff.missing.map((id) => (
                        <li
                          key={id}
                          className="font-mono text-xs text-zinc-700 border-b border-zinc-100 last:border-0 py-1"
                        >
                          {id}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Field mismatches table */}
            {diff.field_mismatches.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-400 mb-2">
                  Field mismatches
                </p>
                <div className="rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Airtable ID</TableHead>
                        <TableHead className="text-xs">Field</TableHead>
                        <TableHead className="text-xs">Airtable value</TableHead>
                        <TableHead className="text-xs">DB value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {diff.field_mismatches.map((m, i) => (
                        <TableRow key={`${m.airtable_id}-${m.field}-${i}`}>
                          <TableCell
                            className="font-mono text-xs max-w-[160px] truncate"
                            title={m.airtable_id}
                          >
                            {m.airtable_id}
                          </TableCell>
                          <TableCell className="text-xs font-medium">
                            {m.field}
                          </TableCell>
                          <TableCell
                            className="text-xs text-zinc-600 max-w-[200px] truncate"
                            title={m.airtable_value ?? "null"}
                          >
                            {m.airtable_value ?? (
                              <span className="text-zinc-400 italic">null</span>
                            )}
                          </TableCell>
                          <TableCell
                            className="text-xs text-zinc-600 max-w-[200px] truncate"
                            title={m.db_value ?? "null"}
                          >
                            {m.db_value ?? (
                              <span className="text-zinc-400 italic">null</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {diff.missing.length === 0 && diff.field_mismatches.length === 0 && (
              <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-3">
                DB is fully in sync with Airtable. No missing records and no field mismatches.
              </div>
            )}
          </div>
        )}

        {!loading && !diff && !error && (
          <p className="text-sm text-zinc-400 py-2">
            Click &quot;Run now&quot; to fetch a fresh diff from Airtable.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "zinc";
}) {
  const styles: Record<string, string> = {
    emerald: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    zinc: "bg-zinc-100 text-zinc-700",
  };
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${styles[tone]}`}
    >
      <span className="text-lg font-bold">{value.toLocaleString()}</span>
      <span className="opacity-75">{label}</span>
    </div>
  );
}
