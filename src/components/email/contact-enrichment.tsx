"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Building, UserPlus, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { SERVICE_TYPES, MODES, COUNTRIES, canAccessEnrichment } from "@/lib/enrichment/taxonomy";
import { isInternalEmail } from "@/config/customer";

type Props = {
  senderEmail: string;
  senderName: string;
  matchedAccount?: string | null;
  matchedCompany?: string | null;
  userRole?: string;
  emailBody?: string;
};

const CURRENCIES = ["GBP", "USD", "EUR", "AED", "SGD", "CNY", "INR", "TRY"];

function MultiSelect({ label, options, selected, onChange, placeholder }: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()) && !selected.includes(o));

  return (
    <div>
      <label className="text-[9px] text-zinc-400 font-medium uppercase">{label}</label>
      <div className="flex flex-wrap gap-1 mt-0.5">
        {selected.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-zinc-100 rounded text-[9px]">
            {item}
            <button onClick={() => onChange(selected.filter(s => s !== item))} className="text-zinc-400 hover:text-zinc-600">x</button>
          </span>
        ))}
      </div>
      <div className="relative mt-0.5">
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder || `Add ${label.toLowerCase()}...`}
          className="w-full px-2 py-1 border rounded text-[10px] bg-white"
        />
        {open && filtered.length > 0 && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <div className="absolute left-0 right-0 top-full mt-0.5 bg-white border rounded shadow-lg max-h-32 overflow-y-auto z-40">
              {filtered.slice(0, 12).map(opt => (
                <button key={opt} onClick={() => { onChange([...selected, opt]); setSearch(""); setOpen(false); }}
                  className="w-full text-left px-2 py-1 text-[10px] hover:bg-zinc-50">{opt}</button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const FINANCIAL_ROLES = ["super_admin", "admin", "branch_md", "accounts"];

// Get client tier - matches existing Client Intel colour scheme exactly
function getClientTier(appGrade?: string, totalProfit?: number): { tier: string; color: string; textColor: string } {
  const grade = appGrade?.toUpperCase() || "";
  // A++ = Platinum (deep red/magenta)
  if (grade === "A++" || (totalProfit && totalProfit >= 50000))
    return { tier: "Platinum", color: "bg-[#c62828]", textColor: "text-white" };
  // A+ = Platinum (lighter)
  if (grade === "A+" || (totalProfit && totalProfit >= 30000))
    return { tier: "Platinum", color: "bg-[#e53935]", textColor: "text-white" };
  // A = Gold (amber/yellow)
  if (grade === "A" || (totalProfit && totalProfit >= 20000))
    return { tier: "Gold", color: "bg-[#f9a825]", textColor: "text-white" };
  // B = Silver (blue)
  if (grade === "B" || (totalProfit && totalProfit >= 10000))
    return { tier: "Silver", color: "bg-[#1e88e5]", textColor: "text-white" };
  // C = Bronze (orange)
  if (grade === "C" || (totalProfit && totalProfit >= 3000))
    return { tier: "Bronze", color: "bg-[#fb8c00]", textColor: "text-white" };
  // Below thresholds = Starter (grey)
  if (totalProfit && totalProfit > 0)
    return { tier: "Starter", color: "bg-zinc-400", textColor: "text-white" };
  return { tier: "New", color: "bg-purple-500", textColor: "text-white" };
}

// Identify growth opportunities
function getOpportunities(perf: any): string[] {
  const opps: string[] = [];
  if (perf.fclJobs === 0 && perf.totalJobs > 0) opps.push("No FCL - opportunity to win container business");
  if (perf.airJobs === 0 && perf.totalJobs > 0) opps.push("No air freight - cross-sell opportunity");
  if (perf.lclJobs === 0 && perf.totalJobs > 0) opps.push("No LCL - groupage opportunity");
  if (perf.trend < -10) opps.push("Declining - needs account review and retention plan");
  if (perf.trend > 20) opps.push("Strong growth - consider rate review for volume discount");
  if (perf.avgJobValue < 100) opps.push("Low avg job value - opportunity for larger shipments");
  if (perf.totalJobs > 50 && perf.totalJobs < 100) opps.push("High volume - consider dedicated account management");
  return opps;
}

// Extract company info from email signature
function extractFromSignature(body: string): { company?: string; title?: string; phone?: string; website?: string } {
  const text = body.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  const result: any = {};

  // Extract company name patterns from signature block (usually after the name)
  // Look for Ltd, Limited, Inc, Corp, LLC, GmbH, PLC, Group, Logistics, Transport, Shipping etc
  const companyMatch = text.match(/(?:^|\n|,\s*)([\w\s&.'()-]+(?:Ltd|Limited|Inc|Corp|LLC|GmbH|PLC|Group|Logistics|Transport|Shipping|Freight|International|Global|Solutions|Services|Agency|Forwarding|Express|Line|Lines|Maritime|Aviation|Cargo|Supply Chain)[\w\s.]*)/i);
  if (companyMatch) result.company = companyMatch[1].trim();

  // Job title
  const titleMatch = text.match(/(?:Director|Manager|Coordinator|CEO|CFO|COO|CTO|MD|Head of|VP|President|Owner|Founder|Partner|Executive|Officer|Specialist|Analyst|Supervisor|Team Lead|Assistant|Administrator|Controller|Clerk)[^,\n<]{0,40}/i);
  if (titleMatch) result.title = titleMatch[0].trim();

  // Phone
  const phoneMatch = text.match(/(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/);
  if (phoneMatch) result.phone = phoneMatch[0].trim();

  // Website
  const urlMatch = text.match(/(?:www\.|https?:\/\/)([\w.-]+\.\w{2,})/i);
  if (urlMatch) result.website = urlMatch[1];

  return result;
}

function ResearchDisplay({ results }: { results: any }) {
  const { research, contacts } = results;
  if (!research && (!contacts || contacts.length === 0)) return null;

  return (
    <div className="space-y-1.5">
      {research && !research.error && (
        <div className="bg-white rounded-lg p-2 border space-y-1">
          <p className="text-[9px] text-zinc-400 font-medium uppercase">Research</p>
          {research.description && <p className="text-[10px] text-zinc-700">{research.description}</p>}
          {research.industry && <p className="text-[10px]"><span className="text-zinc-400">Industry:</span> {research.industry}</p>}
          {research.commodities && <p className="text-[10px]"><span className="text-zinc-400">Ships:</span> {research.commodities}</p>}
          {research.employee_count && <p className="text-[10px]"><span className="text-zinc-400">Size:</span> {research.employee_count}</p>}
          {research.current_logistics_provider && (
            <p className="text-[10px]"><span className="text-zinc-400">Current provider:</span> {research.current_logistics_provider}</p>
          )}
          {research.countries?.length > 0 && (
            <div className="flex flex-wrap gap-0.5">
              {research.countries.map((c: string, i: number) => (
                <span key={i} className="text-[8px] px-1 py-0.5 bg-zinc-100 rounded">{c}</span>
              ))}
            </div>
          )}
          {research.opportunity && (
            <div className="bg-green-50 rounded p-1.5 mt-1">
              <p className="text-[9px] text-green-700"><span className="font-medium">Opportunity:</span> {research.opportunity}</p>
            </div>
          )}
          {research.pain_points && (
            <div className="bg-amber-50 rounded p-1.5">
              <p className="text-[9px] text-amber-700"><span className="font-medium">Pain points:</span> {research.pain_points}</p>
            </div>
          )}
        </div>
      )}

      {contacts && contacts.length > 0 && (
        <div className="bg-white rounded-lg p-2 border space-y-1">
          <p className="text-[9px] text-zinc-400 font-medium uppercase">Contacts found ({contacts.length})</p>
          {contacts.map((c: any, i: number) => (
            <div key={i} className="text-[10px] py-0.5 flex items-start justify-between">
              <div>
                <span className="font-medium text-zinc-700">{c.name || "Unknown"}</span>
                {c.position && <span className="text-zinc-400"> - {c.position}</span>}
                <p className="text-zinc-400">{c.email}</p>
              </div>
              {c.confidence && (
                <span className={`text-[8px] px-1 py-0.5 rounded ${c.confidence > 80 ? "bg-green-100 text-green-700" : "bg-zinc-100 text-zinc-500"}`}>
                  {c.confidence}%
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EditAccountForm({ account, onSave, onCancel }: { account: any; onSave: (a: any) => void; onCancel: () => void }) {
  const [f, setF] = useState({
    company_name: account.company_name || "",
    relationship_types: account.relationship_types || ["direct_client"],
    service_categories: account.service_categories || [],
    financial_direction: account.financial_direction || "receivable",
    countries_of_origin: account.countries_of_origin || [],
    countries_of_operation: account.countries_of_operation || [],
    modes: account.modes || [],
    currency: account.currency || "GBP",
    website: account.website || "",
    status: account.status || "active",
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { data, error } = await supabase.from("accounts")
      .update({ ...f, updated_at: new Date().toISOString() })
      .eq("id", account.id).select().single();
    if (error) { toast.error(error.message); setSaving(false); return; }
    onSave(data);
    toast.success("Account updated");
    setSaving(false);
  }

  return (
    <div className="space-y-2 pt-1.5 border-t border-green-200">
      <div>
        <label className="text-[9px] text-zinc-400">Company name</label>
        <input value={f.company_name} onChange={e => setF({ ...f, company_name: e.target.value })}
          className="w-full px-2 py-1 border rounded text-xs bg-white" />
      </div>
      <div>
        <label className="text-[9px] text-zinc-400 font-medium uppercase">Type</label>
        <div className="flex flex-wrap gap-1 mt-0.5">
          {[
            { value: "direct_client", label: "Direct Client" },
            { value: "forwarder_agent", label: "Forwarder/Agent" },
            { value: "supplier", label: "Supplier" },
          ].map(t => (
            <button key={t.value} onClick={() => setF({
              ...f,
              relationship_types: f.relationship_types.includes(t.value)
                ? f.relationship_types.filter((r: string) => r !== t.value)
                : [...f.relationship_types, t.value],
            })}
              className={`px-2 py-0.5 rounded text-[9px] ${f.relationship_types.includes(t.value) ? "bg-zinc-900 text-white" : "bg-white border hover:bg-zinc-50"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-[9px] text-zinc-400 font-medium uppercase">Services</label>
        <div className="flex flex-wrap gap-0.5 mt-0.5">
          {SERVICE_TYPES.flatMap(g => g.items).map(s => (
            <button key={s} onClick={() => {
              const cats = f.service_categories.includes(s) ? f.service_categories.filter((c: string) => c !== s) : [...f.service_categories, s];
              setF({ ...f, service_categories: cats });
            }}
              className={`px-1.5 py-0.5 rounded text-[8px] ${f.service_categories.includes(s) ? "bg-zinc-900 text-white" : "bg-white border hover:bg-zinc-50"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-[9px] text-zinc-400 font-medium uppercase">Modes</label>
        <div className="flex flex-wrap gap-1 mt-0.5">
          {MODES.map(m => (
            <button key={m} onClick={() => {
              const modes = f.modes.includes(m) ? f.modes.filter((x: string) => x !== m) : [...f.modes, m];
              setF({ ...f, modes });
            }}
              className={`px-1.5 py-0.5 rounded text-[8px] ${f.modes.includes(m) ? "bg-zinc-900 text-white" : "bg-white border hover:bg-zinc-50"}`}>
              {m}
            </button>
          ))}
        </div>
      </div>
      <MultiSelect label="Based in" options={COUNTRIES} selected={f.countries_of_origin}
        onChange={v => setF({ ...f, countries_of_origin: v })} />
      <MultiSelect label="Operates in" options={COUNTRIES} selected={f.countries_of_operation}
        onChange={v => setF({ ...f, countries_of_operation: v })} />
      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <label className="text-[9px] text-zinc-400">Currency</label>
          <select value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })}
            className="w-full px-2 py-1 border rounded text-[10px] bg-white">
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[9px] text-zinc-400">Status</label>
          <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}
            className="w-full px-2 py-1 border rounded text-[10px] bg-white">
            <option value="active">Active</option>
            <option value="on_hold">On Hold</option>
            <option value="dormant">Dormant</option>
            <option value="blacklisted">Blacklisted</option>
          </select>
        </div>
      </div>
      <div className="flex gap-1.5 pt-1">
        <Button size="sm" onClick={save} disabled={saving} className="bg-zinc-900 hover:bg-zinc-800 text-[10px] flex-1">
          {saving ? "Saving..." : "Update"}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} className="text-[10px]">Cancel</Button>
      </div>
    </div>
  );
}

export function ContactEnrichment({ senderEmail, senderName, matchedAccount, matchedCompany, userRole, emailBody }: Props) {
  const canSeeFinancials = FINANCIAL_ROLES.includes(userRole || "");
  const [account, setAccount] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showFullDetails, setShowFullDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [editContact, setEditContact] = useState({ name: "", title: "", phone: "" });
  const [editingAccount, setEditingAccount] = useState(false);
  const [researching, setResearching] = useState(false);
  const [researchResults, setResearchResults] = useState<any>(null);

  async function runResearch() {
    setResearching(true);
    try {
      const res = await fetch("/api/enrich-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: account?.company_name || form.company_name || senderName,
          domain,
          account_id: account?.id || null,
        }),
      });
      const data = await res.json();
      setResearchResults(data);
      if (data.research?.company_name && !account?.company_name) {
        setForm(prev => ({ ...prev, company_name: data.research.company_name }));
      }
      toast.success("Research complete");
    } catch {
      toast.error("Research failed");
    }
    setResearching(false);
  }

  const domain = senderEmail.split("@")[1] || "";
  const isInternal = isInternalEmail(senderEmail);

  const [form, setForm] = useState({
    company_name: matchedCompany || "",
    relationship_types: ["direct_client"] as string[],
    service_categories: [] as string[],
    financial_direction: "receivable",
    countries_of_origin: [] as string[],
    countries_of_operation: [] as string[],
    modes: [] as string[],
    trade_lanes: [] as string[],
    port_coverage: [] as string[],
    currency: "GBP",
    website: "",
    contact_name: senderName,
    contact_email: senderEmail,
    contact_title: "",
    contact_phone: "",
  });

  const [contactRecord, setContactRecord] = useState<any>(null);
  const [otherContacts, setOtherContacts] = useState<any[]>([]);
  const [performance, setPerformance] = useState<any>(null);
  const [appGrade, setAppGrade] = useState<string | null>(null);
  const [accountHealth, setAccountHealth] = useState<string | null>(null);
  const [prospectData, setProspectData] = useState<any>(null);

  useEffect(() => {
    // Reset all state when sender changes
    setAccount(null);
    setLoading(true);
    setShowAddForm(false);
    setShowFullDetails(false);
    setEditingContact(false);
    setEditingAccount(false);
    setResearching(false);
    setResearchResults(null);
    setContactRecord(null);
    setOtherContacts([]);
    setPerformance(null);
    setAppGrade(null);
    setAccountHealth(null);
    setProspectData(null);
    setForm({
      company_name: matchedCompany || "",
      relationship_types: ["direct_client"],
      service_categories: [],
      financial_direction: "receivable",
      countries_of_origin: [],
      countries_of_operation: [],
      modes: [],
      trade_lanes: [],
      port_coverage: [],
      currency: "GBP",
      website: "",
      contact_name: senderName,
      contact_email: senderEmail,
      contact_title: "",
      contact_phone: "",
    });

    if (isInternal) { setLoading(false); return; }

    async function lookup() {
      // 1. Check accounts table by domain
      const { data: byDomain } = await supabase.from("accounts")
        .select("*").eq("domain", domain).limit(1).single();
      if (byDomain) { setAccount(byDomain); }

      // 2. Check accounts by matched account code
      if (!byDomain && matchedAccount) {
        const { data: byCode } = await supabase.from("accounts")
          .select("*").eq("account_code", matchedAccount).limit(1).single();
        if (byCode) { setAccount(byCode); }
      }

      // 3. Check cargowise_contacts for this sender
      const { data: contact } = await supabase.from("cargowise_contacts")
        .select("*").eq("email", senderEmail).limit(1).single();
      if (contact) {
        setContactRecord(contact);
        setEditContact({ name: contact.contact_name || "", title: contact.job_title || "", phone: contact.phone || "" });
        // If no account found yet, check by contact's account code
        if (!byDomain && !matchedAccount && contact.account_code) {
          const { data: acct } = await supabase.from("accounts")
            .select("*").eq("account_code", contact.account_code).limit(1).single();
          if (acct) setAccount(acct);
        }
        // Pre-fill form from contact
        setForm(prev => ({
          ...prev,
          company_name: contact.org_name || prev.company_name,
          contact_name: contact.contact_name || prev.contact_name,
          contact_title: contact.job_title || prev.contact_title,
          contact_phone: contact.phone || prev.contact_phone,
        }));
      }

      // 4. Get other contacts at the same account
      const acctCode = contact?.account_code || matchedAccount;
      if (acctCode) {
        const { data: others } = await supabase.from("cargowise_contacts")
          .select("contact_name, email, job_title, phone")
          .eq("account_code", acctCode)
          .neq("email", senderEmail)
          .limit(10);
        if (others) setOtherContacts(others);

        // 5. Get client performance data
        const { data: perf } = await supabase.from("client_performance")
          .select("*")
          .eq("account_code", acctCode)
          .order("report_month", { ascending: false })
          .limit(12);
        if (perf && perf.length > 0) {
          const totalJobs = perf.reduce((s: number, r: any) => s + (r.total_jobs || 0), 0);
          const totalProfit = perf.reduce((s: number, r: any) => s + (Number(r.profit_total) || 0), 0);
          const fclJobs = perf.reduce((s: number, r: any) => s + (r.fcl_jobs || 0), 0);
          const lclJobs = perf.reduce((s: number, r: any) => s + (r.lcl_jobs || 0), 0);
          const airJobs = perf.reduce((s: number, r: any) => s + (r.air_jobs || 0), 0);
          const fclTeu = perf.reduce((s: number, r: any) => s + (r.fcl_teu || 0), 0);
          const airKg = perf.reduce((s: number, r: any) => s + (Number(r.air_kg) || 0), 0);
          const profitFcl = perf.reduce((s: number, r: any) => s + (Number(r.profit_fcl) || 0), 0);
          const profitAir = perf.reduce((s: number, r: any) => s + (Number(r.profit_air) || 0), 0);
          const profitLcl = perf.reduce((s: number, r: any) => s + (Number(r.profit_lcl) || 0) + (Number(r.profit_grp_lcl) || 0), 0);
          const months = perf.length;
          const latestMonth = perf[0]?.report_month;
          const avgJobValue = totalJobs > 0 ? Math.round(totalProfit / totalJobs) : 0;

          // Trend: compare last 3 months to previous 3
          const recent = perf.slice(0, 3).reduce((s: number, r: any) => s + (Number(r.profit_total) || 0), 0);
          const previous = perf.slice(3, 6).reduce((s: number, r: any) => s + (Number(r.profit_total) || 0), 0);
          const trend = previous > 0 ? Math.round(((recent - previous) / previous) * 100) : 0;

          setPerformance({
            totalJobs, totalProfit, months, latestMonth, avgJobValue, trend,
            fclJobs, lclJobs, airJobs, fclTeu, airKg,
            profitFcl, profitAir, profitLcl,
            modes: [
              ...(fclJobs > 0 ? [`FCL (${fclJobs} jobs, ${fclTeu} TEU)`] : []),
              ...(lclJobs > 0 ? [`LCL (${lclJobs} jobs)`] : []),
              ...(airJobs > 0 ? [`Air (${airJobs} jobs, ${Math.round(airKg / 1000)}t)`] : []),
            ],
          });
        }
      }

      // 6. Get app_scores grade and account_health
      if (acctCode) {
        const { data: score } = await supabase.from("app_scores")
          .select("grade").eq("account_code", acctCode).limit(1).single();
        if (score?.grade) setAppGrade(score.grade);

        const { data: research } = await supabase.from("client_research")
          .select("account_health").eq("account_code", acctCode).limit(1).single();
        if (research?.account_health) setAccountHealth(research.account_health);
      }

      // 7. Extract company info from email signature
      const sigInfo = emailBody ? extractFromSignature(emailBody) : {};
      const extractedCompany = sigInfo.company || matchedCompany || "";

      // Update form with extracted data
      if (sigInfo.title || sigInfo.phone) {
        setForm(prev => ({
          ...prev,
          contact_title: sigInfo.title || prev.contact_title,
          contact_phone: sigInfo.phone || prev.contact_phone,
          website: sigInfo.website ? `www.${sigInfo.website}` : prev.website,
        }));
        if (sigInfo.title || sigInfo.phone) {
          setEditContact(prev => ({
            ...prev,
            title: sigInfo.title || prev.title,
            phone: sigInfo.phone || prev.phone,
          }));
        }
      }

      // 8. If not a client, search our databases for the company
      if (!byDomain && !matchedAccount && !contact?.account_code) {
        let company: any = null;

        // Try domain match first
        const { data: byDomainCompany } = await supabase.from("companies")
          .select("id, company_name, company_domain, icp_score, icp_grade, country")
          .eq("company_domain", domain).limit(1).single();
        company = byDomainCompany;

        // If no domain match, search by extracted company name
        if (!company && extractedCompany) {
          const searchTerm = extractedCompany.replace(/\b(Ltd|Limited|Inc|Corp|LLC|GmbH|PLC)\b/gi, "").trim();
          if (searchTerm.length > 2) {
            const { data: byName } = await supabase.from("companies")
              .select("id, company_name, company_domain, icp_score, icp_grade, country")
              .ilike("company_name", `%${searchTerm}%`)
              .limit(1).single();
            company = byName;
          }
        }

        // Also search by sender's display name if it looks like a company
        if (!company && senderName && !senderName.includes("@")) {
          const nameParts = senderName.split(" ");
          if (nameParts.length <= 2) {
            // Probably a person name, not a company - skip
          } else {
            const { data: byDisplayName } = await supabase.from("companies")
              .select("id, company_name, company_domain, icp_score, icp_grade, country")
              .ilike("company_name", `%${senderName}%`)
              .limit(1).single();
            company = byDisplayName;
          }
        }

        // Also try searching cargowise contacts org_name by extracted company
        if (!company && extractedCompany) {
          const searchTerm = extractedCompany.replace(/\b(Ltd|Limited|Inc|Corp|LLC|GmbH|PLC)\b/gi, "").trim();
          if (searchTerm.length > 2) {
            const { data: byOrgName } = await supabase.from("cargowise_contacts")
              .select("account_code, org_name")
              .ilike("org_name", `%${searchTerm}%`)
              .limit(1).single();
            if (byOrgName?.account_code) {
              setContactRecord((prev: any) => prev || { ...byOrgName, email: senderEmail, contact_name: senderName });
              // Fetch the account
              const { data: acct } = await supabase.from("accounts")
                .select("*").eq("account_code", byOrgName.account_code).limit(1).single();
              if (acct) setAccount(acct);
              // Fetch performance
              const { data: perf } = await supabase.from("client_performance")
                .select("*").eq("account_code", byOrgName.account_code).order("report_month", { ascending: false }).limit(12);
              if (perf && perf.length > 0) {
                // Reuse performance calculation from above
                setForm(prev => ({ ...prev, company_name: byOrgName.org_name }));
              }
            }
          }
        }

        if (company) {
          const { data: enrichment } = await supabase.from("enrichments")
            .select("commodity_summary, vertical, angle, current_provider, provider_confidence, pain_points, suggested_approach, approach_hook")
            .eq("company_id", company.id).limit(1).single();

          setProspectData({
            company_name: company.company_name,
            domain: company.company_domain,
            icp_score: company.icp_score,
            icp_grade: company.icp_grade,
            country: company.country,
            enrichment: enrichment || null,
          });

          setForm(prev => ({ ...prev, company_name: company.company_name || prev.company_name }));
        }
      }

      // Set the best company name we found (priority: signature > contact org > prospect > domain)
      const bestName = sigInfo.company || contact?.org_name || prospectData?.company_name || matchedCompany || "";
      if (bestName) {
        setForm(prev => ({ ...prev, company_name: bestName }));
      } else if (!form.company_name) {
        // Last resort: capitalise the domain (but this is the worst option)
        setForm(prev => ({ ...prev, company_name: domain.split(".")[0].charAt(0).toUpperCase() + domain.split(".")[0].slice(1) }));
      }
      setLoading(false);
    }
    lookup();
  }, [senderEmail, domain, matchedAccount]);

  async function saveAccount() {
    setSaving(true);
    // Account codes are only assigned once set up in Cargowise - use temporary placeholder
    const accountCode = `PENDING_${Date.now().toString(36).toUpperCase()}`;

    const { data, error } = await supabase.from("accounts").insert({
      account_code: accountCode,
      company_name: form.company_name,
      domain,
      relationship_types: form.relationship_types,
      service_categories: form.service_categories,
      financial_direction: form.financial_direction,
      countries_of_origin: form.countries_of_origin,
      countries_of_operation: form.countries_of_operation,
      modes: form.modes,
      trade_lanes: form.trade_lanes,
      port_coverage: form.port_coverage,
      currency: form.currency,
      website: form.website,
      source: "manual",
    }).select().single();

    if (error) { toast.error(error.message); setSaving(false); return; }

    await supabase.from("cargowise_contacts").upsert({
      email: form.contact_email,
      contact_name: form.contact_name,
      job_title: form.contact_title,
      phone: form.contact_phone,
      account_code: accountCode,
      org_name: form.company_name,
    }, { onConflict: "email" });

    setAccount(data);
    setShowAddForm(false);
    setSaving(false);
    toast.success(`${form.company_name} added to database`);
  }

  if (isInternal) return null;

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="relative">
        <img src="/brain-icon.png" alt="Braiin" className="w-12 h-12 animate-pulse" style={{ animationDuration: "1.5s" }} />
        <div className="absolute inset-0 rounded-full bg-zinc-900/5 animate-ping" style={{ animationDuration: "2s" }} />
      </div>
      <p className="text-[10px] text-zinc-400 mt-3 animate-pulse">Braiin is thinking...</p>
    </div>
  );

  // Account or contact found in system
  if (account || contactRecord) {
    return (
      <div className="p-3 bg-green-50 border border-green-200 rounded-lg space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Building size={12} className="text-green-600" />
            <span className="text-[10px] font-medium text-green-700">In system</span>
            {(() => {
              const code = account?.account_code || contactRecord?.account_code;
              if (!code) return null;
              const isPending = code.startsWith("PENDING_") || code === "NOACCOUNT";
              return (
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${isPending ? "bg-amber-100 text-amber-700" : "bg-green-200 text-green-800"}`}>
                  {isPending ? "No CW Code" : code}
                </span>
              );
            })()}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setEditingAccount(!editingAccount)} className="text-[9px] text-green-600 underline">
              {editingAccount ? "Cancel" : "Edit"}
            </button>
            <button onClick={() => setShowFullDetails(!showFullDetails)} className="text-[9px] text-green-600">
              {showFullDetails ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>
          </div>
        </div>
        <p className="text-xs font-medium">{account?.company_name || contactRecord?.org_name}</p>

        {/* Edit account form */}
        {editingAccount && account && (
          <EditAccountForm account={account} onSave={(updated) => { setAccount(updated); setEditingAccount(false); }} onCancel={() => setEditingAccount(false)} />
        )}

        {/* This contact - editable */}
        {contactRecord && !editingContact && (
          <div className="text-[10px] text-zinc-600 flex items-start justify-between">
            <div>
              <span className="font-medium">{contactRecord.contact_name}</span>
              {contactRecord.job_title && <span className="text-zinc-400"> - {contactRecord.job_title}</span>}
              {contactRecord.phone && <p className="text-zinc-400">{contactRecord.phone}</p>}
            </div>
            <button onClick={() => setEditingContact(true)} className="text-[8px] text-zinc-400 hover:text-zinc-600 underline shrink-0">Edit</button>
          </div>
        )}
        {contactRecord && editingContact && (
          <div className="space-y-1 pt-1 border-t border-green-200">
            <div className="grid grid-cols-2 gap-1">
              <div>
                <label className="text-[8px] text-zinc-400">Name</label>
                <input value={editContact.name} onChange={e => setEditContact({ ...editContact, name: e.target.value })}
                  className="w-full px-1.5 py-0.5 border rounded text-[10px] bg-white" />
              </div>
              <div>
                <label className="text-[8px] text-zinc-400">Title</label>
                <input value={editContact.title} onChange={e => setEditContact({ ...editContact, title: e.target.value })}
                  className="w-full px-1.5 py-0.5 border rounded text-[10px] bg-white" />
              </div>
            </div>
            <div>
              <label className="text-[8px] text-zinc-400">Phone</label>
              <input value={editContact.phone} onChange={e => setEditContact({ ...editContact, phone: e.target.value })}
                className="w-full px-1.5 py-0.5 border rounded text-[10px] bg-white" />
            </div>
            <div className="flex gap-1">
              <button onClick={async () => {
                await supabase.from("cargowise_contacts").update({
                  contact_name: editContact.name, job_title: editContact.title, phone: editContact.phone,
                }).eq("email", senderEmail);
                setContactRecord({ ...contactRecord, contact_name: editContact.name, job_title: editContact.title, phone: editContact.phone });
                setEditingContact(false);
                toast.success("Contact updated");
              }} className="px-2 py-0.5 bg-zinc-900 text-white rounded text-[9px]">Save</button>
              <button onClick={() => setEditingContact(false)} className="px-2 py-0.5 text-zinc-500 text-[9px]">Cancel</button>
            </div>
          </div>
        )}

        {/* Relationship types */}
        <div className="flex flex-wrap gap-1">
          {(account?.relationship_types || []).map((t: string, i: number) => (
            <span key={i} className="text-[8px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded capitalize">{t.replace(/_/g, " ")}</span>
          ))}
          {(account?.service_categories || []).map((c: string, i: number) => (
            <span key={i} className="text-[8px] px-1.5 py-0.5 bg-zinc-100 text-zinc-600 rounded">{c}</span>
          ))}
        </div>

        {/* Client tier + performance */}
        {(performance || appGrade) && (() => {
          const tier = getClientTier(appGrade || undefined, performance?.totalProfit);
          const opportunities = performance ? getOpportunities(performance) : [];
          return (
            <div className="bg-white rounded-lg p-2 space-y-1.5 border border-green-200">
              {/* Tier badge + health + trend */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${tier.color} ${tier.textColor}`}>
                    {tier.tier}
                  </span>
                  {accountHealth && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                      accountHealth === "growing" ? "bg-green-100 text-green-700" :
                      accountHealth === "at_risk" ? "bg-red-100 text-red-700" :
                      "bg-zinc-100 text-zinc-500"
                    }`}>
                      {accountHealth === "at_risk" ? "At Risk" : accountHealth.charAt(0).toUpperCase() + accountHealth.slice(1)}
                    </span>
                  )}
                </div>
                {performance && (
                  <span className={`text-[9px] font-medium ${performance.trend > 0 ? "text-green-600" : performance.trend < 0 ? "text-red-600" : "text-zinc-400"}`}>
                    {performance.trend > 0 ? "+" : ""}{performance.trend}%
                  </span>
                )}
              </div>

              {/* Key metrics - jobs always visible, financials role-gated */}
              <div className={`grid ${canSeeFinancials ? "grid-cols-3" : "grid-cols-2"} gap-1.5 text-center`}>
                <div>
                  <p className="text-sm font-semibold text-zinc-900">{performance.totalJobs}</p>
                  <p className="text-[8px] text-zinc-400">Shipments</p>
                </div>
                {canSeeFinancials && (
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">{performance.totalProfit >= 1000 ? `${(performance.totalProfit / 1000).toFixed(1)}k` : Math.round(performance.totalProfit).toLocaleString()}</p>
                    <p className="text-[8px] text-zinc-400">Profit (GBP)</p>
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-zinc-900">{performance.months}</p>
                  <p className="text-[8px] text-zinc-400">Months</p>
                </div>
              </div>

              {/* Mode tags - always visible */}
              {performance.modes.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1 border-t">
                  {performance.modes.map((m: string, i: number) => (
                    <span key={i} className="text-[8px] px-1.5 py-0.5 bg-zinc-100 text-zinc-600 rounded">{m}</span>
                  ))}
                </div>
              )}

              {/* Financials - role gated */}
              {canSeeFinancials && (
                <div className="flex justify-between text-[9px] text-zinc-400 pt-1 border-t">
                  <span>Avg job: GBP {Math.round(performance.avgJobValue).toLocaleString()}</span>
                  <span>Latest: {performance.latestMonth}</span>
                </div>
              )}

              {/* Growth opportunities - always visible */}
              {opportunities.length > 0 && (
                <div className="pt-1.5 border-t">
                  <p className="text-[9px] text-zinc-400 font-medium mb-1">Opportunities</p>
                  {opportunities.map((opp, i) => (
                    <p key={i} className="text-[9px] text-amber-700 flex items-start gap-1">
                      <span className="text-amber-500 shrink-0">-</span> {opp}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {showFullDetails && (
          <div className="pt-1.5 border-t border-green-200 space-y-1.5">
            {/* Profit by mode - financials only */}
            {canSeeFinancials && performance && (
              <div className="space-y-1 text-[10px]">
                <p className="text-[9px] text-zinc-400 font-medium">Profit by mode</p>
                {performance.profitFcl > 0 && (
                  <div className="flex justify-between">
                    <span className="text-zinc-600">FCL</span>
                    <span className="font-medium">GBP {Math.round(performance.profitFcl).toLocaleString()}</span>
                  </div>
                )}
                {performance.profitLcl > 0 && (
                  <div className="flex justify-between">
                    <span className="text-zinc-600">LCL</span>
                    <span className="font-medium">GBP {Math.round(performance.profitLcl).toLocaleString()}</span>
                  </div>
                )}
                {performance.profitAir > 0 && (
                  <div className="flex justify-between">
                    <span className="text-zinc-600">Air</span>
                    <span className="font-medium">GBP {Math.round(performance.profitAir).toLocaleString()}</span>
                  </div>
                )}
              </div>
            )}

            {/* Account details */}
            {account && (
              <div className="space-y-1 text-[10px] text-zinc-600">
                {account.countries_of_origin?.length > 0 && <p><span className="text-zinc-400">Based in:</span> {account.countries_of_origin.join(", ")}</p>}
                {account.countries_of_operation?.length > 0 && <p><span className="text-zinc-400">Operates in:</span> {account.countries_of_operation.join(", ")}</p>}
                {account.modes?.length > 0 && <p><span className="text-zinc-400">Modes:</span> {account.modes.join(", ")}</p>}
                {account.trade_lanes?.length > 0 && <p><span className="text-zinc-400">Trade lanes:</span> {account.trade_lanes.join(", ")}</p>}
                {account.currency && <p><span className="text-zinc-400">Currency:</span> {account.currency}</p>}
                {account.website && <p><span className="text-zinc-400">Web:</span> {account.website}</p>}
              </div>
            )}

            {/* Other contacts at this account */}
            {otherContacts.length > 0 && (
              <div className="pt-1.5 border-t border-green-200">
                <p className="text-[9px] text-zinc-400 font-medium mb-1">Other contacts ({otherContacts.length})</p>
                {otherContacts.slice(0, 5).map((c, i) => (
                  <div key={i} className="text-[10px] py-0.5">
                    <span className="font-medium text-zinc-700">{c.contact_name}</span>
                    {c.job_title && <span className="text-zinc-400"> - {c.job_title}</span>}
                    <p className="text-zinc-400">{c.email}</p>
                  </div>
                ))}
                {otherContacts.length > 5 && <p className="text-[9px] text-zinc-400">+{otherContacts.length - 5} more</p>}
              </div>
            )}
          </div>
        )}

        {/* Research button - only in expanded details for existing clients */}
        {showFullDetails && canAccessEnrichment(userRole) && (
          <button onClick={runResearch} disabled={researching}
            className="w-full text-center text-[9px] px-2 py-1.5 bg-white border border-green-300 text-green-700 rounded hover:bg-green-100 font-medium disabled:opacity-50">
            {researching ? "Researching..." : researchResults ? "Research again" : "Research this company"}
          </button>
        )}
        {researchResults && canAccessEnrichment(userRole) && <ResearchDisplay results={researchResults} />}

        {account?.status === "blacklisted" && (
          <p className="text-[9px] text-red-600 font-medium">BLACKLISTED: {account.blacklist_reason}</p>
        )}
      </div>
    );
  }

  // Prospect - in companies database but not a client
  if (prospectData) {
    return (
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Building size={12} className="text-blue-600" />
            <span className="text-[10px] font-medium text-blue-700">Prospect</span>
            {prospectData.icp_grade && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium text-white ${
                prospectData.icp_grade === "A++" ? "bg-[#c62828]" :
                prospectData.icp_grade === "A+" ? "bg-[#e53935]" :
                prospectData.icp_grade === "A" ? "bg-[#f9a825]" :
                prospectData.icp_grade === "B" ? "bg-[#1e88e5]" :
                "bg-zinc-400"
              }`}>
                {prospectData.icp_grade}
              </span>
            )}
          </div>
          <button onClick={() => setShowFullDetails(!showFullDetails)} className="text-[9px] text-blue-600">
            {showFullDetails ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
        </div>
        <p className="text-xs font-medium">{prospectData.company_name}</p>
        {prospectData.country && <p className="text-[10px] text-zinc-500">{prospectData.country}</p>}

        {/* Enrichment data */}
        {prospectData.enrichment && (
          <div className="space-y-1.5">
            {prospectData.enrichment.commodity_summary && (
              <div className="bg-white rounded p-2 text-[10px]">
                <p className="text-[9px] text-zinc-400 font-medium mb-0.5">What they ship</p>
                <p className="text-zinc-700">{prospectData.enrichment.commodity_summary}</p>
              </div>
            )}
            {prospectData.enrichment.current_provider && (
              <div className="bg-white rounded p-2 text-[10px]">
                <p className="text-[9px] text-zinc-400 font-medium mb-0.5">Current provider</p>
                <p className="text-zinc-700">{prospectData.enrichment.current_provider}</p>
                {prospectData.enrichment.provider_confidence && (
                  <p className="text-[9px] text-zinc-400">Confidence: {prospectData.enrichment.provider_confidence}</p>
                )}
              </div>
            )}

            {showFullDetails && (
              <>
                {prospectData.enrichment.pain_points && (
                  <div className="bg-white rounded p-2 text-[10px]">
                    <p className="text-[9px] text-zinc-400 font-medium mb-0.5">Pain points</p>
                    <p className="text-zinc-700">{prospectData.enrichment.pain_points}</p>
                  </div>
                )}
                {prospectData.enrichment.suggested_approach && (
                  <div className="bg-white rounded p-2 text-[10px]">
                    <p className="text-[9px] text-zinc-400 font-medium mb-0.5">Suggested approach</p>
                    <p className="text-zinc-700">{prospectData.enrichment.suggested_approach}</p>
                  </div>
                )}
                {prospectData.enrichment.approach_hook && (
                  <div className="bg-white rounded p-2 text-[10px]">
                    <p className="text-[9px] text-zinc-400 font-medium mb-0.5">Hook</p>
                    <p className="text-zinc-700">{prospectData.enrichment.approach_hook}</p>
                  </div>
                )}
                {prospectData.enrichment.vertical && (
                  <p className="text-[10px] text-zinc-500">Vertical: {prospectData.enrichment.vertical}</p>
                )}
              </>
            )}
          </div>
        )}

        {/* Add as client button */}
        {!showAddForm && (
          <button onClick={() => setShowAddForm(true)}
            className="w-full text-center text-[9px] px-2 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium">
            Convert to client
          </button>
        )}

        {showAddForm && (
          <div className="pt-1.5 border-t border-blue-200">
            {/* Reuse the same add form from below - abbreviated */}
            <p className="text-[9px] text-zinc-400 mb-1">Adding {prospectData.company_name} as a client account</p>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {[
                { value: "direct_client", label: "Direct Client" },
                { value: "forwarder_agent", label: "Forwarder/Agent" },
                { value: "supplier", label: "Supplier" },
              ].map(t => (
                <button key={t.value} onClick={() => setForm({ ...form, company_name: prospectData.company_name, relationship_types: [t.value] })}
                  className={`px-2 py-0.5 rounded text-[9px] ${form.relationship_types.includes(t.value) ? "bg-zinc-900 text-white" : "bg-white border hover:bg-zinc-50"}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" onClick={() => { setForm({ ...form, company_name: prospectData.company_name }); saveAccount(); }} disabled={saving}
                className="bg-zinc-900 hover:bg-zinc-800 text-[10px] flex-1">
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowAddForm(false)} className="text-[10px]">Cancel</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Not in database at all
  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <UserPlus size={12} className="text-amber-600" />
          <span className="text-[10px] font-medium text-amber-700">Not in database</span>
        </div>
        {!showAddForm && (
          <button onClick={() => setShowAddForm(true)}
            className="text-[9px] px-2 py-0.5 bg-zinc-900 text-white rounded hover:bg-zinc-800">Add</button>
        )}
      </div>
      <p className="text-[10px] text-amber-700">{senderName} ({domain})</p>

      {/* Research before adding - sales/managers only */}
      {canAccessEnrichment(userRole) && (
        <button onClick={runResearch} disabled={researching}
          className="w-full text-center text-[9px] px-2 py-1.5 bg-white border border-amber-300 text-amber-700 rounded hover:bg-amber-100 font-medium disabled:opacity-50">
          {researching ? "Researching..." : researchResults ? "Research again" : "Research this company"}
        </button>
      )}
      {researchResults && canAccessEnrichment(userRole) && <ResearchDisplay results={researchResults} />}

      {showAddForm && (
        <div className="space-y-2 pt-1 border-t border-amber-200">
          <div>
            <label className="text-[9px] text-zinc-400">Company name</label>
            <input value={form.company_name} onChange={e => setForm({ ...form, company_name: e.target.value })}
              className="w-full px-2 py-1 border rounded text-xs bg-white" />
          </div>

          {/* Relationship type */}
          <div>
            <label className="text-[9px] text-zinc-400 font-medium uppercase">Type</label>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {[
                { value: "direct_client", label: "Direct Client" },
                { value: "forwarder_agent", label: "Forwarder/Agent" },
                { value: "supplier", label: "Supplier" },
              ].map(t => (
                <button key={t.value} onClick={() => setForm({
                  ...form,
                  relationship_types: form.relationship_types.includes(t.value)
                    ? form.relationship_types.filter(r => r !== t.value)
                    : [...form.relationship_types, t.value],
                  financial_direction: t.value === "supplier" ? "payable" : t.value === "direct_client" ? "receivable" : "both",
                })}
                  className={`px-2 py-0.5 rounded text-[9px] ${form.relationship_types.includes(t.value) ? "bg-zinc-900 text-white" : "bg-white border hover:bg-zinc-50"}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Services - grouped */}
          <div>
            <label className="text-[9px] text-zinc-400 font-medium uppercase">Services</label>
            {SERVICE_TYPES.map(group => (
              <div key={group.group} className="mt-1">
                <p className="text-[8px] text-zinc-400 mb-0.5">{group.group}</p>
                <div className="flex flex-wrap gap-0.5">
                  {group.items.map(s => (
                    <button key={s} onClick={() => {
                      const cats = form.service_categories.includes(s)
                        ? form.service_categories.filter(c => c !== s)
                        : [...form.service_categories, s];
                      setForm({ ...form, service_categories: cats });
                    }}
                      className={`px-1.5 py-0.5 rounded text-[8px] ${form.service_categories.includes(s) ? "bg-zinc-900 text-white" : "bg-white border hover:bg-zinc-50"}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Modes */}
          <div>
            <label className="text-[9px] text-zinc-400 font-medium uppercase">Modes</label>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {MODES.map(m => (
                <button key={m} onClick={() => {
                  const modes = form.modes.includes(m) ? form.modes.filter(x => x !== m) : [...form.modes, m];
                  setForm({ ...form, modes });
                }}
                  className={`px-1.5 py-0.5 rounded text-[8px] ${form.modes.includes(m) ? "bg-zinc-900 text-white" : "bg-white border hover:bg-zinc-50"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Countries */}
          <MultiSelect label="Based in (country)" options={COUNTRIES} selected={form.countries_of_origin}
            onChange={v => setForm({ ...form, countries_of_origin: v })} placeholder="Search countries..." />

          <MultiSelect label="Operates in (countries)" options={COUNTRIES} selected={form.countries_of_operation}
            onChange={v => setForm({ ...form, countries_of_operation: v })} placeholder="Search countries..." />

          {/* Trade lanes + ports */}
          <div>
            <label className="text-[9px] text-zinc-400">Trade lanes (e.g. UK-Turkey, China-UK)</label>
            <input
              onKeyDown={e => {
                if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
                  setForm({ ...form, trade_lanes: [...form.trade_lanes, (e.target as HTMLInputElement).value.trim()] });
                  (e.target as HTMLInputElement).value = "";
                }
              }}
              placeholder="Type and press Enter..."
              className="w-full px-2 py-1 border rounded text-[10px] bg-white" />
            <div className="flex flex-wrap gap-1 mt-0.5">
              {form.trade_lanes.map((tl, i) => (
                <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-zinc-100 rounded text-[9px]">
                  {tl} <button onClick={() => setForm({ ...form, trade_lanes: form.trade_lanes.filter((_, j) => j !== i) })} className="text-zinc-400">x</button>
                </span>
              ))}
            </div>
          </div>

          {/* Contact details */}
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="text-[9px] text-zinc-400">Contact name</label>
              <input value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })}
                className="w-full px-2 py-1 border rounded text-[10px] bg-white" />
            </div>
            <div>
              <label className="text-[9px] text-zinc-400">Job title</label>
              <input value={form.contact_title} onChange={e => setForm({ ...form, contact_title: e.target.value })}
                className="w-full px-2 py-1 border rounded text-[10px] bg-white" placeholder="Operations Manager" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="text-[9px] text-zinc-400">Currency</label>
              <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}
                className="w-full px-2 py-1 border rounded text-[10px] bg-white">
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] text-zinc-400">Website</label>
              <input value={form.website} onChange={e => setForm({ ...form, website: e.target.value })}
                className="w-full px-2 py-1 border rounded text-[10px] bg-white" placeholder={`www.${domain}`} />
            </div>
          </div>

          <div className="flex gap-1.5 pt-1">
            <Button size="sm" onClick={saveAccount} disabled={!form.company_name || saving}
              className="bg-zinc-900 hover:bg-zinc-800 text-[10px] flex-1">
              {saving ? "Saving..." : "Save to database"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowAddForm(false)} className="text-[10px]">Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
