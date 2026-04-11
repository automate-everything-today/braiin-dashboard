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

  const { account_code, message, history } = await req.json();
  if (!account_code || !message) {
    return Response.json({ error: "Missing account_code or message" }, { status: 400 });
  }

  // Fetch all context for this client
  const [perfResult, researchResult, notesResult] = await Promise.all([
    supabase.from("client_performance")
      .select("report_month, total_jobs, fcl_jobs, lcl_jobs, air_jobs, bbk_jobs, fcl_teu, air_kg, bbk_cbm, profit_total, profit_fcl, profit_air")
      .eq("account_code", account_code)
      .order("report_month", { ascending: true }),
    supabase.from("client_research")
      .select("client_news, growth_signals, retention_risks, competitor_intel, recommended_action, account_health, is_forwarder, country")
      .eq("account_code", account_code)
      .single(),
    supabase.from("client_notes")
      .select("note, author, created_at")
      .eq("account_code", account_code)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const perf = perfResult.data || [];
  const research = researchResult.data;
  const notes = notesResult.data || [];

  // Build performance summary
  const totalProfit = perf.reduce((s: number, r: any) => s + (Number(r.profit_total) || 0), 0);
  const totalJobs = perf.reduce((s: number, r: any) => s + (r.total_jobs || 0), 0);
  const totalTeu = perf.reduce((s: number, r: any) => s + (Number(r.fcl_teu) || 0), 0);
  const totalAirKg = perf.reduce((s: number, r: any) => s + (Number(r.air_kg) || 0), 0);
  const months = perf.length;

  const perfSummary = `Performance (${months} months): Total profit £${Math.round(totalProfit).toLocaleString()}, ${totalJobs} jobs, ${Math.round(totalTeu)} TEU, ${Math.round(totalAirKg).toLocaleString()} kg air.
Monthly avg: £${Math.round(totalProfit / Math.max(months, 1)).toLocaleString()}/mo, ${Math.round(totalTeu / Math.max(months, 1))} TEU/mo.
Recent months: ${perf.slice(-3).map((r: any) => `${r.report_month}: £${Math.round(Number(r.profit_total) || 0).toLocaleString()}, ${r.total_jobs} jobs`).join(" | ")}`;

  const researchSummary = research ? `
Research Intel:
- News: ${research.client_news || "None"}
- Health: ${research.account_health || "unknown"}
- Growth signals: ${JSON.stringify(research.growth_signals || [])}
- Retention risks: ${JSON.stringify(research.retention_risks || [])}
- Competitor: ${research.competitor_intel || "None found"}
- Recommended action: ${research.recommended_action || "None"}
- Is forwarder: ${research.is_forwarder ? "Yes" : "No"}
- Country: ${research.country || "UK"}` : "No research data available yet.";

  const notesSummary = notes.length > 0
    ? "Account Notes (most recent first):\n" + notes.map((n: any) =>
        `- [${new Date(n.created_at).toLocaleDateString("en-GB")}] ${n.note}`
      ).join("\n")
    : "No account notes yet.";

  const systemPrompt = `You are the Braiin account intelligence assistant. You help account managers understand and grow their client accounts.

IMPORTANT RULES:
- Use British English spelling throughout
- Only use standard hyphens (-), never em dashes or en dashes
- Be concise and actionable - this is a sales tool, not an essay
- Reference specific data points (profit, TEU, trends) when relevant
- If the user tells you something about the account, acknowledge it and explain how it changes the picture
- If asked to do something (research, draft an email, suggest talking points), do it directly

ACCOUNT: ${account_code}
${perfSummary}

${researchSummary}

${notesSummary}`;

  // Build messages for Claude
  const messages: any[] = [];

  // Include conversation history
  if (history && Array.isArray(history)) {
    for (const h of history.slice(-10)) {
      messages.push({ role: h.role, content: h.content });
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

    if (!res.ok) {
      return Response.json({ error: `Claude error: ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const reply = data.content?.[0]?.text || "No response";

    // Auto-save user messages that contain account intel as notes
    const intelPatterns = /they use|they are|we met|spoke to|confirmed|their provider|they told|they said|contract|switched|renewal|meeting|call with|using|forwarder|competitor|switched to|currently with|just found out|update/i;
    if (intelPatterns.test(message)) {
      await supabase.from("client_notes").insert({
        account_code,
        note: message,
        author: "Rob (via chat)",
      });

      // Update client_research with new intel from the conversation
      // Ask Claude to extract structured updates
      try {
        const extractRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 500,
            messages: [{
              role: "user",
              content: `The user just told us this about client ${account_code}: "${message}"

Current research data:
- News: ${research?.client_news || ""}
- Competitor: ${research?.competitor_intel || "None found"}
- Recommended action: ${research?.recommended_action || ""}

Should we update the client research record? Return a JSON object with ONLY the fields that should change. Possible fields: client_news, competitor_intel, recommended_action, account_health (growing/stable/at_risk), insight (strategic notes about the account), ff_networks (array of freight network names e.g. ["WCA", "FIATA", "JC Trans"]). If nothing needs updating, return {}.
Return JSON only, no explanation.`
            }],
          }),
        });

        if (extractRes.ok) {
          const extractData = await extractRes.json();
          let updateText = extractData.content?.[0]?.text || "{}";
          updateText = updateText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const rawUpdates = JSON.parse(updateText);

          const ALLOWED_FIELDS = ["client_news", "competitor_intel", "recommended_action", "account_health", "insight", "ff_networks"];
          const updates: Record<string, unknown> = {};
          for (const field of ALLOWED_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(rawUpdates, field)) {
              updates[field] = rawUpdates[field];
            }
          }

          if (Object.keys(updates).length > 0) {
            await supabase.from("client_research")
              .update(updates)
              .eq("account_code", account_code);
          }
        }
      } catch {
        // Non-critical - don't fail the chat response
      }
    }

    return Response.json({ reply });
  } catch (e: any) {
    return Response.json({ error: e.message || "Chat failed" }, { status: 500 });
  }
}
