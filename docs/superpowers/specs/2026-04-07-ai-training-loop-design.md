# AI Response Training Loop - Design Spec

## Goal

Build a best-in-class AI response generation system that learns each user's writing style, improves with every interaction, and generates replies indistinguishable from the user's own writing. The system should get measurably better over time.

## Current State (What We Have)

- Email classification with 11 categories
- 3 suggested replies per email (generic, not personalised)
- Writing samples table (logs sent emails)
- Last 10 samples fed into classification prompt
- Thumbs up/down on classification
- User preferences: tone, sign-off, phrases to use/avoid, sample email

## Problems With Current Approach

1. **No retrieval** - we pick the last 10 samples, not the most relevant ones
2. **No style profiling** - we don't analyse how the user writes
3. **Weak feedback signal** - thumbs up/down on classification, not on reply quality
4. **Single-shot generation** - one prompt does classification AND replies
5. **No context** - replies don't know about the client, deal, or history
6. **No learning curve** - system doesn't measurably improve

---

## Architecture: Three-Stage Pipeline

### Stage 1: Classify + Detect (existing, enhanced)
- Classify the email (category, priority, incident)
- Extract structured data (quote details, dates, references)
- Detect sender context (client/prospect/carrier)

### Stage 2: Retrieve Similar Responses (NEW)
- Find the most similar past emails this user has received and replied to
- Match by: sender, category, topic keywords, account
- Return the top 3-5 most relevant (email, reply) pairs as few-shot examples

### Stage 3: Generate Personalised Response (NEW)
- Separate API call specifically for response generation
- Uses: user's voice profile + retrieved examples + client context + email content
- Generates 3 response options at different lengths (short/medium/detailed)

---

## 1. User Voice Profile

Built automatically from writing samples. Recalculated when new samples accumulate.

### Table: `user_voice_profiles`

| Column | Type | Description |
|--------|------|-------------|
| user_email | text PK | |
| avg_reply_length | integer | Average words per reply |
| tone | text | Detected: formal/professional/warm/casual |
| greeting_style | text | "Hi [name]", "Dear [name]", "[name]," etc. |
| sign_off_style | text | Detected from actual usage |
| common_phrases | text[] | Phrases used in 3+ replies |
| avoided_phrases | text[] | Phrases from preferences |
| sentence_style | text | Short/medium/long average sentence length |
| formality_score | numeric | 0-1 scale (0=casual, 1=very formal) |
| response_speed | text | Typical response pattern: immediate/same-day/next-day |
| sample_count | integer | How many samples the profile is built from |
| last_rebuilt | timestamptz | |
| updated_at | timestamptz | |

### How it's built

Every 20 new writing samples (or on demand), run an AI analysis:

```
Analyse these email replies from the same person. Extract their writing style:
- Average reply length (words)
- Tone (formal/professional/warm/casual)
- How they greet people (first name? title? none?)
- How they sign off
- Phrases they use repeatedly
- Sentence style (short punchy? long detailed?)
- Formality level (0-1)

Replies:
[last 50 writing samples]
```

Store the result. This becomes the "voice DNA" for this user.

---

## 2. Similar Response Retrieval (RAG-lite)

When generating a reply, find the most relevant past interactions.

### Similarity matching (in order of priority)

1. **Same sender** - have we replied to this exact person before? Highest signal.
2. **Same account** - have we replied to anyone at this company before?
3. **Same category** - for this email type (quote request, action, etc.), what did we write?
4. **Similar subject** - keyword matching on subject lines
5. **Same mode/trade lane** - for freight-specific context

### Table: `ai_writing_samples` (enhanced)

Add columns:
| Column | Type | Description |
|--------|------|-------------|
| category | text | Email category when this reply was sent |
| account_code | text | Client/company for context matching |
| keywords | text[] | Extracted keywords from the original email |
| reply_length | integer | Word count of the reply |
| was_edited | boolean | Was the AI suggestion edited before sending? |
| edit_distance | numeric | How much was it changed (0=used as-is, 1=completely rewritten) |

