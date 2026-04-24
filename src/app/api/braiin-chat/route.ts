import { supabase } from "@/services/base";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { CUSTOMER } from "@/config/customer";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

export async function POST(req: Request) {
  if (!(await checkRateLimit(getClientIp(req)))) {
    return Response.json({ error: "Too many requests. Please wait before trying again." }, { status: 429 });
  }

  const { question, context_type, context_id, thread_summary, account_code, user_email } = await req.json();
  if (!question) return Response.json({ error: "Missing question" }, { status: 400 });

  // Gather context based on what we're looking at
  let contextParts: string[] = [];

  // Thread summary (email chain, deal messages, etc.)
  if (thread_summary) {
    contextParts.push(`CURRENT ${context_type?.toUpperCase() || "EMAIL"} THREAD:\n${thread_summary}`);
  }

  // Client data if we have an account code
  if (account_code) {
    const { data: perf } = await supabase.from("client_performance")
      .select("profit_total, total_jobs, report_month")
      .eq("account_code", account_code)
      .order("report_month", { ascending: false })
      .limit(12);

    if (perf && perf.length > 0) {
      const totalJobs = perf.reduce((s, r) => s + (r.total_jobs || 0), 0);
      const totalProfit = perf.reduce((s, r) => s + (Number(r.profit_total) || 0), 0);
      contextParts.push(`CLIENT PERFORMANCE (${account_code}):\n- ${totalJobs} jobs over ${perf.length} months\n- Total profit: GBP ${totalProfit.toLocaleString()}\n- Latest month: ${perf[0]?.report_month}`);
    }

    // Open deals
    const { data: deals } = await supabase.from("deals")
      .select("title, stage, value, currency")
      .eq("account_code", account_code)
      .not("stage", "in", '("Won","Lost")')
      .limit(5);

    if (deals && deals.length > 0) {
      contextParts.push(`OPEN DEALS:\n${deals.map(d => `- ${d.title} (${d.stage}) - ${d.currency} ${d.value}`).join("\n")}`);
    }

    // Recent incidents
    const { data: incidents } = await supabase.from("incidents")
      .select("severity, title, status, created_at")
      .eq("account_code", account_code)
      .order("created_at", { ascending: false })
      .limit(5);

    if (incidents && incidents.length > 0) {
      contextParts.push(`INCIDENTS:\n${incidents.map(i => `- ${i.severity.toUpperCase()}: ${i.title} (${i.status})`).join("\n")}`);
    }

    // Research
    const { data: research } = await supabase.from("client_research")
      .select("account_health, competitor_intel, is_forwarder")
      .eq("account_code", account_code)
      .single();

    if (research) {
      contextParts.push(`ACCOUNT INTEL:\n- Health: ${research.account_health || "unknown"}\n- Is forwarder: ${research.is_forwarder ? "Yes" : "No"}${research.competitor_intel ? `\n- Competitor intel: ${research.competitor_intel}` : ""}`);
    }

    // Notes
    const { data: notes } = await supabase.from("client_notes")
      .select("note, created_at")
      .eq("account_code", account_code)
      .order("created_at", { ascending: false })
      .limit(5);

    if (notes && notes.length > 0) {
      contextParts.push(`RECENT NOTES:\n${notes.map(n => `- ${n.note}`).join("\n")}`);
    }
  }

  // Email tags for this email
  if (context_id && context_type === "email") {
    const { data: tags } = await supabase.from("email_tags")
      .select("tag, party, is_primary")
      .eq("email_id", context_id);

    if (tags && tags.length > 0) {
      contextParts.push(`EMAIL TAGS: ${tags.map(t => `${t.tag}${t.party ? ` (${t.party})` : ""}${t.is_primary ? " *primary*" : ""}`).join(", ")}`);
    }
  }

  // Quote requests history
  if (account_code) {
    const { data: quotes } = await supabase.from("quote_requests")
      .select("origin, destination, mode, container_type, created_at")
      .eq("account_code", account_code)
      .order("created_at", { ascending: false })
      .limit(5);

    if (quotes && quotes.length > 0) {
      contextParts.push(`RECENT QUOTES:\n${quotes.map(q => `- ${q.origin || "?"} to ${q.destination || "?"} (${q.mode || "?"}) - ${q.created_at ? new Date(q.created_at).toLocaleDateString("en-GB") : "?"}`).join("\n")}`);
    }
  }

  const systemPrompt = `You are Braiin, the AI assistant for ${CUSTOMER.name} (${CUSTOMER.industryDescription}). You help staff by answering questions about emails, clients, deals, shipments, and operations.

You have access to the following context about what the user is currently looking at:

${contextParts.join("\n\n")}

RULES:
- Be concise and direct. Use bullet points and bold for structure.
- Reference specific data from the context (job numbers, amounts, dates).
- If you don't have enough data to answer, say so clearly - don't make up numbers.
- Use standard hyphens (-) only, never em dashes.
- Don't start with "Based on the context" or similar - just answer the question.
- If the user asks about something not in the context, suggest where to find it.`;

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
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: "user", content: question }],
      }),
    });

    const data = await res.json();
    const answer = data.content?.[0]?.text || "Sorry, I could not process that question.";

    // Determine suggested actions based on the question and context
    const actions: { id: string; label: string; icon: string }[] = [];
    const questionLower = question.toLowerCase();

    // Always available
    actions.push({ id: "draft_email", label: "Draft email", icon: "mail" });

    // Context-specific actions
    if (account_code) {
      actions.push({ id: "log_deal", label: "Log deal", icon: "kanban" });
      actions.push({ id: "log_note", label: "Add note", icon: "pencil" });
    }
    if (questionLower.includes("quote") || questionLower.includes("rate") || questionLower.includes("price")) {
      actions.push({ id: "send_wisor", label: "Send to Wisor", icon: "zap" });
      actions.push({ id: "log_quote", label: "Log quote", icon: "file-text" });
    }
    if (!account_code) {
      actions.push({ id: "create_company", label: "Create company", icon: "building" });
      actions.push({ id: "create_contact", label: "Create contact", icon: "user-plus" });
    }
    if (account_code) {
      actions.push({ id: "enrich", label: "Enrich", icon: "search" });
    }

    return Response.json({ answer, actions });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
