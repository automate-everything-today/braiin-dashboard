# Automatic Company Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically enrich accounts and companies with services, modes, countries, contacts, and research data via a background queue processed by Vercel Cron every 5 minutes.

**Architecture:** Supabase `enrichment_queue` table as job queue. Four triggers add items (unknown sender, data gaps, stale records, manual add). Vercel Cron route picks up pending items by priority, enriches using website scraping + Perplexity + Claude + Hunter.io, maps to standard taxonomy, and merges (append-only) into records.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgreSQL), Vercel Cron, Perplexity API, Anthropic API (Claude Sonnet 4.6), Hunter.io API

---

## File Structure

| File | Responsibility |
|------|---------------|
| **Create:** `src/lib/enrichment/taxonomy.ts` | Canonical SERVICE_TYPES, MODES, COUNTRIES lists + mapping functions |
| **Create:** `src/lib/enrichment/scraper.ts` | Website scraping logic (homepage + subpages, HTML-to-text) |
| **Create:** `src/lib/enrichment/researcher.ts` | Perplexity + Claude research + Hunter.io contacts |
| **Create:** `src/lib/enrichment/queue.ts` | Queue operations: add, dedup, pick, complete, fail |
| **Create:** `src/lib/enrichment/processor.ts` | Orchestrates scrape -> research -> taxonomy map -> merge |
| **Create:** `src/app/api/cron/enrich/route.ts` | Vercel Cron handler - processes queue |
| **Create:** `src/app/api/enrichment-queue/route.ts` | Queue stats endpoint for monitoring |
| **Create:** `vercel.json` | Cron schedule configuration |
| **Modify:** `src/app/api/enrich-company/route.ts` | Refactor to use shared processor, integrate with queue |
| **Modify:** `src/components/email/contact-enrichment.tsx:18-53` | Import taxonomy from shared module |
| **Modify:** `src/middleware.ts` | Allow cron route through without session cookie |

---

### Task 1: Canonical Taxonomy Module

**Files:**
- Create: `src/lib/enrichment/taxonomy.ts`

- [ ] **Step 1: Create the taxonomy module with all canonical lists and mapping functions**