### Retrieval query

```sql
SELECT original_email_subject, original_email_preview, actual_reply, category
FROM ai_writing_samples
WHERE user_email = $1
  AND (
    original_email_from = $sender  -- same sender (priority 1)
    OR account_code = $account     -- same account (priority 2)
    OR category = $category        -- same type (priority 3)
  )
ORDER BY
  CASE WHEN original_email_from = $sender THEN 0
       WHEN account_code = $account THEN 1
       WHEN category = $category THEN 2
       ELSE 3
  END,
  created_at DESC
LIMIT 5;
```

---

## 3. Response Generation (Separate API Call)

A dedicated endpoint `/api/generate-reply` that runs AFTER classification.

### Input
- The original email (subject, body, sender)
- Classification result (category, priority, structured data)
- User voice profile
- Top 5 retrieved similar responses
- Client context (account data, recent jobs, open deals)
- User preferences (tone, sign-off, phrases)

### Prompt structure

```
You are writing an email reply as {user_name} from the customer.

VOICE PROFILE:
- Tone: {tone}
- Average reply: {avg_length} words
- Greeting: {greeting_style}
- Sign-off: {sign_off_style}
- Phrases they use: {common_phrases}
- Phrases to avoid: {avoided_phrases}
- Formality: {formality_score}/10

EXAMPLES OF HOW THEY REPLY TO SIMILAR EMAILS:
Example 1:
  Received: {similar_email_1_preview}
  They replied: {similar_reply_1}

Example 2:
  Received: {similar_email_2_preview}
  They replied: {similar_reply_2}

[up to 5 examples]

CLIENT CONTEXT:
- Company: {company_name} ({relationship_type})
- Account health: {health}
- Recent jobs: {job_count} in last 3 months
- Open deals: {deals}
- Contact: {contact_name}, {job_title}

EMAIL TO REPLY TO:
From: {sender_name} ({sender_email})
Subject: {subject}
Body: {body}

Generate 3 reply options:
1. SHORT (1-2 sentences, quick acknowledgement)
2. STANDARD (3-5 sentences, addresses the email properly)
3. DETAILED (full response with all necessary information)

Each reply MUST:
- Match the voice profile exactly
- Use their greeting and sign-off style
- Match their typical sentence length and formality
- Reference relevant client context where appropriate
- Use standard hyphens only (-), never em dashes
- Not look AI-generated

Return JSON:
{
  "replies": [
    {"type": "short", "content": "..."},
    {"type": "standard", "content": "..."},
    {"type": "detailed", "content": "..."}
  ],
  "context_used": "Brief note on what context influenced the replies"
}
```

---

## 4. Feedback Signals (Multi-Signal Learning)

Track more than just thumbs up/down:

### Signal 1: Selection
Which reply option was selected (short/standard/detailed)? This teaches length preference per category.

### Signal 2: Edit distance
When a suggestion is used but edited, calculate how much was changed:
- 0% edit = perfect suggestion (strong positive signal)
- 1-20% edit = good suggestion, minor tweaks (positive)
- 21-50% edit = decent starting point (neutral)
- 51%+ edit = mostly rewritten (negative signal, but the rewrite is a great training sample)

### Signal 3: Ignore
If all 3 suggestions are ignored and the user writes from scratch, that's a negative signal for that email type. The from-scratch reply becomes a strong training sample.

### Signal 4: Explicit feedback
Thumbs up/down with optional context (existing).

### Signal 5: Response time
How quickly after viewing suggestions did the user respond? Fast = suggestions were useful. Long gap = user needed to think (suggestions may not have helped).

### Table: `ai_response_feedback`

