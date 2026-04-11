# The Brain - Full Platform Design Spec

## Overview

The Brain is the customer' internal business intelligence and CRM platform, replacing Pipedrive and consolidating all sales, operations, finance, and knowledge tools into a single freight-specific system. Built for 30-40 users across up to 5 branches with role-based access control.

## Architecture

### Tech Stack
- **Frontend:** Next.js 14 + shadcn/ui + Tailwind + Recharts
- **Backend:** Supabase (PostgreSQL) + Next.js API routes (Vercel serverless)
- **Auth:** Microsoft Azure AD SSO (replaces Supabase magic link)
- **Email:** Microsoft Graph API (send/receive) + Resend (transactional)
- **Calling:** Twilio (dialler, recording, IVR)
- **AI:** Claude API (drafting, analysis, chat) + Perplexity (research)
- **Documents:** Gamma API (reports, presentations)
- **Knowledge:** Obsidian / NotebookLM (company + industry knowledge base)
- **Hosting:** Vercel Pro (London edge)
- **Domain:** brain.example.com

### Data Flow
```
Cargowise → Supabase (shipments, contacts, financials)
UK Trade Data → Supabase (382k companies, 8.4M HS codes)
Apollo → Supabase (prospect enrichment, logos)
Perplexity → Supabase (company research, news)
Microsoft Graph → Supabase (email sync)
Twilio → Supabase (call logs, recordings)
Obsidian/NotebookLM ← → The Brain (knowledge base)
```

---

## Module Breakdown

### Module 1: Authentication & Access Control

**Microsoft Azure AD SSO:**
- All users log in with their @example.com Microsoft account
- No more magic links or email whitelist
- Single sign-on across all the customer tools
- Azure AD app registration with Mail.Read, Mail.Send, Mail.ReadWrite, User.Read permissions

**User Roles:**

| Role | Access | Count |
|------|--------|-------|
| Super Admin | Everything, all branches, P&L, settings, fee configuration | 2 (Rob, Sam) |
| Branch MD | Their branch data, branch P&L, all their reps' accounts | Up to 5 |
| Sales Rep | Their assigned accounts, their pipeline, their emails | 20-30 |
| Ops/Admin | Shipment data, contacts, no P&L or financials | 5-10 |

**Branch Structure:**
- Up to 5 branches (dynamically configurable)
- Each user belongs to one branch (or HQ)
- UK and International sales reps
- Branch assignment stored in user profile

**Database Tables:**
```sql
users (
  id UUID PRIMARY KEY,
  azure_id TEXT UNIQUE,
  email TEXT UNIQUE,
  full_name TEXT,
  role TEXT CHECK (role IN ('super_admin', 'branch_md', 'sales_rep', 'ops_admin')),
  branch_id INTEGER REFERENCES branches(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ
)

branches (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE,
  code TEXT UNIQUE,
  city TEXT,
  country TEXT DEFAULT 'UK',
  is_active BOOLEAN DEFAULT true,
  -- Fee model
  fee_model TEXT CHECK (fee_model IN ('hq_ops', 'own_ops')),
  ops_fee_per_job NUMERIC DEFAULT 150,
  gp_percentage NUMERIC DEFAULT 10,
  software_fee_per_user NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ
)
```

**Row-Level Security:**
- Super Admin: sees all data
- Branch MD: sees data WHERE branch_id = their branch
- Sales Rep: sees data WHERE assigned_rep = their user_id
- Ops/Admin: sees operational data for their branch, no financial data

**Security:**
- All API keys server-side only (never in NEXT_PUBLIC_)
- HTTPS everywhere
- Audit log for all sensitive operations (fee changes, user role changes, data exports)
- Daily automated Supabase backup
- Rate limiting on API routes

---

### Module 2: CRM Core (Replaces Pipedrive)

**Deals Pipeline:**
```sql
deals (
  id SERIAL PRIMARY KEY,
  title TEXT,
  company_name TEXT,
  account_code TEXT,
  contact_id INTEGER,
  stage TEXT CHECK (stage IN ('lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost')),
  value NUMERIC,
  currency TEXT CHECK (currency IN ('GBP', 'USD', 'EUR')),
  value_gbp NUMERIC, -- auto-converted
  probability INTEGER DEFAULT 50,
  expected_close DATE,
  assigned_to UUID REFERENCES users(id),
  branch_id INTEGER REFERENCES branches(id),
  source TEXT, -- enrichment, cold_call, referral, inbound, bcc_intel
  notes TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  lost_reason TEXT
)
```