```typescript
// src/lib/enrichment/taxonomy.ts

export const SERVICE_TYPES = [
  { group: "Freight", items: [
    "International Freight", "Domestic Freight", "FCL (Full Container)", "LCL (Groupage)",
    "FTL (Full Truckload)", "LTL (Part Load)", "Air Freight", "Sea Freight", "Road Freight",
    "Rail Freight", "Multimodal", "Project Cargo", "Out of Gauge", "Dangerous Goods",
    "Temperature Controlled", "Express/Time Critical",
  ]},
  { group: "Transport", items: [
    "Container Haulage", "General Haulage", "Pallet Distribution", "Courier",
    "Last Mile Delivery", "Collection Service", "Trunking",
  ]},
  { group: "Carrier", items: [
    "Shipping Line", "Airline", "NVOCC", "Freight Train Operator",
  ]},
  { group: "Services", items: [
    "Customs Brokerage", "Customs Clearance", "AEO Certified", "Warehousing",
    "Pick and Pack", "Cross-dock", "Container Storage", "Insurance",
    "Cargo Survey", "Fumigation", "Packaging",
  ]},
  { group: "Other", items: [
    "Freight Forwarder", "IATA Agent", "Port/Terminal", "Software Provider",
    "Consulting", "Other",
  ]},
] as const;

export const ALL_SERVICES = SERVICE_TYPES.flatMap(g => g.items);

export const MODES = ["FCL", "LCL", "Air", "Road", "Rail", "Courier", "Multimodal", "Project"] as const;

export const COUNTRIES = [
  "UK", "Turkey", "China", "India", "USA", "Germany", "France", "Spain", "Italy",
  "Netherlands", "Belgium", "Poland", "UAE", "Saudi Arabia", "Singapore", "Hong Kong",
  "Japan", "South Korea", "Australia", "Brazil", "Mexico", "Canada", "South Africa",
  "Nigeria", "Kenya", "Egypt", "Morocco", "Pakistan", "Bangladesh", "Vietnam",
  "Thailand", "Indonesia", "Malaysia", "Philippines", "Taiwan", "Sri Lanka",
  "Ireland", "Portugal", "Greece", "Romania", "Czech Republic", "Sweden", "Norway",
  "Denmark", "Finland", "Austria", "Switzerland", "Russia", "Ukraine",
] as const;

// Fuzzy mapping: common variations -> canonical service name
const SERVICE_ALIASES: Record<string, string> = {
  "ocean freight": "Sea Freight",
  "sea shipping": "Sea Freight",
  "ocean shipping": "Sea Freight",
  "seafreight": "Sea Freight",
  "airfreight": "Air Freight",
  "air cargo": "Air Freight",
  "air shipping": "Air Freight",
  "road transport": "Road Freight",
  "road haulage": "Road Freight",
  "trucking": "Road Freight",
  "rail transport": "Rail Freight",
  "railway freight": "Rail Freight",
  "full container load": "FCL (Full Container)",
  "fcl": "FCL (Full Container)",
  "less than container load": "LCL (Groupage)",
  "lcl": "LCL (Groupage)",
  "groupage": "LCL (Groupage)",
  "consolidation": "LCL (Groupage)",
  "full truck load": "FTL (Full Truckload)",
  "ftl": "FTL (Full Truckload)",
  "part load": "LTL (Part Load)",
  "ltl": "LTL (Part Load)",
  "customs": "Customs Brokerage",
  "customs broker": "Customs Brokerage",
  "clearance": "Customs Clearance",
  "customs clearance": "Customs Clearance",
  "warehousing": "Warehousing",
  "storage": "Warehousing",
  "distribution": "Pallet Distribution",
  "haulage": "Container Haulage",
  "container haulage": "Container Haulage",
  "drayage": "Container Haulage",
  "last mile": "Last Mile Delivery",
  "courier": "Courier",
  "express": "Express/Time Critical",
  "time critical": "Express/Time Critical",
  "project cargo": "Project Cargo",
  "heavy lift": "Project Cargo",
  "breakbulk": "Project Cargo",
  "out of gauge": "Out of Gauge",
  "oog": "Out of Gauge",
  "oversize": "Out of Gauge",
  "dangerous goods": "Dangerous Goods",
  "hazmat": "Dangerous Goods",
  "dg": "Dangerous Goods",
  "imdg": "Dangerous Goods",
  "temperature controlled": "Temperature Controlled",
  "reefer": "Temperature Controlled",
  "cold chain": "Temperature Controlled",
  "fumigation": "Fumigation",
  "packaging": "Packaging",
  "packing": "Packaging",
  "insurance": "Insurance",
  "cargo insurance": "Insurance",
  "pick and pack": "Pick and Pack",
  "cross dock": "Cross-dock",
  "cross-docking": "Cross-dock",
  "container storage": "Container Storage",
  "cargo survey": "Cargo Survey",
  "survey": "Cargo Survey",
  "freight forwarding": "Freight Forwarder",
  "freight forwarder": "Freight Forwarder",
  "nvocc": "NVOCC",
  "shipping line": "Shipping Line",
  "airline": "Airline",
  "iata": "IATA Agent",
  "iata agent": "IATA Agent",
  "aeo": "AEO Certified",
  "aeo certified": "AEO Certified",
  "multimodal": "Multimodal",
  "intermodal": "Multimodal",
};

const MODE_ALIASES: Record<string, string> = {
  "ocean": "FCL",
  "sea": "FCL",
  "ocean freight": "FCL",
  "sea freight": "FCL",
  "full container": "FCL",
  "groupage": "LCL",
  "consolidation": "LCL",
  "air freight": "Air",
  "air cargo": "Air",
  "airfreight": "Air",
  "road freight": "Road",
  "trucking": "Road",
  "road haulage": "Road",
  "rail freight": "Rail",
  "railway": "Rail",
  "courier service": "Courier",
  "express": "Courier",
  "multimodal": "Multimodal",
  "intermodal": "Multimodal",
  "project cargo": "Project",
  "heavy lift": "Project",
  "breakbulk": "Project",
};

/**
 * Map a raw service string to a canonical SERVICE_TYPES value.
 * Returns null if no match found.
 */
export function mapService(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  // Direct match
  const direct = ALL_SERVICES.find(s => s.toLowerCase() === lower);
  if (direct) return direct;
  // Alias match
  if (SERVICE_ALIASES[lower]) return SERVICE_ALIASES[lower];
  // Partial match - check if any canonical service is contained in the raw string
  const partial = ALL_SERVICES.find(s => lower.includes(s.toLowerCase()));
  if (partial) return partial;
  return null;
}

/**
 * Map a raw mode string to a canonical MODES value.
 * Returns null if no match found.
 */
export function mapMode(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  // Direct match
  const direct = MODES.find(m => m.toLowerCase() === lower);
  if (direct) return direct as string;
  // Alias match
  if (MODE_ALIASES[lower]) return MODE_ALIASES[lower];
  return null;
}

/**
 * Map an array of raw services to canonical values, deduped.
 */
export function mapServices(raw: string[]): string[] {
  const mapped = raw.map(mapService).filter((s): s is string => s !== null);
  return [...new Set(mapped)];
}

/**
 * Map an array of raw modes to canonical values, deduped.
 */
export function mapModes(raw: string[]): string[] {
  const mapped = raw.map(mapMode).filter((m): m is string => m !== null);
  return [...new Set(mapped)];
}

/**
 * Merge two arrays: union of existing + new, deduped.
 * Never removes existing values.
 */
export function mergeArrays(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming])];
}
```

- [ ] **Step 2: Verify the module compiles**

Run: `cd "/Users/robdonald-agent/ai-projects/arigato77-dashboard" && npx tsc --noEmit src/lib/enrichment/taxonomy.ts 2>&1 || echo "checking with build..." && npx next build 2>&1 | tail -5`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/enrichment/taxonomy.ts
git commit -m "feat: add canonical taxonomy module for enrichment mapping"
```

---

### Task 2: Website Scraper Module

**Files:**
- Create: `src/lib/enrichment/scraper.ts`

- [ ] **Step 1: Create the scraper module extracted from existing enrich-company route**

```typescript
// src/lib/enrichment/scraper.ts

