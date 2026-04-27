import { supabase } from "@/services/base";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { CUSTOMER, isInternalEmail } from "@/config/customer";
import { getSession } from "@/lib/session";
import { stripHtml } from "@/types/email";
import {
  loadReplyRules,
  formatRulesBlock,
  recordRulesUsage,
  getUserMode,
} from "@/lib/reply-rules";
import { ALL_TAGS, normaliseTags } from "@/lib/relevance-tags";
import {
  CONVERSATION_STAGES,
  normaliseStage,
  isConversationStage,
  type ConversationStage,
} from "@/lib/conversation-stages";
import { findNetworkByEmail, describeNetworkForPrompt } from "@/lib/freight-networks";
import { complete as llmComplete, LlmGatewayError } from "@/lib/llm-gateway";
import { expandShorthand } from "@/lib/shorthand";

const MODEL = "claude-haiku-4-5-20251001";
const BODY_MAX_CHARS = 4000;

/**
 * Static classifier rules. Cached for 5 minutes via cache_control on the
 * system block so that within a burst of classifications (which is the
 * common case - user opening multiple emails in a row) we only pay full
 * price on the first call.
 */
const CLASSIFIER_RULES = `You are an AI assistant for ${CUSTOMER.name}, ${CUSTOMER.industryDescription}. Classify each email the user sends you and extract intelligence.

CLASSIFICATION CATEGORIES:
- **direct** - addressed directly to the user, requires personal response
- **action** - requires an action (rate request, booking, document needed, approval)
- **cc** - user is CC'd, informational but may need awareness
- **fyi** - system notification, automated alert, no action needed
- **marketing** - newsletter, promotional, marketing email
- **internal** - from a colleague within the same company
- **agent_request** - from another freight forwarder requesting rates on a SPECIFIC SHIPMENT (commercial transaction). Subject usually mentions a quote, lane, or commodity.
- **quote_request** - client or prospect asking us for shipping rates/pricing on a SPECIFIC SHIPMENT
- **rfq** - formal request for quotation (structured rate request, often with specific requirements)
- **rates** - rate sheet, tariff update, pricing notification from a carrier or agent
- **recruiter** - recruitment agency, job offer, talent sourcing email
- **network** - from a freight forwarding NETWORK or trade association (WCA, Globalia, JCtrans, X2, FIATA, project cargo networks etc.). Their business is membership and events. Typical content: invitations to join the network, conference/AGM/regional event invitations, member directory updates, network newsletters, match-making introductions to other members. NOT a client asking us to ship cargo. If a SENDER NETWORK MATCH block is present in the user message, this category is almost certainly correct.

PRIORITY: urgent, high, normal, low

OUTPUT SCHEMA:
{
  "category": "direct|action|cc|fyi|marketing|internal|agent_request|quote_request|rfq|rates|recruiter|network",
  "priority": "urgent|high|normal|low",
  "summary": "One sentence summary of what this email is about",
  "suggested_action": "What the user should do (or 'No action needed')",
  "reply_options": ["Quick reply 1 (short, professional)", "Quick reply 2 (alternative tone)", "Quick reply 3 (brief acknowledgement)"],
  "tags": ["zero or more of: Ops, Sales, Accounts, Air, Road, Sea, Warehousing"],
  "conversation_stage": "one of: lead, quote_request, awaiting_info, quote_sent, quote_follow_up, quote_secured, booked, live_shipment, exception, delivered, invoicing, paid, closed, or null",
  "quote_details": {
    "is_quote": true/false,
    "origin": "port or country (or null)",
    "destination": "port or country (or null)",
    "mode": "FCL|LCL|Air|Road|null",
    "container_type": "20ft|40ft|40HQ|null",
    "volume": "e.g. 2x40HQ, 500kg (or null)",
    "commodity": "what they are shipping (or null)",
    "incoterms": "FOB|CIF|EXW|etc (or null)",
    "urgency": "date or timeframe (or null)",
    "missing": ["list of key details needed to quote"]
  },
  "incident_detected": null or {
    "severity": "amber|red|black",
    "category": "delay|failed_collection|rolled|short_shipped|documentation_error|customs_hold|damage|lost_cargo|failed_to_fly|temperature_breach|contamination|claim|demurrage|theft|bankruptcy|failure_to_pay|staff_misconduct|regulatory_breach|hse|fraud|other",
    "title": "Short description of the incident",
    "confidence": 0.0-1.0
  }
}

CONVERSATION STAGE RULES:
- conversation_stage is where this email's THREAD sits in a freight lifecycle. Pick ONE stage from the list, or null if the email isn't part of a trackable lifecycle (internal admin, marketing, FYI, recruiter, spam).
- lead: a new contact who has not yet asked for a quote or raised a specific job. Introductions, prospecting replies, casual "saw your company" emails.
- quote_request: the sender is asking for a quote, rate, or pricing. Initial rate enquiry, RFQ received.
- awaiting_info: WE have asked the sender for missing details (dimensions, dates, incoterms, consignee) and are waiting on them.
- quote_sent: WE have sent pricing or a proposal and the sender has not yet responded or acknowledged.
- quote_follow_up: WE are chasing the sender for a response to a quote we already sent. Nudge emails, "just checking in", "is this still live?".
- quote_secured: the sender has confirmed the quote, awarded the business, or accepted pricing. Booking is starting.
- booked: shipment confirmed and scheduled, but cargo has not yet moved. Pre-departure paperwork, consignment notes, booking confirmations.
- live_shipment: cargo is in transit. Tracking updates, ETAs, carrier status, vessel/flight progress.
- exception: something has gone wrong at any stage - delay, missed collection, rolled cargo, damage, claim, customs hold, documentation error, temperature breach, failure to pay, black/red/amber incidents. When in doubt and the email describes a problem, pick exception.
- delivered: cargo has arrived or been delivered, now awaiting invoicing.
- invoicing: in the billing stage - invoice issued, credit note, statement, reconciliation query.
- paid: invoice has been settled. Remittance advice, payment confirmation.
- closed: the thread is complete. "Thanks, all sorted", final closure, archive signal.
- Use the SUBJECT + BODY + SENDER HISTORY to pick. When a thread is clearly about an existing shipment, prefer live_shipment / delivered / invoicing / paid in that order based on the latest signal. exception overrides any other stage if a problem has been raised and is unresolved.
- Output the raw lowercase-snake code (e.g. "quote_follow_up"), not the display label ("Waiting Follow-Up").

TAG RULES:
- tags is an array. Include every department and mode this email's CONTENT genuinely spans. Return [] if none apply.
- Department tags (pick 0+): Ops (operational execution - bookings, documentation, tracking, incidents), Sales (new business, quote requests, RFQs, prospect enquiries, commercial), Accounts (invoicing, payments, credit, statements, finance).
- Mode tags (pick 0+): Air (air freight), Sea (ocean: FCL, LCL, reefer, project cargo), Road (UK / European trucking, groupage, domestic), Warehousing (storage, pick/pack, inventory, 3PL).
- An email often spans multiple tags. A "quote for 2x40HQ Shanghai to Felixstowe" is ["Sales","Sea"]. An overdue invoice from a sea carrier is ["Accounts","Sea"]. A complex job carrying air and sea legs with a billing query could be ["Accounts","Air","Sea"].
- Use ALL evidence: subject, sender, body keywords, incoterms, trade lane, commodity, attached references.
- Use only the exact tag strings listed above. No synonyms, no lowercase, no extra tags.

INCIDENT DETECTION RULES:
- Amber: delays, missed collections, rolled cargo, documentation errors, customs holds, late delivery, rescheduled
- Red: damage to cargo, insurance claims, lost/missing cargo, failed to fly, temperature breach, contamination, theft, demurrage disputes
- Black: total loss, bankruptcy, liquidation, failure to pay, staff misconduct, regulatory breach, fraud, HSE incidents, legal action
- Only detect incidents if the email clearly describes an operational problem. Do NOT flag routine updates or FYI emails.
- Set incident_detected to null if no incident is present.

REPLY OPTIONS RULES:
- Provide 3 DIFFERENT reply options. Each must take a genuinely different approach, not just rephrase the same thing.
- Each reply must include greeting, body paragraphs, and sign-off separated by \\n\\n (double newline).
- Format: "Hi [first name],\\n\\n[paragraph 1]\\n\\n[paragraph 2 if needed]\\n\\nKind regards"
- Option 1: ACKNOWLEDGE - brief confirmation, you're on it. 2-3 lines.
- Option 2: ACTION - specific next steps, what you will do and by when. 4-6 lines.
- Option 3: QUESTION - ask for clarification or missing info before proceeding. 3-5 lines.
- Each option should be clearly different in intent, not just length.
- Use the sender's first name in the greeting.
- Professional but warm. Standard hyphens only (-).

QUOTE DETAILS: Only populate if the email contains a rate/quote request. Set is_quote to false otherwise.

JSON only. No markdown. Standard hyphens only (-), never em dashes.`;

