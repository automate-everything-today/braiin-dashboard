import { supabase } from "@/services/base";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const GAMMA_KEY = process.env.GAMMA_API_KEY || "";

export async function POST(req: Request) {
  if (!(await checkRateLimit(getClientIp(req)))) {
    return Response.json({ error: "Too many requests. Please wait before trying again." }, { status: 429 });
  }

  const { account_code, report_type } = await req.json();
  if (!account_code || !report_type) {
    return Response.json({ error: "Missing account_code or report_type" }, { status: 400 });
  }
  if (!GAMMA_KEY) return Response.json({ error: "No Gamma API key" }, { status: 500 });

  // Fetch all client data
  const [perfResult, researchResult, notesResult] = await Promise.all([
    supabase.from("client_performance")
      .select("report_month, total_jobs, fcl_jobs, lcl_jobs, air_jobs, bbk_jobs, fcl_teu, air_kg, bbk_cbm, profit_total, profit_fcl, profit_air")
      .eq("account_code", account_code)
      .order("report_month", { ascending: true }),
    supabase.from("client_research")
      .select("client_news, growth_signals, retention_risks, competitor_intel, recommended_action, account_health")
      .eq("account_code", account_code)
      .single(),
    supabase.from("client_notes")
      .select("note, author, created_at")
      .eq("account_code", account_code)
      .order("created_at", { ascending: false })
      .limit(15),
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

  // Build performance summary
  const totalJobs = perf.reduce((s: number, r: any) => s + (r.total_jobs || 0), 0);
  const totalTeu = perf.reduce((s: number, r: any) => s + (Number(r.fcl_teu) || 0), 0);
  const totalAirKg = perf.reduce((s: number, r: any) => s + (Number(r.air_kg) || 0), 0);
  const totalProfit = perf.reduce((s: number, r: any) => s + (Number(r.profit_total) || 0), 0);
  const months = perf.length;

  // Monthly breakdown for charts
  const monthlyData = perf.map((r: any) => ({
    month: r.report_month,
    jobs: r.total_jobs || 0,
    teu: Number(r.fcl_teu) || 0,
    air_kg: Number(r.air_kg) || 0,
  }));

  // Generate report content with Claude
  const isInternal = report_type === "internal";

  const reportPrompt = isInternal
    ? `Generate an INTERNAL account review document for Braiin management about client: ${clientName}.

Include:
- Account overview and tier classification
- Performance summary: ${totalJobs} jobs, ${Math.round(totalTeu)} TEU, ${Math.round(totalAirKg).toLocaleString()} kg air freight over ${months} months
- Monthly profit: £${Math.round(totalProfit).toLocaleString()} total, £${Math.round(totalProfit / Math.max(months, 1)).toLocaleString()}/mo average
- Profit breakdown: FCL £${perf.reduce((s: number, r: any) => s + (Number(r.profit_fcl) || 0), 0).toLocaleString()}, Air £${perf.reduce((s: number, r: any) => s + (Number(r.profit_air) || 0), 0).toLocaleString()}
- Volume trends (last 3 months): ${monthlyData.slice(-3).map((m: any) => `${m.month}: ${m.jobs} jobs, ${m.teu} TEU`).join("; ")}
- Research intel: ${research?.client_news || "No research data"}
- Growth signals: ${JSON.stringify(research?.growth_signals || [])}
- Retention risks: ${JSON.stringify(research?.retention_risks || [])}
- Competitor intel: ${research?.competitor_intel || "None"}
- Recommended actions: ${research?.recommended_action || "None"}
- Account notes: ${notes.slice(0, 5).map((n: any) => n.note).join("; ") || "None"}

Format as a professional internal review. Include specific numbers. Use British English, standard hyphens only.`
    : `Generate an EXTERNAL client report/proposal for ${clientName} from Braiin.

This is a document we send TO the client. DO NOT include any internal profit data, margins, or financial performance.

Include:
- Partnership overview - how Braiin supports their supply chain
- Service summary: ${totalJobs} shipments managed over ${months} months
- Volume handled: ${Math.round(totalTeu)} TEU ocean, ${Math.round(totalAirKg).toLocaleString()} kg air freight
- Mode breakdown: FCL ${perf.reduce((s: number, r: any) => s + (r.fcl_jobs || 0), 0)} shipments, Air ${perf.reduce((s: number, r: any) => s + (r.air_jobs || 0), 0)} shipments, LCL ${perf.reduce((s: number, r: any) => s + (r.lcl_jobs || 0), 0)} shipments
- Service capabilities relevant to their business
- Recommendations for optimising their supply chain
- Braiin's value proposition: Manchester hub, pharma/retail/projects expertise, technology platform

Tone: professional, confident, data-driven. Use British English, standard hyphens only. NO internal financial data.`;

  let reportContent = "";
  try {
    const cRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6", max_tokens: 3000,
        messages: [{ role: "user", content: reportPrompt }],
      }),
    });
    const cData = await cRes.json();
    reportContent = cData.content?.[0]?.text || "";
  } catch {
    return Response.json({ error: "Report generation failed" }, { status: 502 });
  }

  // Push to Gamma
  try {
    const gammaRes = await fetch("https://public-api.gamma.app/v1.0/generations", {
      method: "POST",
      headers: {
        "X-API-KEY": GAMMA_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputText: reportContent,
        textMode: "preserve",
        format: "document",
        numCards: isInternal ? 8 : 6,
        additionalInstructions: `Professional freight logistics ${isInternal ? "internal review" : "client report"}. Use clean, modern design. Braiin branding.`,
        textOptions: {
          amount: "detailed",
          tone: "professional",
          language: "en",
        },
        imageOptions: {
          source: "webFreeToUse",
          style: "professional logistics freight shipping",
        },
        cardOptions: {
          dimensions: "a4",
        },
      }),
    });

    const gammaData = await gammaRes.json();

    if (!gammaData.generationId) {
      return Response.json({ error: "Gamma generation failed", details: gammaData }, { status: 502 });
    }

    // Poll for completion
    let gammaUrl = "";
    let exportUrl = "";
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const statusRes = await fetch(
        `https://public-api.gamma.app/v1.0/generations/${gammaData.generationId}`,
        { headers: { "X-API-KEY": GAMMA_KEY } }
      );
      const statusData = await statusRes.json();

      if (statusData.status === "completed") {
        gammaUrl = statusData.gammaUrl || "";
        exportUrl = statusData.exportUrl || "";
        break;
      }
      if (statusData.status === "failed") {
        return Response.json({ error: "Gamma generation failed" }, { status: 502 });
      }
    }

    return Response.json({
      success: true,
      gammaUrl,
      exportUrl,
      generationId: gammaData.generationId,
      reportType: report_type,
    });
  } catch (e: any) {
    return Response.json({ error: `Gamma error: ${e.message}` }, { status: 502 });
  }
}
