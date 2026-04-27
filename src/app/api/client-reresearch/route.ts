import { supabase } from "@/services/base";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { complete as llmComplete, LlmGatewayError } from "@/lib/llm-gateway";

const PERPLEXITY_KEY = process.env.PERPLEXITY_API_KEY || "";

export async function POST(req: Request) {
  if (!(await checkRateLimit(getClientIp(req)))) {
    return Response.json({ error: "Too many requests. Please wait before trying again." }, { status: 429 });
  }

  const { account_code } = await req.json();
  if (!account_code) return Response.json({ error: "Missing account_code" }, { status: 400 });
  if (!PERPLEXITY_KEY) return Response.json({ error: "No Perplexity API key" }, { status: 500 });

  // Fetch client name
  const { data: perfData } = await supabase
    .from("client_performance")
    .select("client_name, account_code")
    .eq("account_code", account_code)
    .limit(1);

  const clientName = perfData?.[0]?.client_name || account_code;

  // Fetch existing notes for context
  const { data: notesData } = await supabase
    .from("client_notes")
    .select("note, created_at")
    .eq("account_code", account_code)
    .order("created_at", { ascending: false })
    .limit(10);

  const notesContext = (notesData || []).map((n: any) =>
    `[${new Date(n.created_at).toLocaleDateString("en-GB")}] ${n.note}`
  ).join("\n");

  // Step 1: Perplexity search
  const query = `Find the latest news, recent contracts, financial updates, expansion plans, and any logistics or supply chain developments for ${clientName}. Look for: press releases, Companies House filings, new product launches, new warehouse or office openings, M&A activity, new markets entered, key hires, financial results.`;

  let researchContent = "";
  let citations: string[] = [];
  try {
    const pRes = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${PERPLEXITY_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar", messages: [{ role: "user", content: query }],
        max_tokens: 1500, temperature: 0.1, return_citations: true,
      }),
    });
    const pData = await pRes.json();
    researchContent = pData.choices?.[0]?.message?.content || "";
    citations = (pData.citations || []).slice(0, 10);
  } catch {
    return Response.json({ error: "Perplexity search failed" }, { status: 502 });
  }

  if (!researchContent) return Response.json({ error: "No research returned" }, { status: 502 });

  // Step 2: Claude analysis
  const prompt = `You are a freight account strategist for Braiin. Analyse this EXISTING client and return JSON.

RULES: British English, standard hyphens only, be specific.

Fields:
1. client_news: 2-3 sentences on latest developments relevant to freight
2. growth_signals: Array of 3 specific growth opportunities
3. retention_risks: Array of up to 2 threats (empty if none)
4. competitor_intel: Name of any competing forwarder/3PL, or "None found"
5. recommended_action: One specific next step (max 2 sentences)
6. account_health: "growing", "stable", or "at_risk"
7. ff_networks: If this is a freight forwarder, list any freight networks they are members of (e.g. WCA, FIATA, JC Trans, Globalink, PANCO, OOG Network, etc.). Return empty array if not a forwarder or unknown.

Return JSON only.

CLIENT: ${clientName}
${notesContext ? `\nACCOUNT NOTES:\n${notesContext}\n` : ""}
PERPLEXITY RESEARCH:
${researchContent}`;

  try {
    const llmResult = await llmComplete({
      purpose: "client_reresearch",
      model: "claude-sonnet-4-6",
      maxTokens: 1500,
      user: prompt,
    });
    let text = llmResult.text || "{}";
    text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const analysis = JSON.parse(text);

    // Save to client_research
    const today = new Date().toISOString().split("T")[0];
    await supabase.from("client_research").upsert({
      account_code,
      client_news: analysis.client_news || "",
      growth_signals: analysis.growth_signals || [],
      retention_risks: analysis.retention_risks || [],
      competitor_intel: analysis.competitor_intel || "None found",
      recommended_action: analysis.recommended_action || "",
      account_health: analysis.account_health || "stable",
      ff_networks: analysis.ff_networks || [],
      source_links: citations,
      research_date: today,
      researched_at: new Date().toISOString(),
    }, { onConflict: "account_code" });

    return Response.json({ success: true, analysis, citations, research_date: today });
  } catch {
    return Response.json({ error: "Claude analysis failed" }, { status: 502 });
  }
}