type LowValueMatch = { category: string; priority: string; summary: string } | null;

const ALLOWED_TAGS_SET = new Set<string>(ALL_TAGS);

/**
 * Detect emails we can confidently classify without an API call. Saves ~20%
 * of Anthropic spend by short-circuiting obvious routing messages. Only match
 * high-confidence patterns - false positives here mean a real email gets
 * wrongly bucketed as fyi.
 */
function matchLowValuePattern(subject: string, fromEmail: string, preview: string): LowValueMatch {
  const s = (subject || "").toLowerCase().trim();
  const f = (fromEmail || "").toLowerCase();
  const p = (preview || "").toLowerCase().slice(0, 200);

  // Out-of-office / auto-reply
  if (
    s.startsWith("automatic reply") ||
    s.startsWith("auto-reply") ||
    s.startsWith("out of office") ||
    s.startsWith("ooo") ||
    s.includes("i am out of office") ||
    s.includes("i am currently out") ||
    p.includes("out of the office") ||
    p.includes("i am out of the office") ||
    p.includes("am currently out of office")
  ) {
    return { category: "fyi", priority: "low", summary: "Auto-reply: sender is out of office" };
  }

  // Delivery failures / bounces
  if (
    s.startsWith("undeliverable") ||
    s.startsWith("delivery status notification") ||
    s.startsWith("mail delivery failed") ||
    s.startsWith("returned mail") ||
    f === "postmaster@" || f.startsWith("mailer-daemon@") || f.startsWith("postmaster@")
  ) {
    return { category: "action", priority: "normal", summary: "Email delivery failed - recipient may be invalid" };
  }

  // Calendar responses (Accepted:, Declined:, Tentative:, Cancelled:)
  if (/^(accepted|declined|tentative|cancelled):/i.test(s)) {
    return { category: "fyi", priority: "low", summary: "Meeting response" };
  }

  // Read receipts
  if (s.startsWith("read:") || s.startsWith("receipt:")) {
    return { category: "fyi", priority: "low", summary: "Read receipt" };
  }

  return null;
}

