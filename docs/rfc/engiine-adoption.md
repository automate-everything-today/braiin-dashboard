# RFC: engiine adoption mapping

**Status:** Draft 2026-04-27
**Author:** Rob Donald, with Claude
**Source material:** `/Users/robdonald-agent/ai-projects/engiine/engiine-plan.md` (v0.4) and `engiine-architecture.md` (v0.1)
**Companion RFCs:** 024 (Activity Backbone) — already shipped; 025+ migrations to follow

---

## 1. Why this exists

`engiine` is a 140-page architecture project (no code yet) that describes a "universal linking layer" for freight forwarding: every meaningful entity is a node, every relationship a typed link, all events appended to an immutable log, all AI calls funnelled through one boundary with token metering and cost compression.

The engiine spec assumes a **Python + FastAPI + Docker Compose VPS** deployment. Braiin runs on **TypeScript + Next.js + Supabase + Vercel**. Adopting engiine literally means a Python sidecar and a second Postgres - double the ops complexity for no functional gain.

This RFC is the bridge: which **ideas** from engiine carry over into Braiin's existing stack, in what order, with what effort.

---

## 2. What Braiin already has (the half-built engiine)

Stream Phase 1 (RFC 024) shipped 2026-04-27 and is the seed of `engiine_log`. The contract overlap is 30%+ already done:

| engiine concept | Braiin reality (today) | Status |
|---|---|---|
| `engiine_log` (append-only event log) | `activity.events` (partitioned by `occurred_at`, 36 monthly partitions) | shipped (024) |
| Polymorphic node references | `subject_type TEXT, subject_id TEXT` | shipped (024) |
| Provenance | `created_by`, `metadata`, `correlation_key` | shipped (024) |
| Inherited / role-gated visibility | `visibility` enum: `public_to_org` / `branch_only` / `manager_only` / `private` | shipped (024) |
| Three-layer correlation token | `outbound_correlation_tokens` (reply-to + subject + message-id) | shipped (024) |
| Decision provenance for AI | `metadata` JSON has room; no first-class `decision_id` yet | partial |
| Feedback events | events table can hold them (`event_type='feedback_*'`) but no UI / SDK yet | not started |
| Typed directed links between any two nodes | NOT shipped - subject polymorphism only handles primary subject + one secondary via `event_links` | gap |
| Single LLM boundary with token metering | NOT shipped - direct Anthropic SDK calls scattered across routes | gap |
| Domain shorthand vocabulary | NOT shipped | gap |
| `decision_id` + feedback loop pipeline | NOT shipped | gap |

The four "shipped" rows mean Stream is the foundation engiine asked for. The four "gap" rows are the borrowings worth doing.

---

## 3. The six borrowings, ranked by ROI

### 3.1 Single LLM boundary (`src/lib/llm-gateway/`)

**Engiine reference:** §7.4, §7.5 (`engiine_prompt_io`).

**What:** One module that every LLM call in Braiin imports from. Wraps the Anthropic SDK (and any future provider) with token metering, content-hash cache, retry/timeout, and per-prompt tracking.

**Why highest ROI:** You currently call `anthropic.messages.create(...)` directly from `classify-email`, enrichment, account-assistant, drafting, and 3+ other places. There is no central view of token spend, no cache for repeated prompts, no way to switch providers when Claude pricing shifts. A central boundary fixes all of these in one move and pays back from the first deploy.

**Concrete artifact:**
- `src/lib/llm-gateway/index.ts` - public API: `complete({ prompt, schema, cacheKey })`, `stream(...)`, `embed(...)`
- `src/lib/llm-gateway/providers/anthropic.ts` - the only provider for now
- `src/lib/llm-gateway/cache.ts` - SHA-256 of prompt + model + parameters as cache key, Supabase-backed
- `src/lib/llm-gateway/metering.ts` - writes to `activity.events` with `event_type='llm_call'`, captures input/output token counts, model, latency, cost-cents

**Migration impact:** Optional table `activity.llm_calls` (or just use `activity.events` with the right metadata). No schema changes required if reusing events.

**Effort:** ~2 days. Day 1: build the gateway and migrate `classify-email` to it. Day 2: migrate the rest (enrichment, drafting, account-assistant). CI rule: grep for `from "@anthropic-ai/sdk"` outside `src/lib/llm-gateway/` = build fail.

**Dependencies:** None. Ship anytime.

---

### 3.2 Decision + feedback loop

