"use client";

import { useEffect, useState, useMemo } from "react";
import { useStaff, useUpdateStaff, useAddStaff, useDeactivateStaff, useBonusConfig, useUpdateBonusConfig, useApplyBonusToAll } from "@/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Save, X } from "lucide-react";
import { PageGuard } from "@/components/page-guard";

const formatGBP = (v: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v);

const DEPT_COLORS: Record<string, string> = {
  Management: "bg-purple-100 text-purple-700",
  Accounts: "bg-green-100 text-green-700",
  Air: "bg-yellow-100 text-yellow-700",
  Customs: "bg-teal-100 text-teal-700",
  Sea: "bg-blue-100 text-blue-700",
  Road: "bg-zinc-200 text-zinc-700",
  Warehouse: "bg-orange-100 text-orange-700",
  Sales: "bg-[#ff3366]/10 text-[#ff3366]",
  Ops: "bg-cyan-100 text-cyan-700",
};

const COUNTRY_FLAGS: Record<string, string> = {
  UK: "GB", Turkey: "TR", Spain: "ES", Poland: "PL", India: "IN",
  Germany: "DE", France: "FR", USA: "US", Brazil: "BR", UAE: "AE",
  Netherlands: "NL", China: "CN", Philippines: "PH",
};
function flag(c: string) {
  const code = COUNTRY_FLAGS[c];
  if (!code) return "";
  return String.fromCodePoint(...[...code].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
}

const BRANCHES = ["London HQ", "Manchester", "Southampton", "Heathrow", "Newcastle", "International"];
const DEPARTMENTS = ["Management", "Accounts", "Air", "Customs", "Sea", "Road", "Warehouse", "Sales", "Ops"];
const COUNTRIES = ["UK", "Turkey", "Spain", "Poland", "India", "Germany", "France", "USA", "Brazil", "UAE", "Netherlands", "China", "Philippines"];

type Staff = {
  id: number;
  name: string;
  role: string;
  department: string;
  branch: string;
  new_salary: number;
  nic: number;
  pension: number;
  monthly_cost: number;
  contract_type: string;
  is_manager: boolean;
  bonus_eligible: boolean;
  bonus_t1: number;
  bonus_t2: number;
  bonus_t3: number;
  country: string;
  is_remote: boolean;
  fte_pct: number;
  professional_fees: number;
  overseas_tax: number;
  notes: string;
  start_date: string | null;
  end_date: string | null;
};

const DEPT_ORDER: Record<string, number> = { Management: 0, Accounts: 1, Air: 2, Customs: 3, Sea: 4, Road: 5, Warehouse: 6, Sales: 7, Ops: 8 };

export default function TeamPage() {
  const { data: staff = [] as Staff[], isLoading } = useStaff() as { data: Staff[] | undefined; isLoading: boolean };
  const { data: bonusConfigData } = useBonusConfig(2026);

  const updateStaff = useUpdateStaff();
  const addStaffMutation = useAddStaff();
  const deactivateStaff = useDeactivateStaff();
  const updateBonusConfig = useUpdateBonusConfig();
  const applyBonusToAll = useApplyBonusToAll();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [adding, setAdding] = useState(false);
  const [newForm, setNewForm] = useState<any>({
    name: "", role: "", department: "Sales", branch: "HQ",
    new_salary: 0, nic: 0, pension: 0, contract_type: "paye",
    is_manager: false, bonus_eligible: true, bonus_t1: 1.0, bonus_t2: 1.25, bonus_t3: 1.5,
    country: "UK", is_remote: false, fte_pct: 100, notes: "", start_date: "", end_date: "",
    professional_fees: 0, overseas_tax: 0,
  });
  const [branchFilter, setBranchFilter] = useState("all");
  const [bonusConfig, setBonusConfig] = useState({ staff_t1: 1, staff_t2: 1.25, staff_t3: 1.5, manager_t1: 1.5, manager_t2: 1.75, manager_t3: 2.0 });
  const [editingConfig, setEditingConfig] = useState(false);
  const [configForm, setConfigForm] = useState({ ...bonusConfig });

  useEffect(() => {
    if (bonusConfigData) {
      const c = {
        staff_t1: Number(bonusConfigData.staff_t1),
        staff_t2: Number(bonusConfigData.staff_t2),
        staff_t3: Number(bonusConfigData.staff_t3),
        manager_t1: Number(bonusConfigData.manager_t1),
        manager_t2: Number(bonusConfigData.manager_t2),
        manager_t3: Number(bonusConfigData.manager_t3),
      };
      setBonusConfig(c);
      setConfigForm(c);
    }
  }, [bonusConfigData]);

  async function saveBonusConfig() {
    await updateBonusConfig.mutateAsync({
      year: 2026,
      config: {
        staff_t1: configForm.staff_t1, staff_t2: configForm.staff_t2, staff_t3: configForm.staff_t3,
        manager_t1: configForm.manager_t1, manager_t2: configForm.manager_t2, manager_t3: configForm.manager_t3,
        updated_at: new Date().toISOString(),
      },
    });
    await applyBonusToAll.mutateAsync(configForm);
    setBonusConfig({ ...configForm });
    setEditingConfig(false);
  }

  async function saveEdit() {
    if (!editingId) return;
    const monthly = ((editForm.new_salary * (editForm.fte_pct / 100)) / 12) + (Number(editForm.nic) || 0) + (Number(editForm.pension) || 0) + (Number(editForm.professional_fees) || 0) + (Number(editForm.overseas_tax) || 0);
    try {
      await updateStaff.mutateAsync({
        id: editingId,
        updates: {
          name: editForm.name,
          email: editForm.email || "",
          role: editForm.role,
          department: editForm.department,
          branch: editForm.branch,
          salary: editForm.new_salary,
          new_salary: editForm.new_salary,
          nic: Number(editForm.nic) || 0,
          pension: Number(editForm.pension) || 0,
          monthly_cost: monthly,
          contract_type: editForm.contract_type,
          is_manager: editForm.is_manager,
          bonus_eligible: editForm.bonus_eligible,
          bonus_t1: editForm.bonus_t1,
          bonus_t2: editForm.bonus_t2,
          bonus_t3: editForm.bonus_t3,
          country: editForm.country,
          is_remote: editForm.is_remote,
          fte_pct: editForm.fte_pct,
          professional_fees: Number(editForm.professional_fees) || 0,
          overseas_tax: Number(editForm.overseas_tax) || 0,
          notes: editForm.notes || "",
          start_date: editForm.start_date || null,
          end_date: editForm.end_date || null,
        },
      });
      setEditingId(null);
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  }

  async function handleDeleteStaff(id: number) {
    await deactivateStaff.mutateAsync(id);
  }

  async function handleAddStaff() {
    const monthly = ((newForm.new_salary * (newForm.fte_pct / 100)) / 12) + (Number(newForm.nic) || 0) + (Number(newForm.pension) || 0) + (Number(newForm.professional_fees) || 0) + (Number(newForm.overseas_tax) || 0);
    try {
      await addStaffMutation.mutateAsync({
        name: newForm.name,
        email: newForm.email || "",
        role: newForm.role,
        department: newForm.department,
        branch: newForm.branch,
        salary: newForm.new_salary,
        new_salary: newForm.new_salary,
        nic: Number(newForm.nic) || 0,
        pension: Number(newForm.pension) || 0,
        monthly_cost: monthly,
        contract_type: newForm.contract_type,
        is_manager: newForm.is_manager,
        bonus_eligible: newForm.bonus_eligible,
        bonus_t1: newForm.bonus_t1,
        bonus_t2: newForm.bonus_t2,
        bonus_t3: newForm.bonus_t3,
        country: newForm.country,
        is_remote: newForm.is_remote,
        fte_pct: newForm.fte_pct,
        professional_fees: Number(newForm.professional_fees) || 0,
        overseas_tax: Number(newForm.overseas_tax) || 0,
        notes: newForm.notes || "",
        start_date: newForm.start_date || new Date().toISOString().split("T")[0],
        ...(newForm.end_date ? { end_date: newForm.end_date } : {}),
        is_active: true,
      });
      setAdding(false);
      setNewForm({
        name: "", role: "", department: "Sales", branch: "HQ",
        new_salary: 0, nic: 0, pension: 0, contract_type: "paye",
        is_manager: false, bonus_eligible: true, bonus_t1: 1.0, bonus_t2: 1.25, bonus_t3: 1.5,
        country: "UK", is_remote: false, fte_pct: 100, notes: "", start_date: "", end_date: "",
      });
    } catch (error: any) {
      alert(`Error adding staff: ${error.message}`);
    }
  }

  const sorted = useMemo(() => [...(staff as Staff[])].sort((a, b) => {
    if (a.department === "Management" && b.department !== "Management") return -1;
    if (b.department === "Management" && a.department !== "Management") return 1;
    const deptA = DEPT_ORDER[a.department] ?? 99;
    const deptB = DEPT_ORDER[b.department] ?? 99;
    if (deptA !== deptB) return deptA - deptB;
    if (a.is_manager && !b.is_manager) return -1;
    if (b.is_manager && !a.is_manager) return 1;
    return a.name.localeCompare(b.name);
  }), [staff]);

  const filtered = useMemo(() =>
    branchFilter === "all" ? sorted : sorted.filter(s => s.branch === branchFilter),
    [sorted, branchFilter]
  );

  const totalMonthly = useMemo(() => filtered.reduce((s, x) => s + x.monthly_cost, 0), [filtered]);
  const eligible = useMemo(() => filtered.filter(s => s.bonus_eligible), [filtered]);

  const bonusCost = useMemo(() => ({
    t1: eligible.reduce((s, x) => s + ((x.new_salary * (x.fte_pct / 100)) / 12) * x.bonus_t1, 0),
    t2: eligible.reduce((s, x) => s + ((x.new_salary * (x.fte_pct / 100)) / 12) * x.bonus_t2, 0),
    t3: eligible.reduce((s, x) => s + ((x.new_salary * (x.fte_pct / 100)) / 12) * x.bonus_t3, 0),
  }), [eligible]);

  const remoteCount = useMemo(() => filtered.filter(s => s.is_remote).length, [filtered]);
  const ukCount = useMemo(() => filtered.filter(s => !s.is_remote).length, [filtered]);

  if (isLoading) return <p className="text-zinc-400 py-12">Loading team data...</p>;

  function renderEditRow(form: any, setForm: (f: any) => void, onSave: () => void, onCancel: () => void) {
    return (
      <Card className="mb-4 border-blue-300">
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <div><label className="text-[10px] text-zinc-500">Name</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
            <div><label className="text-[10px] text-zinc-500">Role</label>
              <input value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
            <div><label className="text-[10px] text-zinc-500">Department</label>
              <select value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm">
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}</select></div>
            <div><label className="text-[10px] text-zinc-500">Branch</label>
              <select value={form.branch} onChange={e => setForm({ ...form, branch: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm">
                {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
            <div><label className="text-[10px] text-zinc-500">Country</label>
              <select value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm">
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label className="text-[10px] text-zinc-500">Login Email</label>
              <input type="email" value={form.email || ""} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" placeholder="name@example.com" /></div>
            <div><label className="text-[10px] text-zinc-500">Annual Salary</label>
              <input type="number" value={form.new_salary} onChange={e => setForm({ ...form, new_salary: Number(e.target.value) })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
            <div><label className="text-[10px] text-zinc-500">FTE %</label>
              <input type="number" value={form.fte_pct} onChange={e => setForm({ ...form, fte_pct: Number(e.target.value) })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
            <div><label className="text-[10px] text-zinc-500">Employer NIC/mo (UK)</label>
              <input type="number" value={form.nic || 0} onChange={e => setForm({ ...form, nic: Number(e.target.value) })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
            <div><label className="text-[10px] text-zinc-500">Pension/mo (UK)</label>
              <input type="number" value={form.pension || 0} onChange={e => setForm({ ...form, pension: Number(e.target.value) })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
            <div><label className="text-[10px] text-zinc-500">Professional Fees/mo (OS)</label>
              <input type="number" value={form.professional_fees || 0} onChange={e => setForm({ ...form, professional_fees: Number(e.target.value) })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
            <div><label className="text-[10px] text-zinc-500">Overseas Tax/mo</label>
              <input type="number" value={form.overseas_tax || 0} onChange={e => setForm({ ...form, overseas_tax: Number(e.target.value) })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
            <div><label className="text-[10px] text-zinc-500">Contract Type</label>
              <select value={form.contract_type} onChange={e => setForm({ ...form, contract_type: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm">
                <option value="paye">PAYE</option><option value="contract">Contract</option></select></div>
            <div><label className="text-[10px] text-zinc-500">Remote</label>
              <select value={form.is_remote ? "yes" : "no"} onChange={e => setForm({ ...form, is_remote: e.target.value === "yes" })} className="w-full px-2 py-1.5 border rounded text-sm">
                <option value="no">Office</option><option value="yes">Remote</option></select></div>
            <div><label className="text-[10px] text-zinc-500">Bonus Eligible</label>
              <select value={form.bonus_eligible ? "yes" : "no"} onChange={e => setForm({ ...form, bonus_eligible: e.target.value === "yes" })} className="w-full px-2 py-1.5 border rounded text-sm">
                <option value="yes">Yes</option><option value="no">No</option></select></div>
            <div><label className="text-[10px] text-zinc-500">Start Date</label>
              <input type="date" value={form.start_date || ""} onChange={e => setForm({ ...form, start_date: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
            <div><label className="text-[10px] text-zinc-500">End Date</label>
              <input type="date" value={form.end_date || ""} onChange={e => setForm({ ...form, end_date: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
          </div>
          <div className="mb-3">
            <label className="text-[10px] text-zinc-500">Notes (additional charges, arrangements, etc.)</label>
            <textarea value={form.notes || ""} onChange={e => setForm({ ...form, notes: e.target.value })}
              className="w-full px-2 py-1.5 border rounded text-sm min-h-[60px]"
              placeholder="Free text - additional charges, remote setup costs, visa requirements, etc." />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={onSave} disabled={!form.name} className="bg-green-600 hover:bg-green-700 text-xs gap-1.5"><Save size={12} /> Save</Button>
            <Button size="sm" variant="outline" onClick={onCancel} className="text-xs gap-1.5"><X size={12} /> Cancel</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <PageGuard pageId="team">
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Team</h1>
        <div className="flex gap-2">
          <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
            className="px-2 py-1.5 border rounded text-xs">
            <option value="all">All branches</option>
            {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <Button size="sm" onClick={() => setAdding(true)} className="bg-[#ff3366] hover:bg-[#e6004d] gap-1.5 text-xs">
            <Plus size={14} /> Add Staff
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-zinc-400">Headcount</p>
          <p className="text-2xl font-bold">{filtered.length}</p>
          <p className="text-[10px] text-zinc-400">{ukCount} office, {remoteCount} remote</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-zinc-400">Monthly Payroll</p>
          <p className="text-lg font-bold">{formatGBP(totalMonthly)}</p>
          <p className="text-[10px] text-zinc-400">Annual: {formatGBP(totalMonthly * 12)}</p>
        </CardContent></Card>
        <Card className="border-green-200"><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-green-600 font-medium">T1 Bonus Cost</p>
          <p className="text-lg font-bold text-green-700">{formatGBP(bonusCost.t1)}</p>
          <p className="text-[10px] text-zinc-400">{eligible.length} eligible</p>
        </CardContent></Card>
        <Card className="border-yellow-200"><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-yellow-600 font-medium">T2 Bonus Cost</p>
          <p className="text-lg font-bold text-yellow-700">{formatGBP(bonusCost.t2)}</p>
        </CardContent></Card>
        <Card className="border-orange-200"><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-orange-600 font-medium">T3 Bonus Cost</p>
          <p className="text-lg font-bold text-orange-700">{formatGBP(bonusCost.t3)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-zinc-400">Avg Cost/Head</p>
          <p className="text-lg font-bold">{formatGBP(filtered.length > 0 ? totalMonthly / filtered.length : 0)}</p>
          <p className="text-[10px] text-zinc-400">per month</p>
        </CardContent></Card>
      </div>

      {/* Add form */}
      {adding && renderEditRow(newForm, setNewForm, handleAddStaff, () => setAdding(false))}

      {/* Edit form */}
      {editingId && renderEditRow(editForm, setEditForm, saveEdit, () => setEditingId(null))}

      {/* Staff table */}
      <Card>
        <CardContent className="pt-4">
          <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-100">
              <tr>
                <th className="p-2 text-left">Name</th>
                <th className="p-2 text-left">Role</th>
                <th className="p-2 text-left">Dept</th>
                <th className="p-2 text-left">Branch</th>
                <th className="p-2 text-right">Salary/mo</th>
                <th className="p-2 text-right">NIC + Pen</th>
                <th className="p-2 text-right">Prof Fees</th>
                <th className="p-2 text-right">OS Tax</th>
                <th className="p-2 text-right">Total/mo</th>
                <th className="p-2 text-center">FTE</th>
                <th className="p-2 text-center">Bonus</th>
                <th className="p-2 text-right">T1</th>
                <th className="p-2 text-right">T2</th>
                <th className="p-2 text-right">T3</th>
                <th className="p-2 text-right w-20"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => {
                const monthlySal = (s.new_salary * (s.fte_pct / 100)) / 12;
                return (
                  <tr key={s.id} className={`border-t hover:bg-zinc-50 group ${!s.bonus_eligible ? "opacity-60" : ""}`}>
                    <td className="p-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{s.name}</span>
                        {s.is_manager && <Badge className="bg-purple-100 text-purple-700 text-[8px]">Mgr</Badge>}
                        {s.is_remote && <span className="text-[10px]" title={s.country}>{flag(s.country)}</span>}
                        {s.contract_type === "contract" && <Badge variant="secondary" className="text-[8px]">Contract</Badge>}
                      </div>
                      {s.notes && <p className="text-[10px] text-zinc-400 mt-0.5">{s.notes}</p>}
                    </td>
                    <td className="p-2 text-zinc-500">{s.role}</td>
                    <td className="p-2"><Badge className={`${DEPT_COLORS[s.department] || "bg-zinc-100"} text-[9px]`}>{s.department}</Badge></td>
                    <td className="p-2 text-zinc-500">{s.branch}</td>
                    <td className="p-2 text-right">{formatGBP((s.new_salary * (s.fte_pct / 100)) / 12)}</td>
                    <td className="p-2 text-right text-zinc-400">{(s.nic || 0) + (s.pension || 0) > 0 ? formatGBP((s.nic || 0) + (s.pension || 0)) : "-"}</td>
                    <td className="p-2 text-right text-zinc-400">{s.professional_fees ? formatGBP(s.professional_fees) : "-"}</td>
                    <td className="p-2 text-right text-zinc-400">{s.overseas_tax ? formatGBP(s.overseas_tax) : "-"}</td>
                    <td className="p-2 text-right font-medium">{formatGBP(s.monthly_cost)}</td>
                    <td className="p-2 text-center">
                      {s.fte_pct < 100 ? <Badge variant="secondary" className="text-[8px]">{s.fte_pct}%</Badge> : <span className="text-zinc-300">100%</span>}
                    </td>
                    <td className="p-2 text-center">
                      {s.bonus_eligible ? <Badge className="bg-green-100 text-green-700 text-[8px]">Yes</Badge> : <span className="text-zinc-300">-</span>}
                    </td>
                    <td className="p-2 text-right text-green-600">{s.bonus_eligible ? formatGBP(monthlySal * s.bonus_t1) : "-"}</td>
                    <td className="p-2 text-right text-yellow-600">{s.bonus_eligible ? formatGBP(monthlySal * s.bonus_t2) : "-"}</td>
                    <td className="p-2 text-right text-orange-600">{s.bonus_eligible ? formatGBP(monthlySal * s.bonus_t3) : "-"}</td>
                    <td className="p-2 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditingId(s.id); setEditForm({ ...s }); }} className="text-blue-600 hover:underline text-[10px] mr-2">Edit</button>
                      <button onClick={() => handleDeleteStaff(s.id)} className="text-[#ff3366] hover:underline text-[10px]">Leave</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-zinc-100 font-bold">
              <tr>
                <td className="p-2" colSpan={4}>{filtered.length} staff ({eligible.length} bonus eligible)</td>
                <td className="p-2 text-right">{formatGBP(filtered.reduce((s, x) => s + ((x.new_salary * (x.fte_pct / 100)) / 12), 0))}</td>
                <td className="p-2 text-right text-zinc-400">{formatGBP(filtered.reduce((s, x) => s + (x.nic || 0) + (x.pension || 0), 0))}</td>
                <td className="p-2 text-right text-zinc-400">{formatGBP(filtered.reduce((s, x) => s + (x.professional_fees || 0), 0))}</td>
                <td className="p-2 text-right text-zinc-400">{formatGBP(filtered.reduce((s, x) => s + (x.overseas_tax || 0), 0))}</td>
                <td className="p-2 text-right font-bold">{formatGBP(totalMonthly)}</td>
                <td className="p-2"></td>
                <td className="p-2"></td>
                <td className="p-2 text-right text-green-600">{formatGBP(bonusCost.t1)}</td>
                <td className="p-2 text-right text-yellow-600">{formatGBP(bonusCost.t2)}</td>
                <td className="p-2 text-right text-orange-600">{formatGBP(bonusCost.t3)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          </div>
        </CardContent>
      </Card>

      {/* Bonus Config */}
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Bonus Structure - 2026</CardTitle>
            {!editingConfig ? (
              <Button size="sm" variant="outline" onClick={() => { setConfigForm({ ...bonusConfig }); setEditingConfig(true); }} className="text-xs">Edit Multipliers</Button>
            ) : (
              <div className="flex gap-2">
                <Button size="sm" onClick={saveBonusConfig} className="bg-green-600 hover:bg-green-700 text-xs gap-1"><Save size={12} /> Save & Apply to All</Button>
                <Button size="sm" variant="outline" onClick={() => setEditingConfig(false)} className="text-xs">Cancel</Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="font-medium text-zinc-700 text-sm mb-2">Base Staff (additional monthly salary)</p>
              {editingConfig ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500 w-12">Tier 1:</span>
                    <input type="number" step="0.25" value={configForm.staff_t1} onChange={e => setConfigForm({ ...configForm, staff_t1: Number(e.target.value) })}
                      className="w-20 px-2 py-1 border rounded text-sm" />
                    <span className="text-xs text-zinc-400">x monthly salary</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500 w-12">Tier 2:</span>
                    <input type="number" step="0.25" value={configForm.staff_t2} onChange={e => setConfigForm({ ...configForm, staff_t2: Number(e.target.value) })}
                      className="w-20 px-2 py-1 border rounded text-sm" />
                    <span className="text-xs text-zinc-400">x monthly salary</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500 w-12">Tier 3:</span>
                    <input type="number" step="0.25" value={configForm.staff_t3} onChange={e => setConfigForm({ ...configForm, staff_t3: Number(e.target.value) })}
                      className="w-20 px-2 py-1 border rounded text-sm" />
                    <span className="text-xs text-zinc-400">x monthly salary</span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-zinc-500 space-y-1">
                  <p>Tier 1: +{bonusConfig.staff_t1}x monthly salary</p>
                  <p>Tier 2: +{bonusConfig.staff_t2}x monthly salary</p>
                  <p>Tier 3: +{bonusConfig.staff_t3}x monthly salary</p>
                </div>
              )}
            </div>
            <div>
              <p className="font-medium text-zinc-700 text-sm mb-2">Managers (additional monthly salary)</p>
              {editingConfig ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500 w-12">Tier 1:</span>
                    <input type="number" step="0.25" value={configForm.manager_t1} onChange={e => setConfigForm({ ...configForm, manager_t1: Number(e.target.value) })}
                      className="w-20 px-2 py-1 border rounded text-sm" />
                    <span className="text-xs text-zinc-400">x monthly salary</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500 w-12">Tier 2:</span>
                    <input type="number" step="0.25" value={configForm.manager_t2} onChange={e => setConfigForm({ ...configForm, manager_t2: Number(e.target.value) })}
                      className="w-20 px-2 py-1 border rounded text-sm" />
                    <span className="text-xs text-zinc-400">x monthly salary</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500 w-12">Tier 3:</span>
                    <input type="number" step="0.25" value={configForm.manager_t3} onChange={e => setConfigForm({ ...configForm, manager_t3: Number(e.target.value) })}
                      className="w-20 px-2 py-1 border rounded text-sm" />
                    <span className="text-xs text-zinc-400">x monthly salary</span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-zinc-500 space-y-1">
                  <p>Tier 1: +{bonusConfig.manager_t1}x monthly salary</p>
                  <p>Tier 2: +{bonusConfig.manager_t2}x monthly salary</p>
                  <p>Tier 3: +{bonusConfig.manager_t3}x monthly salary</p>
                </div>
              )}
            </div>
          </div>
          <p className="text-[10px] text-zinc-400 mt-3">Clicking "Save & Apply to All" updates every eligible staff member. Pro-rata staff have bonus calculated on their pro-rata monthly salary.</p>
        </CardContent>
      </Card>
    </div>
    </PageGuard>
  );
}
