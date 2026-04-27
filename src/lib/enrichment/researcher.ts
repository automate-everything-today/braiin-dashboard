import { ALL_SERVICES, MODES } from "./taxonomy";
import { CUSTOMER } from "@/config/customer";
import { complete as llmComplete, LlmGatewayError } from "@/lib/llm-gateway";

const PERPLEXITY_KEY = process.env.PERPLEXITY_API_KEY || "";
const HUNTER_KEY = process.env.HUNTER_API_KEY || "";

export type ResearchResult = {
  company_name?: string;
  description?: string;
  industry?: string;
  services?: string[];
  modes?: string[];
  countries?: string[];
  ports?: string[];
  trade_lanes?: string[];
  website?: string;
  employee_count?: string;
  founded?: string;
  commodities?: string;
  certifications?: string[];
  current_logistics_provider?: string;
  competitors?: string;
  pain_points?: string;
  opportunity?: string;
  error?: string;
};

export type ContactResult = {
  email: string;
  name: string;
  position: string;
  department: string;
  confidence: number;
};

export type EnrichmentResult = {
  research: ResearchResult | null;
  contacts: ContactResult[];
};

const SERVICES_LIST = ALL_SERVICES.join(", ");
const MODES_LIST = MODES.join(", ");

function buildClaudePrompt(websiteText: string, rawResearch: string): string {
  return `You are building a company profile for a ${CUSTOMER.industry} CRM. Extract EVERYTHING useful from the website content and research below.

COMPANY WEBSITE CONTENT:
${websiteText || "Not available"}

WEB RESEARCH:
${rawResearch}

You MUST map services to these EXACT values (use only from this list):
${SERVICES_LIST}

You MUST map modes to these EXACT values (use only from this list):
${MODES_LIST}

Return JSON:
{
  "company_name": "Full legal/trading name",
  "description": "2-3 sentence description of what they do, their speciality, and their market position",
  "industry": "Their primary industry/sector",
  "services": ["ONLY values from the services list above that match what they offer"],
  "modes": ["ONLY values from the modes list above that match what they offer"],
  "countries": ["every country mentioned they operate in or ship to/from"],
  "ports": ["specific ports mentioned if any"],
  "trade_lanes": ["specific trade lanes e.g. UK-China, Europe-USA"],
  "website": "their website URL",
  "employee_count": "if mentioned",
  "founded": "year if mentioned",
  "commodities": "what types of cargo they handle or what their clients ship",
  "certifications": ["ISO, AEO, IATA, etc"],
  "current_logistics_provider": "if they mention using a specific provider",
  "competitors": "similar companies if identifiable",
  "pain_points": "specific logistics pain points based on their business type and what they ship",
  "opportunity": "specific ways ${CUSTOMER.name} (${CUSTOMER.industryDescription}) could win their business - be concrete and actionable"
}

Be thorough with services - if their website lists air freight, ocean freight, customs, warehousing etc, capture ALL of them. Map fuzzy matches (e.g. "ocean freight" = "Sea Freight", "trucking" = "Road Freight"). Standard hyphens (-) only. JSON only.`;
}

export async function researchCompany(
  companyName: string,
  domain: string,
  websiteText: string,
): Promise<ResearchResult | null> {
  if (!PERPLEXITY_KEY || !process.env.ANTHROPIC_API_KEY) {
    console.error("[enrichment] Missing PERPLEXITY_API_KEY or ANTHROPIC_API_KEY");
    return null;
  }

  const searchQuery = `${companyName || domain} freight logistics shipping company profile services countries`;

  let rawResearch = "";
  try {
    const pplxRes = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${PERPLEXITY_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: searchQuery }],
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!pplxRes.ok) {
      console.error(`[enrichment] Perplexity returned ${pplxRes.status}`);
      return { description: "Research API error" };
    }
    const pplxData = await pplxRes.json();
    rawResearch = pplxData.choices?.[0]?.message?.content || "";
  } catch (err) {
    console.error("[enrichment] Perplexity fetch failed:", err);
    return { description: "Research API timeout or error" };
  }

  if (!rawResearch) return { description: "No research data available" };

  try {
    const llmResult = await llmComplete({
      purpose: "enrichment_research",
      model: "claude-sonnet-4-6",
      maxTokens: 800,
      user: buildClaudePrompt(websiteText, rawResearch),
    });
    let text = llmResult.text || "{}";
    text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    try {
      return JSON.parse(text) as ResearchResult;
    } catch {
      return { description: rawResearch.slice(0, 500) };
    }
  } catch (err) {
    if (err instanceof LlmGatewayError) {
      console.error("[enrichment] LLM gateway error:", err.errorCode, err.message);
      return { description: rawResearch.slice(0, 500) };
    }
    console.error("[enrichment] Claude fetch failed:", err);
    return { description: rawResearch.slice(0, 500) };
  }
}

export async function findContacts(domain: string): Promise<ContactResult[]> {
  if (!HUNTER_KEY || !domain) return [];

  try {
    const res = await fetch(
      `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${HUNTER_KEY}&limit=10`,
      { signal: AbortSignal.timeout(10000) },
    );
    const data = await res.json();
    if (!data.data?.emails) return [];

    return data.data.emails.map((e: any) => ({
      email: e.value,
      name: [e.first_name, e.last_name].filter(Boolean).join(" "),
      position: e.position || "",
      department: e.department || "",
      confidence: e.confidence,
    }));
  } catch (err) {
    console.error(`[enrichment] Hunter.io failed for ${domain}:`, err);
    return [];
  }
}
