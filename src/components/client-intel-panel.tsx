"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Maximize2, Minimize2, Send, RefreshCw, FileText, Search, Save } from "lucide-react";
import ReactMarkdown from "react-markdown";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type Research = {
  clientNews: string;
  growthSignals: string[];
  retentionRisks: string[];
  competitorIntel: string;
  recommendedAction: string;
  accountHealth: string;
  sourceLinks: string[];
  researchDate: string;
  insight: string;
  ffNetworks: string[];
};

type Note = {
  id: number;
  note: string;
  author: string;
  created_at: string;
};

type Props = {
  accountCode: string;
  clientName: string;
  isForwarder: boolean;
  research: Research;
  onClose: () => void;
};

export function ClientIntelPanel({ accountCode, clientName, isForwarder, research: initialResearch, onClose }: Props) {
  const [width, setWidth] = useState(520);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [research, setResearch] = useState<Research>(initialResearch);
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [researching, setResearching] = useState(false);
  const [reportStatus, setReportStatus] = useState("");
  const [insightEdit, setInsightEdit] = useState(false);
  const [insightText, setInsightText] = useState(initialResearch.insight || "");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<boolean>(false);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // Load notes + chat history on mount
  useEffect(() => {
    loadNotes();
    loadChatHistory();
  }, [accountCode]);

  async function loadNotes() {
    setNotesLoading(true);
    const { data } = await supabase.from("client_notes")
      .select("id, note, author, created_at")
      .eq("account_code", accountCode)
      .order("created_at", { ascending: false }).limit(20);
    setNotes(data || []);
    setNotesLoading(false);
  }

  async function loadChatHistory() {
    const { data } = await supabase.from("client_research")
      .select("chat_history").eq("account_code", accountCode).single();
    if (data?.chat_history && Array.isArray(data.chat_history) && data.chat_history.length > 0) {
      setMessages(data.chat_history);
    } else {
      setMessages([{
        role: "assistant",
        content: `Ready to help with **${clientName}**. Ask me anything about this account, give me context, or generate a report.`,
      }]);
    }
  }

  async function saveChatHistory(msgs: Message[]) {
    await supabase.from("client_research")
      .update({ chat_history: msgs.slice(-30) })
      .eq("account_code", accountCode);
  }

  async function refreshResearch() {
    const { data } = await supabase.from("client_research")
      .select("client_news, growth_signals, retention_risks, competitor_intel, recommended_action, account_health, source_links, research_date, insight, ff_networks")
      .eq("account_code", accountCode).single();
    if (data) {
      setResearch({
        clientNews: data.client_news || "",
        growthSignals: data.growth_signals || [],
        retentionRisks: data.retention_risks || [],
        competitorIntel: data.competitor_intel || "",
        recommendedAction: data.recommended_action || "",
        accountHealth: data.account_health || "",
        sourceLinks: data.source_links || [],
        researchDate: data.research_date || "",
        insight: data.insight || "",
        ffNetworks: data.ff_networks || [],
      });
      setInsightText(data.insight || "");
    }
  }

  async function saveInsight() {
    await supabase.from("client_research")
      .update({ insight: insightText })
      .eq("account_code", accountCode);
    setResearch(prev => ({ ...prev, insight: insightText }));
    setInsightEdit(false);
  }

  async function reResearch() {
    setResearching(true);
    try {
      const res = await fetch("/api/client-reresearch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_code: accountCode }),
      });
      const data = await res.json();
      if (data.success) {
        refreshResearch();
        const newMsg: Message = {
          role: "assistant",
          content: `Research updated. Health: **${data.analysis?.account_health || "unknown"}**. ${data.citations?.length || 0} sources found.`,
        };
        setMessages(prev => { const updated = [...prev, newMsg]; saveChatHistory(updated); return updated; });
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: `Research failed: ${data.error}` }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Research error - try again." }]);
    }
    setResearching(false);
  }

  async function generateReport(type: "internal" | "external") {
    setReportStatus(`Generating ${type} report...`);
    const statusMsg: Message = { role: "assistant", content: `Generating **${type} report** via Gamma. This takes 1-2 minutes...` };
    setMessages(prev => [...prev, statusMsg]);

    try {
      const res = await fetch("/api/client-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_code: accountCode, report_type: type }),
      });
      const data = await res.json();
      if (data.success && data.gammaUrl) {
        setReportStatus("");
        const newMsg: Message = {
          role: "assistant",
          content: `**${type === "internal" ? "Internal" : "Client"} report ready!**\n\n[View Report](${data.gammaUrl})${data.exportUrl ? `\n\n[Download PDF](${data.exportUrl})` : ""}`,
        };
        setMessages(prev => { const updated = [...prev, newMsg]; saveChatHistory(updated); return updated; });
      } else {
        setReportStatus("");
        setMessages(prev => [...prev, { role: "assistant", content: `Report failed: ${data.error || "Unknown error"}` }]);
      }
    } catch {
      setReportStatus("");
      setMessages(prev => [...prev, { role: "assistant", content: "Report generation error." }]);
    }
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    const newMessages = [...messages, { role: "user" as const, content: userMsg }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const res = await fetch("/api/client-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_code: accountCode, message: userMsg, history: messages }),
      });
      const data = await res.json();
      const reply = data.reply || data.error || "No response";
      const updated = [...newMessages, { role: "assistant" as const, content: reply }];
      setMessages(updated);
      saveChatHistory(updated);
      loadNotes();
      refreshResearch();
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Error connecting. Try again." }]);
    }
    setLoading(false);
  }

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    resizeRef.current = true;
    const startX = e.clientX;
    const startWidth = width;
    function handleMouseMove(e: MouseEvent) {
      if (!resizeRef.current) return;
      setWidth(Math.max(400, Math.min(900, startWidth + (startX - e.clientX))));
    }
    function handleMouseUp() {
      resizeRef.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    }
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  return (
    <div className="fixed top-0 right-0 h-full bg-white border-l shadow-2xl flex flex-col z-50"
      style={{ width: expanded ? 800 : width }}>
      {/* Resize handle */}
      <div className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[#ff3366] transition-colors"
        onMouseDown={handleMouseDown} />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-zinc-900 text-white shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm">{clientName}</span>
          {research.accountHealth && (
            <Badge className={`text-[9px] ${
              research.accountHealth === "growing" ? "bg-green-500"
              : research.accountHealth === "at_risk" ? "bg-red-500"
              : "bg-blue-500"
            } text-white`}>{research.accountHealth}</Badge>
          )}
          {isForwarder && <Badge className="text-[9px] bg-amber-500 text-white">FF</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={refreshResearch} className="p-1.5 hover:bg-zinc-700 rounded" title="Refresh">
            <RefreshCw size={13} />
          </button>
          <button onClick={() => setExpanded(!expanded)} className="p-1.5 hover:bg-zinc-700 rounded">
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button onClick={onClose} className="p-1.5 hover:bg-zinc-700 rounded">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex gap-2 px-4 py-2 border-b bg-zinc-50 shrink-0">
        <Button size="sm" onClick={reResearch} disabled={researching}
          className="bg-emerald-600 hover:bg-emerald-700 text-[11px] gap-1.5 h-7">
          <Search size={12} />
          {researching ? "Researching..." : "Re-research"}
        </Button>
        <Button size="sm" onClick={() => generateReport("internal")} disabled={!!reportStatus}
          className="bg-zinc-700 hover:bg-zinc-800 text-[11px] gap-1.5 h-7">
          <FileText size={12} />
          Internal Report
        </Button>
        <Button size="sm" onClick={() => generateReport("external")} disabled={!!reportStatus}
          className="bg-[#ff3366] hover:bg-[#e6004d] text-[11px] gap-1.5 h-7">
          <FileText size={12} />
          Client Report
        </Button>
        {reportStatus && <span className="text-[10px] text-zinc-400 self-center">{reportStatus}</span>}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">

        {/* Braiin Insight - editable */}
        <div className="px-4 py-3 border-b">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-[#ff3366] uppercase">Braiin Insight</h3>
            {!insightEdit ? (
              <button onClick={() => setInsightEdit(true)} className="text-[10px] text-blue-600 hover:underline">Edit</button>
            ) : (
              <button onClick={saveInsight} className="text-[10px] text-green-600 hover:underline flex items-center gap-1">
                <Save size={10} /> Save
              </button>
            )}
          </div>
          {insightEdit ? (
            <textarea
              value={insightText}
              onChange={(e) => setInsightText(e.target.value)}
              className="w-full text-sm border rounded p-2 min-h-[80px] resize-y"
              placeholder="Add recommendations, next steps, account strategy..."
            />
          ) : insightText ? (
            <div className="text-sm prose prose-sm max-w-none">
              <ReactMarkdown>{insightText}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-xs text-zinc-400">No insight yet. Click Edit to add recommendations, next steps, or account strategy.</p>
          )}
        </div>

        {/* Research & News */}
        <div className="px-4 py-3 border-b space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-zinc-500 uppercase">Research & News</h3>
            {research.researchDate && (
              <span className="text-[10px] text-zinc-400">{research.researchDate}</span>
            )}
          </div>

          {research.recommendedAction && (
            <div className="p-2.5 bg-[#ff3366]/10 rounded border border-[#ff3366]/20">
              <span className="text-[10px] text-[#ff3366] font-medium">Recommended action:</span>
              <p className="text-sm mt-0.5">{research.recommendedAction}</p>
            </div>
          )}

          {research.clientNews && (
            <div>
              <span className="text-[10px] text-zinc-400 font-medium">Latest news:</span>
              <p className="text-sm mt-0.5">{research.clientNews}</p>
            </div>
          )}

          {research.competitorIntel && research.competitorIntel !== "None found" && (
            <div>
              <span className="text-[10px] text-zinc-400 font-medium">Competitor:</span>
              <p className="text-sm font-medium mt-0.5">{research.competitorIntel}</p>
            </div>
          )}

          {research.growthSignals.length > 0 && (
            <div>
              <span className="text-[10px] text-green-600 font-medium">Growth signals:</span>
              <ul className="mt-1 space-y-1">
                {research.growthSignals.map((s, i) => (
                  <li key={i} className="text-sm flex items-start gap-1.5">
                    <span className="text-green-500 mt-0.5">+</span><span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {research.retentionRisks.length > 0 && (
            <div>
              <span className="text-[10px] text-red-600 font-medium">Retention risks:</span>
              <ul className="mt-1 space-y-1">
                {research.retentionRisks.map((r, i) => (
                  <li key={i} className="text-sm flex items-start gap-1.5">
                    <span className="text-red-500 mt-0.5">!</span><span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {research.sourceLinks.length > 0 && (
            <div>
              <span className="text-[10px] text-zinc-400 font-medium">Sources:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {research.sourceLinks.map((url, i) => {
                  let domain = "";
                  try { domain = new URL(url).hostname.replace("www.", ""); } catch { domain = url; }
                  return (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                      className="text-[10px] text-blue-600 hover:underline bg-blue-50 px-1.5 py-0.5 rounded">
                      {domain}
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {!research.recommendedAction && !research.clientNews && (
            <p className="text-xs text-zinc-400">No research data yet. Click Re-research above.</p>
          )}
        </div>

        {/* FF Networks - only for forwarders */}
        {isForwarder && (
          <div className="px-4 py-3 border-b">
            <h3 className="text-xs font-bold text-amber-600 uppercase mb-2">Network Memberships</h3>
            {research.ffNetworks.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {research.ffNetworks.map((n, i) => (
                  <Badge key={i} variant="secondary" className="text-xs bg-amber-50 text-amber-700">{n}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-400">No networks detected. Tell the assistant which networks they belong to.</p>
            )}
          </div>
        )}

        {/* Account Notes */}
        <div className="px-4 py-3 border-b">
          <h3 className="text-xs font-bold text-zinc-500 uppercase mb-2">Account Notes</h3>
          {notesLoading ? (
            <p className="text-xs text-zinc-400">Loading...</p>
          ) : notes.length === 0 ? (
            <p className="text-xs text-zinc-400">No notes yet.</p>
          ) : (
            <div className="space-y-1.5">
              {notes.map((n) => (
                <div key={n.id} className="text-xs p-2 bg-zinc-50 rounded">
                  <p className="text-zinc-700">{n.note}</p>
                  <p className="text-[10px] text-zinc-400 mt-0.5">
                    {n.author && `${n.author} - `}
                    {new Date(n.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Chat History */}
        <div className="px-4 py-3">
          <h3 className="text-xs font-bold text-zinc-500 uppercase mb-2">Chat</h3>
          <div className="space-y-2">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                  msg.role === "user"
                    ? "bg-[#25D366] text-white"
                    : "bg-zinc-100 text-zinc-800"
                }`}>
                  {msg.role === "assistant" ? (
                    <div className="prose prose-xs max-w-none [&_p]:m-0 [&_ul]:m-0 [&_li]:m-0 [&_strong]:font-semibold [&_a]:text-blue-600 [&_a]:underline">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-zinc-100 rounded-lg px-3 py-2 text-xs text-zinc-400">Thinking...</div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      {/* Input - fixed at bottom */}
      <div className="px-4 py-2.5 border-t bg-white shrink-0">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Ask about this account or add intel..."
            className="flex-1 px-3 py-2 border rounded text-sm bg-white"
            disabled={loading}
          />
          <Button size="sm" onClick={sendMessage} disabled={loading || !input.trim()}
            className="bg-[#ff3366] hover:bg-[#e6004d]">
            <Send size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
