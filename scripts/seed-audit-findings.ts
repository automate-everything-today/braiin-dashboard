#!/usr/bin/env npx tsx
/**
 * Seed security findings from a JSON file into feedback.security_findings.
 *
 * Use this for one-off / small batches. For a full audit (10+ findings)
 * prefer writing a migration in supabase/migrations/0XX_seed_<audit>.sql
 * matching the pattern in 046-048.
 *
 * Usage:
 *   npx tsx scripts/seed-audit-findings.ts <path-to-findings.json>
 *
 * Findings JSON format:
 *   {
 *     "source_audit": "2026-05-15-pre-release",
 *     "findings": [
 *       {
 *         "source_reviewer": "security-reviewer",
 *         "severity": "high",
 *         "title": "...",
 *         "description": "...",
 *         "recommendation": "...",
 *         "file_path": "src/...",
 *         "line_number": 123,
 *         "tags": ["auth"]
 *       }
 *     ]
 *   }
 */

import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

interface Finding {
  source_reviewer: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  recommendation?: string;
  file_path?: string;
  line_number?: number;
  tags?: string[];
}

interface AuditFile {
  source_audit: string;
  findings: Finding[];
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: seed-audit-findings.ts <findings.json>");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const orgId = process.env.DEFAULT_ORG_ID;
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required");
    process.exit(1);
  }
  if (!orgId) {
    console.error("DEFAULT_ORG_ID required");
    process.exit(1);
  }

  const audit: AuditFile = JSON.parse(readFileSync(path, "utf8"));
  if (!audit.source_audit || !Array.isArray(audit.findings)) {
    console.error("Invalid format - expected { source_audit, findings: [...] }");
    process.exit(1);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  // Idempotency: skip if any row with this source_audit already exists.
  const { data: existing } = await sb
    .schema("feedback")
    .from("security_findings")
    .select("finding_id")
    .eq("source_audit", audit.source_audit)
    .limit(1);
  if (existing && existing.length > 0) {
    console.log(`Audit ${audit.source_audit} already seeded - skipping ${audit.findings.length} findings`);
    return;
  }

  const rows = audit.findings.map((f) => ({
    org_id: orgId,
    source_audit: audit.source_audit,
    source_reviewer: f.source_reviewer,
    severity: f.severity,
    status: "open",
    title: f.title,
    description: f.description,
    recommendation: f.recommendation ?? null,
    file_path: f.file_path ?? null,
    line_number: f.line_number ?? null,
    tags: f.tags ?? [],
  }));

  const { error } = await sb.schema("feedback").from("security_findings").insert(rows);
  if (error) {
    console.error("Insert failed:", error.message);
    process.exit(1);
  }
  console.log(`Seeded ${rows.length} findings for audit ${audit.source_audit}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
