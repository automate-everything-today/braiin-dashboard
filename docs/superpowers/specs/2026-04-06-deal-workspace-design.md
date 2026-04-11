# Braiin Deal Workspace - Attio-Style Chat Interface

## Goal

Replace the structured deal form with a conversational workspace where reps interact with deals through natural language. The pipeline kanban stays as the overview; the deal workspace is where the actual selling happens.

## Core Concept

**The deal workspace is a chat interface.** Everything flows through conversation:

- Paste an email → AI extracts company, contact, route, volume, creates the deal
- Type "what do they ship?" → AI answers from enrichment data
- Type "draft a rate response" → AI drafts using account context
- Type "send to Wisor" → forwards rate request to quote@wisor.ai
- Upload a document → AI reads and extracts relevant info
- Forward a web enquiry → AI processes and creates the deal
- Type "book a meeting" → AI creates a task with calendar suggestion

The workspace combines: chat (like Attio), intelligence (like the Account Assistant we already built), and actions (create tasks, send emails, move stages) in one place.

---

## 1. Architecture

```
Pipeline Page (kanban - unchanged)
  │
  └── Click deal → Opens Deal Workspace
      │
      ├── LEFT SIDEBAR (narrow, collapsible)
      │   ├── Deal info (stage, value, assigned)
      │   ├── Account intel (concertina sections)
      │   └── Quick actions (move stage, assign, close)
      │
      └── MAIN AREA (chat-first)
          ├── Message thread (all comms + AI responses)
          ├── Input bar (paste, type, upload, actions)
          └── AI processes everything through the thread
```

### Two modes of interaction:

**1. Human-to-AI (rep works the deal)**
```
Rep types/pastes → AI processes → creates activities, tasks, deals → responds with insight
```

**2. System-to-thread (auto-logged events)**
```
Email received → logged in thread → AI summarises
Stage changed → logged in thread
Task completed → logged in thread
Quote from Wisor → logged in thread → AI reviews
```

Everything appears in one chronological thread. The thread IS the deal history.

---

## 2. Deal Workspace Layout

```
┌──────────────────────────────────────────────────────────┐
│ HEADER                                                    │
│ Contact Name | Company | Stage Badge | Value | Health     │
│ [Move Stage ▼] [Assign ▼] [Close Won] [Close Lost]       │
├──────────┬───────────────────────────────────────────────┤
│          │                                                │
│ SIDEBAR  │  THREAD                                        │
│ (280px)  │                                                │
│          │  ┌─ System ────────────────────────────┐       │
│ Deal     │  │ Deal created from cold email         │       │
│ info     │  │ 5 Apr 2026                           │       │
│          │  └──────────────────────────────────────┘       │
│ Stage    │                                                │
│ selector │  ┌─ Email (inbound) ───────────────────┐       │
│          │  │ From: john@acme.com                   │       │
│ Intel    │  │ Subject: FCL rates enquiry            │       │
│ sections │  │ Hi, we're looking for rates from...   │       │
│ (concer- │  │ [Expand] [Reply] [Forward to Wisor]   │       │
│  tina)   │  └──────────────────────────────────────┘       │
│          │                                                │
│ - Perf   │  ┌─ AI ───────────────────────────────┐        │
│ - Ships  │  │ Matched to Acme Corp (A+ prospect)  │        │
│ - Angle  │  │ They import textiles from China.     │        │
│ - News   │  │ Current provider: DHL (confirmed)    │        │
│ - Risks  │  │                                      │        │
│          │  │ Recommended: Send competitive rate    │        │
│ Contacts │  │ for Shanghai-Felixstowe 40HQ. Our    │        │
│ on file  │  │ rate is 12% below market.             │        │
│          │  └──────────────────────────────────────┘       │
│          │                                                │
│          │  ┌─ You ──────────────────────────────┐        │
│          │  │ Send to Wisor for pricing            │        │
│          │  └──────────────────────────────────────┘       │
│          │                                                │
│          │  ┌─ System ────────────────────────────┐       │
│          │  │ Rate request forwarded to Wisor       │       │
│          │  │ quote@wisor.ai                        │       │
│          │  └──────────────────────────────────────┘       │
│          │                                                │
│          │  ┌─────────────────────────────────────┐       │
│          │  │ Type a message, paste an email, or   │       │
│          │  │ ask a question...          [Actions] │       │
│          │  └─────────────────────────────────────┘       │
│          │                                                │
└──────────┴───────────────────────────────────────────────┘
```

