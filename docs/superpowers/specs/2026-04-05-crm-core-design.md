# Braiin CRM Core - Design Spec (Phase 1)

## Goal

Build the CRM core that replaces Pipedrive - an Attio-style record-centric system with Pipedrive pipeline mechanics, AI coaching on every deal, and a unified activity timeline. Everything lives on the Account.

## Core Concept

**Everything is an Account.** Prospects from enrichment, clients from Cargowise, agent partners - they're all accounts. Each account has contacts, deals, activities, tasks, communications, and intelligence attached. The CRM is a view layer on top of existing data.

---

## 1. Account View (Unified Company Page)

The account page is the single source of truth for any company. It pulls together data from across the platform:

```
Account Page Layout:
┌─────────────────────────────────────────────┐
│ HEADER (sticky)                              │
│ Logo | Company Name | Tier | FF/Direct |     │
│ Country Flag | Account Health | [Actions]    │
├──────────────┬──────────────────────────────┤
│ LEFT PANEL   │ MAIN CONTENT (tabbed)         │
│              │                               │
│ Quick Info:  │ Tabs:                          │
│ - Contacts   │ [Timeline] [Deals] [Quotes]   │
│ - Key person │ [Intelligence] [Performance]   │
│ - Phone/email│                               │
│ - Website    │ TIMELINE tab:                  │
│ - Assigned   │ All activities in one feed     │
│ - Last touch │                               │
│ - Days since │ DEALS tab:                     │
│              │ Active deals for this account  │
│ AI Summary:  │                               │
│ "Growing     │ QUOTES tab:                    │
│  account,    │ Rate request log               │
│  3 active    │                               │
│  deals.      │ INTELLIGENCE tab:             │
│  Book Q3     │ Research, enrichment, news     │
│  review."    │                               │
│              │ PERFORMANCE tab:               │
│ [Email]      │ TEU/Air/Road trackers          │
│ [Call]       │ (existing client intel data)   │
│ [WhatsApp]   │                               │
│ [Note]       │                               │
│ [Task]       │                               │
│ [Referral]   │                               │
└──────────────┴──────────────────────────────┘
```

### Data Sources (merged automatically):
- `companies` table (trade data, enrichment)
- `client_performance` (if existing client)
- `client_research` (Perplexity research, customer insight)
- `enrichments` (commodity, vertical, pain points)
- `cargowise_contacts` (contacts)
- `contacts` (Apollo contacts)
- `deals` (pipeline deals)
- `activities` (timeline)
- `tasks` (follow-ups)
- `client_notes` (notes)
- `client_emails` (sent emails)
- `quote_requests` (rate requests)

### Account Linking
Accounts are identified by `account_code`. For prospects without an account_code, they're identified by `company_id` from the companies table. When a prospect becomes a client, the account_code links everything together.

---

## 2. Deals Pipeline

### Pipeline Configuration (stored in DB, managed in Settings)

```sql
pipeline_types (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
)

pipeline_stages (
  id SERIAL PRIMARY KEY,
  pipeline_type_id INTEGER REFERENCES pipeline_types(id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  stale_days INTEGER DEFAULT 7,
  probability INTEGER DEFAULT 50,
  color TEXT DEFAULT '#6b7280',
  is_active BOOLEAN DEFAULT true
)
```

### Default Pipeline Types:

**New Business:**
| Stage | Position | Stale Days | Probability | Color |
|-------|----------|-----------|-------------|-------|
| Lead | 1 | 3 | 10% | grey |
| Qualified | 2 | 5 | 25% | blue |
| Rates Sent | 3 | 5 | 40% | yellow |
| Negotiation | 4 | 7 | 60% | orange |
| Meeting Booked | 5 | 10 | 75% | purple |
| Won | 6 | - | 100% | green |
| Lost | 7 | - | 0% | red |

**Agent Partnership:**
| Stage | Position | Stale Days | Probability |
|-------|----------|-----------|-------------|
| Rate Request | 1 | 2 | 20% |
| Quoted | 2 | 3 | 40% |
| Terms Discussed | 3 | 7 | 60% |
| Active | 4 | - | 100% |
| Dormant | 5 | - | 0% |

**Upsell (Existing Client):**
| Stage | Position | Stale Days | Probability |
|-------|----------|-----------|-------------|
| Opportunity Identified | 1 | 5 | 20% |
| Discussed | 2 | 7 | 40% |
| Proposed | 3 | 7 | 60% |
| Won | 4 | - | 100% |
| Lost | 5 | - | 0% |

### Pipeline Views

**Kanban Board:**
- Columns for each stage
- Drag and drop to move deals
- Cards show: company, value, days in stage, assigned rep, stale indicator
- Filter by: rep, source, branch, date range

**List View:**
- Sortable/filterable table
- All deal fields visible
- Bulk actions (assign, move stage, close)

**My Deals:**
- Filtered to logged-in user
- Sorted by urgency (stale first, then by days in stage)

### Deal Card Fields

