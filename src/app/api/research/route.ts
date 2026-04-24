import { supabase } from "@/services/base";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const PERPLEXITY_KEY = process.env.PERPLEXITY_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

export async function POST(req: Request) {
  if (!(await checkRateLimit(getClientIp(req)))) {
    return Response.json({ error: "Too many requests. Please wait before trying again." }, { status: 429 });
  }

  const { company_id } = await req.json();
  if (!company_id) return Response.json({ error: "Missing company_id" }, { status: 400 });
  if (!PERPLEXITY_KEY) return Response.json({ error: "No Perplexity API key" }, { status: 500 });

  // Fetch company + enrichment data
  const { data: company } = await supabase
    .from("companies")
    .select("id, company_name, company_domain, trade_type")
    .eq("id", company_id)
    .single();

  if (!company) return Response.json({ error: "Company not found" }, { status: 404 });

  const { data: enrichment } = await supabase
    .from("enrichments")
    .select("commodity_summary, supply_chain_profile, angle, pain_points, import_yeti_data")
    .eq("company_id", company_id)
    .single();

  // Step 1: Perplexity search
  const query = `Find the latest news, recent contracts, financial updates, and current freight forwarder or logistics provider for ${company.company_name} (${company.company_domain || ""}). They are a UK ${company.trade_type || "importer/exporter"} of ${enrichment?.commodity_summary || "various goods"}. Look for: press releases, Companies House filings, job postings mentioning logistics partners, LinkedIn posts about supply chain, shipping line partnerships, and any mentions of freight forwarders, customs brokers, or 3PL providers they use.`;

  let researchContent = "";
  let citations: string[] = [];
  try {
    const pRes = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${PERPLEXITY_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: query }],
        max_tokens: 1500,
        temperature: 0.1,
        return_citations: true,
      }),
    });
    const pData = await pRes.json();
    researchContent = pData.choices?.[0]?.message?.content || "";
    citations = (pData.citations || []).slice(0, 10);
  } catch (err) {
    console.error("[research] Perplexity request failed:", err);
    return Response.json({ error: "Perplexity search failed" }, { status: 502 });
  }

  if (!researchContent) return Response.json({ error: "No research returned" }, { status: 502 });

  // Step 2: Claude analysis
  let yetiSection = "";
  if (enrichment?.import_yeti_data) {
    const yd = typeof enrichment.import_yeti_data === "string"
      ? JSON.parse(enrichment.import_yeti_data) : enrichment.import_yeti_data;
    if (yd) {
      yetiSection = `IMPORT YETI DATA:\n  Shipments: ${yd.shipment_count || "N/A"}\n  Suppliers: ${(yd.suppliers || []).slice(0, 10).join(", ")}\n  Ports: ${(yd.ports || []).slice(0, 5).join(", ")}\n  Origins: ${(yd.origin_countries || []).slice(0, 5).join(", ")}\n`;
    }
  }

  const analysisPrompt = `You are a freight sales strategist for Braiin, a UK-based freight management company.

IMPORTANT RULES:
- Use British English spelling throughout (specialise, organise, colour, centre, etc.)
- Only use standard hyphens (-), never em dashes or en dashes
- Be specific and actionable, not vague

Analyse the following research about a prospect and return a JSON object with these fields:

1. company_news: 2-3 sentence summary of latest developments, financial health, growth signals. If nothing found, say "No recent news found - check Companies House for latest filings."
2. current_provider: Name of their current freight forwarder, customs broker, or 3PL. If unknown, return "Unknown".
3. provider_confidence: "confirmed" (named in source), "likely" (strong evidence/inference), or "unknown"
4. provider_source: Where you found this (e.g. "Import Yeti bill of lading", "LinkedIn job post", "Press release", "Inferred from trade patterns")
5. suggested_approach: One of: "rate-led", "service-led", "relationship-led", "expertise-led"
6. approach_hook: One compelling sentence that would make them take a call.

Return JSON only. No preamble, no markdown fences, no explanation.

COMPANY: ${company.company_name}
DOMAIN: ${company.company_domain || ""}
TRADE TYPE: ${company.trade_type || ""}
COMMODITIES: ${enrichment?.commodity_summary || ""}
SUPPLY CHAIN: ${enrichment?.supply_chain_profile || ""}
PAIN POINTS: ${(enrichment?.pain_points || []).join(", ")}
SALES ANGLE: ${enrichment?.angle || ""}
${yetiSection}
PERPLEXITY RESEARCH:
${researchContent}`;

  let analysis: any = null;
  try {
    const cRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: analysisPrompt }],
      }),
    });
    const cData = await cRes.json();
    let text = cData.content?.[0]?.text || "";
    text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    analysis = JSON.parse(text);
  } catch (err) {
    console.error("[research] Claude analysis failed:", err);
    return Response.json({ error: "Claude analysis failed" }, { status: 502 });
  }

  // Step 3: Save to enrichments
  await supabase.from("enrichments").update({
    company_news: analysis.company_news || "",
    current_provider: analysis.current_provider || "Unknown",
    provider_confidence: analysis.provider_confidence || "unknown",
    provider_source: analysis.provider_source || "",
    suggested_approach: analysis.suggested_approach || "",
    approach_hook: analysis.approach_hook || "",
    source_links: citations,
    research_date: new Date().toISOString().split("T")[0],
    researched_at: new Date().toISOString(),
  }).eq("company_id", company_id);

  return Response.json({ success: true, analysis });
}