**Pipeline Stages:**
1. Lead - initial contact/enrichment
2. Qualified - confirmed they ship, have a need
3. Proposal - rate card sent
4. Negotiation - discussing terms
5. Won - first shipment booked
6. Lost - didn't convert (with reason)

**Activity Timeline:**
```sql
activities (
  id SERIAL PRIMARY KEY,
  account_code TEXT,
  deal_id INTEGER REFERENCES deals(id),
  user_id UUID REFERENCES users(id),
  type TEXT CHECK (type IN ('email_sent', 'email_received', 'call', 'meeting', 'note', 'task', 'deal_stage_change', 'research')),
  subject TEXT,
  body TEXT,
  metadata JSONB, -- call duration, email_id, recording_url, etc.
  created_at TIMESTAMPTZ
)
```

Every action (email, call, note, deal change) creates an activity record. The account page shows a unified timeline.

**Task Management:**
```sql
tasks (
  id SERIAL PRIMARY KEY,
  title TEXT,
  description TEXT,
  account_code TEXT,
  deal_id INTEGER,
  assigned_to UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  due_date DATE,
  priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
```

**Contact Management:**
- Unified from Cargowise contacts + Apollo contacts + manually added
- Link contacts to accounts, deals, and activities
- Contact enrichment via Apollo (title, LinkedIn, phone)
- Duplicate detection by email

---

### Module 3: Email (Microsoft Graph)

**Sync:**
- Each user authenticates with Microsoft once
- Graph API syncs sent/received emails
- Emails auto-matched to accounts by sender/recipient email → cargowise_contacts lookup
- Unmatched emails flagged for manual assignment

