"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Save, X, Settings } from "lucide-react";
import { PageGuard } from "@/components/page-guard";
import { useBranches, useUpdateBranch, useAddBranch, useToggleBranch } from "@/hooks";

const formatGBP = (v: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v);

type Branch = {
  id: number;
  name: string;
  code: string;
  city: string;
  country: string;
  fee_model: string;
  ops_fee_per_job: number;
  gp_percentage: number;
  warehouse_gp_percentage: number;
  software_fee_per_user: number;
  is_active: boolean;
};

export default function SettingsPage() {
  const { data: branches = [], isLoading } = useBranches();
  const updateMutation = useUpdateBranch();
  const addMutation = useAddBranch();
  const toggleMutation = useToggleBranch();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [adding, setAdding] = useState(false);
  const [newForm, setNewForm] = useState({
    name: "", code: "", city: "", country: "UK",
    fee_model: "hq_ops", ops_fee_per_job: 150, gp_percentage: 15,
    warehouse_gp_percentage: 20, software_fee_per_user: 100,
  });

  async function saveBranch() {
    if (!editingId) return;
    try {
      await updateMutation.mutateAsync({ id: editingId, updates: editForm });
      setEditingId(null);
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  }

  async function addBranch() {
    try {
      await addMutation.mutateAsync({ ...newForm, is_active: true });
      setAdding(false);
      setNewForm({ name: "", code: "", city: "", country: "UK", fee_model: "hq_ops", ops_fee_per_job: 150, gp_percentage: 15, warehouse_gp_percentage: 20, software_fee_per_user: 100 });
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  }

  async function toggleBranch(id: number, active: boolean) {
    await toggleMutation.mutateAsync({ id, currentActive: active });
  }

  if (isLoading) return <p className="text-zinc-400 py-12">Loading settings...</p>;

  return (
    <PageGuard pageId="settings">
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-xs text-zinc-400">Super Admin only - branch configuration and fee models</p>
        </div>
        <Badge className="bg-zinc-900 text-white text-xs">Super Admin Only</Badge>
      </div>

      {/* Branches */}
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Branches</CardTitle>
            <Button size="sm" onClick={() => setAdding(true)} className="bg-[#ff3366] hover:bg-[#e6004d] text-xs gap-1.5">
              <Plus size={14} /> Add Branch
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Add form */}
          {adding && (
            <div className="border rounded-lg p-4 mb-4 bg-green-50 border-green-300">
              <h4 className="text-sm font-bold text-green-700 mb-3">New Branch</h4>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                <div><label className="text-[10px] text-zinc-500">Branch Name</label>
                  <input value={newForm.name} onChange={e => setNewForm({ ...newForm, name: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" placeholder="e.g. Birmingham" /></div>
                <div><label className="text-[10px] text-zinc-500">Branch Code</label>
                  <input value={newForm.code} onChange={e => setNewForm({ ...newForm, code: e.target.value.toUpperCase() })} className="w-full px-2 py-1.5 border rounded text-sm" placeholder="e.g. BHM" maxLength={5} /></div>
                <div><label className="text-[10px] text-zinc-500">City</label>
                  <input value={newForm.city} onChange={e => setNewForm({ ...newForm, city: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
                <div><label className="text-[10px] text-zinc-500">Country</label>
                  <input value={newForm.country} onChange={e => setNewForm({ ...newForm, country: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={addBranch} disabled={!newForm.name || !newForm.code} className="bg-green-600 hover:bg-green-700 text-xs gap-1"><Save size={12} /> Create</Button>
                <Button size="sm" variant="outline" onClick={() => setAdding(false)} className="text-xs"><X size={12} /> Cancel</Button>
              </div>
            </div>
          )}

          {/* Branch list */}
          <div className="space-y-3">
            {branches.map(b => (
              editingId === b.id ? (
                <div key={b.id} className="border rounded-lg p-4 bg-blue-50 border-blue-300">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                    <div><label className="text-[10px] text-zinc-500">Branch Name</label>
                      <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
                    <div><label className="text-[10px] text-zinc-500">Branch Code</label>
                      <input value={editForm.code} onChange={e => setEditForm({ ...editForm, code: e.target.value.toUpperCase() })} className="w-full px-2 py-1.5 border rounded text-sm" maxLength={5} /></div>
                    <div><label className="text-[10px] text-zinc-500">City</label>
                      <input value={editForm.city} onChange={e => setEditForm({ ...editForm, city: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
                    <div><label className="text-[10px] text-zinc-500">Country</label>
                      <input value={editForm.country} onChange={e => setEditForm({ ...editForm, country: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-500 uppercase mt-3 mb-2">Fee Model</h4>
                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
                    <div><label className="text-[10px] text-zinc-500">Model</label>
                      <select value={editForm.fee_model} onChange={e => setEditForm({ ...editForm, fee_model: e.target.value })} className="w-full px-2 py-1.5 border rounded text-sm">
                        <option value="hq_ops">Model A: HQ Ops</option>
                        <option value="own_ops">Model B: Own Ops</option>
                      </select></div>
                    <div><label className="text-[10px] text-zinc-500">Ops Fee/Job</label>
                      <input type="number" value={editForm.ops_fee_per_job} onChange={e => setEditForm({ ...editForm, ops_fee_per_job: Number(e.target.value) })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
                    <div><label className="text-[10px] text-zinc-500">GP %</label>
                      <input type="number" value={editForm.gp_percentage} onChange={e => setEditForm({ ...editForm, gp_percentage: Number(e.target.value) })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
                    <div><label className="text-[10px] text-zinc-500">Warehouse GP %</label>
                      <input type="number" value={editForm.warehouse_gp_percentage} onChange={e => setEditForm({ ...editForm, warehouse_gp_percentage: Number(e.target.value) })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
                    <div><label className="text-[10px] text-zinc-500">Software/User/mo</label>
                      <input type="number" value={editForm.software_fee_per_user} onChange={e => setEditForm({ ...editForm, software_fee_per_user: Number(e.target.value) })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveBranch} className="bg-green-600 hover:bg-green-700 text-xs gap-1"><Save size={12} /> Save</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="text-xs"><X size={12} /> Cancel</Button>
                  </div>
                </div>
              ) : (
                <div key={b.id} className={`border rounded-lg p-4 ${b.is_active ? "bg-white" : "bg-zinc-50 opacity-60"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm">{b.name}</span>
                          <Badge variant="secondary" className="text-[10px]">{b.code}</Badge>
                          {!b.is_active && <Badge className="bg-red-100 text-red-700 text-[9px]">Inactive</Badge>}
                        </div>
                        <p className="text-xs text-zinc-400">{b.city}{b.city && b.country ? ", " : ""}{b.country}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right text-xs">
                        <Badge className={b.fee_model === "hq_ops" ? "bg-blue-100 text-blue-700 text-[9px]" : "bg-green-100 text-green-700 text-[9px]"}>
                          {b.fee_model === "hq_ops" ? "Model A: HQ Ops" : "Model B: Own Ops"}
                        </Badge>
                      </div>
                      <div className="text-right text-xs space-y-0.5">
                        <p className="text-zinc-500">Ops fee: {formatGBP(b.ops_fee_per_job)}/job</p>
                        <p className="text-zinc-500">GP: {b.gp_percentage}% | WH: {b.warehouse_gp_percentage}%</p>
                        <p className="text-zinc-500">Software: {formatGBP(b.software_fee_per_user)}/user/mo</p>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => { setEditingId(b.id); setEditForm({ ...b }); }} className="text-xs h-7">Edit</Button>
                        <Button size="sm" variant="outline" onClick={() => toggleBranch(b.id, b.is_active)}
                          className={`text-xs h-7 ${b.is_active ? "text-red-600" : "text-green-600"}`}>
                          {b.is_active ? "Disable" : "Enable"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
    </PageGuard>
  );
}
