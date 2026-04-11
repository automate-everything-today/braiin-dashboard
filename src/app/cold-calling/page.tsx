"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { PageGuard } from "@/components/page-guard";

type ColdCall = {
  id: number;
  account_name: string;
  contact_first: string;
  contact_last: string;
  contact_title: string;
  contact_email: string;
  telephone: string;
  status: string;
  call_grade: string;
  commodity: string;
  routes: string;
  shipments_per_month: string;
  current_forwarder: string;
  icp_score: number | null;
  trade_match: boolean;
  requested_rates: boolean;
};

const columns: ColumnDef<ColdCall, any>[] = [
  { accessorKey: "account_name", header: "Company" },
  {
    accessorKey: "contact_first",
    header: "Contact",
    cell: ({ row }) => (
      <div>
        <div className="text-xs">{row.original.contact_first} {row.original.contact_last}</div>
        <div className="text-[10px] text-zinc-400">{row.original.contact_title}</div>
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ getValue }) => <Badge variant="secondary" className="text-[10px]">{getValue()}</Badge>,
  },
  { accessorKey: "commodity", header: "Commodity" },
  { accessorKey: "routes", header: "Routes" },
  { accessorKey: "shipments_per_month", header: "Volume" },
  {
    accessorKey: "icp_score",
    header: "ICP",
    cell: ({ getValue }) => <span className="font-bold">{getValue() || "-"}</span>,
  },
  { accessorKey: "current_forwarder", header: "Forwarder" },
  {
    accessorKey: "trade_match",
    header: "Trade DB",
    cell: ({ getValue }) => (getValue() ? "Yes" : ""),
  },
  {
    accessorKey: "requested_rates",
    header: "Rates",
    cell: ({ getValue }) => (getValue() ? "Yes" : ""),
  },
  { accessorKey: "contact_email", header: "Email" },
  { accessorKey: "telephone", header: "Phone" },
];

export default function ColdCallingPage() {
  const [accounts, setAccounts] = useState<ColdCall[]>([]);
  const [gradeFilter, setGradeFilter] = useState("A");

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("cold_calling")
        .select("*")
        .eq("call_grade", gradeFilter)
        .order("icp_score", { ascending: false, nullsFirst: false })
        .limit(100);
      setAccounts((data as ColdCall[]) || []);
    }
    load();
  }, [gradeFilter]);

  return (
    <PageGuard pageId="cold-calling">
    <div>
      <h1 className="text-2xl font-bold mb-4">Cold Calling</h1>

      <div className="flex gap-2 mb-4">
        {["A", "B", "C", "D", "F"].map((g) => (
          <button
            key={g}
            onClick={() => setGradeFilter(g)}
            className={`px-4 py-2 rounded text-sm font-medium ${
              gradeFilter === g ? "bg-[#ff3366] text-white" : "bg-zinc-200 text-zinc-700"
            }`}
          >
            Grade {g}
          </button>
        ))}
      </div>

      <DataTable columns={columns} data={accounts} />
    </div>
    </PageGuard>
  );
}
