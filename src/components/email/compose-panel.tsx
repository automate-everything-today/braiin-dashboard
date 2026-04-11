"use client";

import { useState } from "react";
import { Send, X, Paperclip, Clock, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/rich-text-editor";

export interface ComposePanelProps {
  compose: { to: string; subject: string; body: string; cc: string };
  setCompose: (v: { to: string; subject: string; body: string; cc: string }) => void;
  onSend: () => void;
  onClose: () => void;
}

export function ComposePanel({ compose, setCompose, onSend, onClose }: ComposePanelProps) {
  const [showCc, setShowCc] = useState(!!compose.cc);
  const [showBcc, setShowBcc] = useState(false);
  const [bcc, setBcc] = useState("");

  return (
    <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b bg-white">
        <h2 className="text-sm font-semibold text-zinc-900">New Email</h2>
        <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 rounded-lg transition-colors">
          <X size={16} className="text-zinc-400" />
        </button>
      </div>

      {/* Fields */}
      <div className="bg-white border-b">
        {/* To */}
        <div className="flex items-center px-5 py-2 border-b border-zinc-100">
          <span className="text-xs text-zinc-400 w-14 shrink-0">To</span>
          <input
            value={compose.to}
            onChange={e => setCompose({ ...compose, to: e.target.value })}
            className="flex-1 text-sm outline-none bg-transparent"
            placeholder="recipient@company.com"
            autoFocus
          />
          <div className="flex gap-1 text-[10px] text-zinc-400">
            {!showCc && (
              <button onClick={() => setShowCc(true)} className="hover:text-zinc-600 px-1.5 py-0.5 rounded hover:bg-zinc-100">Cc</button>
            )}
            {!showBcc && (
              <button onClick={() => setShowBcc(true)} className="hover:text-zinc-600 px-1.5 py-0.5 rounded hover:bg-zinc-100">Bcc</button>
            )}
          </div>
        </div>

        {/* CC */}
        {showCc && (
          <div className="flex items-center px-5 py-2 border-b border-zinc-100">
            <span className="text-xs text-zinc-400 w-14 shrink-0">Cc</span>
            <input
              value={compose.cc}
              onChange={e => setCompose({ ...compose, cc: e.target.value })}
              className="flex-1 text-sm outline-none bg-transparent"
              placeholder="cc@company.com"
            />
            <button onClick={() => { setShowCc(false); setCompose({ ...compose, cc: "" }); }} className="text-zinc-300 hover:text-zinc-500 p-0.5">
              <X size={12} />
            </button>
          </div>
        )}

        {/* BCC */}
        {showBcc && (
          <div className="flex items-center px-5 py-2 border-b border-zinc-100">
            <span className="text-xs text-zinc-400 w-14 shrink-0">Bcc</span>
            <input
              value={bcc}
              onChange={e => setBcc(e.target.value)}
              className="flex-1 text-sm outline-none bg-transparent"
              placeholder="bcc@company.com"
            />
            <button onClick={() => { setShowBcc(false); setBcc(""); }} className="text-zinc-300 hover:text-zinc-500 p-0.5">
              <X size={12} />
            </button>
          </div>
        )}

        {/* Subject */}
        <div className="flex items-center px-5 py-2">
          <span className="text-xs text-zinc-400 w-14 shrink-0">Subject</span>
          <input
            value={compose.subject}
            onChange={e => setCompose({ ...compose, subject: e.target.value })}
            className="flex-1 text-sm outline-none bg-transparent font-medium"
            placeholder="Email subject"
          />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto bg-white">
        <div className="px-5 pt-3">
          <RichTextEditor
            content={compose.body}
            placeholder="Write your email..."
            onChange={(html) => setCompose({ ...compose, body: html })}
            onSubmit={onSend}
            minHeight="300px"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-5 py-3 border-t bg-zinc-50">
        <div className="flex items-center gap-1">
          <Button
            onClick={onSend}
            disabled={!compose.to || !compose.subject || !compose.body}
            className="bg-zinc-900 hover:bg-zinc-800 text-xs gap-1.5 h-8 px-4"
          >
            <Send size={12} /> Send
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <button className="p-2 hover:bg-zinc-200 rounded-lg transition-colors text-zinc-400 hover:text-zinc-600">
            <Paperclip size={14} />
          </button>
          <button onClick={onClose} className="p-2 hover:bg-zinc-200 rounded-lg transition-colors text-zinc-400 hover:text-zinc-600">
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