const USER_AGENT = "Mozilla/5.0 (compatible; Braiin/1.0)";
const HOMEPAGE_LIMIT = 3000;
const SUBPAGE_LIMIT = 2000;
const SUBPAGES = ["/about", "/about-us", "/services", "/our-services"];

function stripHtml(html: string, limit: number): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, limit);
}

/**
 * Scrape a company website: homepage + common subpages.
 * Returns combined text content or empty string on failure.
 */
export async function scrapeWebsite(domain: string): Promise<string> {
  let websiteText = "";

  // Homepage
  try {
    const res = await fetch(`https://${domain}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      websiteText = stripHtml(await res.text(), HOMEPAGE_LIMIT);
    }
  } catch (err) {
    console.error(`[enrichment] Failed to scrape homepage for ${domain}:`, err);
  }

  // Subpages
  for (const path of SUBPAGES) {
    try {
      const res = await fetch(`https://${domain}${path}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const pageText = stripHtml(await res.text(), SUBPAGE_LIMIT);
        websiteText += `\n\n--- ${path} ---\n${pageText}`;
      }
    } catch {
      // Subpage not found or timeout - not an error
    }
  }

  return websiteText;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/enrichment/scraper.ts
git commit -m "feat: extract website scraper into reusable module"
```

---

### Task 3: Researcher Module (Perplexity + Claude + Hunter)

**Files:**
- Create: `src/lib/enrichment/researcher.ts`

- [ ] **Step 1: Create the researcher module with Perplexity, Claude structuring, and Hunter.io**

```typescript
// src/lib/enrichment/researcher.ts

import { ALL_SERVICES, MODES } from "./taxonomy";

const PERPLEXITY_KEY = process.env.PERPLEXITY_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const HUNTER_KEY = process.env.HUNTER_API_KEY || "";

export type ResearchResult = {
  company_name?: string;
  description?: string;
  industry?: string;
  services?: string[];
  modes?: string[];
  countries?: string[];
  ports?: string[];
  trade_lanes?: string[];
  website?: string;
  employee_count?: string;
  founded?: string;
  commodities?: string;
  certifications?: string[];
  current_logistics_provider?: string;
  competitors?: string;
  pain_points?: string;
  opportunity?: string;
  error?: string;
};

export type ContactResult = {
  email: string;
  name: string;
  position: string;
  department: string;
  confidence: number;
};

export type EnrichmentResult = {
  research: ResearchResult | null;
  contacts: ContactResult[];
};

const CLAUDE_PROMPT = `You are building a company profile for a freight forwarding CRM. Extract EVERYTHING useful from the website content and research below.

COMPANY WEBSITE CONTENT:
{websiteText}

WEB RESEARCH:
{rawResearch}

You MUST map services to these EXACT values (use only from this list):
${ALL_SERVICES.join(", ")}

You MUST map modes to these EXACT values (use only from this list):
${MODES.join(", ")}

Return JSON:
{
  "company_name": "Full legal/trading name",
  "description": "2-3 sentence description of what they do, their speciality, and their market position",
  "industry": "Their primary industry/sector",
  "services": ["ONLY values from the services list above that match what they offer"],
  "modes": ["ONLY values from the modes list above that match what they offer"],
  "countries": ["every country mentioned they operate in or ship to/from"],
  "ports": ["specific ports mentioned if any"],
  "trade_lanes": ["specific trade lanes e.g. UK-China, Europe-USA"],
  "website": "their website URL",
  "employee_count": "if mentioned",
  "founded": "year if mentioned",
  "commodities": "what types of cargo they handle or what their clients ship",
  "certifications": ["ISO, AEO, IATA, etc"],
  "current_logistics_provider": "if they mention using a specific provider",
  "competitors": "similar companies if identifiable",
  "pain_points": "specific logistics pain points based on their business type and what they ship",
  "opportunity": "specific ways the customer (a UK-based freight forwarder) could win their business - be concrete and actionable"
}

Be thorough with services - if their website lists air freight, ocean freight, customs, warehousing etc, capture ALL of them. Map fuzzy matches (e.g. "ocean freight" = "Sea Freight", "trucking" = "Road Freight"). Standard hyphens (-) only. JSON only.`;

/**
 * Research a company using Perplexity + Claude.
 */
export async function researchCompany(
  companyName: string,
  domain: string,
  websiteText: string,
): Promise<ResearchResult | null> {
  if (!PERPLEXITY_KEY || !ANTHROPIC_KEY) {
    console.error("[enrichment] Missing PERPLEXITY_API_KEY or ANTHROPIC_API_KEY");
    return null;
  }

  // 1. Perplexity search
  const searchQuery = `${companyName || domain} freight logistics shipping company profile services countries`;
  const pplxRes = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${PERPLEXITY_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "sonar",
      messages: [{ role: "user", content: searchQuery }],
      max_tokens: 500,
    }),
  });
  const pplxData = await pplxRes.json();
  const rawResearch = pplxData.choices?.[0]?.message?.content || "";

  if (!rawResearch) return { description: "No research data available" };

  // 2. Claude structuring
  const prompt = CLAUDE_PROMPT
    .replace("{websiteText}", websiteText || "Not available")
    .replace("{rawResearch}", rawResearch);

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const claudeData = await claudeRes.json();
  let text = claudeData.content?.[0]?.text || "{}";
  text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  try {
    return JSON.parse(text) as ResearchResult;
  } catch {
    return { description: rawResearch.slice(0, 500) };
  }
}

