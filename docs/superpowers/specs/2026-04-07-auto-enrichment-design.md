# Automatic Company Enrichment System

## Goal

Automatically enrich accounts, prospects, and unknown senders with company data (services, modes, countries, contacts, research) using a background queue processed by a Vercel Cron job. Enrichment maps to Braiin's standard taxonomy and merges with existing data (append only, never remove).

## Architecture

Vercel Cron (every 5 minutes) + Supabase `enrichment_queue` table. Items enter the queue via four triggers. The cron picks up pending items by priority, enriches using website scraping + Perplexity + Claude + Hunter.io, maps results to the standard SERVICE_TYPES and MODES taxonomy, and merges into account/company records.

## Standard Taxonomy

### SERVICE_TYPES (grouped)

**Freight:** International Freight, Domestic Freight, FCL (Full Container), LCL (Groupage), FTL (Full Truckload), LTL (Part Load), Air Freight, Sea Freight, Road Freight, Rail Freight, Multimodal, Project Cargo, Out of Gauge, Dangerous Goods, Temperature Controlled, Express/Time Critical

**Transport:** Container Haulage, General Haulage, Pallet Distribution, Courier, Last Mile Delivery, Collection Service, Trunking

**Carrier:** Shipping Line, Airline, NVOCC, Freight Train Operator

**Services:** Customs Brokerage, Customs Clearance, AEO Certified, Warehousing, Pick and Pack, Cross-dock, Container Storage, Insurance, Cargo Survey, Fumigation, Packaging

**Other:** Freight Forwarder, IATA Agent, Port/Terminal, Software Provider, Consulting, Other

### MODES

FCL, LCL, Air, Road, Rail, Courier, Multimodal, Project

---

## Triggers

### Trigger A: Unknown sender email
- When email sync processes a new email from a domain not in accounts, companies, or cargowise_contacts
- **Excludes:** Emails classified as "Marketing" or "Recruiter" - these are never auto-enriched
- Creates a minimal company record (domain, extracted company name from signature)
- Queues at **priority 1**
- Manual override: user can still click "Research" on any contact to force enrichment

### Trigger B: Known prospect with data gaps
- Cron sweep (hourly): query companies where service_categories, modes, or countries_of_operation are empty AND last_enriched_at IS NULL
- Queues at **priority 2**

### Trigger C: Stale data refresh
- Cron sweep (hourly): query accounts and companies where last_enriched_at < 90 days ago
- Queues at **priority 3**

### Trigger D: Manual addition
- When user creates a new account or prospect through the UI
- Queues at **priority 4**
- When user clicks "Research this company" button - queues at **priority 1** (user is waiting)

### Deduplication
- Before inserting: check if entity already has a pending/processing queue entry. If so, skip.
- If a previous attempt failed with < 3 attempts, reset to pending.
- Unique constraint on (entity_type, entity_id) WHERE status IN ('pending', 'processing')

---

## Data Model

### New table: `enrichment_queue`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | Auto-generated |
| entity_type | text NOT NULL | "account" or "company" |
| entity_id | uuid NOT NULL | FK to accounts.id or companies.id |
| domain | text | Website domain to research |
| company_name | text | Fallback if no domain |
| priority | int NOT NULL DEFAULT 3 | 1=highest (unknown/user request), 2=gaps, 3=stale, 4=manual add |
| status | text NOT NULL DEFAULT 'pending' | pending, processing, completed, failed |
| trigger | text NOT NULL | email_sync, manual_add, stale_check, user_request |
| attempts | int NOT NULL DEFAULT 0 | Number of processing attempts (max 3) |
| last_error | text | Error message from last failed attempt |
| enrichment_data | jsonb | Full research results blob |
| created_at | timestamptz DEFAULT now() | When queued |
| processed_at | timestamptz | When processing started |
| completed_at | timestamptz | When completed/failed |

Index on (status, priority, created_at) for efficient queue polling.
Partial unique index on (entity_type, entity_id) WHERE status IN ('pending', 'processing').

### Schema additions to `accounts` table

These columns may already exist in Supabase but not in migrations:
- `countries_of_operation` text[] DEFAULT '{}'
- `countries_of_origin` text[] DEFAULT '{}'
- `modes` text[] DEFAULT '{}'
- `trade_lanes` text[] DEFAULT '{}'
- `ports` text[] DEFAULT '{}'
- `certifications` text[] DEFAULT '{}'
- `website` text
- `enrichment_data` jsonb
- `last_enriched_at` timestamptz

### Schema additions to `companies` table

Same columns as above for prospect enrichment.

---

## Processing Engine

### Cron route: `/api/cron/enrich`

