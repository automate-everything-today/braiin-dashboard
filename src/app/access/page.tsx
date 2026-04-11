"use client";

import { useState } from "react";
import { useStaff, useUpdateStaff } from "@/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Save, Shield } from "lucide-react";
import { PageGuard } from "@/components/page-guard";

const ROLES = [
  { id: "super_admin", label: "Super Admin", color: "bg-purple-100 text-purple-700", desc: "Full access to everything - Rob & Sam" },
  { id: "admin", label: "Admin", color: "bg-indigo-100 text-indigo-700", desc: "Everything except P&L, Staff, Bonuses" },
  { id: "branch_md", label: "Branch MD", color: "bg-blue-100 text-blue-700", desc: "Their branch P&L, team, clients, CRM" },
  { id: "manager", label: "Manager", color: "bg-green-100 text-green-700", desc: "Department data, client intel, CRM" },
  { id: "sales_rep", label: "Sales Rep", color: "bg-[#ff3366]/10 text-[#ff3366]", desc: "Their accounts only, their leads, CRM" },
  { id: "ops", label: "Ops", color: "bg-yellow-100 text-yellow-700", desc: "Shipments, clients, contacts" },
  { id: "accounts", label: "Accounts", color: "bg-cyan-100 text-cyan-700", desc: "P&L, billing, invoicing" },
  { id: "viewer", label: "Viewer", color: "bg-zinc-200 text-zinc-600", desc: "Read-only basic access" },
];

const PAGES = [
  { id: "pnl", label: "P&L", sensitive: true, scope: "branch" },
  { id: "bonus", label: "Bonus Tracker", sensitive: true, scope: "global" },
  { id: "team", label: "Team", sensitive: true, scope: "branch" },
  { id: "settings", label: "Settings", sensitive: true, scope: "global" },
  { id: "access", label: "Access Management", sensitive: true, scope: "global" },
  { id: "performance", label: "Performance", sensitive: false, scope: "branch" },
  { id: "client-intel", label: "Client Intel", sensitive: false, scope: "assigned" },
  { id: "clients", label: "Clients", sensitive: false, scope: "assigned" },
  { id: "lead-intel", label: "Lead Intel", sensitive: false, scope: "assigned" },
  { id: "prospects", label: "Prospects", sensitive: false, scope: "all" },
  { id: "enriched", label: "Enriched", sensitive: false, scope: "all" },
  { id: "cold-calling", label: "Cold Calling", sensitive: false, scope: "assigned" },
  { id: "overview", label: "Overview", sensitive: false, scope: "branch" },
  { id: "usage", label: "Usage", sensitive: false, scope: "global" },
  { id: "billing", label: "Billing", sensitive: true, scope: "branch" },
];

const DEFAULT_ACCESS: Record<string, string[]> = {
  super_admin: PAGES.map(p => p.id),
  admin: PAGES.filter(p => !["pnl", "bonus", "team", "access"].includes(p.id)).map(p => p.id),
  branch_md: ["pnl", "performance", "client-intel", "clients", "team", "overview", "enriched", "prospects", "cold-calling", "billing"],
  manager: ["performance", "client-intel", "clients", "overview", "enriched", "prospects", "cold-calling"],
  sales_rep: ["client-intel", "clients", "enriched", "prospects", "cold-calling", "overview", "lead-intel"],
  ops: ["client-intel", "clients", "performance", "overview"],
  accounts: ["pnl", "performance", "clients", "overview", "billing"],
  viewer: ["overview"],
};

type StaffMember = {
  id: number;
  name: string;
  email: string;
  role: string;
  department: string;
  branch: string;
  access_role: string;
  page_access: string[];
};