| Column | Type | Description |
|--------|------|-------------|
| id | serial PK | |
| email_id | text | |
| user_email | text | |
| suggestion_type | text | "short", "standard", "detailed" |
| suggestion_content | text | What was suggested |
| was_selected | boolean | Did user click this suggestion? |
| was_sent | boolean | Was it actually sent? |
| edit_distance | numeric | 0-1, how much was edited |
| final_content | text | What was actually sent (if different) |
| explicit_rating | text | "good", "bad", null |
| feedback_context | text | Optional explanation |
| time_to_respond_ms | integer | Milliseconds from suggestion shown to send |
| created_at | timestamptz | |

---

## 5. Continuous Improvement Metrics

### Per-user metrics (dashboard in Settings)
- **Suggestion adoption rate**: % of emails where a suggestion was used (target: >60%)
- **Average edit distance**: how much users change suggestions (target: <20%)
- **Preferred reply length**: which option (short/standard/detailed) gets used most
- **Training samples**: how many samples the system has learned from
- **Voice profile strength**: confidence level based on sample count

### System metrics (admin dashboard)
- Adoption rate across all users
- Most/least accurate categories
- Average edit distance trend over time
- Which users benefit most from AI suggestions

---

## 6. Implementation Order

### Phase 1: Enhanced writing samples (quick win)
- Add category, account_code, keywords, was_edited, edit_distance to ai_writing_samples
- Track which suggestion was selected and what was actually sent
- Calculate edit distance on send

### Phase 2: Voice profile
- Build user_voice_profiles table
- Run voice analysis on existing samples
- Feed into reply generation prompt

### Phase 3: Retrieval
- Implement similar response retrieval query
- Feed top 5 examples into reply generation

### Phase 4: Separate reply generation endpoint
- New /api/generate-reply endpoint
- Three reply options (short/standard/detailed)
- Context-aware with client data

### Phase 5: Feedback loop
- ai_response_feedback table
- Track selection, edit distance, timing
- Feed back into retrieval ranking

### Phase 6: Metrics dashboard
- Per-user adoption rate
- System-wide improvement tracking

---

## 7. Edit-and-Explain Flow

When a user selects a suggested reply and edits it before sending:

1. User clicks a suggestion - it populates the editor
2. User edits the text (adds details, changes tone, fixes something)
3. User clicks Send
4. **Before sending**, a small inline prompt appears:

```
+--------------------------------------------------+
| You edited the AI suggestion. Quick note on why?  |
|                                                    |
| [ ] Tone was wrong                                |
| [ ] Missing information                           |
| [ ] Too formal / too casual                       |
| [ ] Wrong context                                 |
| [ ] Added client-specific detail                  |
| [ ] Other: [________________]                     |
|                                                    |
|              [Skip]  [Save & Send]                |
+--------------------------------------------------+
```

- Checkboxes (multi-select) + optional free text
- "Skip" sends without logging the reason (respects user's time)
- "Save & Send" logs the original, the edit, and the reason, then sends
- This only appears when the content differs from the suggestion
- Does NOT appear if user wrote from scratch (no suggestion was selected)

### What gets logged

```json
{
  "email_id": "...",
  "user_email": "rob@...",
  "original_suggestion": "Hi James, noted - will update you on the ETA.",
  "edited_version": "Hi James, noted - the revised ETA is 12th April. I'll keep you posted if anything changes.",
  "edit_reasons": ["missing_information", "added_client_detail"],
  "edit_reason_text": "Needed to include the actual date",
  "edit_distance": 0.45
}
```

This is the richest training data possible:
- The AI sees what it generated
- What the human actually wanted
- WHY the human changed it
- Specific, actionable improvement signals

Over time, the AI learns: "When replying to carrier ETA updates, include the actual date" or "Rob prefers to add reassurance about keeping them posted."

---

## Non-Goals
- Fine-tuning a custom model (overkill for this stage, prompt engineering with RAG is sufficient)
- Real-time learning (batch processing of voice profiles is fine)
- Multi-language support (English only for now)