---

## 3. Input Processing

The input bar accepts anything. AI determines what to do with it.

### Input Types

**Plain text message:**
```
"Called John, he's interested but needs to check with procurement. Follow up Thursday."
→ Creates note activity
→ Creates task: "Follow up with John" due Thursday
→ AI responds: "Noted. Task created for Thursday. John's procurement cycle is typically Q3 based on their Companies House filings."
```

**Pasted email:**
```
(paste full email content)
→ AI detects it's an email
→ Extracts: sender, subject, key details (routes, volumes, dates)
→ Logs as email activity
→ AI responds with analysis and suggested next step
```

**Question:**
```
"What's their current volume with us?"
→ AI queries client_performance data
→ Responds with actual numbers, trends, mode breakdown
```

**Action request:**
```
"Draft a rate response for Shanghai to Felixstowe 2x40HQ"
→ AI drafts email using account context
→ Shows draft in thread
→ User can edit, approve, send
```

**Forward to Wisor:**
```
"Send to Wisor" or "Get a quote"
→ Takes the rate request details from the thread
→ Forwards to quote@wisor.ai
→ Logs in quote_requests table
→ Shows confirmation in thread
```

**Stage change:**
```
"Move to qualified" or "They're qualified"
→ Moves deal to Qualified stage
→ Logs stage change activity
→ AI responds with what's needed for next stage
```

### How AI Processes Input

```
User input
  → Claude analyses: what type of input is this?
  → Determines actions:
      - Create activity? (type, subject, body)
      - Create task? (title, due date, assigned)
      - Update deal? (stage, value, notes)
      - Send email? (draft for approval)
      - Forward to Wisor? (rate request)
      - Answer question? (query database)
      - Just acknowledge? (note taken)
  → Executes actions
  → Responds with confirmation + insight
```

---

## 4. Thread Message Types

Each message in the thread has a type that determines its appearance:

| Type | Visual | Source |
|------|--------|--------|
| `user` | Green bubble (right) | Rep typed it |
| `ai` | White bubble (left) | AI response |
| `email_in` | Blue card with envelope | Inbound email |
| `email_out` | Green card with envelope | Sent email |
| `call` | Card with phone icon | Call logged |
| `system` | Grey mini card (centred) | Stage change, task, auto-event |
| `note` | Yellow card | Note added |
| `quote` | Orange card | Quote request/response |
| `task` | Checkbox card | Task created/completed |

### Thread Storage

```sql
deal_messages (
  id SERIAL PRIMARY KEY,
  deal_id INTEGER REFERENCES deals(id) NOT NULL,
  type TEXT CHECK (type IN ('user', 'ai', 'email_in', 'email_out', 'call', 'system', 'note', 'quote', 'task')),
  content TEXT NOT NULL,
  sender_name TEXT DEFAULT '',
  sender_email TEXT DEFAULT '',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
)
```

The thread replaces the activities table for deals. Activities table stays for account-level tracking but the deal thread is the primary view.

---

## 5. API Route: Deal Chat

```
POST /api/deal-chat
{
  deal_id: number,
  message: string,
  history: Message[]  // last 20 messages for context
}

→ Claude receives:
  - Deal details (stage, value, contact, company)
  - Account intel (enrichment, research, performance)
  - Thread history (last 20 messages)
  - Available actions it can take

→ Returns:
  {
    reply: string,           // AI's response text
    actions: [               // Actions to execute
      { type: "create_task", title: "...", due_date: "..." },
      { type: "move_stage", stage: "qualified" },
      { type: "log_activity", type: "note", subject: "..." },
      { type: "draft_email", to: "...", subject: "...", body: "..." },
      { type: "forward_wisor", details: "..." },
    ]
  }
```

The frontend executes the actions and shows confirmations in the thread.

---

## 6. New Deal Flow (from any source)

