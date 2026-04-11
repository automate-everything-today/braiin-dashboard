"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ThumbsUp, ThumbsDown, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

interface IntelSectionProps {
  title: string;
  preview: string;
  children: React.ReactNode;
  dealId?: number;
  accountCode?: string;
  sectionId: string;
  contentForFeedback?: string;
  defaultOpen?: boolean;
}

export function IntelSection({
  title,
  preview,
  children,
  dealId,
  accountCode,
  sectionId,
  contentForFeedback,
  defaultOpen = false,
}: IntelSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [rated, setRated] = useState<"good" | "bad" | null>(null);

  async function submitFeedback(rating: "good" | "bad") {
    setRated(rating);
    await supabase.from("ai_feedback").insert({
      context: "deal_coach",
      section: sectionId,
      content: contentForFeedback || "",
      rating,
      feedback: "",
      deal_id: dealId,
      account_code: accountCode || "",
    });
    if (rating === "bad") {
      setShowFeedback(true);
    } else {
      toast.success("Thanks - noted as helpful");
    }
  }

  async function submitTextFeedback() {
    if (!feedbackText.trim()) return;
    await supabase.from("ai_feedback").insert({
      context: "deal_coach",
      section: sectionId,
      content: contentForFeedback || "",
      rating: "bad",
      feedback: feedbackText.trim(),
      deal_id: dealId,
      account_code: accountCode || "",
    });
    setShowFeedback(false);
    setFeedbackText("");
    toast.success("Feedback saved - AI will learn from this");
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-zinc-50 hover:bg-zinc-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {open ? <ChevronDown size={14} className="text-zinc-400 shrink-0" /> : <ChevronRight size={14} className="text-zinc-400 shrink-0" />}
          <span className="text-xs font-medium text-zinc-700">{title}</span>
          {!open && preview && (
            <span className="text-[10px] text-zinc-400 truncate">{preview}</span>
          )}
        </div>
        {/* Feedback buttons - only show when open */}
        {open && (
          <div className="flex items-center gap-1 shrink-0 ml-2" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => submitFeedback("good")}
              className={`p-1 rounded hover:bg-green-100 ${rated === "good" ? "bg-green-100 text-green-600" : "text-zinc-300"}`}
              title="Helpful"
            >
              <ThumbsUp size={12} />
            </button>
            <button
              onClick={() => submitFeedback("bad")}
              className={`p-1 rounded hover:bg-red-100 ${rated === "bad" ? "bg-red-100 text-red-600" : "text-zinc-300"}`}
              title="Not helpful"
            >
              <ThumbsDown size={12} />
            </button>
          </div>
        )}
      </button>

      {open && (
        <div className="px-3 py-2 text-xs">
          {children}

          {/* Feedback text input */}
          {showFeedback && (
            <div className="mt-2 flex gap-1.5 border-t pt-2">
              <input
                value={feedbackText}
                onChange={e => setFeedbackText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") submitTextFeedback(); }}
                placeholder="What was wrong? How should it be different?"
                className="flex-1 px-2 py-1 border rounded text-[10px]"
                autoFocus
              />
              <button onClick={submitTextFeedback} className="p-1 text-[#ff3366] hover:bg-[#ff3366]/10 rounded">
                <Send size={12} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
