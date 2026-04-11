"use client";

import { useEffect, useState } from "react";
import { useMyMentions } from "@/hooks/use-messages";
import { MessageThread } from "@/components/message-thread";
import { PageGuard } from "@/components/page-guard";
import { Badge } from "@/components/ui/badge";
import { MessageSquare } from "lucide-react";
import type { PlatformMessage } from "@/types";

export default function MessagesPage() {
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<PlatformMessage | null>(null);

  useEffect(() => {
    fetch("/api/auth/session").then(r => r.json()).then(d => {
      if (d.email) setEmail(d.email);
    });
  }, []);

  const { data: mentions } = useMyMentions(email);

  // Group by context
  const grouped = (mentions || []).reduce((acc: Record<string, PlatformMessage[]>, msg: PlatformMessage) => {
    const key = `${msg.context_type}:${msg.context_id || "general"}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(msg);
    return acc;
  }, {} as Record<string, PlatformMessage[]>);

  const threads = (Object.entries(grouped) as [string, PlatformMessage[]][]).map(([key, msgs]) => ({
    key,
    latest: msgs[0],
    count: msgs.length,
    contextType: msgs[0].context_type,
    contextId: msgs[0].context_id,
    contextSummary: msgs[0].context_summary,
    contextUrl: msgs[0].context_url,
  }));

  return (
    <PageGuard pageId="messages">
    <div className="h-[calc(100vh-48px)] flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0">
        <MessageSquare size={18} />
        <h1 className="text-lg font-semibold">Messages</h1>
        <span className="text-xs text-zinc-400">{threads.length} conversations</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Thread list */}
        <div className="w-96 border-r overflow-y-auto shrink-0">
          {threads.length === 0 ? (
            <p className="text-sm text-zinc-400 p-4">No messages yet</p>
          ) : (
            threads.map(t => (
              <button key={t.key} onClick={() => setSelected(t.latest)}
                className={`w-full text-left px-4 py-3 border-b hover:bg-zinc-50 ${selected?.context_type === t.contextType && selected?.context_id === t.contextId ? "bg-zinc-50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[8px]">{t.contextType}</Badge>
                      <span className="text-xs font-medium truncate">{t.latest.author_name}</span>
                    </div>
                    <p className="text-xs text-zinc-600 truncate mt-0.5">
                      {t.contextSummary || t.latest.content.slice(0, 80)}
                    </p>
                    <p className="text-[10px] text-zinc-400 mt-0.5">
                      {t.count} message{t.count > 1 ? "s" : ""} - {new Date(t.latest.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Message thread */}
        <div className="flex-1 overflow-hidden">
          {selected?.context_type && selected?.context_id ? (
            <MessageThread
              contextType={selected.context_type}
              contextId={selected.context_id!}
              contextSummary={selected.context_summary || undefined}
              contextUrl={selected.context_url || undefined}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
              Select a conversation
            </div>
          )}
        </div>
      </div>
    </div>
    </PageGuard>
  );
}