### From Pipeline (manual)
1. Click "New Deal" on pipeline
2. Opens workspace with empty thread
3. Type or paste the first message
4. AI processes: extracts company, matches database, creates deal fields
5. Thread becomes the deal history

### From Email (auto)
1. Email arrives (via Graph or forwarded)
2. AI detects it's a new enquiry (not existing deal)
3. Creates draft deal in "New" queue
4. First message in thread is the email
5. AI's response is the analysis + suggested actions
6. Rep reviews and accepts/assigns

### From Web Enquiry
1. Form submission hits webhook
2. Creates draft deal in "New" queue
3. Thread shows the enquiry details
4. AI enriches from database

### From Cold Call/Email Response
1. Reply to Instantly sequence or inbound call
2. Creates deal linked to existing prospect
3. Thread starts with the response/call notes

### New Queue
Unreviewed deals sit in a "New" queue at the top of the pipeline. Count badge shows how many need attention. Any rep can claim one.

---

## 7. Quick Actions (sidebar or slash commands)

Available as buttons in the sidebar or as /commands in the input:

| Action | Command | What it does |
|--------|---------|-------------|
| Move stage | /stage qualified | Moves deal to stage |
| Assign | /assign Rob | Assigns to rep |
| Set value | /value 5000 | Sets deal value |
| Close won | /won | Closes as won |
| Close lost | /lost reason | Closes as lost with reason |
| Send email | /email | Opens email composer |
| Send to Wisor | /wisor | Forwards rate request |
| Create task | /task Follow up Thursday | Creates task |
| Research | /research | Runs Perplexity research |
| Call | /call | Logs a call |
| Note | /note text | Adds a note |

These are shortcuts. The AI also understands natural language for all of these.

---

## 8. Integration with Existing Features

| Existing Feature | How it connects |
|-----------------|-----------------|
| Client Intel | Account data shown in sidebar |
| Account Assistant | Replaced by deal workspace chat |
| Email Composer | Embedded in workspace (/email or "draft an email") |
| Perplexity Research | Triggered by /research or "research this company" |
| Enriched data | Auto-loaded in sidebar when company matches |
| Contacts | Shown in sidebar, selectable for emails |
| Notes | Part of the thread |
| Tasks | Created from thread, shown in thread |

---

## 9. What to Build (phased)

### Phase A: Thread + Chat (build first)
- Deal workspace layout (sidebar + thread)
- Thread message display (all types)
- Chat input with AI processing
- Message storage (deal_messages table)
- Basic actions: notes, stage changes, tasks
- Slash commands

### Phase B: Email Integration
- Paste email → AI extracts and logs
- Draft email in thread
- Send email from thread
- Email received → appears in thread

### Phase C: Quote Flow
- Forward to Wisor button/command
- Quote request logging
- Wisor response appears in thread

### Phase D: Auto-Processing
- New enquiry queue
- AI auto-creates draft deals from emails
- Auto-matching to database
- Auto-enrichment on new companies

---

## 10. Database Changes

### New Table
```sql
deal_messages (
  id SERIAL PRIMARY KEY,
  deal_id INTEGER REFERENCES deals(id) NOT NULL,
  type TEXT CHECK (type IN ('user', 'ai', 'email_in', 'email_out', 'call', 'system', 'note', 'quote', 'task')),
  content TEXT NOT NULL,
  sender_name TEXT DEFAULT '',
  sender_email TEXT DEFAULT '',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
)
```

### Indexes
```sql
CREATE INDEX idx_deal_messages_deal ON deal_messages(deal_id);
CREATE INDEX idx_deal_messages_type ON deal_messages(type);
CREATE INDEX idx_deal_messages_created ON deal_messages(created_at);
```

---

## 11. Design Principles

1. **Thread is truth** - if it's not in the thread, it didn't happen
2. **AI is helpful, not blocking** - always let the human do things manually if AI doesn't understand
3. **Context is king** - AI always has access to enrichment, performance, research, notes
4. **Actions are logged** - every action creates a visible entry in the thread
5. **Speed matters** - input → AI response < 3 seconds
6. **Learn from feedback** - thumbs up/down on AI responses trains the system (ai_feedback table already exists)
