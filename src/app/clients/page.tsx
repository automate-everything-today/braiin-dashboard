"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useClientPerformance, useClientResearch } from "@/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { ColumnDef } from "@tanstack/react-table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { PageGuard } from "@/components/page-guard";
import { formatGBP } from "@/lib/utils";

type Client = {
  code: string;
  name: string;
  profit: number;
  jobs: number;
  months: number;
  last: string;
  avg: number;
  status: string;
  is_forwarder: boolean;
  country: string;
  logo_url: string;
};

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  const { data: perfData, isLoading: perfLoading } = useClientPerformance();
  const { data: researchData, isLoading: researchLoading } = useClientResearch();

  // Aggregate performance data into per-account summaries
  const agg = useMemo(() => {
    const map: Record<string, { name: string; profit: number; jobs: number; months: number; last: string }> = {};
    (perfData || []).forEach((c: any) => {
      if (!map[c.account_code]) {
        map[c.account_code] = { name: c.client_name, profit: 0, jobs: 0, months: 0, last: "" };
      }
      map[c.account_code].profit += Number(c.profit_total) || 0;
      map[c.account_code].jobs += c.total_jobs || 0;
      map[c.account_code].months += 1;
      if (c.report_month > map[c.account_code].last) map[c.account_code].last = c.report_month;
    });
    return map;
  }, [perfData]);

  // Build research flag map and logo overrides
  const flagMap = useMemo(() => {
    const map: Record<string, any> = {};
    (researchData || []).forEach((r: any) => {
      map[r.account_code] = r;
    });
    return map;
  }, [researchData]);

  // Fetch contacts and companies (no hooks yet), then merge everything
  useEffect(() => {
    if (!perfData || !researchData) return;

    async function loadExtras() {
      const { data: contactData } = await supabase
        .from("contacts")
        .select("company_id, full_name, email, phone, title")
        .not("email", "is", null);

      const { data: companyLinks } = await supabase
        .from("companies")
        .select("id, account_code, logo_url")
        .not("account_code", "is", null);

      const companyToAccount: Record<number, string> = {};
      const logoByAccount: Record<string, string> = {};
      (companyLinks || []).forEach((c: any) => {
        companyToAccount[c.id] = c.account_code;
        if (c.logo_url && !logoByAccount[c.account_code]) logoByAccount[c.account_code] = c.logo_url;
      });

      // Logo overrides from research
      (researchData || []).forEach((r: any) => {
        if (r.logo_url) logoByAccount[r.account_code] = r.logo_url;
      });

      const contactsByAccount: Record<string, any> = {};
      (contactData || []).forEach((c: any) => {
        const acct = companyToAccount[c.company_id];
        if (acct && !contactsByAccount[acct]) {
          contactsByAccount[acct] = c;
        }
      });

      const sorted = Object.entries(agg)
        .map(([code, d]) => {
          const contact = contactsByAccount[code] || {};
          const flags = flagMap[code] || {};
          return {
            code,
            name: d.name,
            profit: Math.round(d.profit),
            jobs: d.jobs,
            months: d.months,
            last: d.last,
            avg: Math.round(d.profit / Math.max(d.months, 1)),
            status: d.last >= "2025-11" ? "Active" : d.months >= 4 ? "Dropped off" : "Sporadic",
            contact_name: contact.full_name || "",
            contact_email: contact.email || "",
            contact_phone: contact.phone || "",
            is_forwarder: flags.is_forwarder || false,
            country: flags.country || "",
            logo_url: logoByAccount[code] || "",
          };
        })
        .sort((a, b) => b.profit - a.profit);

      setClients(sorted);
    }

    loadExtras();
  }, [perfData, researchData, agg, flagMap]);

  async function markGone(code: string, reason: string) {
    await supabase
      .from("companies")
      .update({ status: "do_not_contact" })
      .eq("account_code", code);

    await supabase
      .from("cold_calling")
      .update({ status: "Do Not Call", call_grade: "F" })
      .eq("account_code", code);

    setRemovedIds((prev) => new Set([...prev, code]));
  }

  const columns: ColumnDef<Client, any>[] = [
    { accessorKey: "code", header: "Code" },
    {
      accessorKey: "name",
      header: "Client",
      cell: ({ row }) => (
        <span className={`flex items-center gap-1.5 ${removedIds.has(row.original.code) ? "line-through text-zinc-400" : "font-medium"}`}>
          {row.original.logo_url && (
            <img src={row.original.logo_url} alt="" className="w-5 h-5 rounded object-contain shrink-0"
              onError={(e) => (e.currentTarget.style.display = "none")} />
          )}
          {row.original.name}
          {row.original.is_forwarder && <span className="inline-block px-1.5 py-0.5 text-[9px] bg-amber-500 text-white rounded font-medium">FF</span>}
          {row.original.country && row.original.country !== "UK" && <span className="inline-block px-1.5 py-0.5 text-[9px] bg-zinc-200 text-zinc-600 rounded">{row.original.country}</span>}
        </span>
      ),
    },
    {
      accessorKey: "profit",
      header: "Total Profit",
      cell: ({ getValue }) => (
        <span className="font-medium">{formatGBP(getValue())}</span>
      ),
    },
    { accessorKey: "jobs", header: "Total Jobs" },
    { accessorKey: "months", header: "Months" },
    { accessorKey: "last", header: "Last Active" },
    {
      accessorKey: "avg",
      header: "Avg/Month",
      cell: ({ getValue }) => formatGBP(getValue()),
    },
    {
      accessorKey: "contact_name",
      header: "Contact",
      cell: ({ getValue }) => getValue() || "",
    },
    {
      accessorKey: "contact_email",
      header: "Email",
      cell: ({ getValue }) => getValue() ? (
        <a href={`mailto:${getValue()}`} className="text-[10px] text-blue-600 hover:underline">{String(getValue())}</a>
      ) : "",
    },
    {
      accessorKey: "contact_phone",
      header: "Phone",
      cell: ({ getValue }) => getValue() ? <span className="text-[10px]">{String(getValue())}</span> : "",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => {
        const s = getValue() as string;
        return (
          <Badge
            className={
              s === "Active" ? "bg-green-600 text-white"
              : s === "Dropped off" ? "bg-[#ff3366] text-white"
              : "bg-zinc-400 text-white"
            }
          >
            {s}
          </Badge>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        if (removedIds.has(row.original.code)) {
          return <span className="text-xs text-zinc-400">Removed</span>;
        }
        return (
          <AlertDialog>
            <AlertDialogTrigger>
              <span className="text-xs text-zinc-500 hover:text-[#ff3366] cursor-pointer">
                Remove
              </span>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {row.original.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will mark them as do-not-contact across the entire system.
                  They won't appear in outreach, cold calling, or enrichment.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => markGone(row.original.code, "gone_bust")}
                  className="bg-[#ff3366]"
                >
                  Gone bust
                </AlertDialogAction>
                <AlertDialogAction
                  onClick={() => markGone(row.original.code, "no_longer_trading")}
                  className="bg-zinc-700"
                >
                  No longer trading
                </AlertDialogAction>
                <AlertDialogAction
                  onClick={() => markGone(row.original.code, "other")}
                  className="bg-zinc-500"
                >
                  Other
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        );
      },
      enableSorting: false,
      enableColumnFilter: false,
    },
  ];

  return (
    <PageGuard pageId="clients">
    <div>
      <h1 className="text-2xl font-bold mb-6">Clients</h1>
      <DataTable columns={columns} data={clients} />
    </div>
    </PageGuard>
  );
}