/**
 * Find contacts at a domain using Hunter.io.
 */
export async function findContacts(domain: string): Promise<ContactResult[]> {
  if (!HUNTER_KEY || !domain) return [];

  try {
    const res = await fetch(
      `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${HUNTER_KEY}&limit=10`,
    );
    const data = await res.json();
    if (!data.data?.emails) return [];

    return data.data.emails.map((e: any) => ({
      email: e.value,
      name: [e.first_name, e.last_name].filter(Boolean).join(" "),
      position: e.position || "",
      department: e.department || "",
      confidence: e.confidence,
    }));
  } catch (err) {
    console.error(`[enrichment] Hunter.io failed for ${domain}:`, err);
    return [];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/enrichment/researcher.ts
git commit -m "feat: add researcher module with Perplexity, Claude, and Hunter.io"
```

---

### Task 4: Queue Operations Module

**Files:**
- Create: `src/lib/enrichment/queue.ts`

- [ ] **Step 1: Create the queue module for all enrichment_queue operations**

```typescript
// src/lib/enrichment/queue.ts

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export type QueueItem = {
  id: string;
  entity_type: "account" | "company";
  entity_id: string;
  domain: string | null;
  company_name: string | null;
  priority: number;
  status: string;
  trigger: string;
  attempts: number;
  last_error: string | null;
  enrichment_data: any;
  created_at: string;
  processed_at: string | null;
  completed_at: string | null;
};

/**
 * Add an item to the enrichment queue with deduplication.
 * Returns the queue item id, or null if already queued.
 */
export async function enqueue(params: {
  entity_type: "account" | "company";
  entity_id: string;
  domain?: string | null;
  company_name?: string | null;
  priority: number;
  trigger: string;
}): Promise<string | null> {
  // Check for existing pending/processing entry
  const { data: existing } = await supabase
    .from("enrichment_queue")
    .select("id, status, attempts")
    .eq("entity_type", params.entity_type)
    .eq("entity_id", params.entity_id)
    .in("status", ["pending", "processing"])
    .limit(1)
    .single();

  if (existing) return null; // Already queued

  // Check for failed entry with retries remaining
  const { data: failed } = await supabase
    .from("enrichment_queue")
    .select("id, attempts")
    .eq("entity_type", params.entity_type)
    .eq("entity_id", params.entity_id)
    .eq("status", "failed")
    .lt("attempts", 3)
    .limit(1)
    .single();

  if (failed) {
    // Reset to pending for retry
    await supabase
      .from("enrichment_queue")
      .update({ status: "pending", priority: params.priority })
      .eq("id", failed.id);
    return failed.id;
  }

  // Insert new queue item
  const { data, error } = await supabase
    .from("enrichment_queue")
    .insert({
      entity_type: params.entity_type,
      entity_id: params.entity_id,
      domain: params.domain || null,
      company_name: params.company_name || null,
      priority: params.priority,
      trigger: params.trigger,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[enrichment] Failed to enqueue:", error.message);
    return null;
  }

  return data?.id || null;
}

/**
 * Pick up to `limit` pending items, ordered by priority then created_at.
 * Marks them as processing.
 */
export async function pickItems(limit: number = 20): Promise<QueueItem[]> {
  const { data: items, error } = await supabase
    .from("enrichment_queue")
    .select("*")
    .eq("status", "pending")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error || !items?.length) return [];

  const ids = items.map((i: any) => i.id);
  await supabase
    .from("enrichment_queue")
    .update({ status: "processing", processed_at: new Date().toISOString() })
    .in("id", ids);

  return items as QueueItem[];
}

/**
 * Mark an item as completed with enrichment data.
 */
export async function markComplete(id: string, enrichmentData: any): Promise<void> {
  await supabase
    .from("enrichment_queue")
    .update({
      status: "completed",
      enrichment_data: enrichmentData,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);
}

/**
 * Mark an item as failed with error message.
 * If attempts >= 3, stays failed permanently.
 */
export async function markFailed(id: string, error: string, attempts: number): Promise<void> {
  await supabase
    .from("enrichment_queue")
    .update({
      status: attempts >= 3 ? "failed" : "pending",
      last_error: error,
      attempts: attempts + 1,
      completed_at: attempts >= 3 ? new Date().toISOString() : null,
    })
    .eq("id", id);
}

/**
 * Get queue stats for monitoring.
 */
export async function getQueueStats(): Promise<{
  pending: number;
  processing: number;
  completed_today: number;
  failed: number;
}> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [pending, processing, completedToday, failed] = await Promise.all([
    supabase.from("enrichment_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("enrichment_queue").select("id", { count: "exact", head: true }).eq("status", "processing"),
    supabase.from("enrichment_queue").select("id", { count: "exact", head: true })
      .eq("status", "completed").gte("completed_at", today.toISOString()),
    supabase.from("enrichment_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
  ]);

  return {
    pending: pending.count || 0,
    processing: processing.count || 0,
    completed_today: completedToday.count || 0,
    failed: failed.count || 0,
  };
}

/**
 * Queue prospects with missing enrichment data (Trigger B).
 */
export async function queueProspectsWithGaps(): Promise<number> {
  const { data: prospects } = await supabase
    .from("companies")
    .select("id, company_domain, company_name")
    .is("last_enriched_at", null)
    .not("company_domain", "is", null)
    .limit(50);

  if (!prospects?.length) return 0;

  let queued = 0;
  for (const p of prospects) {
    const result = await enqueue({
      entity_type: "company",
      entity_id: p.id,
      domain: p.company_domain,
      company_name: p.company_name,
      priority: 2,
      trigger: "stale_check",
    });
    if (result) queued++;
  }
  return queued;
}

/**
 * Queue records with stale enrichment data > 90 days (Trigger C).
 */
export async function queueStaleRecords(): Promise<number> {
  const staleDate = new Date();
  staleDate.setDate(staleDate.getDate() - 90);

  const [accounts, companies] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, domain, company_name")
      .lt("last_enriched_at", staleDate.toISOString())
      .not("domain", "is", null)
      .limit(25),
    supabase
      .from("companies")
      .select("id, company_domain, company_name")
      .lt("last_enriched_at", staleDate.toISOString())
      .not("company_domain", "is", null)
      .limit(25),
  ]);

  let queued = 0;
  for (const a of accounts.data || []) {
    const result = await enqueue({
      entity_type: "account",
      entity_id: a.id,
      domain: a.domain,
      company_name: a.company_name,
      priority: 3,
      trigger: "stale_check",
    });
    if (result) queued++;
  }
  for (const c of companies.data || []) {
    const result = await enqueue({
      entity_type: "company",
      entity_id: c.id,
      domain: c.company_domain,
      company_name: c.company_name,
      priority: 3,
      trigger: "stale_check",
    });
    if (result) queued++;
  }
  return queued;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/enrichment/queue.ts
git commit -m "feat: add enrichment queue operations module"
```

---

### Task 5: Processor Module (Orchestration + Merge)

**Files:**
- Create: `src/lib/enrichment/processor.ts`

- [ ] **Step 1: Create the processor that orchestrates scrape -> research -> map -> merge**

```typescript
// src/lib/enrichment/processor.ts

import { createClient } from "@supabase/supabase-js";
import { scrapeWebsite } from "./scraper";
import { researchCompany, findContacts, type EnrichmentResult } from "./researcher";
import { mapServices, mapModes, mergeArrays } from "./taxonomy";
import { type QueueItem } from "./queue";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

/**
 * Process a single enrichment queue item:
 * 1. Scrape website
 * 2. Research via Perplexity + Claude
 * 3. Find contacts via Hunter.io
 * 4. Map to canonical taxonomy
 * 5. Merge into account/company record (append only)
 */
export async function processItem(item: QueueItem): Promise<EnrichmentResult> {
  const domain = item.domain || "";
  const companyName = item.company_name || "";

  // 1. Scrape website
  const websiteText = domain ? await scrapeWebsite(domain) : "";

  // 2. Research
  const research = await researchCompany(companyName, domain, websiteText);

  // 3. Contacts
  const contacts = domain ? await findContacts(domain) : [];

  // 4. Map to canonical taxonomy
  const mappedServices = research?.services ? mapServices(research.services) : [];
  const mappedModes = research?.modes ? mapModes(research.modes) : [];

  // 5. Merge into record
  const table = item.entity_type === "account" ? "accounts" : "companies";
  const domainField = item.entity_type === "account" ? "domain" : "company_domain";

  // Fetch existing record
  const { data: existing } = await supabase
    .from(table)
    .select("service_categories, modes, countries_of_operation, trade_lanes, ports, certifications, website")
    .eq("id", item.entity_id)
    .single();

  if (existing) {
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
      last_enriched_at: new Date().toISOString(),
      enrichment_data: { research, contacts },
    };

    // Merge arrays - append only, never remove
    if (mappedServices.length > 0) {
      updates.service_categories = mergeArrays(existing.service_categories || [], mappedServices);
    }
    if (mappedModes.length > 0) {
      updates.modes = mergeArrays(existing.modes || [], mappedModes);
    }
    if (research?.countries?.length) {
      updates.countries_of_operation = mergeArrays(existing.countries_of_operation || [], research.countries);
    }
    if (research?.trade_lanes?.length) {
      updates.trade_lanes = mergeArrays(existing.trade_lanes || [], research.trade_lanes);
    }
    if (research?.ports?.length) {
      updates.ports = mergeArrays(existing.ports || [], research.ports);
    }
    if (research?.certifications?.length) {
      updates.certifications = mergeArrays(existing.certifications || [], research.certifications);
    }
    // Scalar fields: only set if currently empty
    if (research?.website && !existing.website) {
      updates.website = research.website;
    }

    await supabase.from(table).update(updates).eq("id", item.entity_id);
  }

  return { research, contacts };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/enrichment/processor.ts
git commit -m "feat: add enrichment processor with taxonomy mapping and merge"
```

---

### Task 6: Database Migration

**Files:**
- Run SQL directly against Supabase (no migration files in this project)

- [ ] **Step 1: Create the enrichment_queue table and add columns to accounts/companies**

Run via Supabase SQL editor or `supabase` CLI:

```sql
-- Enrichment queue table
CREATE TABLE IF NOT EXISTS enrichment_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('account', 'company')),
  entity_id uuid NOT NULL,
  domain text,
  company_name text,
  priority int NOT NULL DEFAULT 3,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  trigger text NOT NULL CHECK (trigger IN ('email_sync', 'manual_add', 'stale_check', 'user_request')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  enrichment_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  completed_at timestamptz
);

-- Index for efficient queue polling
CREATE INDEX idx_enrichment_queue_poll
  ON enrichment_queue (status, priority, created_at)
  WHERE status = 'pending';

-- Partial unique index to prevent duplicate pending/processing entries
CREATE UNIQUE INDEX idx_enrichment_queue_dedup
  ON enrichment_queue (entity_type, entity_id)
  WHERE status IN ('pending', 'processing');

-- Add enrichment columns to accounts (if not already present)
DO $$ BEGIN
  ALTER TABLE accounts ADD COLUMN IF NOT EXISTS countries_of_operation text[] DEFAULT '{}';
  ALTER TABLE accounts ADD COLUMN IF NOT EXISTS countries_of_origin text[] DEFAULT '{}';
  ALTER TABLE accounts ADD COLUMN IF NOT EXISTS modes text[] DEFAULT '{}';
  ALTER TABLE accounts ADD COLUMN IF NOT EXISTS trade_lanes text[] DEFAULT '{}';
  ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ports text[] DEFAULT '{}';
  ALTER TABLE accounts ADD COLUMN IF NOT EXISTS certifications text[] DEFAULT '{}';
  ALTER TABLE accounts ADD COLUMN IF NOT EXISTS website text;
  ALTER TABLE accounts ADD COLUMN IF NOT EXISTS enrichment_data jsonb;
  ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_enriched_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Add enrichment columns to companies (if not already present)
DO $$ BEGIN
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS service_categories text[] DEFAULT '{}';
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS modes text[] DEFAULT '{}';
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS countries_of_operation text[] DEFAULT '{}';
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS trade_lanes text[] DEFAULT '{}';
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS ports text[] DEFAULT '{}';
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS certifications text[] DEFAULT '{}';
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS enrichment_data jsonb;
  ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_enriched_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Enable RLS on enrichment_queue
ALTER TABLE enrichment_queue ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access" ON enrichment_queue
  FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Verify tables exist by querying**

Run: Check in Supabase dashboard or via API that enrichment_queue table is visible and accounts/companies have the new columns.

- [ ] **Step 3: Commit a note about the migration**

```bash
echo "-- Migration applied 2026-04-07: enrichment_queue table + columns on accounts/companies" > supabase/migrations/007_enrichment_queue.sql
git add supabase/migrations/007_enrichment_queue.sql
git commit -m "docs: record enrichment queue migration"
```

---

### Task 7: Cron Route Handler

**Files:**
- Create: `src/app/api/cron/enrich/route.ts`

- [ ] **Step 1: Create the Vercel Cron endpoint**

```typescript
// src/app/api/cron/enrich/route.ts

import { pickItems, markComplete, markFailed, queueProspectsWithGaps, queueStaleRecords } from "@/lib/enrichment/queue";
import { processItem } from "@/lib/enrichment/processor";

// Track which run we're on for hourly sweep (every 12th run = ~1 hour at 5-min intervals)
let runCount = 0;

export async function POST(req: Request) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  runCount++;
  let processed = 0;
  let failed = 0;
  let queued = 0;

  // Hourly sweep: queue prospects with gaps and stale records
  if (runCount % 12 === 1) {
    try {
      const gapCount = await queueProspectsWithGaps();
      const staleCount = await queueStaleRecords();
      queued = gapCount + staleCount;
      console.log(`[enrichment-cron] Hourly sweep: queued ${gapCount} gaps + ${staleCount} stale`);
    } catch (err) {
      console.error("[enrichment-cron] Sweep failed:", err);
    }
  }

  // Process pending items
  const items = await pickItems(20);
  console.log(`[enrichment-cron] Processing ${items.length} items`);

  for (const item of items) {
    try {
      const result = await processItem(item);
      await markComplete(item.id, result);
      processed++;
    } catch (err: any) {
      console.error(`[enrichment-cron] Failed to process ${item.id}:`, err.message);
      await markFailed(item.id, err.message || "Unknown error", item.attempts);
      failed++;
    }
  }

  return Response.json({
    processed,
    failed,
    queued,
    run: runCount,
    timestamp: new Date().toISOString(),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/cron/enrich/route.ts
git commit -m "feat: add Vercel Cron route for enrichment processing"
```

---

### Task 8: Queue Stats Endpoint

**Files:**
- Create: `src/app/api/enrichment-queue/route.ts`

- [ ] **Step 1: Create the monitoring endpoint**

```typescript
// src/app/api/enrichment-queue/route.ts

import { getQueueStats } from "@/lib/enrichment/queue";

export async function GET() {
  try {
    const stats = await getQueueStats();
    return Response.json(stats);
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/enrichment-queue/route.ts
git commit -m "feat: add enrichment queue stats endpoint"
```

---

### Task 9: Middleware Update for Cron Route

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: Allow cron routes through without session cookie**

In `src/middleware.ts`, after the line `if (pathname.startsWith("/api/auth/")) return NextResponse.next();`, add:

```typescript
  // Allow cron routes (secured by CRON_SECRET in the route handler)
  if (pathname.startsWith("/api/cron/")) return NextResponse.next();
```

- [ ] **Step 2: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: allow cron routes through auth middleware"
```

---

### Task 10: Vercel Cron Configuration

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Create vercel.json with cron schedule**

```json
{
  "crons": [
    {
      "path": "/api/cron/enrich",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

- [ ] **Step 2: Add CRON_SECRET to Vercel environment variables**

Run: `vercel env add CRON_SECRET` or add via Vercel dashboard. Generate a random secret: `openssl rand -hex 32`

Vercel automatically sends this as `Authorization: Bearer <CRON_SECRET>` to cron endpoints.

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat: add Vercel cron config for enrichment (every 5 min)"
```

---

### Task 11: Refactor Existing enrich-company Route

**Files:**
- Modify: `src/app/api/enrich-company/route.ts`

- [ ] **Step 1: Refactor to use shared modules and integrate with queue**

Replace the entire contents of `src/app/api/enrich-company/route.ts`:

```typescript
// src/app/api/enrich-company/route.ts

import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { scrapeWebsite } from "@/lib/enrichment/scraper";
import { researchCompany, findContacts } from "@/lib/enrichment/researcher";
import { mapServices, mapModes, mergeArrays } from "@/lib/enrichment/taxonomy";
import { enqueue } from "@/lib/enrichment/queue";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export async function POST(req: Request) {
  if (!checkRateLimit(getClientIp(req))) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const { company_name, domain, account_id, entity_type, entity_id } = await req.json();
  if (!company_name && !domain) {
    return Response.json({ error: "Need company_name or domain" }, { status: 400 });
  }

  // If entity info provided, also queue for background processing
  if (entity_type && entity_id) {
    await enqueue({
      entity_type,
      entity_id,
      domain,
      company_name,
      priority: 1, // User-initiated = highest priority
      trigger: "user_request",
    });
  }

  // Process synchronously for immediate results (user is waiting)
  const websiteText = domain ? await scrapeWebsite(domain) : "";
  const research = await researchCompany(company_name || "", domain || "", websiteText);
  const contacts = domain ? await findContacts(domain) : [];

  // Map to canonical taxonomy
  const mappedServices = research?.services ? mapServices(research.services) : [];
  const mappedModes = research?.modes ? mapModes(research.modes) : [];

  // Save to account if we have an account_id
  if (account_id && research && !research.error) {
    const { data: existing } = await supabase
      .from("accounts")
      .select("service_categories, modes, countries_of_operation, trade_lanes, ports, certifications, website")
      .eq("id", account_id)
      .single();

    if (existing) {
      const updates: Record<string, any> = {
        updated_at: new Date().toISOString(),
        last_enriched_at: new Date().toISOString(),
        enrichment_data: { research, contacts },
      };

      if (mappedServices.length > 0) {
        updates.service_categories = mergeArrays(existing.service_categories || [], mappedServices);
      }
      if (mappedModes.length > 0) {
        updates.modes = mergeArrays(existing.modes || [], mappedModes);
      }
      if (research.countries?.length) {
        updates.countries_of_operation = mergeArrays(existing.countries_of_operation || [], research.countries);
      }
      if (research.trade_lanes?.length) {
        updates.trade_lanes = mergeArrays(existing.trade_lanes || [], research.trade_lanes);
      }
      if (research.ports?.length) {
        updates.ports = mergeArrays(existing.ports || [], research.ports);
      }
      if (research.certifications?.length) {
        updates.certifications = mergeArrays(existing.certifications || [], research.certifications);
      }
      if (research.website && !existing.website) {
        updates.website = research.website;
      }

      await supabase.from("accounts").update(updates).eq("id", account_id);
    }
  }

  return Response.json({ research, contacts });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/enrich-company/route.ts
git commit -m "refactor: use shared enrichment modules in enrich-company route"
```

---

### Task 12: Update ContactEnrichment to Use Shared Taxonomy

**Files:**
- Modify: `src/components/email/contact-enrichment.tsx:18-53`

- [ ] **Step 1: Replace hardcoded taxonomy with import from shared module**

At the top of `src/components/email/contact-enrichment.tsx`, replace lines 18-53 (the SERVICE_TYPES, MODES, COUNTRIES constants) with:

```typescript
import { SERVICE_TYPES, MODES, COUNTRIES } from "@/lib/enrichment/taxonomy";
```

Remove the following constants from the file (they now come from the import):
- `SERVICE_TYPES` (lines 18-41)
- `MODES` (line 43)
- `COUNTRIES` (lines 45-53)

- [ ] **Step 2: Build to verify**

Run: `cd "/Users/robdonald-agent/ai-projects/arigato77-dashboard" && npx next build 2>&1 | tail -10`
Expected: Build succeeds with no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/email/contact-enrichment.tsx
git commit -m "refactor: import taxonomy from shared module in contact enrichment"
```

---

### Task 13: Email Sync Trigger (Trigger A)

**Files:**
- Modify: `src/app/api/email-sync/route.ts` (add queue trigger after processing emails)

- [ ] **Step 1: Read the current email-sync route to understand its structure**

Read: `src/app/api/email-sync/route.ts`

- [ ] **Step 2: After the email sync processes incoming emails, add enrichment queue trigger**

At the point where new emails are processed, add logic to check if sender's domain is known. If not (and email is not classified as Marketing or Recruiter), create a minimal company record and queue for enrichment.

Add this import at the top:

```typescript
import { enqueue } from "@/lib/enrichment/queue";
```

Add this function and call it after each new email is processed:

```typescript
async function triggerEnrichmentIfNeeded(
  senderEmail: string,
  classification?: string,
) {
  // Skip marketing and recruiter emails
  if (classification === "Marketing" || classification === "Recruiter") return;

  const domain = senderEmail.split("@")[1];
  if (!domain || domain.includes("example.com")) return;

  // Check if domain exists in accounts
  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("domain", domain)
    .limit(1)
    .single();

  if (account) return; // Known account, no need to enrich unknown sender

  // Check if domain exists in companies
  const { data: company } = await supabase
    .from("companies")
    .select("id, company_domain")
    .eq("company_domain", domain)
    .limit(1)
    .single();

  if (company) {
    // Known company but might need enrichment - queue if no enrichment data
    await enqueue({
      entity_type: "company",
      entity_id: company.id,
      domain,
      priority: 2,
      trigger: "email_sync",
    });
    return;
  }

  // Unknown sender - create minimal company record and queue
  const { data: newCompany } = await supabase
    .from("companies")
    .insert({
      company_domain: domain,
      company_name: domain.split(".")[0],
      status: "prospect",
    })
    .select("id")
    .single();

  if (newCompany) {
    await enqueue({
      entity_type: "company",
      entity_id: newCompany.id,
      domain,
      priority: 1,
      trigger: "email_sync",
    });
  }
}
```

Note: The exact integration point depends on the email-sync route's structure. The implementer must read the file first and place `triggerEnrichmentIfNeeded(senderEmail, classification)` at the right point after each email is processed.

- [ ] **Step 3: Build and verify**

Run: `npx next build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/app/api/email-sync/route.ts
git commit -m "feat: trigger enrichment queue from email sync for unknown senders"
```

---

### Task 14: Build, Push, and Verify

**Files:**
- No new files

- [ ] **Step 1: Full build**

Run: `cd "/Users/robdonald-agent/ai-projects/arigato77-dashboard" && npx next build 2>&1 | tail -20`
Expected: Build succeeds with all routes listed

- [ ] **Step 2: Push to remote**

```bash
git push origin main
```

- [ ] **Step 3: Verify Vercel deployment**

Check Vercel dashboard for successful deployment. Verify the cron job appears in the Cron Jobs section.

- [ ] **Step 4: Run migration SQL**

Execute the SQL from Task 6 in Supabase SQL editor.

- [ ] **Step 5: Test the cron endpoint manually**

```bash
curl -X POST https://braiin.app/api/cron/enrich \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Expected: `{"processed":0,"failed":0,"queued":0,"run":1,"timestamp":"..."}`

- [ ] **Step 6: Test enrichment via the UI**

Click "Research this company" on a contact in the email sidebar. Verify:
- Research results appear immediately
- Queue stats endpoint shows the item
- Account/company record gets enrichment data merged

---

## Self-Review Checklist

**Spec coverage:**
- [x] Queue table with priority, status, dedup - Task 4, 6
- [x] Trigger A (unknown sender) - Task 13
- [x] Trigger B (data gaps) - Task 4 (queueProspectsWithGaps)
- [x] Trigger C (stale refresh) - Task 4 (queueStaleRecords)
- [x] Trigger D (manual add) - Task 11 (enrich-company route)
- [x] Marketing/Recruiter exclusion - Task 13
- [x] Taxonomy mapping - Task 1, 3, 5
- [x] Merge strategy (append only) - Task 1 (mergeArrays), Task 5
- [x] Cron every 5 minutes - Task 7, 10
- [x] Hourly sweep - Task 7
- [x] Schema changes - Task 6
- [x] Middleware bypass for cron - Task 9
- [x] Shared taxonomy module - Task 1, 12
- [x] Error handling with retries - Task 4, 7
- [x] Queue monitoring - Task 8

**Placeholder scan:** No TBD, TODO, or "implement later" found.

**Type consistency:** QueueItem type used consistently in queue.ts and processor.ts. EnrichmentResult type used in researcher.ts and processor.ts. mergeArrays used in taxonomy.ts, processor.ts, and enrich-company route.