```sql
deals (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  account_code TEXT DEFAULT '',
  company_id INTEGER,
  company_name TEXT DEFAULT '',
  contact_id INTEGER,
  contact_name TEXT DEFAULT '',
  pipeline_type_id INTEGER REFERENCES pipeline_types(id),
  stage_id INTEGER REFERENCES pipeline_stages(id),
  value NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'GBP',
  probability INTEGER DEFAULT 50,
  expected_close DATE,
  assigned_to TEXT DEFAULT '',
  branch TEXT DEFAULT 'London HQ',
  source TEXT DEFAULT '',
  source_detail TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  lost_reason TEXT DEFAULT '',
  health_score INTEGER DEFAULT 50,
  last_activity_at TIMESTAMPTZ,
  days_in_stage INTEGER DEFAULT 0,
  is_stale BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ
)
```

### Source Tracking
Every deal records where it came from:
- `cold_call` - boiler room
- `cold_email` - Instantly sequence
- `linkedin` - DM outreach
- `web_enquiry` - website form
- `email_inbound` - direct email
- `agent_request` - agent rate request
- `internal_referral` - ops team flagged
- `event` - networking/conference
- `referral` - client referral
- `enrichment` - A++ prospect pushed to pipeline

---

## 3. Activity Timeline

Every interaction is logged as an activity, creating a complete history per account and per deal.

```sql
activities (
  id SERIAL PRIMARY KEY,
  account_code TEXT DEFAULT '',
  company_id INTEGER,
  deal_id INTEGER REFERENCES deals(id),
  user_name TEXT DEFAULT '',
  type TEXT CHECK (type IN (
    'email_sent', 'email_received',
    'call_outbound', 'call_inbound',
    'whatsapp_sent', 'whatsapp_received',
    'linkedin_sent', 'linkedin_received',
    'meeting', 'note',
    'task_created', 'task_completed',
    'deal_created', 'deal_stage_change', 'deal_won', 'deal_lost',
    'quote_requested', 'quote_sent', 'quote_won', 'quote_lost',
    'research', 'referral'
  )),
  subject TEXT DEFAULT '',
  body TEXT DEFAULT '',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
)
```

### Timeline Display
- Reverse chronological (newest first)
- Grouped by date
- Each entry shows: icon (by type), who, what, when
- Expandable to see full content
- Email threads grouped
- Filter by type (calls only, emails only, etc.)

### Auto-Logging
These create activities automatically:
- Email sent from Braiin → `email_sent`
- Email received (Graph sync) → `email_received`
- Call made via Twilio → `call_outbound`
- Deal stage changed → `deal_stage_change`
- Quote sent → `quote_sent`
- Task completed → `task_completed`
- Research run → `research`

Manual logging:
- Notes added by user
- Meetings logged
- Internal referrals

---

## 4. Tasks

```sql
tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  account_code TEXT DEFAULT '',
  company_id INTEGER,
  deal_id INTEGER REFERENCES deals(id),
  assigned_to TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  due_date DATE,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  auto_generated BOOLEAN DEFAULT false,
  source TEXT DEFAULT '',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
)
```

### Auto-Generated Tasks
AI creates tasks from:
- Call transcriptions ("send rates" → task: "Send rate card", due: tomorrow)
- Email content ("get back to you Thursday" → task: "Follow up", due: Thursday)
- Stale deals ("Deal X has been in Rates Sent for 5 days" → task: "Follow up on rates")
- Stage transitions ("Deal moved to Negotiation" → task: "Prepare contract terms")

### Task Views
- **My Tasks** - filtered to logged-in user, sorted by due date
- **Overdue** - red, needs attention
- **Team Tasks** - manager view of all reps' tasks
- **By Account** - all tasks for a specific company

---

## 5. Quote Request Log

Separate from the pipeline - tracks transactional rate requests.

```sql
quote_requests (
  id SERIAL PRIMARY KEY,
  account_code TEXT DEFAULT '',
  company_id INTEGER,
  company_name TEXT DEFAULT '',
  contact_name TEXT DEFAULT '',
  requested_by TEXT DEFAULT '',
  -- Route details
  origin TEXT DEFAULT '',
  destination TEXT DEFAULT '',
  mode TEXT DEFAULT '',
  container_type TEXT DEFAULT '',
  volume TEXT DEFAULT '',
  -- Pricing
  rate_quoted NUMERIC,
  currency TEXT DEFAULT 'GBP',
  margin_pct NUMERIC,
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'quoted', 'won', 'lost', 'expired')),
  -- Timing
  requested_at TIMESTAMPTZ DEFAULT now(),
  quoted_at TIMESTAMPTZ,
  responded_in_minutes INTEGER,
  -- Outcome
  won_reason TEXT DEFAULT '',
  lost_reason TEXT DEFAULT '',
  -- Auto-promote to deal
  promoted_to_deal_id INTEGER REFERENCES deals(id),
  -- Wisor integration
  wisor_forwarded BOOLEAN DEFAULT false,
  wisor_response TEXT DEFAULT '',
  -- Meta
  source TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
)
```

