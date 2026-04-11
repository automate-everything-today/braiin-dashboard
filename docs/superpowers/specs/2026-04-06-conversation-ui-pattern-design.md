# Conversation UI Pattern - Universal Design Spec

## Goal

Establish a single, consistent UI pattern across the entire Braiin platform where every entity (emails, deals, clients, incidents) uses the same three-panel conversational layout. The middle panel is always a chat-style chronological thread. This replaces the current mixed layouts with one unified experience that feels like WhatsApp meets Attio.

## Architecture

One reusable layout component (`ConversationLayout`) that accepts pluggable content for each panel. Every page (email, pipeline, client-intel, incidents) wraps this component with entity-specific configuration. The conversation thread component renders different message types (emails, notes, files, activities, system events) as styled bubbles.

## Tech Stack

- Next.js 14 App Router
- Existing component library (shadcn/ui, lucide-react, Tailwind)
- Existing platform_messages, email, deal, incident infrastructure
- React Query for data fetching

---

## 1. The Three-Panel Layout

Every entity page follows this structure:

```
+------------------+------------------------+------------------+
|                  |                        |                  |
|   Left Panel     |    Middle Panel        |   Right Panel    |
|   (280px)        |    (flex)              |   (240px)        |
|                  |                        |                  |
|   List of items  |    Conversation        |   Tabbed         |
|   with filters,  |    thread (chat-       |   context        |
|   search, and    |    style bubbles)      |   sidebar        |
|   status badges  |    + reply bar         |                  |
|                  |                        |                  |
+------------------+------------------------+------------------+
```

### Left Panel (280px, fixed)

- **Selector/filter** at top (inbox selector for email, pipeline selector for deals, etc.)
- **Primary action** button (Compose, New Deal, New Incident, etc.)
- **Filter tabs** (All, Mine, Unassigned, Pinned, etc.)
- **Scrollable list** of items with:
  - Status indicator (dot colour or icon)
  - Title (sender name, deal name, company name)
  - Subtitle (subject, stage, category)
  - Preview text
  - Badges (tags, assignment, priority)
  - Timestamp
  - Active state: left border zinc-900, bg-zinc-100
  - Hover state: left border zinc-300, bg-zinc-50

### Middle Panel (flex, fills remaining space)

- **Thread header**: entity info (contact name, avatar, key identifiers, tags)
- **Conversation thread**: chronological bubbles mixing all activity types
- **Reply bar**: input with channel switcher and @ mentions

### Right Panel (240px, fixed)

- **Tab bar** at top with dot indicators for attention
- **Scrollable content** per tab
- **Bounce animation** on tabs needing attention (AI-driven urgency, not timers)
- **Focus mode** toggle suppresses animations

---

## 2. Conversation Thread - Message Types

The thread renders different types of content as distinct bubble styles:

### Outgoing messages (your emails, your notes)

