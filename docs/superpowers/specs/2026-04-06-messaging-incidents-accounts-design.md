# Unified Messaging, Incidents & Accounts - Design Spec

## Goal

Build three interconnected systems for Braiin: (1) a unified accounts table where every company lives once with relationship types, service categories, and financial direction, (2) a platform-wide messaging system with @ mentions that works from any page with full context, and (3) an operational incident system with three severity levels (Amber/Red/Black) that logs against supplier/carrier/client, auto-detects from emails via AI, and escalates to management with notifications.

## Architecture

Next.js API routes backed by Supabase tables. Notifications delivered in-app via a bell component and via Microsoft Graph email for Black incidents. AI incident detection extends the existing classify-email route. All messaging uses a single `platform_messages` table with context polymorphism (email, deal, account, incident).

## Tech Stack

- Next.js 14 App Router (API routes + React client components)
- Supabase (PostgreSQL)
- Microsoft Graph API (email notifications for Black incidents)
- Claude Sonnet 4.6 (AI incident detection in email classification)
- React Query (TanStack Query) for data fetching
- Sonner for toast notifications

---

## 1. Unified Accounts Table

### Problem

Company data is fragmented across `cargowise_contacts`, `companies`, `enrichments`, and `client_performance`. In freight forwarding, the same company can be a client on one job and a supplier on another. There is no single source of truth.

### Schema: `accounts`

| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| account_code | text UNIQUE | Cargowise account code (e.g. "MAERSK") |
| company_name | text NOT NULL | Legal/registered name |
| trading_name | text | Trading as name if different |
| domain | text | Website domain for matching |
| logo_url | text | Company logo |
| relationship_types | text[] | Array: "direct_client", "forwarder_agent", "supplier" |
| service_categories | text[] | Array: "shipping_line", "road_haulier", "airline", "courier", "customs_broker", "warehouse", "software", "insurance", "port_terminal", "other" |
| financial_direction | text | "receivable", "payable", or "both" |
| status | text DEFAULT 'active' | "active", "on_hold", "blacklisted", "dormant" |
| blacklist_reason | text | Nullable - free text or link to incident |
| blacklist_incident_id | integer | FK to incidents table, nullable |
| credit_terms | text | e.g. "30 days", "COD" |
| payment_terms | text | e.g. "Net 30" |
| vat_number | text | |
| country | text | |
| city | text | |
| address | text | |
| phone | text | |
| source | text DEFAULT 'manual' | "cargowise", "manual", "enrichment" |
| notes | text | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### Indexes

- `idx_accounts_account_code` on account_code
- `idx_accounts_domain` on domain
- `idx_accounts_status` on status
- `idx_accounts_relationship_types` GIN on relationship_types
- `idx_accounts_service_categories` GIN on service_categories

### Blacklisting behaviour

When a Black incident is logged against a company (as client or supplier):
1. The account's `status` is set to `blacklisted`
2. `blacklist_reason` is populated from the incident title
3. `blacklist_incident_id` links to the incident
4. Deal creation is blocked for blacklisted accounts (enforced in the pipeline UI and API)
5. Only users with `access_role` of "super_admin", "admin", or "branch_md" can lift a blacklist (sets status back to "active" and clears the blacklist fields)

### Migration from existing tables

The existing `cargowise_contacts`, `companies`, and `enrichments` tables remain as-is for now. The `accounts` table is the new canonical source. A future migration task will deduplicate and merge data. For now, new incidents and messages reference `accounts.account_code`, and the existing contact matching in email-sync continues to work via `cargowise_contacts`.

---

## 2. Platform Messages (@ Mentions)

### Problem

No way to communicate about specific emails, deals, or accounts within Braiin. Context gets lost in Outlook/Teams. Ops can't quickly flag something to a colleague with the job reference attached.

### Schema: `platform_messages`

| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| author_email | text NOT NULL | Sender's email |
| author_name | text | Display name |
| content | text NOT NULL | Message body (supports markdown bold, bullets) |
| context_type | text NOT NULL | "email", "deal", "account", "incident", "general" |
| context_id | text | The email ID, deal ID, account code, or incident ID |
| context_summary | text | Auto-generated: "RE: Shipment delay - SI00032457 - Maersk" |
| context_url | text | Path to navigate to source: "/email?id=xxx" or "/pipeline?deal=123" |
| parent_id | integer | FK to platform_messages.id, nullable (for threads) |
| mentions | text[] | Array of mentioned user emails |
| created_at | timestamptz DEFAULT now() | |

### Schema: `message_read_receipts`

| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| message_id | integer FK | References platform_messages.id |
| user_email | text NOT NULL | |
| read_at | timestamptz DEFAULT now() | |

**Unique constraint:** (message_id, user_email)

### Indexes

- `idx_messages_context` on (context_type, context_id)
- `idx_messages_mentions` GIN on mentions
- `idx_messages_parent` on parent_id
- `idx_messages_created` on created_at DESC
- `idx_read_receipts_user` on (user_email, read_at DESC)

### API: `/api/messages`

**GET** - Fetch messages

Query params:
- `context_type` + `context_id` - get messages for a specific email/deal/account/incident
- `mentions` - get all messages mentioning a specific user
- `parent_id` - get thread replies

**POST** - Send a message

Body:
```json
{
  "content": "Can you chase Maersk on this? The container is 3 days late @sam",
  "context_type": "email",
  "context_id": "AAMkAGI2...",
  "context_summary": "RE: Delayed shipment - SI00032457 - Maersk",
  "mentions": ["sam@example.com"],
  "parent_id": null
}
```

On POST:
1. Insert message
2. Parse @ mentions from content, match against staff table
3. Create a `notification` for each mentioned user
4. Return the created message

### UI: Message Input Bar

Available on every page where context exists (email detail, deal workspace, account page, incident detail). Compact input bar at the bottom of the relevant panel:

- Text input with @ autocomplete (searches staff table by name/email)
- Send button
- Context auto-captured from the current page (email subject + refs, deal title, account name)
- Messages display as a thread above the input, newest at bottom
- Each message shows: author avatar/initials, name, time, content
- Unread messages highlighted

### UI: Email Workspace Chat

On the email detail view, a collapsible chat panel replaces or sits alongside the sender intel sidebar:
- Toggle button "Chat" in the toolbar
- Shows all `platform_messages` where `context_type = "email"` and `context_id = selected email ID`
- Message input at bottom with @ autocomplete
- Option to "Raise incident" from the chat (pre-fills with email context)

---

## 3. Incident System

### Problem

No structured way to log, track, or escalate operational exceptions. Issues get buried in email threads. Management has no visibility. No history of incidents against suppliers/carriers for future decision-making.

### Severity Levels

| Level | Colour | Description | Examples | Notification |
|-------|--------|-------------|----------|-------------|
| **Amber** | Amber/yellow | Operational delay or minor issue | Delayed collection, rolled cargo, documentation error, customs hold, short-shipped, late delivery | In-app notification to branch ops team and branch manager |
| **Red** | Red | Significant operational failure | Damage to cargo, insurance claim, failed to fly, temperature breach, contamination, demurrage dispute, lost cargo | In-app notification to branch manager and all managers |
| **Black** | Black/dark | Major incident - financial, legal, or reputational risk | Total loss, major claim, staff misconduct, regulatory breach, fraud, HSE incident, bankruptcy, liquidation, failure to pay | In-app alert banner to ALL users + email to directors immediately. Company blacklisted if applicable |

These align with freight industry incident classification standards (IATA cargo incident categories, P&I Club claims classification, UK HSE RIDDOR for workplace incidents).

### Schema: `incidents`

| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| severity | text NOT NULL | "amber", "red", "black" |
| title | text NOT NULL | Short description |
| description | text | Full details of what happened |
| category | text NOT NULL | See category list below |
| account_code | text | The client affected |
| supplier_account_code | text | The carrier/supplier responsible (nullable) |
| job_reference | text | Cargowise job ref, container number, etc. (nullable) |
| status | text DEFAULT 'open' | "open", "investigating", "resolved", "escalated" |
| raised_by_email | text NOT NULL | |
| raised_by_name | text | |
| assigned_to | text | Email of person investigating (nullable) |
| branch | text | Branch where incident occurred |
| resolution_notes | text | How it was resolved (nullable) |
| resolved_at | timestamptz | (nullable) |
| resolved_by | text | Email (nullable) |
| financial_impact | numeric | Estimated cost/claim value in GBP (nullable) |
| source | text DEFAULT 'manual' | "manual", "email_ai", "deal", "message" |
| source_id | text | Email ID, deal ID, or message ID that triggered it (nullable) |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### Incident Categories

