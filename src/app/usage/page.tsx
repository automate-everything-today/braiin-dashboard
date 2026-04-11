"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageGuard } from "@/components/page-guard";

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
