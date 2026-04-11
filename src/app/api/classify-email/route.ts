import { createClient } from "@supabase/supabase-js";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { CUSTOMER } from "@/config/customer";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

// POST /api/classify-email - classify a single email
export async function POST(req: Request) {
  if (!checkRateLimit(getClientIp(req))) {
    return Response.json({ error: "Too many requests. Please wait before trying again." }, { status: 429 });
  }

  const { email_id, subject, from_email, from_name, preview, to, cc } = await req.json();
  if (!email_id) return Response.json({ error: "Missing email_id" }, { status: 400 });

  // Check cache first - return ALL fields including advanced ones
  const { data: cached } = await supabase.from("email_classifications")
    .select("*").eq("email_id", email_id).single();
  if (cached) {
    return Response.json({
      classification: {
        category: cached.user_override_category || cached.ai_category,
        priority: cached.ai_priority,
        summary: cached.ai_summary,
        suggested_action: cached.ai_suggested_action,
        reply_options: cached.ai_reply_options || [],
        quote_details: cached.ai_quote_details || null,
        incident_detected: cached.ai_incident_detected || null,
      },
      cached: true,
    });
  }

  // Load past feedback to learn from
  const { data: feedback } = await supabase.from("email_classifications")
    .select("from_email, ai_category, user_override_category, user_feedback")
    .not("user_rating", "is", null)
    .order("created_at", { ascending: false })
    .limit(20);

  const feedbackContext = (feedback || []).map((f: any) =>
    `From: ${f.from_email} - AI said: ${f.ai_category}${f.user_override_category ? ` - User corrected to: ${f.user_override_category}` : ""}${f.user_feedback ? ` - Feedback: ${f.user_feedback}` : ""}`
  ).join("\n");

  // Check if sender has been classified before
  const { data: senderHistory } = await supabase.from("email_classifications")
    .select("ai_category, user_override_category")
    .eq("from_email", from_email)
    .not("user_override_category", "eq", "")
    .limit(3);

  // Load user's actual reply samples to learn their voice and approach
  const { data: writingSamples } = await supabase.from("ai_writing_samples")
    .select("original_email_subject, actual_reply, ai_suggested_reply, used_suggestion")
    .order("created_at", { ascending: false })
    .limit(10);

  const writingContext = (writingSamples || []).length > 0
    ? (writingSamples || []).map((s: any) =>
        `RE: ${s.original_email_subject} - User wrote: "${s.actual_reply.slice(0, 150)}"${s.ai_suggested_reply && !s.used_suggestion ? " (ignored AI suggestion)" : ""}`
      ).join("\n")
    : "";

  const senderPattern = senderHistory?.length
    ? `This sender has been previously classified as: ${senderHistory.map((s: any) => s.user_override_category || s.ai_category).join(", ")}`
    : "";

  const prompt = `You are an AI assistant for ${CUSTOMER.name}, ${CUSTOMER.industryDescription}. Classify this email and extract intelligence.

CLASSIFICATION CATEGORIES:
- **direct** - addressed directly to the user, requires personal response
- **action** - requires an action (rate request, booking, document needed, approval)
- **cc** - user is CC'd, informational but may need awareness
- **fyi** - system notification, automated alert, no action needed
- **marketing** - newsletter, promotional, marketing email
- **internal** - from a colleague within the same company
- **agent_request** - from another freight forwarder requesting rates or partnership info
- **quote_request** - client or prospect asking us for shipping rates/pricing
- **rfq** - formal request for quotation (structured rate request, often with specific requirements)
- **rates** - rate sheet, tariff update, pricing notification from a carrier or agent
- **recruiter** - recruitment agency, job offer, talent sourcing email

PRIORITY: urgent, high, normal, low

${feedbackContext ? `LEARNING FROM PAST CORRECTIONS (use these to improve accuracy):\n${feedbackContext}\n` : ""}
${senderPattern ? `SENDER HISTORY: ${senderPattern}\n` : ""}
${writingContext ? `USER'S ACTUAL REPLY STYLE (match this tone and approach for suggested replies):\n${writingContext}\n` : ""}

EMAIL:
From: ${from_name} (${from_email})
Subject: ${subject}
To: ${(to || []).join(", ")}
CC: ${(cc || []).join(", ")}
Preview: ${preview}

Return JSON with ALL of these fields:
{
  "category": "direct|action|cc|fyi|marketing|internal|agent_request|quote_request|rfq|rates|recruiter",
  "priority": "urgent|high|normal|low",
  "summary": "One sentence summary of what this email is about",
  "suggested_action": "What the user should do (or 'No action needed')",
  "reply_options": ["Quick reply 1 (short, professional)", "Quick reply 2 (alternative tone)", "Quick reply 3 (brief acknowledgement)"],
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

INCIDENT DETECTION RULES:
- Amber: delays, missed collections, rolled cargo, documentation errors, customs holds, late delivery, rescheduled
- Red: damage to cargo, insurance claims, lost/missing cargo, failed to fly, temperature breach, contamination, theft, demurrage disputes
- Black: total loss, bankruptcy, liquidation, failure to pay, staff misconduct, regulatory breach, fraud, HSE incidents, legal action
- Only detect incidents if the email clearly describes an operational problem. Do NOT flag routine updates or FYI emails.
- Set incident_detected to null if no incident is present.

REPLY OPTIONS RULES:
- Provide 3 DIFFERENT reply options. Each must take a genuinely different approach, not just rephrase the same thing.
- Each reply must include greeting, body paragraphs, and sign-off separated by \n\n (double newline).
- Format: "Hi [first name],\n\n[paragraph 1]\n\n[paragraph 2 if needed]\n\nKind regards"
- Option 1: ACKNOWLEDGE - brief confirmation, you're on it. 2-3 lines.
- Option 2: ACTION - specific next steps, what you will do and by when. 4-6 lines.
- Option 3: QUESTION - ask for clarification or missing info before proceeding. 3-5 lines.
- Each option should be clearly different in intent, not just length.
- Use the sender's first name in the greeting.
- Professional but warm. Standard hyphens only (-).

QUOTE DETAILS: Only populate if the email contains a rate/quote request. Set is_quote to false otherwise.

JSON only. No markdown. Standard hyphens only (-), never em dashes.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await res.json();
    let text = data.content?.[0]?.text || "{}";
    text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const classification = JSON.parse(text);

    // Save ALL fields to DB including advanced ones
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
    }, { onConflict: "email_id" });

    return Response.json({ classification, cached: false });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// PUT /api/classify-email - save user feedback (training loop)
export async function PUT(req: Request) {
  const { email_id, rating, feedback, override_category } = await req.json();
  if (!email_id) return Response.json({ error: "Missing email_id" }, { status: 400 });

  await supabase.from("email_classifications").update({
    user_rating: rating,
    user_feedback: feedback || "",
    user_override_category: override_category || "",
  }).eq("email_id", email_id);

  return Response.json({ success: true });
}