- `delay` - Shipment or collection delayed
- `failed_collection` - Collection not completed
- `rolled` - Cargo rolled to next vessel/flight
- `short_shipped` - Partial shipment only
- `documentation_error` - Wrong or missing documents
- `customs_hold` - Held at customs
- `damage` - Physical damage to cargo
- `lost_cargo` - Cargo missing/lost
- `failed_to_fly` - Air cargo not loaded
- `temperature_breach` - Cold chain failure
- `contamination` - Cargo contaminated
- `claim` - Insurance or carrier claim
- `demurrage` - Container demurrage/detention dispute
- `theft` - Cargo stolen
- `bankruptcy` - Company entered administration/liquidation
- `failure_to_pay` - Non-payment of invoices
- `staff_misconduct` - Internal staff issue
- `regulatory_breach` - Compliance/legal violation
- `hse` - Health and safety incident
- `fraud` - Suspected fraud
- `other` - Other (requires description)

### Indexes

- `idx_incidents_severity` on severity
- `idx_incidents_status` on status
- `idx_incidents_account` on account_code
- `idx_incidents_supplier` on supplier_account_code
- `idx_incidents_job_ref` on job_reference
- `idx_incidents_branch` on branch
- `idx_incidents_created` on created_at DESC

### API: `/api/incidents`

**GET** - List/filter incidents

Query params:
- `severity` - filter by level
- `status` - filter by status
- `account_code` - incidents for a specific client
- `supplier_account_code` - incidents for a specific supplier
- `branch` - filter by branch
- `job_reference` - find incidents for a job

**POST** - Raise an incident

Body:
```json
{
  "severity": "red",
  "title": "Damage to cargo - 2x pallets crushed",
  "description": "Carrier reported 2 pallets crushed during transit...",
  "category": "damage",
  "account_code": "ABCLOG",
  "supplier_account_code": "MAERSK",
  "job_reference": "SI00032457",
  "branch": "London",
  "source": "email_ai",
  "source_id": "AAMkAGI2..."
}
```

On POST:
1. Insert incident
2. Create notifications based on severity level (see escalation rules)
3. If Black: update account status to "blacklisted", send email to directors via Graph
4. Create a `platform_message` linking to the incident for the thread
5. Log to `activities` table

**PATCH** - Update incident (change status, assign, add resolution)

**Only directors/admins can:**
- Resolve Black incidents
- Lift blacklist from an account

---

## 4. Notifications

### Schema: `notifications`

| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| user_email | text NOT NULL | Recipient |
| type | text NOT NULL | "mention", "incident", "reply", "escalation", "system" |
| title | text NOT NULL | Short: "Rob mentioned you" or "BLACK: Cargo total loss" |
| body | text | Preview text |
| severity | text | "amber", "red", "black" (for incident notifications, nullable) |
| source_type | text | "message", "incident", "deal" |
| source_id | text | ID to link back to |
| link | text | URL path: "/email?id=xxx" or "/incidents/123" |
| is_read | boolean DEFAULT false | |
| created_at | timestamptz DEFAULT now() | |

### Indexes

- `idx_notifications_user_unread` on (user_email, is_read, created_at DESC)
- `idx_notifications_type` on type

### API: `/api/notifications`

**GET** - Fetch notifications for current user
- Returns unread count + recent notifications (limit 50)
- Ordered by created_at DESC

**PATCH** - Mark as read
- Single: `{ id: 123 }`
- Bulk: `{ mark_all_read: true }`

### UI: Notification Bell Component

