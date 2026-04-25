"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageGuard } from "@/components/page-guard";
import { toast } from "sonner";

const SERVICES = [
  { name: "Supabase", desc: "Database (PostgreSQL)", type: "Infrastructure", status: "active", details: "Frankfurt region, Pro plan, Micro compute, RLS enabled", plan: "Pro", cost: 25, billing: "monthly", usage: "382k companies, 9.7k contacts, 29 tables, ~500MB", limit: "8GB database, 250MB file storage" },
  { name: "Vercel", desc: "Hosting & Serverless", type: "Infrastructure", status: "active", details: "Hobby plan, London edge, auto-deploy from CLI", plan: "Hobby (free)", cost: 0, billing: "monthly", usage: "~5k edge requests/day, 20 function invocations", limit: "100GB bandwidth, 100hrs serverless" },
  { name: "Anthropic (Claude)", desc: "AI - Enrichment, Chat, Email Drafting", type: "AI", status: "active", details: "Claude Sonnet 4.6 - enrichment, account assistant, email composer, research analysis", plan: "Pay as you go", cost: 30, billing: "monthly est.", usage: "~500 API calls/month, enrichment + chat + drafting", limit: "$3/M input, $15/M output tokens" },
  { name: "Perplexity", desc: "AI - Company Research & News", type: "AI", status: "active", details: "Sonar model - prospect & client research, competitor detection, news", plan: "Pay as you go", cost: 10, billing: "monthly est.", usage: "~200 searches/month", limit: "$5 per 1,000 searches" },
  { name: "Apollo", desc: "Contact & Company Data", type: "Data", status: "active", details: "Contact finding, email reveal, company search, logos", plan: "Professional", cost: 79, billing: "monthly", usage: "Contact search, org enrichment, logo lookup", limit: "400 email credits/month, unlimited search" },
  { name: "Resend", desc: "Transactional Email", type: "Email", status: "active", details: "Email sending from dashboard, magic link auth", plan: "Free tier", cost: 0, billing: "monthly", usage: "Auth emails + dashboard emails", limit: "3,000 emails/month, 100/day" },
  { name: "Microsoft Graph", desc: "Email Sync (Planned)", type: "Email", status: "pending", details: "Office 365 email send/receive - awaiting Azure AD setup", plan: "Included in M365", cost: 0, billing: "included", usage: "Not yet active", limit: "Included with Office 365 licence" },
  { name: "Hunter.io", desc: "Email Verification", type: "Data", status: "active", details: "Email finding fallback when Apollo has no credits", plan: "Free tier", cost: 0, billing: "monthly", usage: "Fallback email finder", limit: "25 searches/month free" },
  { name: "Brandfetch", desc: "Company Logos", type: "Data", status: "active", details: "HD logo fetching for prospects and clients", plan: "Developer", cost: 0, billing: "monthly", usage: "Logo fetching for enrichment + clients", limit: "10 requests/minute, 1,000/month" },
  { name: "Gamma", desc: "Document Generation", type: "Documents", status: "active", details: "Internal & client report generation", plan: "Pro", cost: 16, billing: "monthly", usage: "Report generation on demand", limit: "~50 generations/month (150 credits each)" },
  { name: "Instantly", desc: "Email Sequences", type: "Outreach", status: "active", details: "Cold email sequence management", plan: "Growth", cost: 30, billing: "monthly", usage: "Cold email campaigns, sequence management", limit: "1,000 contacts, unlimited emails" },
  { name: "Twilio", desc: "Dialler & Call Recording (Planned)", type: "Calling", status: "pending", details: "Phase 4 - built-in dialler for cold calling boiler room", plan: "Pay as you go", cost: 0, billing: "per minute", usage: "Not yet active", limit: "~$0.02/min outbound UK" },
  { name: "Apify", desc: "Web Scraping", type: "Data", status: "active", details: "Import Yeti scraping via Cloudflare bypass", plan: "Pay as you go", cost: 5, billing: "monthly est.", usage: "Import Yeti company scraping", limit: "$5/month compute" },
  { name: "CloudMailin", desc: "Inbound Email Processing", type: "Email", status: "active", details: "BCC email intelligence pipeline webhook", plan: "Starter", cost: 0, billing: "monthly", usage: "BCC intel email forwarding", limit: "200 emails/month" },
  { name: "n8n Cloud", desc: "Workflow Automation", type: "Automation", status: "active", details: "BCC intel pipeline - webhook to Claude enrichment to Pipedrive", plan: "Starter", cost: 20, billing: "monthly", usage: "BCC intel workflow automation", limit: "5 active workflows" },
  { name: "Pipedrive", desc: "CRM (Being Replaced)", type: "CRM", status: "retiring", details: "Being replaced by Braiin CRM module", plan: "Professional", cost: 49, billing: "monthly per user", usage: "Deal management - migrating to Braiin", limit: "Will be cancelled after CRM migration" },
];

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  retiring: "bg-red-100 text-red-700",
  error: "bg-red-500 text-white",
};