```
                              +---------------------------+
                              | Hi James, could you       |
                              | confirm the ETA?          |
                              |                    09:15  |
                              +---------------------------+
```
- Dark background (#18181b), white text
- Right-aligned
- Rounded: 16px 16px 4px 16px
- Timestamp bottom-right
- Channel icon (email/WhatsApp) in corner

### Incoming messages (their emails, external messages)

```
  [JW]  +---------------------------+
        | Vessel delayed 2 days.    |
        |                           |
        | +--- Structured Data ---+ |
        | | Container: MAEU123... | |
        | | ETA: 12 Apr (was 10)  | |
        | +-----------------------+ |
        |                    14:32  |
        +---------------------------+
```
- White background, dark text
- Left-aligned with sender avatar
- Rounded: 4px 16px 16px 16px
- Structured data extracted by AI into clean cards within the bubble
- Sender name above bubble (first message in a group)

### Internal comments (@ mentions, team discussion)

```
        +--------- yellow bg ---------+
        | @sam Can you update the     |
        | client? 2 day delay.        |
        |              - Rob, 14:45   |
        +-----------------------------+
```
- Yellow/amber background (#fef9c3)
- Centre-aligned
- Rounded pill shape
- Not visible to external parties
- Shows author name and timestamp

### System events (assignments, status changes, incidents)

```
        ---- Rob assigned to Sam - 14:50 ----
```
- Small centred text, grey
- No bubble, just inline
- Examples: "Rob claimed this email", "Status changed to Investigating", "Incident raised: Amber - Delay"

### Files and documents

```
  [RD]  +---------------------------+
        | [PDF icon] Invoice_123.pdf|
        | 2.4 MB                    |
        |            [Download]     |
        +---------------------------+
```
- Standard bubble with file icon, name, size, download link
- Images show inline preview

### AI suggestions

```
        +--------- zinc-100 bg -------+
        | AI detected: Amber -        |
        | Shipment delay               |
        | [Raise incident] [Dismiss]  |
        +-----------------------------+
```
- Light grey background
- Centre-aligned
- Action buttons inline

### Date separators

```
        -------- 6 April 2026 --------
```
- Centred, small text, between message groups

---

## 3. Reply Bar

Persistent at the bottom of the middle panel. Identical across all pages.

```
+-------+--------------------------------------+-------+-------+
| [E][W][N] | Type a reply... @ to mention  | [Clip] | [>]  |
+-------+--------------------------------------+-------+-------+
```

### Channel switcher (left side)

Buttons, one active at a time:

| Button | Label | Colour | Action |
|--------|-------|--------|--------|
| E | Email | Dark (active by default for email context) | Sends email via Graph |
| W | WhatsApp | Green (#25D366) | Sends WhatsApp (future) |
| R | Wisor | Blue (#2563eb) | Sends rate request to quote@wisor.ai with pre-filled shipment details |
| N | Internal note | Yellow/amber | Posts to platform_messages (never sent externally) |
| B | Braiin | Zinc with brain icon | Ask the AI assistant a question |

The active channel determines:
- Placeholder text ("Reply to James via email..." / "Rate request to Wisor..." / "Ask Braiin...")
- Where the message goes (Graph send / WhatsApp API / Wisor email / platform_messages / AI query)
- Bubble colour when posted (dark for outgoing / blue for Wisor / yellow for internal / zinc-50 for AI)

### Wisor channel behaviour

When Wisor channel is selected:
- Reply bar placeholder: "Send rate request to Wisor..."
- If quote details exist (from AI classification or manual entry), they auto-populate a structured card above the input showing origin, destination, mode, container, commodity
- User can edit the details or add a free-text message
- Send posts to `quote@wisor.ai` via Graph API and logs to `quote_requests` table
- The request email includes client context so Wisor can log it against the account:
  - Client company name and account code
  - Client contact name and email (the person who requested the quote)
  - Job reference (if tagged)
  - a customer branch handling the request
  - Any special requirements from the original email
- The sent request appears in the thread as a blue outgoing bubble with the structured quote details
- When Wisor replies (detected by sender matching `wisor.ai`), the AI parses the rate response and renders it as a structured rate card in the thread:

### Wisor rate card (incoming bubble)

When a rate response arrives from Wisor, AI extracts the cost breakdown and renders it as a structured card:

```
  [W]  +----------------------------------------+
       | Wisor Rate Response                     |
       | Shanghai to Felixstowe | 2x 40HC | FCL |
       |                                         |
       | ORIGIN                                  |
       | THC              USD 185 /ctr           |
       | Documentation    USD  45 /shpt          |
       | CFS charge       USD 120 /ctr           |
       | Origin total     USD 350                |
       |                                         |
       | FREIGHT                                 |
       | Ocean freight    USD 1,850 /ctr         |
       | BAF              USD  275 /ctr          |
       | ISPS             USD   25 /ctr          |
       | Freight total    USD 2,150              |
       |                                         |
       | DESTINATION                             |
       | THC              GBP 195 /ctr           |
       | Customs entry    GBP  85 /shpt          |
       | Haulage          GBP 450 /del           |
       | Dest total       GBP 730                |
       |                                         |
       | +------------------------------------+  |
       | | SUMMARY                            |  |
       | | Total cost    GBP 3,180            |  |
       | | Sell price    GBP 3,650            |  |
       | | GP            GBP 470 (12.9%)      |  |
       | +------------------------------------+  |
       |                                         |
       | [Attachment] Wisor_Quote_12345.pdf       |
       |                                         |
       | [Accept rate] [Counter] [Forward to client] |
       +----------------------------------------+
```

### Rate card data structure

AI parses the Wisor email (and any attached PDF/Excel) into:

```typescript
type RateBreakdown = {
  route: { origin: string; destination: string; mode: string; container: string };
  charges: {
    section: "origin" | "freight" | "destination";
    description: string;
    currency: string;
    amount: number;
    unit: string; // "per ctr", "per shpt", "per del", "per CBM"
  }[];
  totals: {
    origin_total: number;
    freight_total: number;
    destination_total: number;
    total_cost: number;
    total_cost_currency: string;
  };
  margin: {
    sell_price: number;
    gp: number;
    gp_pct: number;
    currency: string;
  } | null; // null until user sets sell price
  attachments: { name: string; url: string; type: string }[];
  valid_until: string | null;
};
```

### Rate card actions

| Action | What it does |
|--------|-------------|
| **Accept rate** | Logs acceptance, creates/updates deal, notifies Wisor |
| **Counter** | Opens reply to Wisor pre-filled with "Can you improve on..." |
| **Forward to client** | Opens email channel pre-filled with rate summary (without cost breakdown - only sell price), attached PDF |
| **Edit margin** | Click the sell price to edit, GP and % recalculate live |

### Margin calculator

- Sell price is editable inline in the rate card
- GP = sell price - total cost
- GP% = (GP / sell price) x 100
- Updates in real-time as you type
- If no sell price set, shows "Set sell price" prompt
- Saved to `quote_requests` table alongside the cost breakdown

### Attachment handling

- Email attachments from Wisor (PDF, Excel) are linked in the rate card
- Click to preview or download
- When forwarding to client, you choose which attachments to include
- AI can also parse Excel rate sheets if attached (extracts line items into the structured card)

### Rate history

All rates are logged to `quote_requests` with the full breakdown. When you ask Braiin "What did we quote last time for this lane?", it pulls from this data and shows the comparison.

- System event: "Rate request sent to Wisor - Shanghai to Felixstowe, 2x 40HC"

### Input area

- Auto-expanding textarea (1 line to max 6 lines)
- @ autocomplete from staff table
- Enter to send, Shift+Enter for newline
- Placeholder shows context ("Reply to James via email...")

### Right side actions

- Paperclip icon: attach file
- Send button: circular, dark

---

## 4. Right Sidebar Tabs

Each page has 5 tabs. The content varies by entity type but the structure is consistent.

### Tab structure (same everywhere)

| Tab | Email | Deal | Client | Incident |
|-----|-------|------|--------|----------|
| **Context** | Sender intel, company, performance | Deal details, stage, value, probability | Company overview, performance, health | Incident details, severity, category |
| **Chat** | Internal comments thread | Deal workspace discussion | Client notes and discussion | Incident discussion thread |
| **Assign** | Email assignment, claim, snooze | Deal owner, stage controls | Account manager assignment | Incident assignment, status |
| **Tags** | Job refs, party types, primary | Deal tags, labels | Client tags, verticals | Incident categories, job refs |
| **AI** | Classification, incident detection, quotes | Deal coaching, suggested actions | Client research, enrichment | Suggested resolution, similar incidents |

### Bounce triggers (AI-driven)

| Tab | Bounces when |
|-----|-------------|
| Chat | New unread @ mention or reply |
| AI | Incident detected (urgent/high priority only), or new coaching insight |
| Assign | Urgent/high email unassigned past inbox threshold |
| Tags | Never bounces |
| Context | Never bounces |

Generic newsletters and low-priority items never trigger bounces.

### Bounce animation

```css
@keyframes tab-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
.tab-bounce {
  animation: tab-bounce 1s ease-in-out infinite;
}
```

Plus a coloured dot:
- Chat: zinc-900
- AI: amber (suggestions), red (incidents)
- Assign: red

### Focus mode

- Eye icon in thread header, right side
- Toggles off all bounce animations
- Reduces notification polling from 15s to 60s
- Suppresses toast notifications
- Subtle "Focus" label visible when active
- Per-session (resets on page change or refresh)
- Keyboard shortcut: F (when not in text input)

---

## 5. Per-Page Configuration

### Email Page

- **Left panel**: Inbox selector (group inboxes), compose button, filter tabs (All, Mine, Unassigned, Direct, CC'd, Pinned), email list
- **Thread**: Email messages as chat bubbles + internal comments + AI detections
- **Reply bar**: Email (default), WhatsApp, Internal note
- **Right sidebar**: Context (sender intel), Chat (internal), Assign (email assignment), Tags (job refs + party), AI (classification + quotes + incidents)

### Pipeline/Deals Page

- **Left panel**: Pipeline selector, new deal button, filter tabs (All, Mine, Won, Lost, Stale), deal list by stage
- **Thread**: Deal messages as chat bubbles (user queries, AI responses, emails linked, notes, stage changes, file uploads)
- **Reply bar**: Internal note (default), Email (to deal contact), WhatsApp
- **Right sidebar**: Context (deal details, stage, value, contacts), Chat (workspace discussion), Assign (deal owner, stage controls), Tags (deal labels), AI (coaching, suggested actions)

### Client Intel Page

- **Left panel**: Search, filter by relationship type/health/branch, client list
- **Thread**: All activity for this client chronologically (emails, deals, notes, incidents, calls, research updates)
- **Reply bar**: Internal note (default), Email (to client contact), WhatsApp
- **Right sidebar**: Context (company overview, performance, health, contacts), Chat (team discussion), Assign (account manager), Tags (verticals, segments), AI (research, enrichment, competitor intel)

### Incidents Page

- **Left panel**: Severity filter, status filter, raise incident button, incident list
- **Thread**: Incident discussion as chat bubbles + status changes + resolution notes
- **Reply bar**: Internal note (default), Email (to account contact)
- **Right sidebar**: Context (incident details, severity, financial impact), Chat (discussion), Assign (investigator, status controls), Tags (categories, job refs), AI (suggested resolution, similar past incidents)

### Messages Page

- **Left panel**: Conversation list (grouped by context), filter by unread
- **Thread**: Message thread for selected conversation
- **Reply bar**: Internal note only (messages are always internal)
- **Right sidebar**: Context (linked entity details - the email, deal, or account this conversation is about)

---

## 6. Reusable Components

### `ConversationLayout`

The wrapper component. Every page uses this.

```typescript
type ConversationLayoutProps = {
  leftPanel: React.ReactNode;
  threadHeader: React.ReactNode;
  messages: ConversationMessage[];
  replyChannels: Channel[];
  defaultChannel: string;
  onSendMessage: (content: string, channel: string) => void;
  rightTabs: TabConfig[];
  focusMode?: boolean;
};
```

### `ConversationThread`

Renders the message list with all bubble types.

```typescript
type ConversationMessage = {
  id: string;
  type: "outgoing" | "incoming" | "internal" | "system" | "file" | "ai";
  author_name: string;
  author_email: string;
  content: string;
  structured_data?: Record<string, string>; // AI-extracted key-value pairs
  channel: "email" | "whatsapp" | "internal" | "system";
  timestamp: string;
  attachments?: { name: string; size: string; url: string; type: string }[];
};
```

### `ReplyBar`

The input bar with channel switcher.

```typescript
type Channel = {
  id: string;
  label: string;
  icon: string;
  color: string;
  placeholder: string;
};
```

### `TabbedSidebar`

The right panel with tab bar and content.

```typescript
type TabConfig = {
  id: string;
  label: string;
  content: React.ReactNode;
  badge?: { type: "dot" | "count"; color: string; value?: number };
  bounce?: boolean;
};
```

### `EntityList`

The left panel list component with filters.

```typescript
type EntityListProps = {
  selector?: React.ReactNode; // Inbox selector, pipeline selector, etc.
  primaryAction?: React.ReactNode; // Compose, New Deal, etc.
  filterTabs: { key: string; label: string; count: number }[];
  items: EntityListItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
};
```

---

## 7. Migration Path

Build in this order:

1. **Create reusable components** (`ConversationLayout`, `ConversationThread`, `ReplyBar`, `TabbedSidebar`, `EntityList`)
2. **Rebuild email page** using the new components (this is the template)
3. **Add group inbox support** (inbox selector, assignments, auto-routing)
4. **Rebuild deal workspace** to use the same pattern
5. **Rebuild client intel** to use the same pattern
6. **Incidents page** already close - adapt to use components
7. **Messages page** - adapt

Each step produces a working page. No big-bang rewrite.

---

## 8. Data Flow for Conversation Thread

The thread aggregates data from multiple sources into one chronological stream:

### Email page thread
- `email-sync` API: emails in/out as incoming/outgoing bubbles
- `platform_messages` where context_type = "email": internal comments
- `email_assignments` log: system events (assigned, claimed, done)
- `classify-email` API: AI detection events
- `incidents` where source = "email_ai": incident raised events

### Deal page thread
- `deal_messages`: all deal workspace messages
- `platform_messages` where context_type = "deal": team discussion
- `activities` where deal_id matches: stage changes, emails sent
- `deal-coach` API: AI coaching events

### Client page thread
- `client_emails` + email-sync for this account: emails
- `client_notes`: notes
- `activities` where account_code matches: all activity
- `platform_messages` where context_type = "account": team discussion
- `incidents` where account_code matches: incidents
- `client_research`: research updates

Each source is fetched via React Query and merged client-side into one sorted array by timestamp.

---

## 9. AI Assistant in Conversation Thread

The reply bar isn't just for messaging people - it's also how you talk to the system. When you type a question (detected by AI or triggered with `/ask`), Braiin responds as a participant in the thread.

### How it works

- Type a question in the reply bar with the Internal Note channel active
- AI detects it's a question (starts with "what", "how", "can you", "show me", "find", etc.) or uses `/ask` prefix
- Braiin responds as a system message in the thread with full context awareness

### What you can ask

**About the current context:**
- "What's the history with this client?"
- "How many jobs have we done with Maersk this year?"
- "Show me all open incidents for this account"
- "What was the profit on job SI00032457?"
- "Are there any outstanding invoices?"

**About deals and opportunities:**
- "What deals do we have open with this company?"
- "What's the win rate for ocean freight this quarter?"
- "Find similar quotes we've done for Shanghai to Felixstowe"
- "What rates did we quote last time for this lane?"

**About performance:**
- "How is this client trending - growing or declining?"
- "What's our average margin on air freight from India?"
- "Who handles the most customs jobs?"

**Cross-referencing:**
- "Pull up the deal for this job ref"
- "Show me all emails tagged with SI00032457"
- "What other jobs are we running for this client right now?"

### AI response format

AI responses appear as a distinct bubble type in the thread:

```
        +--------- zinc-50 bg, brain icon --------+
        | Braiin                                    |
        |                                           |
        | Maersk - 847 jobs over 36 months          |
        | Profit: GBP 124,500                       |
        | Trend: Growing (+12% YoY)                 |
        |                                           |
        | **Open deals:**                           |
        | - Rate Renewal (Negotiation - GBP 45k)    |
        |                                           |
        | **Recent incidents:**                     |
        | - Amber: Delay on SI00032457 (open)       |
        |                                           |
        | [View full account] [Open deal]           |
        +------------------------------------------+
```

- Light background with brain icon
- Structured data rendered cleanly (not raw text)
- Action links to jump to related entities
- Follows the same no-AI-looking-output rule - clean, bullet points, bold, standard hyphens

### Data sources the AI can query

- `client_performance` - jobs, profit, months, trends
- `deals` - open deals, stages, values, win rates
- `activities` - recent activity history
- `incidents` - open/closed incidents
- `email_tags` - tagged emails by reference
- `client_research` - enrichment data, competitor intel
- `cargowise_contacts` - contact details
- `quote_requests` - past quotes for lane comparison
- `client_notes` - historical notes
- `budget` - budget vs actual comparisons

### Context awareness

The AI always knows what you're looking at:
- On email page: knows the sender, their account, job refs in the email
- On deal page: knows the deal, company, contacts, stage
- On client page: knows the account, all history
- On incident page: knows the incident, affected parties

Questions are answered in context without needing to specify "for this client" - it knows.

---

## Non-Goals

- Real-time websocket updates (polling sufficient for V1)
- WhatsApp channel implementation (schema ready, UI shows "Coming soon")
- Live chat channel implementation (future)
- Video/voice calls in thread (future)
- Full SaaS onboarding wizard (inbox setup exists but broader flow is separate)
- Mobile-responsive layout (desktop-first, mobile later)
