"use client";

import { useState } from "react";
import Link from "next/link";
import { Brain, Trash2, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Sample = {
  id: number;
  user_email: string;
  sender_name: string;
  sender_department: string | null;
  original_email_subject: string;
  original_email_from: string | null;
  actual_reply: string;
  ai_suggested_reply: string | null;
  used_suggestion: boolean | null;
  created_at: string;
};

/**
 * Inline transparency panel for managers. Lives at the bottom of the AI
 * bubble; click "What's the AI learning from?" to expand a list of the
 * 12 staff replies currently eligible to feed reply suggestions. Each
 * row has a delete button so a manager can prune off-pattern samples
 * without leaving the email triage flow.
 */
export function AILearningPanel() {
  const [open, setOpen] = useState(false);
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/ai-samples/recent");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to load samples");
      setSamples(d.samples || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load samples");
      setSamples([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next && samples === null) await load();
  }

  async function handleDelete(id: number) {
    if (!confirm("Remove this sample from the AI learning corpus?")) return;
    try {
      const r = await fetch(`/api/ai-samples?id=${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      setSamples((prev) => (prev || []).filter((s) => s.id !== id));
      toast.success("Sample removed - won't be used in future suggestions");
    } catch (e: unknown) {
      toast.error(`Delete failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  return (
    <div className="mt-2 pt-2 border-t border-zinc-200">
      <button
        onClick={handleToggle}
        className="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-700 transition-colors"
        title="Manager view of writing samples currently feeding the classifier"
      >
        <Brain size={11} />
        {open ? "Hide samples" : "What's the AI learning from?"}
      </button>

      {open && (
        <div className="mt-2 space-y-1.5">
          {error && (
            <p className="text-[10px] text-red-600">{error}</p>
          )}
          {loading && samples === null && (
            <p className="text-[10px] text-zinc-400">Loading...</p>
          )}
          {samples !== null && samples.length === 0 && !error && (
            <p className="text-[10px] text-zinc-400">
              No samples currently feeding the AI. Either the corpus is empty or every captured reply was internal-to-internal.
            </p>
          )}
          {samples !== null && samples.length > 0 && (
            <>
              {samples.map((s) => (
                <div key={s.id} className="bg-white border border-zinc-200 rounded p-1.5 text-[10px]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="font-medium text-zinc-700">{s.sender_name}</span>
                        {s.sender_department && (
                          <Badge variant="secondary" className="text-[8px]">{s.sender_department}</Badge>
                        )}
                        <span className="text-zinc-400">
                          {new Date(s.created_at).toLocaleDateString("en-GB")}
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-500 truncate">RE: {s.original_email_subject || "(no subject)"}</p>
                      <p className="text-[10px] text-zinc-600 mt-0.5 line-clamp-2 whitespace-pre-wrap">{s.actual_reply}</p>
                    </div>
                    <button
                      onClick={() => handleDelete(s.id)}
                      title="Remove from corpus"
                      className="p-1 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))}
              <Link
                href="/settings/ai-learning"
                className="inline-flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-700 underline"
              >
                <ExternalLink size={9} /> Full review page
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
