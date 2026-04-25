import { CUSTOMER } from "@/config/customer";

/**
 * Static classifier rules. Cached for 5 minutes via cache_control on the
 * system block so that within a burst of classifications we only pay full
 * price on the first call. Same prompt used by the synchronous
 * /api/classify-email POST and the async batch path - keeping it in one
 * place stops the two prompts drifting apart.
 */
export const CLASSIFIER_RULES = `You are an AI assistant for ${CUSTOMER.name}, ${CUSTOMER.industryDescription}. Classify each email the user sends you and extract intelligence.

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

export const CLASSIFY_MODEL = "claude-haiku-4-5-20251001";
export const CLASSIFY_MAX_TOKENS = 800;
const BODY_MAX_CHARS = 4000;

/**
 * Build the per-email user message for the classifier given just the email
 * payload. Used by the batch path where we don't have - and don't need -
 * the full sync-time context (per-user voice rules, sender history etc.).
 * The sync path keeps its own richer assembly because hot-path classifies
 * benefit from the extra signals; batch is a bulk healing tool where the
 * cost saving matters more than per-row prompt richness.
 */
export function buildBatchUserMessage(email: {
  subject?: string | null;
  from_email?: string | null;
  from_name?: string | null;
  preview?: string | null;
  body?: string | null;
  to?: string[] | null;
  cc?: string[] | null;
  network_match?: { name: string; relationship: string } | null;
}): string {
  const stripHtml = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const bodyText = email.body
    ? stripHtml(String(email.body)).slice(0, BODY_MAX_CHARS).trim()
    : "";
  const networkBlock = email.network_match
    ? `SENDER NETWORK MATCH: this sender's domain belongs to a freight network. Set category=network. Network: ${email.network_match.name}; relationship: ${email.network_match.relationship}.\n\n`
    : "";
  return `${networkBlock}EMAIL:
From: ${email.from_name || ""} (${email.from_email || ""})
Subject: ${email.subject || ""}
To: ${(email.to || []).join(", ")}
CC: ${(email.cc || []).join(", ")}
Preview: ${email.preview || ""}
${bodyText ? `\nBody:\n${bodyText}\n` : ""}

Classify this email per the rules above and return JSON.`;
}