**Engiine reference:** §9b in full (the entire feedback loop section).

**What:** Every AI output gets a `decision_id` (UUIDv7). Users can confirm / reject / correct / flag any decision via UI. Feedback events go to `activity.events` with `event_type='feedback_*'` and `metadata.decision_id` pointing at the original decision. Confirmed and corrected decisions get promoted to `engiine/datasets/*_gold.jsonl` (or Braiin equivalent: `data/feedback/*_gold.jsonl`) which becomes regression test fixtures for prompts.

**Why high ROI:** Every AI feature is wrong on day one. Without a feedback loop, wrong answers stay wrong; the corpus of "what should have happened" is never collected. Build the capture path now while AI features are small; deferring it means re-instrumenting every existing call later.

**Concrete artifact:**
- Migration `02X_decisions_feedback.sql` - adds `activity.decisions` (or extends `events.metadata.decision_id` as a soft contract) and `activity.feedback_aggregates` view
- `src/lib/llm-gateway/decision.ts` - mints `decision_id`, stamps it onto the event row
- `src/components/feedback-affordance.tsx` - the confirm/reject/correct UI primitive, dropped onto any AI-generated UI surface
- `data/feedback/` directory - gold dataset, gitignored except the README

**Effort:** ~3 days. Decision ID minting + storage = day 1. Feedback affordance UI + write-back = day 2. Gold dataset promotion + prompt regression test wiring = day 3.

**Dependencies:** §3.1 (LLM boundary) ships first; the gateway is where decision IDs are minted.

---

### 3.3 Links table - typed directed edges between any two nodes

**Engiine reference:** §4.2, §3.2 (Links).

**What:** Today Braiin has `subject_type` + `subject_id` on `activity.events` (one primary subject) and `activity.event_links` (one secondary subject per event). That handles "this email is about this shipment". It does NOT handle: "this email replies to that email AND mentions this client AND attaches this document AND was triggered by this exception". Engiine's `links` table makes arbitrary node-to-node relationships first-class.

**Why high ROI but sequenced after 3.1 / 3.2:** Many Braiin features want this (deal timelines that pull in linked tasks, exception views that surface related shipments, contact pages that show every comm with that person). But it's structural, not visible immediately, and the cost is two more migrations + projection updates. Ship after the LLM gateway is in place because the linker (the AI that proposes links) needs the gateway.

**Concrete artifact:**
- Migration `02Y_graph_links.sql` - new `graph` schema with `graph.links` (`from_node_type`, `from_node_id`, `to_node_type`, `to_node_id`, `link_type`, `created_at`, `created_by`, `method`, `confidence`, `evidence JSONB`, `superseded_by`)
- `src/lib/graph/log-link.ts` - SDK companion to `log-event.ts`
- `src/lib/graph/connected-view.ts` - precomputed projection (engiine §7.2): given a node, return the connected sub-graph in one indexed lookup
- A linker daemon (separate phase) that proposes `ai_suggested` links via the LLM gateway

**Effort:** ~5 days for the table + SDK + first projection (Shipment connected view). The linker daemon is another 5 days but can be deferred.

**Dependencies:** §3.1 LLM gateway (the linker uses it).

---

### 3.4 Domain shorthand vocabulary (`config/shorthand.yaml`)

**Engiine reference:** §13 step 11.

**What:** A single YAML file with ~50 freight-forwarding terms (port codes weighted to UK ↔ Far East / Europe / NA / LATAM, Incoterms, modes, document types, status codes). Used by:
- The LLM gateway to compress prompts ("LHR" instead of "London Heathrow Airport")
- The UI for autocomplete and rendering
- Search for keyword expansion
- Email/RFQ extractors as canonical vocabulary

**Why high ROI per day of effort:** ~1 day to seed 50 terms. Saves tokens on every LLM call thereafter. Creates a single canonical vocabulary that fixes "is it `LHR` or `LON` or `Heathrow`?" debates forever.

**Concrete artifact:**
- `config/shorthand.yaml` - the file
- `src/lib/shorthand.ts` - loader + lookups
- Wire into `src/lib/llm-gateway/index.ts` as a pre-prompt expansion / compression pass

**Effort:** ~1 day to seed + wire. Ops can extend the YAML without a deploy (post-MVP: load from a `core.config` table).

**Dependencies:** §3.1 LLM gateway (where the shorthand expansion happens). Can be drafted in parallel.

---

### 3.5 The cheap-path-first hierarchy as an architectural rule