Secured with `CRON_SECRET` environment variable (Vercel Cron sends this as Authorization header).

**Every 5 minutes:**

1. SELECT up to 20 items from enrichment_queue WHERE status = 'pending' ORDER BY priority ASC, created_at ASC
2. UPDATE those items SET status = 'processing', processed_at = now()
3. For each item sequentially:
   a. **Website scrape** - fetch homepage + /about, /about-us, /services, /our-services. Strip HTML to text.
   b. **Perplexity research** - search for company profile, services, countries
   c. **Claude structuring** - feed website content + Perplexity results into Claude with the exact SERVICE_TYPES and MODES lists. Claude must only return values from these lists. Prompt includes fuzzy mapping instructions (e.g. "ocean freight" = "Sea Freight", "trucking" = "Road Freight").
   d. **Hunter.io contacts** - domain search for email contacts
   e. **Taxonomy mapping** - validate Claude's output against the canonical lists. Strip any values not in the lists.
   f. **Merge into record** - for array fields (services, modes, countries, etc.): union existing values with new values (append only, never remove). For scalar fields (website): only set if currently empty.
   g. **Store full blob** - save complete research results in enrichment_data JSONB
   h. **Update timestamps** - set last_enriched_at = now()
   i. **Mark complete** - update queue item status = 'completed', completed_at = now()
4. On failure: increment attempts, store error in last_error. If attempts >= 3, set status = 'failed'.

**Hourly sweep (every 12th run):**

1. Find prospects with data gaps (Trigger B) - queue them
2. Find stale records > 90 days (Trigger C) - queue them
3. Skip any already in queue

### Rate limiting
- Max 20 items per 5-minute cycle
- Sequential processing (not parallel) to respect API rate limits
- Perplexity: 1 call per item
- Claude: 1 call per item
- Hunter.io: 1 call per item
- Website: up to 5 fetches per item (homepage + 4 subpages)

---

## Merge Strategy

**Array fields (service_categories, modes, countries_of_operation, trade_lanes, ports, certifications):**
- Take existing values
- Add any new values from enrichment
- Never remove existing values
- Deduplicate

**Scalar fields (website):**
- Only set if currently NULL or empty

**JSONB blob (enrichment_data):**
- Always overwrite with latest research (this is the raw data, not curated)

**last_enriched_at:**
- Always set to now() on successful enrichment

---

## Email Sync Integration

When processing incoming emails (existing email sync flow):

1. Extract sender domain from email address
2. Check email classification - if "Marketing" or "Recruiter", skip enrichment
3. Look up domain in accounts (by domain field), then companies (by company_domain)
4. If not found anywhere: extract company name from email signature, create minimal company record, queue for enrichment at priority 1
5. If found but missing enrichment data: queue at priority 2 (if not already queued)

---

## API Routes

### POST `/api/cron/enrich`
- Vercel Cron endpoint, secured with CRON_SECRET
- Processes the queue as described above
- Returns: { processed: number, failed: number, queued: number }

### POST `/api/enrich-company` (existing, updated)
- Now also inserts into enrichment_queue with trigger = 'user_request', priority = 1
- Can still process synchronously for immediate results (user is waiting)
- Stores results in enrichment_data and merges into record

### GET `/api/enrichment-queue`
- Returns queue stats: pending count, processing count, completed today, failed
- For monitoring/debugging

---

## Error Handling

- Fail loud: log errors to enrichment_queue.last_error with full context
- Max 3 attempts per item
- Failed items visible in queue for debugging
- Toast notification if user-initiated enrichment fails
- No silent swallowing of errors

---

## Environment Variables

- `CRON_SECRET` - Vercel Cron authentication
- `PERPLEXITY_API_KEY` - existing
- `ANTHROPIC_API_KEY` - existing
- `HUNTER_API_KEY` - existing

---

## Files to Create/Modify

### New files:
- `src/app/api/cron/enrich/route.ts` - cron handler
- `src/app/api/enrichment-queue/route.ts` - queue stats endpoint
- `src/lib/enrichment/queue.ts` - queue operations (add, dedup, mark complete)
- `src/lib/enrichment/processor.ts` - enrichment logic (scrape, research, map taxonomy, merge)
- `src/lib/enrichment/taxonomy.ts` - canonical SERVICE_TYPES, MODES lists + mapping functions

### Modified files:
- `src/app/api/enrich-company/route.ts` - integrate with queue, use shared processor
- `src/components/email/contact-enrichment.tsx` - import taxonomy from shared module
- `vercel.json` - add cron configuration

### Database:
- Migration for enrichment_queue table
- Migration for new columns on accounts and companies tables
