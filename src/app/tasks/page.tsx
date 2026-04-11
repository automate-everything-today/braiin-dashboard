"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Check, X, Clock, AlertTriangle } from "lucide-react";
import { PageGuard } from "@/components/page-guard";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

type Task = {
  id: number;
  title: string;
  description: string;
  account_code: string;
  deal_id: number | null;
  assigned_to: string;
  created_by: string;
  due_date: string | null;
  priority: string;
  status: string;
  auto_generated: boolean;
  source: string;
  completed_at: string | null;
  created_at: string;
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-yellow-100 text-yellow-700",
  low: "bg-zinc-100 text-zinc-500",
};

async function getTasks(filter: string): Promise<Task[]> {
  let query = supabase.from("tasks").select("*").order("due_date", { ascending: true });
  if (filter === "open") query = query.in("status", ["open", "in_progress"]);
  if (filter === "completed") query = query.eq("status", "completed");
  if (filter === "overdue") query = query.in("status", ["open", "in_progress"]).lt("due_date", new Date().toISOString().split("T")[0]);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as Task[];
}

export default function TasksPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("open");
  const [showNew, setShowNew] = useState(false);
  const [newTask, setNewTask] = useState({ title: "", description: "", assigned_to: "", due_date: "", priority: "medium", account_code: "" });

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["tasks", filter],
    queryFn: () => getTasks(filter),
  });

  const createTask = useMutation({
    mutationFn: async (task: typeof newTask) => {
      const { error } = await supabase.from("tasks").insert({
        ...task,
        status: "open",
        auto_generated: false,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); toast.success("Task created"); },
    onError: () => toast.error("Failed to create task"),
  });

  const completeTask = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from("tasks").update({
        status: "completed",
        completed_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); toast.success("Task completed"); },
  });

  const deleteTask = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from("tasks").update({ status: "cancelled" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); toast.success("Task cancelled"); },
  });

  async function handleCreate() {
    if (!newTask.title) return;
    await createTask.mutateAsync(newTask);
    setShowNew(false);
    setNewTask({ title: "", description: "", assigned_to: "", due_date: "", priority: "medium", account_code: "" });
  }

  const overdue = tasks.filter(t => t.due_date && t.due_date < new Date().toISOString().split("T")[0] && t.status !== "completed");
  const today = tasks.filter(t => t.due_date === new Date().toISOString().split("T")[0]);

  if (isLoading) return <p className="text-zinc-400 py-12">Loading tasks...</p>;

  return (
    <PageGuard pageId="tasks">
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Tasks</h1>
        <Button size="sm" onClick={() => setShowNew(true)} className="bg-[#ff3366] hover:bg-[#e6004d] text-xs gap-1.5">
          <Plus size={14} /> New Task
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        {[
          { id: "open", label: "Open" },
          { id: "overdue", label: `Overdue (${overdue.length})` },
          { id: "completed", label: "Completed" },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded text-xs font-medium ${filter === f.id ? "bg-[#1B2A4A] text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-zinc-400">Total Open</p>
          <p className="text-2xl font-bold">{tasks.filter(t => t.status !== "completed" && t.status !== "cancelled").length}</p>
        </CardContent></Card>
        <Card className={overdue.length > 0 ? "border-red-300" : ""}><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-red-600">Overdue</p>
          <p className={`text-2xl font-bold ${overdue.length > 0 ? "text-red-600" : ""}`}>{overdue.length}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-zinc-400">Due Today</p>
          <p className="text-2xl font-bold">{today.length}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-2">
          <p className="text-[10px] text-zinc-400">Completed</p>
          <p className="text-2xl font-bold text-green-600">{tasks.filter(t => t.status === "completed").length}</p>
        </CardContent></Card>
      </div>

      {/* New task form */}
      {showNew && (
        <Card className="mb-4 border-green-300">
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <div className="col-span-2"><label className="text-[10px] text-zinc-500">Task *</label>
                <input value={newTask.title} onChange={e => setNewTask({ ...newTask, title: e.target.value })}
                  className="w-full px-2 py-1.5 border rounded text-sm" placeholder="What needs to be done?" /></div>
              <div><label className="text-[10px] text-zinc-500">Due Date</label>
                <input type="date" value={newTask.due_date} onChange={e => setNewTask({ ...newTask, due_date: e.target.value })}
                  className="w-full px-2 py-1.5 border rounded text-sm" /></div>
              <div><label className="text-[10px] text-zinc-500">Priority</label>
                <select value={newTask.priority} onChange={e => setNewTask({ ...newTask, priority: e.target.value })}
                  className="w-full px-2 py-1.5 border rounded text-sm">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select></div>
              <div><label className="text-[10px] text-zinc-500">Assigned To</label>
                <input value={newTask.assigned_to} onChange={e => setNewTask({ ...newTask, assigned_to: e.target.value })}
                  className="w-full px-2 py-1.5 border rounded text-sm" /></div>
              <div><label className="text-[10px] text-zinc-500">Account Code</label>
                <input value={newTask.account_code} onChange={e => setNewTask({ ...newTask, account_code: e.target.value })}
                  className="w-full px-2 py-1.5 border rounded text-sm" placeholder="Optional" /></div>
              <div className="col-span-2"><label className="text-[10px] text-zinc-500">Description</label>
                <input value={newTask.description} onChange={e => setNewTask({ ...newTask, description: e.target.value })}
                  className="w-full px-2 py-1.5 border rounded text-sm" /></div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={!newTask.title} className="bg-green-600 hover:bg-green-700 text-xs gap-1"><Check size={12} /> Create</Button>
              <Button size="sm" variant="outline" onClick={() => setShowNew(false)} className="text-xs"><X size={12} /> Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Task list */}
      <div className="space-y-2">
        {tasks.map(t => {
          const isOverdue = t.due_date && t.due_date < new Date().toISOString().split("T")[0] && t.status !== "completed";
          return (
            <div key={t.id} className={`flex items-center gap-3 p-3 bg-white rounded-lg border ${isOverdue ? "border-red-300" : "border-zinc-200"} group`}>
              {/* Complete button */}
              {t.status !== "completed" ? (
                <button onClick={() => completeTask.mutate(t.id)}
                  className="w-5 h-5 rounded-full border-2 border-zinc-300 hover:border-green-500 hover:bg-green-50 shrink-0" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                  <Check size={12} className="text-white" />
                </div>
              )}

              {/* Task content */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${t.status === "completed" ? "line-through text-zinc-400" : ""}`}>{t.title}</p>
                {t.description && <p className="text-xs text-zinc-400 truncate">{t.description}</p>}
                <div className="flex items-center gap-2 mt-1">
                  {t.assigned_to && <span className="text-[10px] text-zinc-500">{t.assigned_to}</span>}
                  {t.account_code && <Badge variant="secondary" className="text-[8px]">{t.account_code}</Badge>}
                  {t.auto_generated && <Badge variant="secondary" className="text-[8px] bg-blue-50 text-blue-600">AI</Badge>}
                </div>
              </div>

              {/* Priority */}
              <Badge className={`${PRIORITY_COLORS[t.priority]} text-[9px] shrink-0`}>{t.priority}</Badge>

              {/* Due date */}
              <div className="shrink-0 text-right">
                {t.due_date ? (
                  <span className={`text-xs ${isOverdue ? "text-red-600 font-medium" : "text-zinc-500"}`}>
                    {isOverdue && <AlertTriangle size={10} className="inline mr-1" />}
                    {new Date(t.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </span>
                ) : (
                  <span className="text-xs text-zinc-300">No date</span>
                )}
              </div>

              {/* Cancel button */}
              {t.status !== "completed" && (
                <button onClick={() => deleteTask.mutate(t.id)}
                  className="text-zinc-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <X size={14} />
                </button>
              )}
            </div>
          );
        })}

        {tasks.length === 0 && (
          <p className="text-center text-zinc-400 text-sm py-8">No tasks</p>
        )}
      </div>
    </div>
    </PageGuard>
  );
}
