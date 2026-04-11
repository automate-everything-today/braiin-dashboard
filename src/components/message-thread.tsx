"use client";

import { useMessages } from "@/hooks/use-messages";
import { MessageInput } from "./message-input";
import { useEffect, useRef } from "react";

type Props = {
  contextType: string;
  contextId: string;
  contextSummary?: string;
  contextUrl?: string;
};

export function MessageThread({ contextType, contextId, contextSummary, contextUrl }: Props) {
  const { data: messages, refetch } = useMessages(contextType, contextId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {(!messages || messages.length === 0) ? (
          <p className="text-[10px] text-zinc-400 text-center py-4">No messages yet - use @ to mention a colleague</p>
        ) : (
          messages.map((msg: any) => (
            <div key={msg.id} className="flex items-start gap-2">
              <div className="w-6 h-6 rounded-full bg-zinc-900 text-white flex items-center justify-center text-[9px] font-medium shrink-0">
                {(msg.author_name || "?").split(" ").filter(Boolean).map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs font-medium">{msg.author_name}</span>
                  <span className="text-[9px] text-zinc-400">
                    {new Date(msg.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="text-xs text-zinc-700 whitespace-pre-wrap break-words">
                  {msg.content.replace(/@([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, (match: string) => `**${match}**`)}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      <div className="border-t p-2">
        <MessageInput
          contextType={contextType}
          contextId={contextId}
          contextSummary={contextSummary}
          contextUrl={contextUrl}
          onSent={() => refetch()}
        />
      </div>
    </div>
  );
}
