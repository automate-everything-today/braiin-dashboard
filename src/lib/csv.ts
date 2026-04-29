/**
 * Tiny RFC-4180-ish CSV parser + serializer.
 *
 * Used by /dev/charge-codes and /dev/margins for the
 * Download template / Upload CSV flow.
 *
 * - Quoted fields support embedded commas, newlines, and
 *   doubled-up double quotes (`""` -> `"`).
 * - Header row required.
 * - Returns an array of rows keyed by header.
 *
 * For multi-value fields (mode arrays, currency_rates maps)
 * use a pipe `|` separator inside the cell, e.g.
 *   sea_fcl|sea_lcl|air
 *   GBP=10|USD=15|EUR=15
 * Easier to type in Excel and avoids comma-escaping headaches.
 */

export type CsvRow = Record<string, string>;

// Cap on parsed input size. CSV import is exposed via authenticated routes
// (charge-codes / margin-rules) but a single multi-MB upload still costs
// CPU + memory; this guard fails loud rather than letting one upload pin
// the runtime.
const MAX_INPUT_BYTES = 5 * 1024 * 1024;

export function parseCsv(input: string): CsvRow[] {
  if (input.length > MAX_INPUT_BYTES) {
    throw new Error(
      `CSV input too large: ${input.length} bytes (max ${MAX_INPUT_BYTES}).`,
    );
  }
  // Strip BOM. Use the explicit codepoint so the source stays readable.
  const text = input.replace(/^﻿/, "");
  const records: string[][] = [];

  let cur = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(cur);
      cur = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // Skip - handled by \n
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(cur);
      records.push(row);
      cur = "";
      row = [];
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    records.push(row);
  }

  // Strip empty trailing rows
  while (records.length > 0 && records[records.length - 1].every((c) => c === "")) {
    records.pop();
  }

  if (records.length === 0) return [];
  const headers = records[0].map((h) => h.trim());
  const out: CsvRow[] = [];
  for (let r = 1; r < records.length; r++) {
    const cells = records[r];
    const obj: CsvRow = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (cells[c] ?? "").trim();
    }
    out.push(obj);
  }
  return out;
}

// Excel / Sheets evaluate any cell starting with =, +, -, @, tab, or CR as
// a formula. A maliciously named charge code starting with `=cmd|...` could
// achieve RCE on the analyst's machine when the CSV is opened. Prefix a
// single quote to neutralise without losing the literal value.
function neutraliseFormula(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

function quoteCell(v: string): string {
  const safe = neutraliseFormula(v);
  if (safe.includes(",") || safe.includes("\n") || safe.includes('"')) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function serializeCsv(headers: string[], rows: CsvRow[]): string {
  const lines = [headers.map(quoteCell).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => quoteCell(row[h] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