Located in the top bar (auth-gate.tsx), next to the user menu:
- Bell icon with red badge showing unread count
- Click opens a dropdown panel (max 400px tall, scrollable)
- Notifications grouped: Incidents (with severity colour), Mentions, Replies
- Black incidents show with a black/red highlight and persist at the top until acknowledged
- Click notification navigates to source and marks as read
- "Mark all as read" link at bottom

### Black Incident Alert Banner

For Black severity, in addition to the notification:
- A persistent red/black banner at the top of the app (below NextTopLoader, above page content)
- Shows: "BLACK INCIDENT: [title] - [account] - Raised by [name] [time ago]"
- Dismiss button (marks notification as read)
- Visible to all users until the incident is resolved or the user dismisses

---

## 5. AI Incident Detection

### Extension to `/api/classify-email`

The existing email classification prompt is extended with an additional output field:

```json
{
  "category": "action",
  "priority": "high",
  "summary": "...",
  "incident_detected": {
    "severity": "amber",
    "category": "delay",
    "title": "Shipment delayed - container MAEU1234567",
    "suggested_account": "ABCLOG",
    "suggested_supplier": "MAERSK",
    "job_reference": "SI00032457",
    "confidence": 0.85
  }
}
```

### AI Detection Trigger Words

**Amber triggers:** delay, delayed, missed collection, rolled, short-shipped, short shipped, documentation error, customs hold, customs clearance issue, awaiting, overdue, late delivery, failed pickup, rescheduled

**Red triggers:** damage, damaged, claim, lost cargo, missing cargo, theft, stolen, failed to fly, temperature breach, cold chain, contamination, contaminated, insurance claim, demurrage dispute, cargo shortage

**Black triggers:** total loss, major claim, bankruptcy, liquidation, administration, winding up, failure to pay, non-payment, overdue payment 90 days, staff misconduct, gross misconduct, regulatory breach, compliance violation, fraud, fraudulent, HSE incident, serious injury, fatality, legal action, lawsuit

### UI: Incident Detection in Email View

When `incident_detected` is present in the classification response:
- A coloured alert box appears below the classification panel
- Shows: severity badge, suggested category, title
- Two buttons: "Raise Incident" (pre-fills the incident form) and "Dismiss" (ignores)
- "Raise Incident" opens a compact form pre-filled with:
  - Severity, category, title from AI
  - Account code from email contact matching
  - Supplier from AI suggestion
  - Job reference from email tags or AI extraction
  - Source set to "email_ai" with the email ID

---

## 6. Incidents Page

A dedicated `/incidents` page accessible from the sidebar.

### Layout

- **Header**: "Incidents" title with filter controls
- **Filters**: Severity (All/Amber/Red/Black), Status (Open/Investigating/Resolved), Branch, Date range
- **Stats bar**: Open count by severity (Amber: 12, Red: 3, Black: 1)
- **List view**: Table with columns: Severity (colour dot), Title, Category, Client, Supplier, Job Ref, Branch, Status, Raised by, Date
- **Click** opens incident detail with full description, thread (via platform_messages), resolution form

### Incident Detail

- Full incident info at top
- Thread of platform_messages linked to this incident
- Message input to discuss/update
- Status controls: Assign, Change status, Add resolution
- For Black: "Lift blacklist" button (directors only)

---

## 7. Escalation Summary

| Severity | Who sees it | How they're notified | Account impact |
|----------|------------|---------------------|----------------|
| **Amber** | Ops team, branch manager | In-app notification bell | None |
| **Red** | Branch manager, all managers | In-app notification bell | None |
| **Black** | All users | In-app alert banner + notification bell + email to directors | Account blacklisted |

---

## 8. Pages and Navigation

New sidebar items:
- **Messages** - `/messages` - all your @ mentions and threads
- **Incidents** - `/incidents` - incident dashboard

Updated pages:
- **Email** - chat panel added to email detail view
- **Pipeline/Deals** - message input already exists via deal workspace
- **All pages** - notification bell in top bar

---

## Non-Goals (Not in this spec)

- Real-time websocket notifications (polling on page load is sufficient for V1)
- SMS/WhatsApp notifications
- Automated incident resolution workflows
- SLA timers on incidents
- Full migration of cargowise_contacts/companies into accounts table (future task)
