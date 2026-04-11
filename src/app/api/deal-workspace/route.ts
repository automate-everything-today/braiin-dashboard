import { createClient } from "@supabase/supabase-js";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

export async function POST(req: Request) {
  if (!checkRateLimit(getClientIp(req))) {
    return Response.json({ error: "Too many requests. Please wait before trying again." }, { status: 429 });
  }

  const { deal_id, message, history } = await req.json();
  if (!deal_id || !message) return Response.json({ error: "Missing deal_id or message" }, { status: 400 });

  // Fetch deal
  const { data: deal } = await supabase.from("deals").select("*").eq("id", deal_id).single();
  if (!deal) return Response.json({ error: "Deal not found" }, { status: 404 });

  // Save user message to thread
  await supabase.from("deal_messages").insert({
    deal_id,
    type: "user",
    content: message,
  });

  // Gather context
  let enrichment = null;
  let research = null;
  let clientPerf = null;
  let notes: string[] = [];
  let contacts: any[] = [];

  if (deal.company_id) {
    const { data: e } = await supabase.from("enrichments")
      .select("commodity_summary, supply_chain_profile, vertical, angle, pain_points, current_provider, provider_confidence, suggested_approach, approach_hook, company_news")
      .eq("company_id", deal.company_id).single();
    enrichment = e;
  }

  if (deal.account_code) {
    const { data: r } = await supabase.from("client_research")
      .select("client_news, growth_signals, retention_risks, competitor_intel, recommended_action, account_health, insight")
      .eq("account_code", deal.account_code).single();
    research = r;

    const { data: perf } = await supabase.from("client_performance")
      .select("profit_total, total_jobs, report_month, fcl_jobs, air_jobs, lcl_jobs, bbk_jobs")
      .eq("account_code", deal.account_code)
      .order("report_month", { ascending: false }).limit(6);
    if (perf && perf.length > 0) clientPerf = perf;

    const { data: n } = await supabase.from("client_notes")
      .select("note").eq("account_code", deal.account_code)
      .order("created_at", { ascending: false }).limit(5);
    notes = (n || []).map((x: any) => x.note);

    const { data: c } = await supabase.from("cargowise_contacts")
      .select("contact_name, job_title, email, phone")
      .eq("account_code", deal.account_code).limit(5);
    contacts = c || [];
  }

  // Build context
  const isClient = clientPerf && clientPerf.length > 0;
  const totalJobs = isClient ? clientPerf!.reduce((s: number, r: any) => s + (r.total_jobs || 0), 0) : 0;
  const totalProfit = isClient ? clientPerf!.reduce((s: number, r: any) => s + (Number(r.profit_total) || 0), 0) : 0;

  const systemPrompt = `You are the Braiin deal assistant. You help sales reps work their deals through natural conversation.

STYLE RULES:
- Clean, minimal responses. No coloured text markers.
- Use bullet points and **bold** for emphasis
- Standard hyphens only (-), never em dashes or en dashes
- British English throughout
- Be concise - this is a sales tool, not an essay
- When you take actions (create task, move stage, log note), confirm briefly what you did
- When answering questions, reference specific data points
- If you don't know something, say so and suggest how to find out

AVAILABLE ACTIONS (tell the user when you take one):
- Log a note on the deal
- Create a follow-up task
- Move the deal to a different stage
- Draft an email for review
- Forward rate request to Wisor (quote@wisor.ai)
- Research the company via Perplexity

When the user pastes an email or describes a conversation:
- Extract key information (names, routes, volumes, dates, pricing mentions)
- Identify any commitments or action items
- Suggest the logical next step
- If relevant, create tasks automatically

DEAL CONTEXT:
- Title: ${deal.title}
- Company: ${deal.company_name}
- Contact: ${deal.contact_name}${deal.contact_email ? ` (${deal.contact_email})` : ""}
- Deal info: ${deal.description || "No description yet"}
- Stage: ${deal.stage || "Lead"}
- Value: ${deal.value ? `GBP ${deal.value}` : "Not set"}
- Source: ${deal.source || "Unknown"}
- Days in stage: ${deal.days_in_stage || 0}

${isClient ? `EXISTING CLIENT:
- ${totalJobs} jobs over ${(clientPerf || []).length} months
- GBP ${Math.round(totalProfit).toLocaleString()} total profit
- Recent: ${(clientPerf || []).slice(0, 3).map((r: any) => `${r.report_month}: ${r.total_jobs} jobs`).join(", ")}
- Modes: FCL ${(clientPerf || []).reduce((s: number, r: any) => s + (r.fcl_jobs || 0), 0)}, Air ${(clientPerf || []).reduce((s: number, r: any) => s + (r.air_jobs || 0), 0)}, LCL ${(clientPerf || []).reduce((s: number, r: any) => s + (r.lcl_jobs || 0), 0)}, Road ${(clientPerf || []).reduce((s: number, r: any) => s + (r.bbk_jobs || 0), 0)}
` : "NEW PROSPECT - not yet a client."}

${enrichment ? `INTELLIGENCE:
- Ships: ${enrichment.commodity_summary || "Unknown"}
- Supply chain: ${enrichment.supply_chain_profile || "Unknown"}
- Our angle: ${enrichment.angle || "Not identified"}
- Pain points: ${(enrichment.pain_points || []).join("; ") || "None identified"}
- Current provider: ${enrichment.current_provider || "Unknown"}
- Suggested approach: ${enrichment.suggested_approach || "Not set"}
${enrichment.company_news ? `- News: ${enrichment.company_news}` : ""}` : "No enrichment data available."}

${research ? `RESEARCH:
- News: ${research.client_news || "None"}
- Health: ${research.account_health || "Unknown"}
- Growth signals: ${JSON.stringify(research.growth_signals || [])}
- Risks: ${JSON.stringify(research.retention_risks || [])}
- Competitor: ${research.competitor_intel || "None"}
${research.insight ? `- Team insight: ${research.insight}` : ""}` : ""}

${notes.length > 0 ? `TEAM NOTES:\n${notes.map(n => `- ${n}`).join("\n")}` : ""}

${contacts.length > 0 ? `CONTACTS ON FILE:\n${contacts.map((c: any) => `- ${c.contact_name}${c.job_title ? ` (${c.job_title})` : ""}${c.email ? ` - ${c.email}` : ""}${c.phone ? ` - ${c.phone}` : ""}`).join("\n")}` : ""}`;

  // Build messages
  const messages: any[] = [];
  if (history && Array.isArray(history)) {
    for (const h of history.slice(-15)) {
      messages.push({ role: h.role === "user" ? "user" : "assistant", content: h.content });
    }
  }
  messages.push({ role: "user", content: message });

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
        max_tokens: 1500,
        system: systemPrompt,
        messages,
      }),
    });

    const data = await res.json();
    const reply = data.content?.[0]?.text || "I couldn't process that. Try again.";

    // Save AI response to thread
    await supabase.from("deal_messages").insert({
      deal_id,
      type: "ai",
      content: reply,
    });

    // Also log as activity on the deal
    await supabase.from("activities").insert({
      deal_id,
      account_code: deal.account_code || "",
      type: "note",
      subject: message.slice(0, 100),
      body: reply.slice(0, 500),
    });

    // Auto-detect and execute actions from the message
    const lowerMsg = message.toLowerCase();

    // Auto-create task if message mentions follow-up
    if (/follow up|follow-up|call back|chase|remind me|task:/i.test(lowerMsg)) {
      const dueDate = new Date();
      if (/tomorrow/i.test(lowerMsg)) dueDate.setDate(dueDate.getDate() + 1);
      else if (/thursday/i.test(lowerMsg)) { while (dueDate.getDay() !== 4) dueDate.setDate(dueDate.getDate() + 1); }
      else if (/friday/i.test(lowerMsg)) { while (dueDate.getDay() !== 5) dueDate.setDate(dueDate.getDate() + 1); }
      else if (/monday/i.test(lowerMsg)) { while (dueDate.getDay() !== 1) dueDate.setDate(dueDate.getDate() + 1); }
      else if (/next week/i.test(lowerMsg)) dueDate.setDate(dueDate.getDate() + 7);
      else dueDate.setDate(dueDate.getDate() + 2); // default: 2 days

      await supabase.from("tasks").insert({
        title: `Follow up: ${deal.title}`,
        deal_id,
        account_code: deal.account_code || "",
        assigned_to: deal.assigned_to || "",
        due_date: dueDate.toISOString().split("T")[0],
        priority: "medium",
        status: "open",
        auto_generated: true,
        source: "deal_chat",
      });
    }

    // Auto-save intel as note
    const intelPatterns = /they use|they are|spoke to|confirmed|their provider|they told|contract|switched|meeting with|called|met with/i;
    if (intelPatterns.test(message) && deal.account_code) {
      await supabase.from("client_notes").insert({
        account_code: deal.account_code,
        note: message,
        author: "Deal workspace",
      });
    }

    return Response.json({ reply });
  } catch (e: any) {
    return Response.json({ error: e.message || "Chat failed" }, { status: 500 });
  }
}
