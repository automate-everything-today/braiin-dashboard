import { supabase } from "@/services/base";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { complete as llmComplete, LlmGatewayError } from "@/lib/llm-gateway";

export async function POST(req: Request) {
  if (!(await checkRateLimit(getClientIp(req)))) {
    return Response.json({ error: "Too many requests. Please wait before trying again." }, { status: 429 });
  }

  const { account_code, contact_name, contact_email, email_type, custom_prompt } = await req.json();
  if (!account_code) return Response.json({ error: "Missing account_code" }, { status: 400 });

  // Fetch account context
  const [perfResult, researchResult, notesResult] = await Promise.all([
    supabase.from("client_performance")
      .select("report_month, total_jobs, fcl_jobs, air_jobs, lcl_jobs, bbk_jobs, fcl_teu, air_kg, profit_total")
      .eq("account_code", account_code)
      .order("report_month", { ascending: true }),
    supabase.from("client_research")
      .select("client_news, growth_signals, retention_risks, competitor_intel, recommended_action, account_health, insight")
      .eq("account_code", account_code)
      .single(),
    supabase.from("client_notes")
      .select("note, created_at")
      .eq("account_code", account_code)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const perf = perfResult.data || [];
  const research = researchResult.data;
  const notes = notesResult.data || [];

  // Get client name
  const { data: nameData } = await supabase
    .from("client_performance")
    .select("client_name")
    .eq("account_code", account_code)
    .limit(1);
  const clientName = nameData?.[0]?.client_name || account_code;

  const totalJobs = perf.reduce((s: number, r: any) => s + (r.total_jobs || 0), 0);
  const totalTeu = perf.reduce((s: number, r: any) => s + (Number(r.fcl_teu) || 0), 0);
  const months = perf.length;

  const EMAIL_TYPES: Record<string, string> = {
    rate_review: "Write a professional email requesting a rate review meeting. Reference their current volume and suggest we can offer competitive rates on their key lanes. Mention any recent market changes that could benefit them.",
    meeting_request: "Write a professional email requesting a face-to-face or video call to review their account. Reference their importance as a client and suggest discussing how we can better support their growth.",
    quarterly_review: "Write a quarterly business review email summarising their recent activity with Braiin, highlighting key metrics, and suggesting areas for improvement or expansion of services.",
    follow_up: "Write a follow-up email after a recent conversation or meeting. Keep it brief and action-oriented, referencing any commitments made.",
    introduction: "Write an introduction email from a new team member or for a new service offering. Be warm but professional, reference the existing relationship.",
    thank_you: "Write a thank you email for their continued business. Reference specific volume or milestones achieved together.",
    service_expansion: "Write an email proposing additional services we could offer (air freight, road, warehousing, customs). Reference their current usage patterns and identify gaps.",
    issue_resolution: "Write a professional email addressing a service issue or complaint. Be empathetic, take ownership, and propose a resolution.",
  };

  const typeInstruction = email_type && EMAIL_TYPES[email_type]
    ? EMAIL_TYPES[email_type]
    : custom_prompt || "Write a professional business email.";

  const prompt = `You are Rob Donald, Managing Director of Braiin. Write an email to ${contact_name || "the client"} at ${clientName}.

RULES:
- British English spelling throughout
- Standard hyphens only, never em dashes
- Professional but warm tone - this is an existing client relationship
- Keep it concise - max 200 words
- Do NOT include profit or margin data
- Sign off as Rob Donald, Managing Director, Braiin
- Include a clear call to action

INSTRUCTION: ${typeInstruction}

ACCOUNT CONTEXT:
- Client: ${clientName} (${months} months with Braiin, ${totalJobs} shipments, ${Math.round(totalTeu)} TEU)
- Recent months: ${perf.slice(-3).map((r: any) => `${r.report_month}: ${r.total_jobs} jobs`).join(", ")}
- Modes: FCL ${perf.reduce((s: number, r: any) => s + (r.fcl_jobs || 0), 0)}, Air ${perf.reduce((s: number, r: any) => s + (r.air_jobs || 0), 0)}, LCL ${perf.reduce((s: number, r: any) => s + (r.lcl_jobs || 0), 0)}, Road ${perf.reduce((s: number, r: any) => s + (r.bbk_jobs || 0), 0)}
${research?.client_news ? `- Latest news: ${research.client_news}` : ""}
${research?.recommended_action ? `- Recommended action: ${research.recommended_action}` : ""}
${research?.insight ? `- Our insight: ${research.insight}` : ""}
${notes.length > 0 ? `- Recent notes: ${notes.slice(0, 3).map((n: any) => n.note).join("; ")}` : ""}

Return a JSON object with:
- subject: email subject line
- body: the email body (use \\n for line breaks)

Return JSON only, no explanation.`;

  try {
    const llmResult = await llmComplete({
      purpose: "compose_email",
      model: "claude-sonnet-4-6",
      maxTokens: 1500,
      user: prompt,
    });
    let text = llmResult.text || "{}";
    text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const result = JSON.parse(text);

    return Response.json({ success: true, subject: result.subject, body: result.body });
  } catch (e: unknown) {
    if (e instanceof LlmGatewayError) {
      console.error("[compose-email] LLM gateway error:", e.errorCode, e.message);
      return Response.json({ error: "Draft service unavailable" }, { status: 502 });
    }
    return Response.json({ error: e instanceof Error ? e.message : "Draft failed" }, { status: 500 });
  }
}
