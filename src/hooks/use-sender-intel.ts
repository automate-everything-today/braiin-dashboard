// src/hooks/use-sender-intel.ts

import { useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Email, SenderIntel } from "@/types";
import { isInternalEmail } from "@/config/customer";

export function useSenderIntel() {
  const [senderIntel, setSenderIntel] = useState<SenderIntel | null>(null);
  const cache = useRef(new Map<string, SenderIntel | null>());

  const loadSenderIntel = useCallback(async (email: Email) => {
    setSenderIntel(null);
    const senderEmail = email.from;
    if (!senderEmail || isInternalEmail(senderEmail)) return;

    // Check cache first
    if (cache.current.has(senderEmail)) {
      setSenderIntel(cache.current.get(senderEmail) || null);
      return;
    }

    const intel: SenderIntel = {
      isClient: false, isProspect: false, isForwarder: false,
      accountCode: "", companyName: "", totalJobs: 0, totalProfit: 0,
      months: 0, lastMonth: "", contactCount: 0, dealCount: 0,
      commoditySummary: "", currentProvider: "", accountHealth: "",
    };

    const { data: contact } = await supabase.from("cargowise_contacts")
      .select("account_code, org_name, contact_name, job_title")
      .eq("email", senderEmail).limit(1).single();

    if (contact) {
      intel.accountCode = contact.account_code;
      intel.companyName = contact.org_name;

      // Run the 5 dependent queries in parallel
      const [perfResult, researchResult, contactCountResult, dealCountResult] = await Promise.all([
        supabase.from("client_performance")
          .select("profit_total, total_jobs, report_month")
          .eq("account_code", contact.account_code),
        supabase.from("client_research")
          .select("account_health, is_forwarder, competitor_intel")
          .eq("account_code", contact.account_code).single(),
        supabase.from("cargowise_contacts")
          .select("*", { count: "exact", head: true })
          .eq("account_code", contact.account_code),
        supabase.from("deals")
          .select("*", { count: "exact", head: true })
          .eq("account_code", contact.account_code)
          .not("stage", "in", '("Won","Lost")'),
      ]);

      const perf = perfResult.data;
      if (perf && perf.length > 0) {
        intel.isClient = true;
        intel.totalJobs = perf.reduce((s: number, r: any) => s + (r.total_jobs || 0), 0);
        intel.totalProfit = perf.reduce((s: number, r: any) => s + (Number(r.profit_total) || 0), 0);
        intel.months = perf.length;
        intel.lastMonth = perf.sort((a: any, b: any) => b.report_month.localeCompare(a.report_month))[0]?.report_month;
      }

      const research = researchResult.data;
      if (research) {
        intel.accountHealth = research.account_health || "";
        intel.isForwarder = research.is_forwarder || false;
      }

      intel.contactCount = contactCountResult.count || 0;
      intel.dealCount = dealCountResult.count || 0;
    }

    if (!contact) {
      const domain = senderEmail.split("@")[1];
      if (domain) {
        const { data: company } = await supabase.from("companies")
          .select("id, company_name, company_domain")
          .eq("company_domain", domain).limit(1).single();
        if (company) {
          intel.isProspect = true;
          intel.companyName = company.company_name;
          const { data: enrichment } = await supabase.from("enrichments")
            .select("commodity_summary, current_provider")
            .eq("company_id", company.id).single();
          if (enrichment) {
            intel.commoditySummary = enrichment.commodity_summary || "";
            intel.currentProvider = enrichment.current_provider || "";
          }
        }
      }
    }

    const result = (intel.companyName || intel.isClient || intel.isProspect) ? intel : null;
    cache.current.set(senderEmail, result);
    setSenderIntel(result);
  }, []);

  return { senderIntel, loadSenderIntel };
}
