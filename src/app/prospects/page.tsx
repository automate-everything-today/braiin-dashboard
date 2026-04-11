"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { PageGuard } from "@/components/page-guard";

type Prospect = {
  company_id: number;
  company_name: string;
  postcode: string;
  company_domain: string;
  ultimate_score: number;
  grade: string;
  import_score: number;
  export_score: number | null;
  import_months: number;
  export_months: number | null;
  import_volume: number;
  export_volume: number | null;
  import_chapters: number;
  is_dual: boolean;
  manchester_proximity: boolean;
  is_forwarder: boolean;
  primary_vertical: string;
  status: string;
  pipeline_status: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  contact_title: string;
};

const columns: ColumnDef<Prospect, any>[] = [
  {
    accessorKey: "company_name",
    header: "Company",
    cell: ({ row }) => (
      <div>
        <div className="font-medium text-xs flex items-center gap-1.5">
          {row.original.company_name}
          {row.original.is_forwarder && <span className="inline-block px-1 py-0.5 text-[8px] bg-amber-500 text-white rounded font-medium">FF</span>}
        </div>
        {row.original.company_domain && (
          <div className="text-[10px] text-zinc-400">{row.original.company_domain}</div>
        )}
      </div>
    ),
  },
  {
    accessorKey: "contact_name",
    header: "Contact",
    cell: ({ row }) => row.original.contact_name ? (
      <div>
        <div className="text-xs">{row.original.contact_name}</div>
        <div className="text-[10px] text-zinc-400">{row.original.contact_title}</div>
      </div>
    ) : <span className="text-zinc-300 text-xs">-</span>,
  },
  {
    accessorKey: "contact_email",
    header: "Email",
    cell: ({ getValue }) => getValue() ? (
      <a href={`mailto:${getValue()}`} className="text-[10px] text-blue-600 hover:underline">{getValue()}</a>
    ) : <span className="text-zinc-300 text-xs">-</span>,
  },
  {
    accessorKey: "contact_phone",
    header: "Phone",
    cell: ({ getValue }) => getValue() ? (
      <span className="text-[10px]">{getValue()}</span>
    ) : <span className="text-zinc-300 text-xs">-</span>,
  },
  { accessorKey: "postcode", header: "Postcode" },
  {
    accessorKey: "ultimate_score",
    header: "Score",
    cell: ({ getValue }) => <span className="font-bold">{getValue()}</span>,
  },
  { accessorKey: "import_score", header: "Import" },
  {
    accessorKey: "export_score",
    header: "Export",
    cell: ({ getValue }) => getValue() || "-",
  },
  {
    accessorKey: "import_months",
    header: "Imp Mo",
    cell: ({ getValue }) => `${getValue()}/13`,
  },
  {
    accessorKey: "export_months",
    header: "Exp Mo",
    cell: ({ getValue }) => (getValue() ? `${getValue()}/13` : "-"),
  },
  { accessorKey: "import_volume", header: "Imp Vol/mo" },
  {
    accessorKey: "export_volume",
    header: "Exp Vol/mo",
    cell: ({ getValue }) => getValue() || "-",
  },
  {
    accessorKey: "import_chapters",
    header: "Chapters",
  },
  {
    accessorKey: "primary_vertical",
    header: "Vertical",
    cell: ({ getValue }) => (
      <Badge variant="secondary" className="text-[10px]">{getValue() || "-"}</Badge>
    ),
  },
  {
    accessorKey: "is_dual",
    header: "Dual",
    cell: ({ getValue }) => (getValue() ? "Yes" : ""),
    filterFn: (row, id, value) => {
      if (!value) return true;
      return row.getValue(id) === true;
    },
  },
  {
    accessorKey: "manchester_proximity",
    header: "Manc",
    cell: ({ getValue }) => (getValue() ? "Yes" : ""),
    filterFn: (row, id, value) => {
      if (!value) return true;
      return row.getValue(id) === true;
    },
  },
  {
    id: "yeti",
    header: "Yeti",
    accessorFn: (row: any) => row.import_yeti_verified ? "Yes" : "",
    cell: ({ getValue }: any) =>
      getValue() === "Yes" ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500 text-white">Yeti Verified</span> : "",
  },
  {
    accessorKey: "pipeline_status",
    header: "Pipeline",
    cell: ({ getValue }) => {
      const s = getValue() as string;
      if (!s || s === "scored" || s === "unprocessed") return <span className="text-zinc-300">-</span>;
      const colors: Record<string, string> = {
        apollo_enriched: "bg-blue-100 text-blue-700",
        claude_enriched: "bg-green-100 text-green-700",
        in_sequence: "bg-purple-100 text-purple-700",
        replied: "bg-[#ff3366] text-white",
        apollo_no_contact: "bg-zinc-200 text-zinc-500",
      };
      return (
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${colors[s] || "bg-zinc-100"}`}>
          {s.replace(/_/g, " ")}
        </span>
      );
    },
  },
];

export default function ProspectsPage() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [grade, setGrade] = useState("A++");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, [grade]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("app_scores")
      .select("*")
      .eq("grade", grade)
      .order("ultimate_score", { ascending: false })
      .limit(200);

    if (!data || !data.length) { setProspects([]); setLoading(false); return; }

    // Fetch contacts and statuses for these company IDs
    const ids = data.map((d: any) => d.company_id);
    const { data: companyData } = await supabase
      .from("companies")
      .select("id, status, is_forwarder")
      .in("id", ids);
    const statusMap: Record<number, string> = {};
    const forwarderMap: Record<number, boolean> = {};
    (companyData || []).forEach((c: any) => {
      statusMap[c.id] = c.status;
      forwarderMap[c.id] = c.is_forwarder || false;
    });

    const { data: contactData } = await supabase
      .from("contacts")
      .select("company_id, full_name, title, email, phone")
      .in("company_id", ids);
    const contactMap: Record<number, any> = {};
    (contactData || []).forEach((c: any) => {
      if (!contactMap[c.company_id] || (c.email && !contactMap[c.company_id].email)) {
        contactMap[c.company_id] = c;
      }
    });

    const { data: yetiData } = await supabase
      .from("enrichments")
      .select("company_id, import_yeti_verified")
      .in("company_id", ids)
      .eq("import_yeti_verified", true);
    const yetiSet = new Set((yetiData || []).map((y: any) => y.company_id));

    const mapped = data.map((d: any) => {
      const contact = contactMap[d.company_id] || {};
      return {
        ...d,
        pipeline_status: statusMap[d.company_id] || d.status || "",
        is_forwarder: forwarderMap[d.company_id] || false,
        import_yeti_verified: yetiSet.has(d.company_id),
        contact_name: contact.full_name || "",
        contact_email: contact.email || "",
        contact_phone: contact.phone || "",
        contact_title: contact.title || "",
      };
    });
    setProspects(mapped as Prospect[]);
    setLoading(false);

    // Counts - run all grade queries in parallel
    const gradeResults = await Promise.all(
      ["A++", "A+", "A", "B", "C"].map((g) =>
        supabase
          .from("app_scores")
          .select("*", { count: "exact", head: true })
          .eq("grade", g)
          .then(({ count }) => ({ grade: g, count: count || 0 }))
      )
    );
    const newCounts: Record<string, number> = {};
    for (const { grade: g, count } of gradeResults) {
      newCounts[g] = count;
    }
    setCounts(newCounts);
  }

  return (
    <PageGuard pageId="prospects">
    <div>
      <h1 className="text-2xl font-bold mb-4">Prospects</h1>

      <div className="flex gap-2 mb-4">
        {["A++", "A+", "A", "B", "C"].map((g) => (
          <button
            key={g}
            onClick={() => setGrade(g)}
            className={`px-4 py-2 rounded text-sm font-medium ${
              grade === g ? "bg-[#ff3366] text-white" : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
            }`}
          >
            {g} ({(counts[g] || 0).toLocaleString()})
          </button>
        ))}
      </div>

      {/* Grade explanation + scoring key */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-bold text-sm mb-2">
            {grade === "A++" && "A++ - SME Dual Traders (Best Prospects)"}
            {grade === "A+" && "A+ - High-Value Dual Traders"}
            {grade === "A" && "A - Strong Single or Dual Traders"}
            {grade === "B" && "B - Regular Importers"}
            {grade === "C" && "C - Low Activity or New"}
          </h3>
          <p className="text-xs text-zinc-600 leading-relaxed">
            {grade === "A++" && "These companies both import AND export regularly (10+ months each), with ICP scores of 50+ in both directions and at least 5 import lines per month. They need freight management in both directions, ship consistently, and are the ideal size for Braiin's personal service. These are your highest priority targets."}
            {grade === "A+" && "Dual traders with high combined ICP (140+) and strong regularity (10+ months active). They import and export but may have lower volume or fewer months than A++ companies. Still excellent prospects - they need multi-directional freight support."}
            {grade === "A" && "Companies with a combined ICP score of 100+ and 8+ months active. May be strong importers with some export activity, or consistent dual traders with moderate volumes. Solid prospects that could grow into A++ accounts."}
            {grade === "B" && "Regular importers with ICP 50+ and 6+ months of activity. Single-direction traders with consistent shipping patterns. Good volume but may only need import or export support, not both. Still worth pursuing - many B accounts become A++ once you handle both directions."}
            {grade === "C" && "Lower activity companies - either new to importing/exporting, sporadic shippers, or those with low commodity value scores. May be worth monitoring for growth or targeting with specific trade lane offers."}
          </p>
        </div>

        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-bold text-sm mb-3">Scoring Breakdown (max 490)</h3>
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-blue-500"></div>
              <span className="w-32">Combined ICP</span>
              <span className="text-zinc-500">max 190</span>
              <span className="text-zinc-400 ml-auto">Import ICP + Export ICP. Based on HS code value (pharma, retail, projects).</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-green-500"></div>
              <span className="w-32">Regularity</span>
              <span className="text-zinc-500">max 100</span>
              <span className="text-zinc-400 ml-auto">13/13 months active = 100. Ships every month = reliable.</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-purple-500"></div>
              <span className="w-32">Volume</span>
              <span className="text-zinc-500">max 100</span>
              <span className="text-zinc-400 ml-auto">Average import + export lines per month. Higher = more shipments.</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-[#ff3366]"></div>
              <span className="w-32">Dual Trader</span>
              <span className="text-zinc-500">+50</span>
              <span className="text-zinc-400 ml-auto">Bonus for companies that both import AND export.</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-yellow-500"></div>
              <span className="w-32">Complexity</span>
              <span className="text-zinc-500">max 50</span>
              <span className="text-zinc-400 ml-auto">Number of HS chapters. More diverse = more complex supply chain = stickier.</span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t">
            <h4 className="font-medium text-xs mb-2">Grade Thresholds</h4>
            <div className="grid grid-cols-5 gap-2 text-center">
              <div className="bg-[#ff3366] text-white rounded-lg p-3">
                <div className="text-lg font-bold">A++</div>
                <div className="text-xs font-bold mt-1">Dual, ICP 50+/50+, 10mo+, 5+ vol</div>
              </div>
              <div className="bg-orange-500 text-white rounded-lg p-3">
                <div className="text-lg font-bold">A+</div>
                <div className="text-xs font-bold mt-1">Combined 140+, 10mo+</div>
              </div>
              <div className="bg-yellow-500 text-black rounded-lg p-3">
                <div className="text-lg font-bold">A</div>
                <div className="text-xs font-bold mt-1">Combined 100+, 8mo+</div>
              </div>
              <div className="bg-blue-500 text-white rounded-lg p-3">
                <div className="text-lg font-bold">B</div>
                <div className="text-xs font-bold mt-1">ICP 50+, 6mo+</div>
              </div>
              <div className="bg-zinc-400 text-white rounded-lg p-3">
                <div className="text-lg font-bold">C</div>
                <div className="text-xs font-bold mt-1">Below thresholds</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-zinc-400 py-8">Loading...</p>
      ) : (
        <DataTable columns={columns} data={prospects} />
      )}
    </div>
    </PageGuard>
  );
}