export default function AccessPage() {
  const { data: staff = [], isLoading: loading } = useStaff();
  const updateStaff = useUpdateStaff();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRole, setEditRole] = useState("");
  const [editPages, setEditPages] = useState<string[]>([]);
  const [saved, setSaved] = useState("");

  function startEdit(s: StaffMember) {
    setEditingId(s.id);
    setEditRole(s.access_role);
    setEditPages(s.page_access?.length > 0 ? s.page_access : DEFAULT_ACCESS[s.access_role] || []);
  }

  function applyRoleDefaults(role: string) {
    setEditRole(role);
    setEditPages(DEFAULT_ACCESS[role] || []);
  }

  function togglePage(pageId: string) {
    setEditPages(prev =>
      prev.includes(pageId) ? prev.filter(p => p !== pageId) : [...prev, pageId]
    );
  }

  async function saveAccess() {
    if (!editingId) return;
    await updateStaff.mutateAsync({
      id: editingId,
      updates: { access_role: editRole, page_access: editPages },
    });
    setEditingId(null);
    setSaved("Saved");
    setTimeout(() => setSaved(""), 2000);
  }

  if (loading) return <p className="text-zinc-400 py-12">Loading access data...</p>;

  const roleCounts: Record<string, number> = {};
  staff.forEach(s => { roleCounts[s.access_role] = (roleCounts[s.access_role] || 0) + 1; });

  return (
    <PageGuard pageId="access">
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Access Management</h1>
          <p className="text-xs text-zinc-400">Control who can see what - Super Admin only</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <Badge className="bg-green-100 text-green-700">{saved}</Badge>}
          <Badge className="bg-zinc-900 text-white text-xs">Super Admin Only</Badge>
        </div>
      </div>

      {/* Role summary */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {ROLES.map(r => (
          <div key={r.id} className={`px-3 py-1.5 rounded text-xs font-medium ${r.color}`}>
            {r.label}: {roleCounts[r.id] || 0}
          </div>
        ))}
      </div>

      {/* Edit panel */}
      {editingId && (
        <Card className="mb-4 border-blue-300">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Editing: {staff.find(s => s.id === editingId)?.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Role selector */}
            <div className="mb-4">
              <label className="text-[10px] text-zinc-500 font-medium uppercase mb-2 block">Role</label>
              <div className="flex gap-2 flex-wrap">
                {ROLES.map(r => (
                  <button key={r.id} onClick={() => applyRoleDefaults(r.id)}
                    className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                      editRole === r.id ? r.color + " border-current" : "bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400"
                    }`}>
                    {r.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-zinc-400 mt-1">
                {ROLES.find(r => r.id === editRole)?.desc}
              </p>
            </div>

            {/* Page access toggles */}
            <div className="mb-4">
              <label className="text-[10px] text-zinc-500 font-medium uppercase mb-2 block">Page Access</label>
              <div className="grid grid-cols-3 lg:grid-cols-5 gap-2">
                {PAGES.map(p => (
                  <button key={p.id} onClick={() => togglePage(p.id)}
                    className={`px-3 py-2 rounded text-xs text-left border transition-colors ${
                      editPages.includes(p.id)
                        ? "bg-green-50 border-green-300 text-green-700"
                        : "bg-zinc-50 border-zinc-200 text-zinc-400"
                    }`}>
                    <div className="flex items-center justify-between">
                      <span>{p.label}</span>
                      <div className="flex items-center gap-1">
                        {p.sensitive && <Shield size={10} className="text-red-400" />}
                      </div>
                    </div>
                    <div className="text-[8px] text-zinc-400 mt-0.5">
                      {p.scope === "assigned" ? "Own accounts" : p.scope === "branch" ? "Own branch" : p.scope === "global" ? "Global" : "All data"}
                    </div>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-zinc-400 mt-1">
                <Shield size={8} className="inline text-red-400" /> = sensitive page (financials, team data)
              </p>
            </div>

            <div className="flex gap-2">
              <Button size="sm" onClick={saveAccess} className="bg-green-600 hover:bg-green-700 text-xs gap-1.5">
                <Save size={12} /> Save Access
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="text-xs">Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Staff list */}
      <Card>
        <CardContent className="pt-4">
          <table className="w-full text-xs">
            <thead className="bg-zinc-100">
              <tr>
                <th className="p-2 text-left">Name</th>
                <th className="p-2 text-left">Email</th>
                <th className="p-2 text-left">Department</th>
                <th className="p-2 text-left">Branch</th>
                <th className="p-2 text-left">Role</th>
                <th className="p-2 text-left">Access</th>
                <th className="p-2 text-right w-16"></th>
              </tr>
            </thead>
            <tbody>
              {staff.map(s => {
                const role = ROLES.find(r => r.id === s.access_role);
                const pages = s.page_access?.length > 0 ? s.page_access : DEFAULT_ACCESS[s.access_role] || [];
                return (
                  <tr key={s.id} className={`border-t hover:bg-zinc-50 ${editingId === s.id ? "bg-blue-50" : ""}`}>
                    <td className="p-2 font-medium">{s.name}</td>
                    <td className="p-2 text-zinc-500">{s.email || "-"}</td>
                    <td className="p-2 text-zinc-500">{s.department}</td>
                    <td className="p-2 text-zinc-500">{s.branch}</td>
                    <td className="p-2">
                      <Badge className={`${role?.color || "bg-zinc-200"} text-[9px]`}>
                        {role?.label || s.access_role}
                      </Badge>
                    </td>
                    <td className="p-2">
                      <span className="text-zinc-400">{pages.length} pages</span>
                    </td>
                    <td className="p-2 text-right">
                      <button onClick={() => startEdit(s)} className="text-blue-600 hover:underline text-[10px]">
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Default access matrix */}
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-zinc-500">Default Access by Role</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-zinc-100">
                  <th className="p-1.5 text-left">Page</th>
                  {ROLES.map(r => (
                    <th key={r.id} className="p-1.5 text-center">{r.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PAGES.map(p => (
                  <tr key={p.id} className="border-t">
                    <td className="p-1.5 font-medium flex items-center gap-1">
                      {p.label}
                      {p.sensitive && <Shield size={8} className="text-red-400" />}
                    </td>
                    {ROLES.map(r => (
                      <td key={r.id} className="p-1.5 text-center">
                        {DEFAULT_ACCESS[r.id]?.includes(p.id)
                          ? <span className="text-green-600">+</span>
                          : <span className="text-zinc-300">-</span>
                        }
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
    </PageGuard>
  );
}