### Quote Flow
```
Rate request detected (email/call)
  → Log in quote_requests (status: pending)
  → Auto-forward to wisor.ai
  → Wisor responds
  → AI reviews response:
      Clean → draft reply, queue for approval
      Issues → flag for human review
  → User approves/edits and sends
  → Track: won/lost/expired
  → If new client → auto-promote to deal
```

### Quote Metrics
- Average response time (target: < 5 mins)
- Win rate by agent/client
- Average margin
- Quote volume by lane
- Wisor accuracy rate

---

## 6. AI Deal Coach

Every deal has an AI coach that analyses all data and recommends actions.

### How It Works
Claude receives:
- All activities on the deal (calls, emails, notes)
- Account enrichment data (what they ship, pain points)
- Research data (news, competitor intel)
- Deal metadata (days in stage, value, source)
- Account performance data (if existing client)
- Quote history

### AI Coach Output
Displayed on the right side of the deal card:

**Next Step** (always one clear action):
> "Send rate comparison for Shanghai-Felixstowe 40HQ. They mentioned price pressure in last call. Lead with our rate which is 12% below current provider."

**Deal Health** (0-100 score):
- Recency: when was last contact? (decays daily)
- Engagement: are they responding? (reply rate)
- Momentum: is the deal moving forward? (stage changes)
- Completeness: have key milestones happened? (call, meeting, rates)
- Signals: positive/negative language in comms

**Missing Milestones:**
> "No face-to-face meeting yet. Deals with meetings close 3x more often."

**Risk Alerts:**
> "They mentioned 'happy with current provider' in last email. Prepare competitive comparison."

---

## 7. Internal Referrals

Ops team can flag opportunities directly from within the app.

```
Any user → clicks "Refer" button on any account
  → Pops up: "What's the opportunity?"
  → Free text + dropdown (new service, volume increase, competitor issue, etc.)
  → Creates an activity (type: referral) on the account
  → Optionally creates a deal in Upsell pipeline
  → Notifies assigned sales rep via toast + task
```

This is a simple button available everywhere an account is shown - Client Intel, Clients page, even on shipment data once we have it.

---

## 8. CRM Navigation

New sidebar items:
```
Pipeline    - Kanban board view
Deals       - List view of all deals
Tasks       - My tasks / team tasks
Quotes      - Quote request log
```

These replace or complement the existing pages. The existing Client Intel, Enriched, and Prospects pages continue to work but now link to the CRM account view.

---

## 9. Database Schema Summary

New tables:
- `pipeline_types` - configurable pipeline definitions
- `pipeline_stages` - stages per pipeline with stale thresholds
- `deals` - (already created, needs updating to match this spec)
- `activities` - (already created, needs updating)
- `tasks` - (already created, needs updating)
- `quote_requests` - new table for rate request tracking

Modified tables:
- `deals` - add pipeline_type_id, stage_id, health_score, days_in_stage, is_stale, source_detail
- `activities` - expand type enum, add company_id

---

## 10. Implementation Phases

### Phase 1a: Pipeline + Deals (build first)
- Pipeline configuration (types + stages in DB)
- Deals CRUD (create, edit, move stage, close)
- Kanban board view
- List view
- Deal card with timeline
- Deal source tracking

### Phase 1b: AI Coach + Tasks
- AI deal coach (next step, health score, risks)
- Task system (CRUD + auto-generation from stale deals)
- Stale deal detection (cron or on-load)
- Internal referral button

### Phase 1c: Quote Log
- Quote request table
- Quote CRUD
- Wisor.ai integration (email forwarding)
- Quote metrics dashboard
- Auto-promote to deal

---

## Configurable Settings (Super Admin)

All managed from Settings page:

| Setting | What | Default |
|---------|------|---------|
| Pipeline types | Add/edit/disable pipelines | 3 defaults |
| Pipeline stages | Add/rename/reorder per pipeline | Per pipeline |
| Stale thresholds | Days per stage before flagged | 3-10 days |
| Deal sources | Add/edit source options | 10 defaults |
| Win/loss reasons | Configurable dropdown | 5 defaults each |
| Auto-task rules | Which events create tasks | Stale deals on |
| Quote response target | Minutes | 5 |
| AI coach model | Which Claude model | Sonnet |

---

## What This Replaces

| Pipedrive Feature | Braiin Equivalent |
|------------------|-------------------|
| Deal pipeline | Configurable multi-pipeline with kanban |
| Activity logging | Auto-logged timeline from all channels |
| Contact management | Unified from Cargowise + Apollo + manual |
| Email integration | Microsoft Graph (full send/receive) |
| Reports | Built-in with AI insights |
| Mobile | Responsive web (mobile app later) |

**What Braiin adds that Pipedrive can't do:**
- AI deal coaching with freight-specific knowledge
- Enrichment data on every account
- Perplexity research integration
- Quote request tracking with Wisor integration
- Internal referral system
- Branch-level access control
- TEU/volume tracking per client
- Cold calling dialler (Phase 3)
- WhatsApp integration (Phase 2)
