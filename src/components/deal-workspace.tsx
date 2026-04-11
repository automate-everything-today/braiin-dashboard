"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Send, ChevronDown, ChevronRight, Paperclip, Image, Mail, Phone, ListTodo, FileText, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { formatGBP } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import type { Deal, PipelineStage } from "@/services/deals";
import * as dealService from "@/services/deals";
import { IntelSection } from "./intel-section";

type Message = {
  id?: number;
  type: "user" | "ai" | "system" | "email_in" | "email_out" | "note" | "task";
  content: string;
  sender_name?: string;
  created_at?: string;
};

type Props = {
  deal: Deal;
  stages: PipelineStage[];
  onClose: () => void;
  onUpdate: () => void;
};

export function DealWorkspace({ deal, stages, onClose, onUpdate }: Props) {
  const qc = useQueryClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [accountIntel, setAccountIntel] = useState<any>(null);
  const [showActions, setShowActions] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // Load thread history
  useEffect(() => {
    loadThread();
    loadAccountIntel();
  }, [deal.id]);

  async function loadThread() {
    const { data } = await supabase
      .from("deal_messages")
      .select("*")
      .eq("deal_id", deal.id)
      .order("created_at", { ascending: true });

    if (data && data.length > 0) {
      setMessages(data.map((m: any) => ({
        id: m.id,
        type: m.type,
        content: m.content,
        sender_name: m.sender_name,
        created_at: m.created_at,
      })));
    } else {
      // First time opening - add a system message
      setMessages([{
        type: "system",
        content: `Deal opened - ${deal.title}`,
        created_at: deal.created_at,
      }]);
    }
  }

  async function loadAccountIntel() {
    setAccountIntel(null);
    if (!deal.account_code && !deal.company_id) return;

    const intel: any = {};

    if (deal.account_code) {
      const { data: perf } = await supabase.from("client_performance")
        .select("profit_total, total_jobs, report_month, fcl_jobs, lcl_jobs, air_jobs, bbk_jobs")
        .eq("account_code", deal.account_code);
      if (perf && perf.length > 0) {
        intel.isClient = true;
        intel.totalJobs = perf.reduce((s: number, r: any) => s + (r.total_jobs || 0), 0);
        intel.totalProfit = perf.reduce((s: number, r: any) => s + (Number(r.profit_total) || 0), 0);
        intel.months = perf.length;
        intel.modes = `FCL ${perf.reduce((s: number, r: any) => s + (r.fcl_jobs || 0), 0)} - Air ${perf.reduce((s: number, r: any) => s + (r.air_jobs || 0), 0)} - LCL ${perf.reduce((s: number, r: any) => s + (r.lcl_jobs || 0), 0)} - Road ${perf.reduce((s: number, r: any) => s + (r.bbk_jobs || 0), 0)}`;
      }

      const { data: research } = await supabase.from("client_research")
        .select("client_news, recommended_action, account_health, competitor_intel, is_forwarder")
        .eq("account_code", deal.account_code).single();
      if (research) Object.assign(intel, research);

      const { count } = await supabase.from("cargowise_contacts")
        .select("*", { count: "exact", head: true })
        .eq("account_code", deal.account_code);
      intel.contactCount = count || 0;
    }

    if (deal.company_id) {
      const { data: enrichment } = await supabase.from("enrichments")
        .select("commodity_summary, angle, pain_points, current_provider, suggested_approach")
        .eq("company_id", deal.company_id).single();
      if (enrichment) Object.assign(intel, enrichment);
    }

    if (Object.keys(intel).length > 0) setAccountIntel(intel);
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      // For text files, paste content into chat
      if (file.type.startsWith("text/") || file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
        setInput(`[File: ${file.name}]\n${content.slice(0, 3000)}`);
      } else {
        // For other files, just note the upload
        setMessages(prev => [...prev, { type: "system", content: `File uploaded: **${file.name}** (${(file.size / 1024).toFixed(0)} KB)`, created_at: new Date().toISOString() }]);
        supabase.from("deal_messages").insert({ deal_id: deal.id, type: "system", content: `File uploaded: ${file.name} (${(file.size / 1024).toFixed(0)} KB)` }).then(({ error }) => { if (error) console.error("[deal-workspace] Insert failed:", error); });
        toast.success(`${file.name} uploaded`);
      }
    };
    if (file.type.startsWith("text/") || file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
      reader.readAsText(file);
    } else {
      reader.readAsDataURL(file);
      // Log the upload
      setMessages(prev => [...prev, { type: "system", content: `File uploaded: **${file.name}** (${(file.size / 1024).toFixed(0)} KB)`, created_at: new Date().toISOString() }]);
      supabase.from("deal_messages").insert({ deal_id: deal.id, type: "system", content: `File uploaded: ${file.name}` }).then(({ error }) => { if (error) console.error("[deal-workspace] Insert failed:", error); });
      toast.success(`${file.name} uploaded`);
    }
    e.target.value = "";
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMessages(prev => [...prev, { type: "system", content: `Image uploaded: **${file.name}**`, created_at: new Date().toISOString() }]);
    supabase.from("deal_messages").insert({ deal_id: deal.id, type: "system", content: `Image uploaded: ${file.name}` }).then(({ error }) => { if (error) console.error("[deal-workspace] Insert failed:", error); });
    toast.success(`Image uploaded`);
    e.target.value = "";
  }

  function insertQuickAction(action: string) {
    setShowActions(false);
    switch (action) {
      case "email": setInput("/email "); break;
      case "call": setInput("Just had a call with "); break;
      case "task": setInput("/task "); break;
      case "wisor": setInput("Send to Wisor - "); break;
      case "research": setInput("/research"); sendMessageWithText("/research"); break;
      case "meeting": setInput("Book a meeting - "); break;
      default: break;
    }
  }

  async function sendMessageWithText(text: string) {
    setInput("");
    const userMsg = text.trim();
    setMessages(prev => [...prev, { type: "user", content: userMsg, created_at: new Date().toISOString() }]);
    setLoading(true);
    try {
      const res = await fetch("/api/deal-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: deal.id, message: userMsg, history: messages.filter(m => m.type === "user" || m.type === "ai").map(m => ({ role: m.type === "user" ? "user" : "assistant", content: m.content })) }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { type: "ai", content: data.reply || data.error || "No response", created_at: new Date().toISOString() }]);
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    } catch {
      setMessages(prev => [...prev, { type: "ai", content: "Error - try again.", created_at: new Date().toISOString() }]);
    }
    setLoading(false);
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");

    // Add user message to UI immediately
    setMessages(prev => [...prev, { type: "user", content: userMsg, created_at: new Date().toISOString() }]);
    setLoading(true);

    try {
      const res = await fetch("/api/deal-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deal_id: deal.id,
          message: userMsg,
          history: messages.filter(m => m.type === "user" || m.type === "ai").map(m => ({
            role: m.type === "user" ? "user" : "assistant",
            content: m.content,
          })),
        }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, {
        type: "ai",
        content: data.reply || data.error || "No response",
        created_at: new Date().toISOString(),
      }]);
      // Refresh deal data
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    } catch {
      setMessages(prev => [...prev, { type: "ai", content: "Error - try again.", created_at: new Date().toISOString() }]);
    }
    setLoading(false);
  }

  async function moveStage(stageId: number, stageName: string) {
    await dealService.moveDealStage(deal.id, stageId, stageName);
    setMessages(prev => [...prev, { type: "system", content: `Stage moved to **${stageName}**`, created_at: new Date().toISOString() }]);
    await supabase.from("deal_messages").insert({ deal_id: deal.id, type: "system", content: `Stage moved to ${stageName}` }).then(({ error }) => { if (error) console.error("[deal-workspace] Insert failed:", error); });
    onUpdate();
    toast.success(`Moved to ${stageName}`);
  }

  const currentStage = stages.find(s => s.id === deal.stage_id || s.name === deal.stage);

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-1 hover:bg-zinc-100 rounded">
            <X size={18} className="text-zinc-400" />
          </button>
          <div>
            <h2 className="text-sm font-semibold">{deal.title}</h2>
            <p className="text-xs text-zinc-400">{deal.company_name}{deal.contact_email ? ` - ${deal.contact_email}` : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {currentStage && (
            <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: currentStage.color + "20", color: currentStage.color }}>
              {currentStage.name}
            </span>
          )}
          {deal.value > 0 && <span className="text-xs font-semibold">{formatGBP(deal.value)}</span>}
          <span className="text-xs text-zinc-400">{deal.days_in_stage}d in stage</span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && (
          <div className="w-72 border-r overflow-y-auto shrink-0 p-4 space-y-3">
            {/* Stage selector */}
            <div>
              <p className="text-[10px] text-zinc-400 font-medium uppercase mb-1.5">Stage</p>
              <div className="space-y-0.5">
                {stages.map(s => (
                  <button key={s.id} onClick={() => moveStage(s.id, s.name)}
                    className={`w-full text-left px-2 py-1 rounded text-xs flex items-center gap-2 ${
                      (deal.stage_id === s.id || deal.stage === s.name)
                        ? "bg-zinc-900 text-white font-medium"
                        : "hover:bg-zinc-50"
                    }`}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Deal details */}
            <div className="space-y-1.5 text-xs">
              <p className="text-[10px] text-zinc-400 font-medium uppercase">Details</p>
              {deal.description && <p className="text-zinc-600">{deal.description}</p>}
              <div className="flex justify-between"><span className="text-zinc-400">Source</span><span>{deal.source?.replace(/_/g, " ") || "-"}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Assigned</span><span>{deal.assigned_to || "-"}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Branch</span><span>{deal.branch || "-"}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Created</span><span>{new Date(deal.created_at).toLocaleDateString("en-GB")}</span></div>
            </div>

            {/* Account intel */}
            {accountIntel && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <p className="text-[10px] text-zinc-400 font-medium uppercase">
                    {accountIntel.isClient ? "Client Intel" : "Prospect Intel"}
                  </p>
                  {accountIntel.is_forwarder && <Badge variant="secondary" className="text-[8px]">FF</Badge>}
                </div>

                {accountIntel.isClient && (
                  <IntelSection title="Performance" preview={`${accountIntel.totalJobs} jobs`} sectionId="perf" dealId={deal.id}>
                    <p>**{accountIntel.totalJobs}** jobs over **{accountIntel.months}** months</p>
                    <p>Profit: **{formatGBP(accountIntel.totalProfit)}**</p>
                    <p className="text-zinc-400">{accountIntel.modes}</p>
                  </IntelSection>
                )}

                {accountIntel.commodity_summary && (
                  <IntelSection title="What they ship" preview={accountIntel.commodity_summary.slice(0, 40)} sectionId="ships" dealId={deal.id}>
                    <p>{accountIntel.commodity_summary}</p>
                  </IntelSection>
                )}

                {accountIntel.angle && (
                  <IntelSection title="Our angle" preview={accountIntel.angle.slice(0, 40)} sectionId="angle" dealId={deal.id}>
                    <p>{accountIntel.angle}</p>
                  </IntelSection>
                )}

                {accountIntel.current_provider && accountIntel.current_provider !== "Unknown" && (
                  <IntelSection title="Current provider" preview={accountIntel.current_provider} sectionId="provider" dealId={deal.id}>
                    <p>**{accountIntel.current_provider}**</p>
                  </IntelSection>
                )}

                {accountIntel.pain_points?.length > 0 && (
                  <IntelSection title="Pain points" preview={accountIntel.pain_points[0]?.slice(0, 30)} sectionId="pains" dealId={deal.id}>
                    {accountIntel.pain_points.map((p: string, i: number) => (
                      <p key={i}>- {p}</p>
                    ))}
                  </IntelSection>
                )}

                {accountIntel.client_news && (
                  <IntelSection title="Latest news" preview={accountIntel.client_news.slice(0, 40)} sectionId="news" dealId={deal.id}>
                    <p>{accountIntel.client_news}</p>
                  </IntelSection>
                )}

                {accountIntel.contactCount > 0 && (
                  <p className="text-[10px] text-zinc-400">{accountIntel.contactCount} contacts on file</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Thread */}
        <div className="flex-1 flex flex-col">
          {/* Toggle sidebar */}
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            className="self-start px-3 py-1 text-[10px] text-zinc-400 hover:text-zinc-600">
            {sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          </button>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={`${msg.type === "user" ? "flex justify-end" : ""}`}>
                {msg.type === "system" ? (
                  <div className="text-center">
                    <p className="text-[10px] text-zinc-400">{msg.content} - {msg.created_at ? new Date(msg.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</p>
                  </div>
                ) : msg.type === "user" ? (
                  <div className="max-w-[70%] bg-zinc-900 text-white rounded-2xl rounded-br-sm px-4 py-2.5">
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    {msg.created_at && <p className="text-[10px] text-zinc-400 mt-1">{new Date(msg.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>}
                  </div>
                ) : msg.type === "ai" ? (
                  <div className="max-w-[75%] bg-zinc-50 rounded-2xl rounded-bl-sm px-4 py-2.5 border">
                    <div className="text-sm prose prose-sm max-w-none [&_p]:m-0 [&_p]:mb-1 [&_ul]:m-0 [&_li]:m-0 [&_strong]:font-semibold">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                    {msg.created_at && <p className="text-[10px] text-zinc-400 mt-1">{new Date(msg.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>}
                  </div>
                ) : (
                  <div className="bg-zinc-50 rounded px-3 py-2 border text-sm">
                    <p>{msg.content}</p>
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="max-w-[75%] bg-zinc-50 rounded-2xl rounded-bl-sm px-4 py-2.5 border">
                <p className="text-sm text-zinc-400 animate-pulse">Thinking...</p>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t px-6 py-3 shrink-0">
            {/* Action bar */}
            <div className="flex items-center gap-1 mb-2">
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".txt,.csv,.pdf,.doc,.docx,.xls,.xlsx,.eml" />
              <input type="file" ref={imageInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />

              <button onClick={() => fileInputRef.current?.click()} className="p-1.5 hover:bg-zinc-100 rounded text-zinc-400 hover:text-zinc-600" title="Upload file">
                <Paperclip size={16} />
              </button>
              <button onClick={() => imageInputRef.current?.click()} className="p-1.5 hover:bg-zinc-100 rounded text-zinc-400 hover:text-zinc-600" title="Upload image">
                <Image size={16} />
              </button>

              <div className="w-px h-4 bg-zinc-200 mx-1" />

              <button onClick={() => insertQuickAction("email")} className="px-2 py-1 hover:bg-zinc-100 rounded text-xs text-zinc-500 hover:text-zinc-700 flex items-center gap-1" title="Draft email">
                <Mail size={13} /> Email
              </button>
              <button onClick={() => insertQuickAction("call")} className="px-2 py-1 hover:bg-zinc-100 rounded text-xs text-zinc-500 hover:text-zinc-700 flex items-center gap-1" title="Log a call">
                <Phone size={13} /> Call
              </button>
              <button onClick={() => insertQuickAction("task")} className="px-2 py-1 hover:bg-zinc-100 rounded text-xs text-zinc-500 hover:text-zinc-700 flex items-center gap-1" title="Create task">
                <ListTodo size={13} /> Task
              </button>
              <button onClick={() => insertQuickAction("wisor")} className="px-2 py-1 hover:bg-zinc-100 rounded text-xs text-zinc-500 hover:text-zinc-700 flex items-center gap-1" title="Send to Wisor for pricing">
                <FileText size={13} /> Wisor
              </button>

              <div className="relative">
                <button onClick={() => setShowActions(!showActions)} className="p-1.5 hover:bg-zinc-100 rounded text-zinc-400 hover:text-zinc-600">
                  <MoreHorizontal size={16} />
                </button>
                {showActions && (
                  <div className="absolute bottom-full mb-1 left-0 bg-white border rounded-lg shadow-lg py-1 w-44 z-50">
                    <button onClick={() => insertQuickAction("research")} className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50">Research this company</button>
                    <button onClick={() => insertQuickAction("meeting")} className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50">Book a meeting</button>
                    <button onClick={() => { setInput("What should I do next?"); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50">Ask for next step</button>
                    <button onClick={() => { setInput("Draft a follow-up email"); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50">Draft follow-up</button>
                    <button onClick={() => { setInput("Summarise this deal"); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50">Summarise deal</button>
                  </div>
                )}
              </div>
            </div>

            {/* Text input */}
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Type a message, paste an email, or ask a question..."
                className="flex-1 px-4 py-2.5 border rounded-xl text-sm bg-zinc-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-zinc-300 resize-none min-h-[42px] max-h-[120px]"
                disabled={loading}
                rows={1}
                onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; }}
              />
              <Button size="sm" onClick={sendMessage} disabled={loading || !input.trim()}
                className="rounded-xl bg-zinc-900 hover:bg-zinc-800 px-4 self-end">
                <Send size={14} />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