**Compose:**
- Rich text editor
- Claude-assisted drafting with account context (already built)
- Preset templates (already built)
- Sent via Graph API (appears in user's Outlook Sent folder)
- CC/BCC support
- Attachment support

**Inbox View:**
- Filtered by account (show all emails for this client)
- Filtered by user (show my inbox)
- Thread view (group by conversation)
- Quick reply from The Brain

---

### Module 4: Freight Operations

**Shipments:**
```sql
shipments (
  id SERIAL PRIMARY KEY,
  shipment_number TEXT UNIQUE,
  account_code TEXT,
  branch_id INTEGER REFERENCES branches(id),
  mode TEXT CHECK (mode IN ('fcl', 'lcl', 'air', 'road', 'rail', 'warehousing', 'customs')),
  -- Dates
  etd DATE, -- estimated departure
  eta DATE, -- estimated arrival
  atd DATE, -- actual departure
  ata DATE, -- actual arrival
  -- Routing
  origin_port TEXT,
  destination_port TEXT,
  origin_country TEXT,
  destination_country TEXT,
  -- Volume
  container_type TEXT,
  teu NUMERIC,
  weight_kg NUMERIC,
  cbm NUMERIC,
  -- Financial
  revenue NUMERIC,
  cost NUMERIC,
  profit NUMERIC,
  currency TEXT DEFAULT 'GBP',
  profit_gbp NUMERIC, -- converted
  -- Status
  status TEXT CHECK (status IN ('booked', 'in_transit', 'arrived', 'delivered', 'completed', 'cancelled')),
  -- Ops
  customs_status TEXT,
  warehouse_status TEXT,
  assigned_rep UUID REFERENCES users(id),
  created_at TIMESTAMPTZ
)
```

**Dashboards:**
- Weekly/monthly TEU tracker by branch
- Air KG tracker by branch
- Road CBM tracker by branch
- Transit time analysis (ETD to ATA)
- On-time performance (ETA vs ATA)
- Shipments in transit (pipeline view)
- Customs clearance turnaround
- Warehouse throughput

---

### Module 5: Financial (P&L + Branch Model)

**P&L Structure:**
```sql
financial_periods (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER REFERENCES branches(id),
  period TEXT, -- '2026-01', '2026-02', etc.
  -- Revenue
  revenue_fcl NUMERIC DEFAULT 0,
  revenue_lcl NUMERIC DEFAULT 0,
  revenue_air NUMERIC DEFAULT 0,
  revenue_road NUMERIC DEFAULT 0,
  revenue_customs NUMERIC DEFAULT 0,
  revenue_warehousing NUMERIC DEFAULT 0,
  revenue_other NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'GBP',
  -- Costs
  cost_of_sales NUMERIC DEFAULT 0,
  staff_costs NUMERIC DEFAULT 0,
  rent NUMERIC DEFAULT 0,
  marketing NUMERIC DEFAULT 0,
  technology NUMERIC DEFAULT 0,
  insurance NUMERIC DEFAULT 0,
  other_costs NUMERIC DEFAULT 0,
  -- Calculated (auto)
  gross_profit NUMERIC GENERATED ALWAYS AS (
    revenue_fcl + revenue_lcl + revenue_air + revenue_road + revenue_customs + revenue_warehousing + revenue_other - cost_of_sales
  ) STORED,
  total_costs NUMERIC GENERATED ALWAYS AS (
    staff_costs + rent + marketing + technology + insurance + other_costs
  ) STORED,
  -- HQ fees (auto-calculated from branch model)
  hq_ops_fees NUMERIC DEFAULT 0, -- sum of per-job ops fees
  hq_gp_fees NUMERIC DEFAULT 0, -- % of GP fee
  hq_software_fees NUMERIC DEFAULT 0, -- per user per month
  total_hq_fees NUMERIC GENERATED ALWAYS AS (
    hq_ops_fees + hq_gp_fees + hq_software_fees
  ) STORED,
  created_at TIMESTAMPTZ
)
```

**Branch Fee Model (Super Admin editable only):**

Model A - HQ does ops:
- Per job: ops fee (e.g. £150) OR GP% (e.g. 10%), whichever is greater
- Plus software fee per user per month

Model B - Branch does own ops:
- GP% only (e.g. 10-15%)
- Plus software fee per user per month

The fee baseline (£150) and GP% are editable only by Super Admin (Rob + Sam).

**Currency:**
- GBP, USD, EUR supported
- Exchange rates stored and configurable
- All reporting converts to GBP for group consolidation
- Branch can operate in their local currency

```sql
exchange_rates (
  id SERIAL PRIMARY KEY,
  from_currency TEXT,
  to_currency TEXT,
  rate NUMERIC,
  effective_date DATE,
  created_at TIMESTAMPTZ
)
```

**Budget:**
```sql
budgets (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER REFERENCES branches(id),
  period TEXT,
  revenue_target NUMERIC,
  profit_target NUMERIC,
  teu_target NUMERIC,
  air_kg_target NUMERIC,
  new_clients_target INTEGER,
  currency TEXT DEFAULT 'GBP',
  created_at TIMESTAMPTZ
)
```

**P&L Dashboard:**
- Branch-level P&L with all fee calculations
- Group consolidated P&L (all branches rolled up to GBP)
- Budget vs actual variance
- Trend charts by branch
- Visible to Super Admin (all) and Branch MD (their branch only)
- Sales reps see NONE of this

---

### Module 6: Boiler Room (Cold Calling + Dialler)

**Twilio Integration:**
- Built-in web dialler (browser-based calling via Twilio Client SDK)
- Click-to-call from any contact in the system
- Call recording (stored in Twilio, linked in Supabase)
- Call duration and outcome logged automatically
- Granola integration for AI call notes

**Cold Calling Queue:**
```sql
call_queue (
  id SERIAL PRIMARY KEY,
  account_code TEXT,
  contact_name TEXT,
  phone TEXT,
  priority INTEGER DEFAULT 0,
  assigned_to UUID REFERENCES users(id),
  status TEXT CHECK (status IN ('queued', 'in_progress', 'completed', 'no_answer', 'callback', 'not_interested')),
  call_script TEXT,
  last_called_at TIMESTAMPTZ,
  callback_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ
)

call_logs (
  id SERIAL PRIMARY KEY,
  account_code TEXT,
  contact_name TEXT,
  phone TEXT,
  user_id UUID REFERENCES users(id),
  direction TEXT CHECK (direction IN ('outbound', 'inbound')),
  duration_seconds INTEGER,
  outcome TEXT CHECK (outcome IN ('connected', 'no_answer', 'voicemail', 'busy', 'wrong_number')),
  recording_url TEXT,
  twilio_sid TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ
)
```

**Features:**
- Auto-dialler mode (next call loaded automatically)
- Call scripts with AI suggestions based on account context
- Callback scheduling
- Cold calling performance dashboard (calls/hour, connect rate, conversion)
- Leaderboard by rep

---

### Module 7: Existing Features (Already Built)

Carried forward and integrated into the new architecture:

- Client Intelligence (performance, research, trackers, account assistant)
- Prospect pipeline (A++ scoring, enrichment, Perplexity research)
- Enriched accounts (search, filters, verticals, research button)
- Cold calling data
- Lead Intel (BCC pipeline)
- Email composer with Claude drafting
- Cargowise contacts
- Forwarder detection + country flags
- Client logos
- Gamma report generation

---

### Module 8: Knowledge Base Integration

**Obsidian / NotebookLM:**
- Central repository of freight industry knowledge
- Company research and analysis
- Training materials
- Marketing content library
- Accessible via API from The Brain's chat assistants

**Use cases:**
- Account Assistant pulls freight knowledge for better recommendations
- Marketing team generates website content, social posts, case studies
- New starters access training materials
- Cold calling scripts reference industry knowledge

---

## Security & Backup

**Authentication:**
- Microsoft SSO only (no passwords stored)
- Session management via Azure AD tokens
- Auto-logout after inactivity

**Data Protection:**
- All API keys server-side (Vercel env vars)
- Row-Level Security on every table
- Branch isolation enforced at database level
- Audit log for: user logins, data exports, fee changes, role changes, deleted records

**Backup:**
- Daily automated Supabase backup (pg_dump to secure storage)
- Point-in-time recovery enabled on Supabase
- Weekly backup verification

**Rate Limiting:**
- API routes rate-limited per user
- Twilio call limits configurable per branch

---

## Implementation Phases

### Phase 1: Foundation (1-2 days)
- Azure AD SSO integration
- User roles and branch structure tables
- Row-level security policies
- Audit logging
- Backup automation
- Settings page (Super Admin only) for branch fee configuration

### Phase 2: CRM Core (3-5 days)
- Deals pipeline (replace Pipedrive)
- Unified contact management
- Activity timeline
- Email send/receive via Microsoft Graph
- Task management with reminders
- Account page redesign (unified view)

### Phase 3: Freight Operations (2-3 days)
- Cargowise shipment data import
- Weekly/monthly volume dashboards
- Transit time and on-time performance
- Customs and warehousing tracking
- Shipment pipeline view

### Phase 4: Financial (2-3 days)
- P&L import and display by branch
- Branch fee model calculation (Model A/B)
- Budget vs actual
- Currency conversion
- Group consolidated reporting
- Settings for fee baselines and percentages (Super Admin only)

### Phase 5: Boiler Room (2-3 days)
- Twilio dialler integration
- Call recording and logging
- Cold calling queue management
- Call scripts with AI
- Performance dashboard

### Phase 6: Knowledge & Marketing (ongoing)
- Obsidian/NotebookLM integration
- Content generation pipeline
- Marketing automation

---

## Open Questions

1. **Resend vs Graph for sending:** Should we send all emails via Microsoft Graph (appears in Outlook) or keep Resend for transactional? Recommendation: Graph for all user emails, Resend only for system notifications.

2. **Twilio account:** Need Rob to create Twilio account and provide credentials.

3. **Azure AD:** Need Rob to register the app and provide client ID, tenant ID, and secret.

4. **P&L file format:** Awaiting sample file to map schema.

5. **Shipment data format:** Awaiting Cargowise export to map schema.

6. **Custom domain:** Set up brain.example.com pointing to Vercel?

7. **Backup storage:** Where to store daily backups? S3, Google Cloud Storage, or local?
