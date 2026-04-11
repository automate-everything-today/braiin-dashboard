"use client";

import { useState } from "react";
import { Archive, Forward, Reply, Clock, X, ChevronDown, ChevronUp } from "lucide-react";

export function TriageTrainer({ totalEmails, processedCount }: { totalEmails: number; processedCount: number }) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (dismissed) return null;

  const pct = totalEmails > 0 ? Math.round((processedCount / totalEmails) * 100) : 0;
  const remaining = totalEmails - processedCount;

  return (
    <div className="border-b bg-white">
      {/* Progress bar */}
      <div className="px-3 py-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-medium text-zinc-500">
            {remaining > 0 ? `${remaining} emails to triage` : "Inbox Zero!"}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold">{processedCount}/{totalEmails}</span>
            <button onClick={() => setExpanded(!expanded)} className="p-0.5 hover:bg-zinc-100 rounded">
              {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>
            <button onClick={() => setDismissed(true)} className="p-0.5 hover:bg-zinc-100 rounded text-zinc-400">
              <X size={10} />
            </button>
          </div>
        </div>
        <div className="w-full bg-zinc-200 rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full transition-all ${pct === 100 ? "bg-green-500" : "bg-zinc-900"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {pct === 100 && (
          <p className="text-[10px] text-green-600 font-medium text-center mt-1">Inbox Zero achieved!</p>
        )}
      </div>

      {/* 4D Method trainer - collapsible */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-[10px] text-zinc-500 font-medium">Touch-It-Once: the 4D Method</p>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="flex items-start gap-1.5 p-2 bg-zinc-50 rounded-lg">
              <Archive size={12} className="text-zinc-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-medium text-zinc-700">Delete/Archive</p>
                <p className="text-[9px] text-zinc-400">FYI or notification you don't need? Remove it.</p>
              </div>
            </div>
            <div className="flex items-start gap-1.5 p-2 bg-indigo-50 rounded-lg">
              <Forward size={12} className="text-indigo-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-medium text-indigo-700">Delegate</p>
                <p className="text-[9px] text-zinc-400">Not yours? Forward to the right person.</p>
              </div>
            </div>
            <div className="flex items-start gap-1.5 p-2 bg-green-50 rounded-lg">
              <Reply size={12} className="text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-medium text-green-700">Do (under 2 min)</p>
                <p className="text-[9px] text-zinc-400">Quick reply, approve, confirm? Do it now.</p>
              </div>
            </div>
            <div className="flex items-start gap-1.5 p-2 bg-blue-50 rounded-lg">
              <Clock size={12} className="text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-medium text-blue-700">Defer/Snooze</p>
                <p className="text-[9px] text-zinc-400">Needs time? Snooze for 1hr or tomorrow.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