**Engiine reference:** Design principle #1, §7.1.

**What:** Every artifact runs through the cheapest possible path before reaching the LLM: regex → dictionary → cached lookup → rule → LLM. Already partially done in `classify-email` but not enforced as a rule.

**Why ROI:** Tokens are the largest variable cost at scale. Architecturally enforcing the hierarchy means future engineers can't accidentally call the LLM for work a regex would solve.

**Concrete artifact:**
- `docs/rfc/cheap-path-first.md` - one-page rule with examples
- Lint rule: any module that imports `llm-gateway` must also import either `regex-extractors` or `rule-engine`, OR justify with a comment

**Effort:** ~half a day. Mostly documentation and a CI lint.

**Dependencies:** None for the doc; §3.1 for the lint to bite.

---

### 3.6 The 19-node-type catalogue as naming north star

**Engiine reference:** §4.1.

**What:** Engiine's `Client / Contact / Deal / Shipment / Leg / Booking / RateRequest / Rate / Quote / Exception / CustomsFiling / Invoice / Sailing / Email / ChatMessage / Document / TMSEvent / Task / User`.

**Why ROI:** Naming consistency. Every new table, route, page, and column in Braiin should align with these names. You're already 80% there - migrations 021-024 use most of these. This RFC just documents the contract so new modules don't drift.

**Concrete artifact:**
- Add a "Node type catalogue" section to `CLAUDE.md` (or a new `docs/naming.md`) with the 19 names and their canonical Postgres table mappings.

**Effort:** ~1 hour.

**Dependencies:** None.

---

## 4. What to skip from engiine

These are good ideas in engiine that do NOT translate to Braiin's stack:

- **Python + FastAPI backend.** Wrong for this stack. Don't introduce a sidecar.
- **Docker Compose on VPS.** You're on Vercel. The deployment model is solved.
- **Multi-provider LLM routing on day one.** The gateway in §3.1 should support it as a future capability but ship Anthropic-only first.
- **Graph database.** Engiine itself rules this out for MVP. Postgres + indexes + projections is correct.
- **TOON serialisation, LLMLingua-2 compression.** Optimisation, not foundation. Reserve the plug points in the LLM gateway; defer integration until token spend justifies it.
- **A separate `engiine_*` module namespace.** Braiin's modular schema (`activity`, `commercial`, `rates`, `core`) is the equivalent. Don't introduce parallel naming.

---

## 5. Build order

Recommended sequence, weeks not days:

1. **Week 1 - LLM gateway (§3.1).** Migrate every existing AI call. CI rule blocks direct Anthropic imports. **Foundation for everything else.**
2. **Week 1 (parallel) - Shorthand vocab (§3.4) + Naming catalogue (§3.6).** Drafted while gateway is being built.
3. **Week 2 - Decision + feedback loop (§3.2).** Mints decision IDs in the gateway, captures feedback events, promotes to gold dataset.
4. **Week 3 - Cheap-path-first rule (§3.5).** Document and lint.
5. **Week 4-5 - Links table (§3.3).** New `graph` schema, SDK, first connected-view projection on Shipment. Linker daemon deferred to Phase 2.

**Total: ~5 weeks of focused work** to land the load-bearing engiine ideas inside Braiin without changing stack or shipping a separate service.

---

## 6. Open questions

1. **Does `decision_id` belong on `activity.events.metadata` or as its own table?** Trade-off: own table = clean foreign keys for feedback aggregation; metadata = no migration. Recommend own table.

2. **Should the linker (graph link suggestions) ship as part of §3.3 or as a separate later phase?** Recommend separate. Get the storage right first, prove value with manual + rule-based linking, only then add AI suggestions.

3. **Can `config/shorthand.yaml` be tenant-specific?** For multi-tenant Braiin, yes - but day one keep it global. Promote to per-tenant when a customer's terminology demands it.

4. **What's the migration story for existing token spend?** The gateway will start metering from deploy day; historical spend is unattainable. Acceptable - we have rough estimates from Anthropic billing.

---

## 7. Decision required

Confirm:
- [ ] Build order in §5 is the right sequence
- [ ] We park the original engiine project as the design north star, do NOT build it as a separate Python service
- [ ] First concrete next step: scaffold `src/lib/llm-gateway/` and migrate one AI call (suggest `classify-email`) to prove the contract

When confirmed, this becomes RFC 026 (or the next available number) and migration / file work tracks against it.
