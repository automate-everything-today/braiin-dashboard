import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { CUSTOMER } from "@/config/customer";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

export async function POST(req: Request) {
  if (!checkRateLimit(getClientIp(req))) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const { tag, emails, userContext } = await req.json();
  if (!tag || !emails?.length) {
    return Response.json({ error: "Need tag and emails" }, { status: 400 });
  }

  if (!ANTHROPIC_KEY) {
    return Response.json({ error: "AI not configured" }, { status: 500 });
  }

  // Build the email thread for Claude
  const emailThread = emails
    .map((e: any, i: number) => {
      const body = (e.body || e.preview || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim()
        .slice(0, 1500);
      return `--- Email ${i + 1} ---
From: ${e.fromName || e.from} (${e.from})
To: ${(e.to || []).join(", ")}
Date: ${new Date(e.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
Subject: ${e.subject}

${body}`;
    })
    .join("\n\n");

  const prompt = `You are summarising a collection of ${emails.length} emails all tagged with reference "${tag}" in a CRM for ${CUSTOMER.name} (${CUSTOMER.industryDescription}).

${userContext ? `The user has provided this context: "${userContext}"\n` : ""}
EMAILS:
${emailThread}

Write a comprehensive but concise summary covering:

1. **Overview** - What is this about? What's the situation in 2-3 sentences?
2. **Key parties** - Who is involved and what is their role?
3. **Timeline** - What happened and when? List the key events chronologically.
4. **Current status** - Where does this stand now? What's outstanding?
5. **Action required** - What needs to happen next? Be specific.
${emails.length > 3 ? "6. **Risks/Issues** - Any problems, delays, or concerns flagged?" : ""}

Write in British English. Be direct and factual. Use standard hyphens (-) only. Do not use markdown headers - use the numbered format above with bold labels.`;

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
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await res.json();
    const summary = data.content?.[0]?.text || "Unable to generate summary";

    return Response.json({ summary, emailCount: emails.length, tag });
  } catch (err: any) {
    console.error("[tag-summary] Failed:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