const TYPE_COLORS: Record<string, string> = {
  Infrastructure: "bg-purple-100 text-purple-700",
  AI: "bg-blue-100 text-blue-700",
  Data: "bg-cyan-100 text-cyan-700",
  Email: "bg-green-100 text-green-700",
  Documents: "bg-orange-100 text-orange-700",
  Outreach: "bg-pink-100 text-pink-700",
  Calling: "bg-yellow-100 text-yellow-700",
  Automation: "bg-zinc-200 text-zinc-700",
  CRM: "bg-red-100 text-red-700",
};

export default function UsagePage() {
  const [dbStats, setDbStats] = useState<any>(null);

  useEffect(() => {
    async function load() {
      // Get some DB stats
      const [companies, contacts, enrichments, clients, staff, notes, emails] = await Promise.all([
        supabase.from("companies").select("*", { count: "exact", head: true }),
        supabase.from("cargowise_contacts").select("*", { count: "exact", head: true }),
        supabase.from("enrichments").select("*", { count: "exact", head: true }),
        supabase.from("client_performance").select("*", { count: "exact", head: true }),
        supabase.from("staff").select("*", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("client_notes").select("*", { count: "exact", head: true }),
        supabase.from("client_emails").select("*", { count: "exact", head: true }),
      ]);

      setDbStats({
        companies: companies.count || 0,
        contacts: contacts.count || 0,
        enrichments: enrichments.count || 0,
        client_months: clients.count || 0,
        staff: staff.count || 0,
        notes: notes.count || 0,
        emails: emails.count || 0,
      });
    }
    load();
  }, []);

  const activeCount = SERVICES.filter(s => s.status === "active").length;
  const pendingCount = SERVICES.filter(s => s.status === "pending").length;
  const totalMonthlyCost = SERVICES.reduce((s, x) => s + x.cost, 0);
  const activeCost = SERVICES.filter(s => s.status === "active").reduce((s, x) => s + x.cost, 0);
  const pendingCost = SERVICES.filter(s => s.status === "pending").reduce((s, x) => s + x.cost, 0);
  const retiringCost = SERVICES.filter(s => s.status === "retiring").reduce((s, x) => s + x.cost, 0);

  return (
    <PageGuard pageId="usage">
    <div>
      <h1 className="text-2xl font-bold mb-4">Usage & Services</h1>
      <ClassifyBatchPanel />


      {/* DB Stats */}
      {dbStats && (
        <div className="grid grid-cols-2 lg:grid-cols-7 gap-3 mb-6">
          <Card><CardContent className="pt-3 pb-2">
            <p className="text-[10px] text-zinc-400">Companies</p>
            <p className="text-lg font-bold">{dbStats.companies.toLocaleString()}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-3 pb-2">
            <p className="text-[10px] text-zinc-400">Contacts</p>
            <p className="text-lg font-bold">{dbStats.contacts.toLocaleString()}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-3 pb-2">
            <p className="text-[10px] text-zinc-400">Enriched</p>
            <p className="text-lg font-bold">{dbStats.enrichments.toLocaleString()}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-3 pb-2">
            <p className="text-[10px] text-zinc-400">Client Records</p>
            <p className="text-lg font-bold">{dbStats.client_months.toLocaleString()}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-3 pb-2">
            <p className="text-[10px] text-zinc-400">Staff</p>
            <p className="text-lg font-bold">{dbStats.staff}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-3 pb-2">
            <p className="text-[10px] text-zinc-400">Notes</p>
            <p className="text-lg font-bold">{dbStats.notes}</p>
          </CardContent></Card>
          <Card><CardContent className="pt-3 pb-2">
            <p className="text-[10px] text-zinc-400">Emails Sent</p>
            <p className="text-lg font-bold">{dbStats.emails}</p>
          </CardContent></Card>
        </div>
      )}

      {/* Budget summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-zinc-400">Monthly Total</p>
          <p className="text-lg font-bold">£{totalMonthlyCost}/mo</p>
          <p className="text-[10px] text-zinc-400">£{totalMonthlyCost * 12}/year</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-green-600">Active Services</p>
          <p className="text-lg font-bold text-green-700">£{activeCost}/mo</p>
          <p className="text-[10px] text-zinc-400">{activeCount} services</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-yellow-600">Pending (planned)</p>
          <p className="text-lg font-bold text-yellow-700">£{pendingCost}/mo</p>
          <p className="text-[10px] text-zinc-400">{pendingCount} services</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-red-600">Retiring (savings)</p>
          <p className="text-lg font-bold text-red-600">-£{retiringCost}/mo</p>
          <p className="text-[10px] text-zinc-400">After CRM migration</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-zinc-400">Post-Migration</p>
          <p className="text-lg font-bold">£{activeCost - retiringCost}/mo</p>
          <p className="text-[10px] text-zinc-400">£{(activeCost - retiringCost) * 12}/year</p>
        </CardContent></Card>
      </div>

      {/* Services grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {SERVICES.map((s, i) => (
          <Card key={i} className={s.status === "retiring" ? "opacity-60" : ""}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{s.name}</CardTitle>
                <div className="flex gap-1">
                  <Badge className={`${TYPE_COLORS[s.type] || "bg-zinc-100"} text-[9px]`}>{s.type}</Badge>
                  <Badge className={`${STATUS_COLORS[s.status]} text-[9px]`}>{s.status}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-medium text-zinc-700">{s.desc}</p>
              <div className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Plan:</span>
                  <span className="font-medium">{s.plan}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Cost:</span>
                  <span className="font-medium">{s.cost > 0 ? `£${s.cost}/${s.billing}` : "Free"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Usage:</span>
                  <span className="text-zinc-600">{s.usage}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Limit:</span>
                  <span className="text-zinc-400">{s.limit}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
    </PageGuard>
  );
}

type ClassifyBatch = {
  id: number;
  anthropic_batch_id: string;
  email_ids: string[];
  status: "in_progress" | "completed" | "canceled" | "expired" | "errored";
  submitted_by: string;
  submitted_at: string;
  completed_at: string | null;
  request_count: number;
  succeeded_count: number;
  errored_count: number;
};

/**
 * Admin panel for the cheap-bulk classify-batch path. Shows recent
 * batches and a "Re-classify legacy rows" button that picks every email
 * with NULL ai_tags or ai_conversation_stage and submits them in one
 * batch to Anthropic at ~50% per-token cost. Cron polls every 5 minutes
 * and writes results back when ready (typically 5-30 min).
 */
function ClassifyBatchPanel() {
  const [batches, setBatches] = useState<ClassifyBatch[]>([]);
  const [staleCount, setStaleCount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const r = await fetch("/api/classify-batch");
      const d = await r.json();
      if (r.ok) setBatches(d.batches || []);

      // Count rows that would benefit from a reclassify pass.
      const { count: missingTags } = await supabase
        .from("email_classifications")
        .select("*", { count: "exact", head: true })
        .is("ai_tags", null);
      const { count: missingStage } = await supabase
        .from("email_classifications")
        .select("*", { count: "exact", head: true })
        .is("ai_conversation_stage", null);
      setStaleCount(Math.max(missingTags || 0, missingStage || 0));
    } catch (e) {
      console.warn("[usage] load batches failed:", e);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submitBackfill() {
    if (submitting) return;
    setSubmitting(true);
    const submittingToast = toast.loading("Finding stale rows...");
    try {
      // Query the missing-tags / missing-stage email ids client-side via
      // RLS-bypassing service role isn't an option here, so use the API.
      // Pulling them through Supabase JS works because the email_classifications
      // table is read-allowed.
      const { data, error } = await supabase
        .from("email_classifications")
        .select("email_id, ai_tags, ai_conversation_stage")
        .or("ai_tags.is.null,ai_conversation_stage.is.null")
        .limit(1000);
      if (error) throw new Error(error.message);
      const ids = (((data || []) as unknown) as Array<{ email_id?: string }>)
        .map((r) => r.email_id || "")
        .filter(Boolean);
      if (ids.length === 0) {
        toast.success("Nothing to backfill - all rows have tags + stage", { id: submittingToast });
        return;
      }
      toast.loading(`Submitting batch of ${ids.length} emails...`, { id: submittingToast });

      const res = await fetch("/api/classify-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_ids: ids }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Batch submission failed");
      toast.success(
        `Batch of ${ids.length} submitted - cron will write results when ready (5-30 min typical)`,
        { id: submittingToast, duration: 8000 },
      );
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Backfill failed", { id: submittingToast });
    } finally {
      setSubmitting(false);
    }
  }

  async function pollNow() {
    const t = toast.loading("Polling open batches...");
    try {
      const res = await fetch("/api/classify-batch?all=open");
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Poll failed");
      toast.success(`Polled ${d.batches?.length ?? 0} batches`, { id: t });
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Poll failed", { id: t });
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-sm">Bulk classify (Anthropic Batch API)</CardTitle>
            <p className="text-[11px] text-zinc-500">
              Re-classify legacy or stale rows at ~50% the per-token cost. Cron polls every 5 minutes; results land within 5-30 minutes typically (24h SLA).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={submitBackfill}
              disabled={submitting || staleCount === 0}
              className="bg-[#ff3366] hover:bg-[#e6004d] text-xs"
            >
              {submitting ? "Submitting..." : staleCount === null ? "Checking..." : `Reclassify ${staleCount} stale rows`}
            </Button>
            <Button size="sm" variant="outline" onClick={pollNow} className="text-xs">
              Poll now
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {batches.length === 0 ? (
          <p className="text-[11px] text-zinc-400">No batches yet.</p>
        ) : (
          <div className="space-y-1">
            {batches.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2 text-[11px] border-b border-zinc-100 py-1">
                <div className="flex items-center gap-2">
                  <Badge className={
                    b.status === "completed"
                      ? "bg-emerald-100 text-emerald-700"
                      : b.status === "in_progress"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-zinc-200 text-zinc-700"
                  }>{b.status}</Badge>
                  <span className="text-zinc-700">{b.request_count} requests</span>
                  <span className="text-zinc-400">·</span>
                  <span className="text-zinc-500">submitted {new Date(b.submitted_at).toLocaleString("en-GB")}</span>
                  {b.completed_at && (
                    <>
                      <span className="text-zinc-400">·</span>
                      <span className="text-zinc-500">{b.succeeded_count} ok / {b.errored_count} err</span>
                    </>
                  )}
                </div>
                <span className="text-zinc-400 font-mono text-[9px]">{b.anthropic_batch_id.slice(0, 24)}...</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
