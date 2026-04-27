import { supabase } from "@/services/base";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { complete as llmComplete, LlmGatewayError } from "@/lib/llm-gateway";

export async function POST(req: Request) {
  if (!(await checkRateLimit(getClientIp(req)))) {
    return Response.json({ error: "Too many requests. Please wait before trying again." }, { status: 429 });
  }

  const { deal_id, force_refresh } = await req.json();
  if (!deal_id) return Response.json({ error: "Missing deal_id" }, { status: 400 });

  // Check cache first (1 hour TTL)
  if (!force_refresh) {
    const { data: cached } = await supabase.from("deals")
      .select("coaching_cache, coaching_cached_at")
      .eq("id", deal_id).single();
    if (cached?.coaching_cache && cached?.coaching_cached_at) {
      const cacheAge = Date.now() - new Date(cached.coaching_cached_at).getTime();
      if (cacheAge < 60 * 60 * 1000) { // 1 hour
        return Response.json({ success: true, coaching: cached.coaching_cache, cached: true });
      }
    }
  }

  // Fetch deal + activities + enrichment
  const [dealResult, activitiesResult] = await Promise.all([
    supabase.from("deals").select("*").eq("id", deal_id).single(),
    supabase.from("activities").select("*").eq("deal_id", deal_id).order("created_at", { ascending: false }).limit(20),
  ]);

  const deal = dealResult.data;
  if (!deal) return Response.json({ error: "Deal not found" }, { status: 404 });

  const activities = activitiesResult.data || [];

  // Gather ALL context before coaching
  let enrichment = null;
  let research = null;
  let clientPerf = null;
  let notes: any[] = [];
  let contacts: any[] = [];

  // Enrichment data (prospect intel)
  if (deal.company_id) {
    const { data: e } = await supabase.from("enrichments")
      .select("commodity_summary, supply_chain_profile, vertical, angle, pain_points, current_provider, provider_confidence, suggested_approach, approach_hook, company_news")
      .eq("company_id", deal.company_id).single();
    enrichment = e;
  }

  // Client research (if existing relationship)
  if (deal.account_code) {
    const { data: r } = await supabase.from("client_research")
      .select("client_news, growth_signals, retention_risks, competitor_intel, recommended_action, account_health, insight")
      .eq("account_code", deal.account_code).single();
    research = r;

    // Performance data (are they already a client?)
    const { data: perf } = await supabase.from("client_performance")
      .select("profit_total, total_jobs, report_month, fcl_jobs, air_jobs")
      .eq("account_code", deal.account_code)
      .order("report_month", { ascending: false }).limit(6);
    if (perf && perf.length > 0) clientPerf = perf;

    // Account notes (ground truth from the team)
    const { data: n } = await supabase.from("client_notes")
      .select("note, created_at")
      .eq("account_code", deal.account_code)
      .order("created_at", { ascending: false }).limit(5);
    notes = n || [];

    // Contacts on file
    const { data: c } = await supabase.from("cargowise_contacts")
      .select("contact_name, job_title, email")
      .eq("account_code", deal.account_code)
      .eq("is_default", true).limit(3);
    contacts = c || [];
  }

  // Build activity summary
  const activitySummary = activities.slice(0, 15).map((a: any) =>
    `[${new Date(a.created_at).toLocaleDateString("en-GB")}] ${a.type}: ${a.subject}${a.body ? ` - ${a.body.slice(0, 150)}` : ""}`
  ).join("\n");

  // Determine relationship context
  const isClient = clientPerf !== null && clientPerf.length > 0;
  const totalJobs = isClient ? (clientPerf || []).reduce((s: number, r: any) => s + (r.total_jobs || 0), 0) : 0;
  const totalProfit = isClient ? (clientPerf || []).reduce((s: number, r: any) => s + (Number(r.profit_total) || 0), 0) : 0;

  const prompt = `You are an AI sales coach for Braiin, a UK freight management company. Your job is to give the sales rep ONE clear, actionable next step and context-aware coaching for THIS specific deal.

CRITICAL RULES:
- Read ALL the context below before giving advice
- Your coaching must be SPECIFIC to this company, this deal, this situation
- Reference actual data points (commodities, volumes, providers, news)
- Do NOT give generic sales advice - every recommendation must reference something from the data
- British English, standard hyphens only
- If they are an existing client, your advice should reflect the existing relationship
- If we know their current provider, reference it
- If there's recent news, use it as a conversation opener

DEAL CONTEXT:
- Title: ${deal.title}
- Company: ${deal.company_name}
- Contact: ${deal.contact_name}${deal.contact_email ? ` (${deal.contact_email})` : ""}
- Deal info: ${deal.description || "No description"}
- Stage: ${deal.stage}
- Value: £${deal.value || 0}
- Source: ${deal.source || "unknown"}
- Days in stage: ${deal.days_in_stage || 0}
- Created: ${deal.created_at ? new Date(deal.created_at).toLocaleDateString("en-GB") : "unknown"}

${isClient ? `EXISTING CLIENT RELATIONSHIP:
This company is an EXISTING Braiin client with ${totalJobs} jobs over ${(clientPerf || []).length} months, generating £${Math.round(totalProfit).toLocaleString()} profit.
Recent months: ${(clientPerf || []).slice(0, 3).map((r: any) => `${r.report_month}: ${r.total_jobs} jobs (FCL: ${r.fcl_jobs}, Air: ${r.air_jobs})`).join(", ")}
` : "This is a NEW prospect - not yet a Braiin client."}

COMMUNICATION HISTORY:
${activitySummary || "No activities logged yet - this is a fresh deal"}

${enrichment ? `COMPANY INTELLIGENCE:
- What they ship: ${enrichment.commodity_summary || "Unknown"}
- Supply chain: ${enrichment.supply_chain_profile || "Unknown"}
- Vertical: ${enrichment.vertical || "Unknown"}
- Our angle: ${enrichment.angle || "No angle identified"}
- Pain points: ${(enrichment.pain_points || []).join("; ") || "None identified"}
- Current freight provider: ${enrichment.current_provider || "Unknown"}${enrichment.provider_confidence ? ` (${enrichment.provider_confidence})` : ""}
- Suggested approach: ${enrichment.suggested_approach || "Not set"}
- Hook: ${enrichment.approach_hook || "None"}
${enrichment.company_news ? `- Recent news: ${enrichment.company_news}` : ""}` : "No enrichment data available for this company."}

${research ? `RESEARCH INTEL:
- Latest news: ${research.client_news || "None"}
- Growth signals: ${JSON.stringify(research.growth_signals || [])}
- Retention risks: ${JSON.stringify(research.retention_risks || [])}
- Competitor intel: ${research.competitor_intel || "None"}
- Recommended action: ${research.recommended_action || "None"}
- Account health: ${research.account_health || "Unknown"}
${research.insight ? `- Team insight: ${research.insight}` : ""}` : ""}

${notes.length > 0 ? `TEAM NOTES (ground truth from our team):
${notes.map((n: any) => `[${new Date(n.created_at).toLocaleDateString("en-GB")}] ${n.note}`).join("\n")}` : ""}

${contacts.length > 0 ? `KEY CONTACTS:
${contacts.map((c: any) => `${c.contact_name}${c.job_title ? ` (${c.job_title})` : ""}${c.email ? ` - ${c.email}` : ""}`).join("\n")}` : ""}

Based on ALL of the above context, return a JSON object with:
1. next_step: One specific, actionable next step referencing actual data from above (max 2 sentences)
2. talking_points: Array of 3 conversation points that reference specific data (commodities, volumes, news, pain points)
3. health_score: 0-100 based on deal momentum and completeness
4. health_reason: One sentence explaining the score, referencing specific factors
5. risks: Array of up to 2 specific risk factors from the data (not generic). Empty array if none.
6. missing_milestones: Array of specific things that should have happened by now based on the stage and time elapsed

Return JSON only.`;

  try {
    const llmResult = await llmComplete({
      purpose: "deal_coach",
      model: "claude-sonnet-4-6",
      maxTokens: 1000,
      user: prompt,
    });
    let text = llmResult.text || "{}";
    text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const coaching = JSON.parse(text);

    // Update deal health score + cache coaching
    await supabase.from("deals").update({
      health_score: coaching.health_score || 50,
      coaching_cache: coaching,
      coaching_cached_at: new Date().toISOString(),
    }).eq("id", deal_id);

    return Response.json({ success: true, coaching, cached: false });
  } catch (e: unknown) {
    if (e instanceof LlmGatewayError) {
      console.error("[deal-coach] LLM gateway error:", e.errorCode, e.message);
      return Response.json({ error: "Coach service unavailable" }, { status: 502 });
    }
    return Response.json({ error: e instanceof Error ? e.message : "Coach failed" }, { status: 500 });
  }
}