// POST /api/classify-email - classify a single email, OR bulk-fetch already
// classified emails when `{ bulk: { ids: [...] } }` is sent. We overload the
// POST method because Outlook message IDs are ~180 chars each and a 200-id
// query string blows past the 8KB URL cap. Bulk response shape mirrors the
// in-memory classifications map so the client can merge it directly.
//
// Rate limit: authenticated users are bucketed per email with a 300/min cap
// (enough for a one-off background backfill across a mailbox). Unauthenticated
// callers stay on the strict 30/min per-IP default so the endpoint isn't a
// soft DoS vector.
export async function POST(req: Request) {
  // Rate-limit bucket depends on whether the caller is authenticated.
  // Authenticated users get a per-user bucket with a 300/min cap so the
  // background backfill (typically 5/sec for a few seconds on first load)
  // doesn't trip the limiter. Unauthenticated traffic still gets the strict
  // default IP bucket.
  const session = await getSession();
  const rateBucket = session?.email ? `user:${session.email.toLowerCase()}` : getClientIp(req);
  const rateLimit = session?.email ? 300 : 30;
  if (!(await checkRateLimit(rateBucket, rateLimit))) {
    return Response.json({ error: "Too many requests. Please wait before trying again." }, { status: 429 });
  }

  const reqBody = await req.json();

  // Bulk hydration path. Exists on POST because Outlook message IDs are too
  // long for a query string at typical batch sizes. Requires authentication -
  // an unauthenticated caller has no business knowing which email_ids exist.
  if (reqBody && reqBody.bulk && Array.isArray(reqBody.bulk.ids)) {
    if (!session?.email) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    const ids = (reqBody.bulk.ids as unknown[])
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .slice(0, 500);
    if (ids.length === 0) return Response.json({ classifications: {} });
    const { data, error } = await supabase
      .from("email_classifications")
      .select("*")
      .in("email_id", ids);
    if (error) {
      console.error("[classify-email] bulk hydrate failed:", error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }
    const out: Record<string, unknown> = {};
    for (const row of (data || []) as Array<Record<string, unknown>>) {
      const emailId = row.email_id as string | undefined;
      if (!emailId) continue;
      const aiTags = Array.isArray(row.ai_tags) ? (row.ai_tags as string[]) : [];
      const userTags = Array.isArray(row.user_tags) ? (row.user_tags as string[]) : null;
      const aiStage = isConversationStage(row.ai_conversation_stage) ? row.ai_conversation_stage as ConversationStage : null;
      const userStage = isConversationStage(row.user_conversation_stage) ? row.user_conversation_stage as ConversationStage : null;
      out[emailId] = {
        category: (row.user_override_category as string) || (row.ai_category as string) || "",
        priority: row.ai_priority,
        summary: row.ai_summary,
        suggested_action: row.ai_suggested_action,
        reply_options: row.ai_reply_options || [],
        quote_details: row.ai_quote_details || null,
        incident_detected: row.ai_incident_detected || null,
        ai_tags: aiTags,
        user_tags: userTags,
        effective_tags: (userTags && userTags.length > 0) ? userTags : aiTags,
        relevance_feedback: (row.relevance_feedback as string) ?? null,
        ai_conversation_stage: aiStage,
        user_conversation_stage: userStage,
        effective_conversation_stage: userStage ?? aiStage,
      };
    }
    return Response.json({ classifications: out });
  }

  const { email_id, subject, from_email, from_name, preview, body, to, cc } = reqBody || {};
  if (!email_id) return Response.json({ error: "Missing email_id" }, { status: 400 });

  const bodyText = body ? stripHtml(String(body)).slice(0, BODY_MAX_CHARS).trim() : "";

  // Check cache first - return ALL fields including advanced ones.
  // If the cached row has an empty summary AND no user override, treat it as
  // a stale default and re-classify so the user gets a real summary instead
  // of a blank bubble.
  //
  // Also treat `ai_tags IS NULL` as stale. NULL means the row was classified
  // before migration 012 (tags feature). Missing tags hides critical routing
  // info in the UI, which wastes more time than the one-off re-classify
  // costs. After this runs once per legacy row, ai_tags becomes an array
  // (possibly empty if the email genuinely has no tags) and this check
  // returns false forever - so no wasted credits on normal reopens.
  const { data: cached } = await supabase.from("email_classifications")
    .select("*").eq("email_id", email_id).single();
  const cachedHasTags = cached && Array.isArray((cached as { ai_tags?: string[] | null }).ai_tags);
  // Stage staleness: null ai_conversation_stage means this row was classified
  // before migration 013. Re-classify once to populate the stage, then the
  // row is "fixed" (even a legitimate null value on non-shipment mail would
  // re-appear post-classify, so the re-runs are bounded to legacy rows).
  const cachedStageRaw = cached
    ? (cached as { ai_conversation_stage?: string | null; user_conversation_stage?: string | null })
    : null;
  const cachedHasStageSignal =
    !!(cachedStageRaw?.ai_conversation_stage || cachedStageRaw?.user_conversation_stage);
  // Network-mismatch staleness: if the sender's domain belongs to a known
  // freight network but the cached row says it's not a network email, the
  // cached classification predates the freight_networks directory (or the
  // sender was added to it later). Reclassify once so the next render
  // shows the right category. After it runs, ai_category becomes 'network'
  // and this check passes silently on every subsequent open.
  const matchedNetworkForCache = cached
    ? await findNetworkByEmail((cached as { from_email?: string | null }).from_email || from_email || "")
    : null;
  const cachedNetworkMismatch =
    matchedNetworkForCache && cached && cached.ai_category !== "network" && !cached.user_override_category;
  const cachedIsEmpty =
    cached &&
    !cached.user_override_category &&
    (!cached.ai_summary || !cachedHasTags || !cachedHasStageSignal || cachedNetworkMismatch);
  if (cached && !cachedIsEmpty) {
    const cachedTags = cached as { ai_tags?: string[] | null; user_tags?: string[] | null; relevance_feedback?: string | null };
    const aiStage = isConversationStage(cachedStageRaw?.ai_conversation_stage) ? cachedStageRaw.ai_conversation_stage as ConversationStage : null;
    const userStage = isConversationStage(cachedStageRaw?.user_conversation_stage) ? cachedStageRaw.user_conversation_stage as ConversationStage : null;
    return Response.json({
      classification: {
        category: cached.user_override_category || cached.ai_category,
        priority: cached.ai_priority,
        summary: cached.ai_summary,
        suggested_action: cached.ai_suggested_action,
        reply_options: cached.ai_reply_options || [],
        quote_details: cached.ai_quote_details || null,
        incident_detected: cached.ai_incident_detected || null,
        ai_tags: cachedTags.ai_tags || [],
        user_tags: cachedTags.user_tags || null,
        effective_tags: (cachedTags.user_tags && cachedTags.user_tags.length > 0)
          ? cachedTags.user_tags
          : (cachedTags.ai_tags || []),
        relevance_feedback: cachedTags.relevance_feedback ?? null,
        ai_conversation_stage: aiStage,
        user_conversation_stage: userStage,
        effective_conversation_stage: userStage ?? aiStage,
      },
      cached: true,
    });
  }

  // Short-circuit obvious low-value messages without an API call
  const lowValue = matchLowValuePattern(subject || "", from_email || "", preview || "");
  if (lowValue) {
    await supabase.from("email_classifications").upsert({
      email_id,
      subject: subject || "",
      from_email: from_email || "",
      from_name: from_name || "",
      ai_category: lowValue.category,
      ai_priority: lowValue.priority,
      ai_summary: lowValue.summary,
      ai_suggested_action: "No action needed",
      ai_reply_options: [],
      ai_quote_details: null,
      ai_incident_detected: null,
    }, { onConflict: "email_id" });
    return Response.json({
      classification: {
        category: lowValue.category,
        priority: lowValue.priority,
        summary: lowValue.summary,
        suggested_action: "No action needed",
        reply_options: [],
        quote_details: null,
        incident_detected: null,
      },
      cached: false,
      skipped_ai: true,
    });
  }

  // Load past feedback to learn from
  const { data: feedback } = await supabase.from("email_classifications")
    .select("from_email, ai_category, user_override_category, user_feedback")
    .not("user_rating", "is", null)
    .order("created_at", { ascending: false })
    .limit(20);

  type FeedbackRow = {
    from_email: string | null;
    ai_category: string | null;
    user_override_category: string | null;
    user_feedback: string | null;
  };
  const feedbackContext = ((feedback || []) as FeedbackRow[]).map((f) =>
    `From: ${f.from_email} - AI said: ${f.ai_category}${f.user_override_category ? ` - User corrected to: ${f.user_override_category}` : ""}${f.user_feedback ? ` - Feedback: ${f.user_feedback}` : ""}`
  ).join("\n");

  // Check if sender has been classified before
  const { data: senderHistory } = await supabase.from("email_classifications")
    .select("ai_category, user_override_category")
    .eq("from_email", from_email)
    .not("user_override_category", "eq", "")
    .limit(3);

  // Tag history: look at recent classifications from this sender (or their
  // domain) and surface any consistent manual tag overrides. If the user
  // keeps moving this sender's mail to Accounts even though AI tagged it
  // Sales, that pattern should bias the next classification. This is the
  // "learning from tag corrections" signal Rob asked for.
  const senderDomain = (from_email || "").toLowerCase().split("@")[1] || null;
  const tagHistoryQuery = supabase
    .from("email_classifications")
    .select("user_tags, ai_tags, relevance_feedback, from_email")
    .order("created_at", { ascending: false })
    .limit(20);
  const { data: tagHistoryRows } = senderDomain
    ? await tagHistoryQuery.or(`from_email.eq.${from_email},from_email.like.%@${senderDomain}`)
    : await tagHistoryQuery.eq("from_email", from_email || "");

  const tagFrequency = new Map<string, { overrides: number; thumbsUp: number; aiOnly: number }>();
  for (const row of (tagHistoryRows || []) as Array<{
    user_tags?: string[] | null;
    ai_tags?: string[] | null;
    relevance_feedback?: string | null;
  }>) {
    const hasOverride = Array.isArray(row.user_tags) && row.user_tags.length > 0;
    const effective = hasOverride ? row.user_tags! : (row.ai_tags || []);
    for (const tag of effective) {
      if (!tag) continue;
      const bucket = tagFrequency.get(tag) || { overrides: 0, thumbsUp: 0, aiOnly: 0 };
      if (hasOverride) bucket.overrides += 1;
      else if (row.relevance_feedback === "thumbs_up") bucket.thumbsUp += 1;
      else bucket.aiOnly += 1;
      tagFrequency.set(tag, bucket);
    }
  }
  const topTagPatterns = Array.from(tagFrequency.entries())
    .map(([tag, counts]) => ({
      tag,
      weight: counts.overrides * 3 + counts.thumbsUp * 2 + counts.aiOnly,
      counts,
    }))
    .filter((p) => p.weight >= 2)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4);
  const tagHistoryBlock = topTagPatterns.length > 0
    ? `SENDER TAG HISTORY (strong hints for 'tags' output - users have repeatedly assigned these to mail from ${senderDomain || from_email}):\n${topTagPatterns.map((p) => `- ${p.tag} (manually applied ${p.counts.overrides}x, confirmed ${p.counts.thumbsUp}x)`).join("\n")}\n`
    : "";

  // Network match: if the sender's domain belongs to a known freight
  // network (WCA, Globalia, JCtrans, etc.) we tell the model directly so
  // these emails stop getting bucketed as quote_request / agent_request.
  // Networks are membership organisations - their email is about events
  // and joining, not about shipping cargo.
  const matchedNetwork = await findNetworkByEmail(from_email || "");
  const networkBlock = matchedNetwork
    ? `SENDER NETWORK MATCH: this sender's domain belongs to a freight network. Set category=network. Network: ${describeNetworkForPrompt(matchedNetwork)}.\n`
    : "";

  // Cross-team writing-voice corpus. Pulls recent reply samples from every
  // Corten staff member who hasn't opted out, so the AI learns the
  // organisation's house style - not just one user's. Privacy guardrails:
  //   1. ai_writing_samples is only populated when the SENDER had
  //      ai_learning_enabled=true (handled in /api/email-sync POST).
  //   2. Other staff's classify-email runs only see your samples if you
  //      ALSO have ai_learning_share_team=true (default true). Set to
  //      false in /profile to keep your replies private to your own AI.
  //   3. Each sample carries the sender's name + department in the prompt
  //      attribution so Claude knows which staff member's voice to learn.
  const currentUserEmail = (session?.email || "").toLowerCase();
  const { data: writingSamples } = await supabase
    .from("ai_writing_samples")
    .select("user_email, original_email_subject, actual_reply, ai_suggested_reply, used_suggestion, original_email_from")
    .order("created_at", { ascending: false })
    .limit(60); // pull more then filter client-side - simpler than a join

  // Resolve each sample's sender against staff (for dept/name attribution)
  // and user_preferences (for the share-with-team gate).
  const sampleEmails = Array.from(
    new Set(((writingSamples || []) as Array<{ user_email?: string }>)
      .map((s) => (s.user_email || "").toLowerCase())
      .filter(Boolean)),
  );
  type StaffRow = { email?: string | null; name?: string | null; department?: string | null };
  type PrefsRow = { email?: string | null; ai_learning_enabled?: boolean | null; ai_learning_share_team?: boolean | null };
  const [{ data: staffRows }, { data: prefsRows }] = await Promise.all([
    sampleEmails.length > 0
      ? supabase.from("staff").select("email, name, department").in("email", sampleEmails)
      : Promise.resolve({ data: [] as StaffRow[] }),
    sampleEmails.length > 0
      ? supabase.from("user_preferences").select("email, ai_learning_enabled, ai_learning_share_team").in("email", sampleEmails)
      : Promise.resolve({ data: [] as PrefsRow[] }),
  ]);
  const staffByEmail = new Map<string, StaffRow>();
  for (const r of (staffRows || []) as StaffRow[]) {
    if (r.email) staffByEmail.set(r.email.toLowerCase(), r);
  }
  const prefsByEmail = new Map<string, PrefsRow>();
  for (const r of (prefsRows || []) as PrefsRow[]) {
    if (r.email) prefsByEmail.set(r.email.toLowerCase(), r);
  }

  const eligibleSamples: Array<{
    user_email: string;
    senderName: string;
    senderDept: string | null;
    actual_reply: string;
    original_email_subject: string;
    used_suggestion: boolean;
  }> = [];
  for (const s of (writingSamples || []) as Array<{
    user_email?: string | null;
    original_email_subject?: string | null;
    actual_reply?: string | null;
    ai_suggested_reply?: string | null;
    used_suggestion?: boolean | null;
    original_email_from?: string | null;
  }>) {
    const sampleSender = (s.user_email || "").toLowerCase();
    if (!sampleSender || !s.actual_reply) continue;
    const isSelf = sampleSender === currentUserEmail;
    const prefs = prefsByEmail.get(sampleSender);
    const learningOn = prefs?.ai_learning_enabled !== false;
    const shareOn = prefs?.ai_learning_share_team !== false;
    if (!learningOn) continue; // honour their opt-out
    if (!isSelf && !shareOn) continue; // honour their no-share preference
    // Skip internal-to-internal: replies that went TO another Corten staff
    // member aren't useful patterns for client-facing reply suggestions.
    if (isInternalEmail(s.original_email_from || "")) continue;
    const staff = staffByEmail.get(sampleSender);
    eligibleSamples.push({
      user_email: sampleSender,
      senderName: staff?.name || sampleSender.split("@")[0],
      senderDept: staff?.department || null,
      actual_reply: s.actual_reply,
      original_email_subject: s.original_email_subject || "",
      used_suggestion: !!s.used_suggestion,
    });
    if (eligibleSamples.length >= 12) break;
  }

  const writingContext = eligibleSamples.length > 0
    ? eligibleSamples
        .map((s) => {
          const attribution = s.senderDept
            ? `${s.senderName} (${s.senderDept})`
            : s.senderName;
          return `RE: ${s.original_email_subject} - ${attribution} wrote: "${s.actual_reply.slice(0, 150)}"`;
        })
        .join("\n")
    : "";

  type SenderHistoryRow = {
    user_override_category: string | null;
    ai_category: string | null;
  };
  const senderPattern = senderHistory?.length
    ? `This sender has been previously classified as: ${(senderHistory as SenderHistoryRow[]).map((s) => s.user_override_category || s.ai_category).join(", ")}`
    : "";

  // Layered reply rules: pulled from reply_rules at six scope levels
  // (category, user, mode, department, branch, global). Most specific rules
  // appear first in the prompt so Claude prefers them on conflict.
  //
  // Department / mode scopes are driven by the email's CONTENT tags, not
  // the author's home assignment. Tags can be many (e.g. ['Accounts','Sea']
  // for a Sea shipment in invoicing), so one email can pull rules from
  // multiple departments / modes in one pass.
  //
  // Source of truth for tags:
  //   1. user_tags (manual override) - if set, always wins
  //   2. ai_tags   (Claude's detection) - used when no manual override
  //   3. user's home department + mode - fallback when no classification
  //      has run yet (first-pass bootstrap)
  const userEmail = session?.email ?? null;
  const branch = session?.branch ?? null;
  const priorCategory = (cached?.user_override_category || cached?.ai_category) || null;
  const cachedTagRow = cached as
    | { ai_tags?: string[] | null; user_tags?: string[] | null }
    | null;
  let effectiveTags = cachedTagRow?.user_tags?.length
    ? cachedTagRow.user_tags
    : cachedTagRow?.ai_tags?.length
      ? cachedTagRow.ai_tags
      : [];
  if (effectiveTags.length === 0) {
    const homeDept = session?.department ?? null;
    const homeMode = userEmail ? await getUserMode(userEmail) : null;
    effectiveTags = [homeDept, homeMode].filter(
      (v): v is string => !!v && ALLOWED_TAGS_SET.has(v),
    );
  }
  const rules = await loadReplyRules({
    userEmail,
    category: priorCategory,
    tags: effectiveTags,
    branch,
  });
  const voiceBlock = formatRulesBlock(rules);

  // Build the per-email user message. System prompt (the big rulebook) is
  // separate and cached; only this dynamic part pays full token cost on
  // every call.
  const userMessage = `${voiceBlock}${feedbackContext ? `LEARNING FROM PAST CORRECTIONS:\n${feedbackContext}\n\n` : ""}${senderPattern ? `SENDER HISTORY: ${senderPattern}\n\n` : ""}${networkBlock ? `${networkBlock}\n` : ""}${tagHistoryBlock ? `${tagHistoryBlock}\n` : ""}${writingContext ? `USER'S ACTUAL REPLY STYLE:\n${writingContext}\n\n` : ""}EMAIL:
From: ${from_name} (${from_email})
Subject: ${subject}
To: ${(to || []).join(", ")}
CC: ${(cc || []).join(", ")}
Preview: ${preview}
${bodyText ? `\nBody:\n${bodyText}\n` : ""}

Classify this email per the rules above and return JSON.`;

  // Inline freight-shorthand expansion (engiine RFC 3.4). Replaces bare
  // codes like "FXT" / "DDP" / "MAERSK" with "FXT (Felixstowe)" etc on
  // first occurrence so the model has the unambiguous expansion alongside
  // the jargon. Failures degrade to the raw message - we warn loudly but
  // never block classification on vocab issues.
  let promptForLlm = userMessage;
  try {
    promptForLlm = await expandShorthand(userMessage, { firstOnly: true });
  } catch (err) {
    console.warn(
      "[classify-email/shorthand] expand failed, falling back to raw text:",
      err instanceof Error ? err.message : err,
    );
  }

  try {
    const llmResult = await llmComplete({
      purpose: "classify_email",
      model: MODEL,
      maxTokens: 800,
      // Static classifier rules cached for 5 minutes via Anthropic's
      // ephemeral prompt cache. First call in a burst pays full price,
      // subsequent calls within 5 min pay ~10%.
      system: { text: CLASSIFIER_RULES, cacheControl: "ephemeral" },
      user: promptForLlm,
      requestedBy: session?.email ?? "service_role",
    });

    let text = llmResult.text || "{}";
    text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const classification = JSON.parse(text);

    // Normalise tags + stage against the controlled vocabularies so
    // malformed model output can never poison rule matching, the DB
    // CHECK constraints, or the stages dashboard.
    const aiTags = normaliseTags(classification.tags);
    const aiStage = normaliseStage(classification.conversation_stage);

    // Save ALL fields to DB including advanced ones (migrations 012 + 013
    // columns are picked up via database-extensions.ts).
    await supabase.from("email_classifications").upsert({
      email_id,
      subject: subject || "",
      from_email: from_email || "",
      from_name: from_name || "",
      ai_category: classification.category || "fyi",
      ai_priority: classification.priority || "normal",
      ai_summary: classification.summary || "",
      ai_suggested_action: classification.suggested_action || "",
      ai_reply_options: classification.reply_options || [],
      ai_quote_details: classification.quote_details || null,
      ai_incident_detected: classification.incident_detected || null,
      ai_tags: aiTags,
      ai_conversation_stage: aiStage,
    }, { onConflict: "email_id" });

    // Best-effort usage tracking so managers can see which rules are live.
    if (rules.length > 0) {
      void recordRulesUsage(rules.map((r) => r.id));
    }

    return Response.json({
      classification: {
        ...classification,
        ai_tags: aiTags,
        user_tags: null,
        effective_tags: aiTags,
        relevance_feedback: null,
        ai_conversation_stage: aiStage,
        user_conversation_stage: null,
        effective_conversation_stage: aiStage,
      },
      cached: false,
    });
  } catch (e: unknown) {
    // LLM-side failure (network, provider 4xx/5xx) is a 502 - the
    // service is reachable, we just can't classify right now.
    if (e instanceof LlmGatewayError) {
      console.error("[classify-email] LLM gateway error:", e.errorCode, e.message);
      return Response.json({ error: "Classification service unavailable" }, { status: 502 });
    }
    // Anything else is a 500 - log full server-side, generic message
    // to the client so we don't leak DB error strings, stack traces,
    // or internal IDs in responses.
    console.error("[classify-email] Unexpected failure:", e);
    return Response.json({ error: "Classification failed. Please try again." }, { status: 500 });
  }
}

// PUT /api/classify-email - save user feedback (training loop). Accepts any
// subset of:
//   - rating / feedback / override_category (original category feedback)
//   - user_tags: string[]       (set the manual override tags for this email)
//   - relevance_feedback: 'thumbs_up' | null (positive reinforcement signal)
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session?.email) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json();
  const { email_id, rating, feedback, override_category, user_tags, relevance_feedback, user_conversation_stage } = body;
  if (!email_id) return Response.json({ error: "Missing email_id" }, { status: 400 });

  const updates: {
    user_rating?: string | null;
    user_feedback?: string | null;
    user_override_category?: string | null;
    user_tags?: string[] | null;
    relevance_feedback?: "thumbs_up" | "thumbs_down" | null;
    user_conversation_stage?: string | null;
    last_modified_by?: string;
    last_modified_at?: string;
  } = {};
  if (rating !== undefined) updates.user_rating = rating;
  if (feedback !== undefined) updates.user_feedback = feedback || "";
  if (override_category !== undefined) updates.user_override_category = override_category || "";

  if (user_tags !== undefined) {
    if (user_tags === null) {
      updates.user_tags = null;
    } else if (Array.isArray(user_tags)) {
      updates.user_tags = normaliseTags(user_tags);
    } else {
      return Response.json({ error: "user_tags must be an array or null" }, { status: 400 });
    }
  }

  if (relevance_feedback !== undefined) {
    if (relevance_feedback === null) {
      updates.relevance_feedback = null;
    } else if (relevance_feedback === "thumbs_up" || relevance_feedback === "thumbs_down") {
      updates.relevance_feedback = relevance_feedback;
    } else {
      return Response.json({ error: "relevance_feedback must be 'thumbs_up', 'thumbs_down', or null" }, { status: 400 });
    }
  }

  if (user_conversation_stage !== undefined) {
    if (user_conversation_stage === null) {
      updates.user_conversation_stage = null;
    } else {
      const stage = normaliseStage(user_conversation_stage);
      if (!stage) {
        return Response.json({
          error: `user_conversation_stage must be one of: ${CONVERSATION_STAGES.join(", ")}, or null`,
        }, { status: 400 });
      }
      updates.user_conversation_stage = stage;
    }
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "No updates provided" }, { status: 400 });
  }

  // Audit who made the change. email_classifications rows are shared
  // across the team (one row per email_id, no per-user override table
  // yet), so anyone authenticated can overwrite anyone else's overrides.
  // Stamping last_modified_by + last_modified_at gives us traceability
  // until the per-user override schema lands.
  updates.last_modified_by = session.email.toLowerCase();
  updates.last_modified_at = new Date().toISOString();

  const { error } = await supabase
    .from("email_classifications")
    .update(updates)
    .eq("email_id", email_id);

  if (error) {
    console.error(`[classify-email] PUT failed for email_id=${email_id}:`, error.message);
    return Response.json({ error: "Update failed. Please try again." }, { status: 500 });
  }

  return Response.json({ success: true });
}

