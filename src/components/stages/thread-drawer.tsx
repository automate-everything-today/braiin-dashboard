"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, ExternalLink, RefreshCw } from "lucide-react";
import { ConversationStagePicker } from "@/components/email/conversation-stage-picker";
import { HtmlIframe } from "@/components/email/html-iframe";
import { DrawerReply } from "@/components/stages/drawer-reply";
import {
  isConversationStage,
  type ConversationStage,
} from "@/lib/conversation-stages";
import { toast } from "sonner";

/**
 * Right-side drawer that opens an email thread inline on the /stages
 * page. Lets the user read the email and change its stage without
 * losing kanban context. Reply / forward / attachments are
 * intentionally redirected to /email for v1 - the compose / draft /
 * classify pipeline is too entangled with that page's local state to
 * lift cleanly. Add an inline reply path here in v2 if needed.
 */

type FetchedEmail = {
  id: string;
  subject: string;
  from: string;
  fromName: string;
  to: string[];
  cc: string[];
  date: string;
  body: string;
};

type Classification = {
  ai_summary: string | null;
  ai_priority: string | null;
  ai_category: string | null;
  ai_suggested_action: string | null;
  ai_conversation_stage: ConversationStage | null;
  user_conversation_stage: ConversationStage | null;
};

type Props = {
  emailId: string;
  onClose: () => void;
  onStageChanged?: () => void;
};

export function ThreadDrawer({ emailId, onClose, onStageChanged }: Props) {
  const [email, setEmail] = useState<FetchedEmail | null>(null);
  const [mailbox, setMailbox] = useState<string>("");
  const [classification, setClassification] = useState<Classification | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEmail(null);
    setClassification(null);

    Promise.all([
      fetch(`/api/email-by-id?id=${encodeURIComponent(emailId)}`).then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Email fetch failed (${r.status})`);
        }
        return r.json();
      }),
      fetch("/api/classify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bulk: { ids: [emailId] } }),
      })
        .then((r) => (r.ok ? r.json() : { classifications: {} }))
        .catch(() => ({ classifications: {} })),
    ])
      .then(([emailData, classifyData]) => {
        if (cancelled) return;
        setEmail(emailData.email as FetchedEmail);
        setMailbox((emailData.mailbox as string) || "");
        const c = (classifyData?.classifications || {})[emailId] || null;
        if (c) {
          setClassification({
            ai_summary: c.summary ?? null,
            ai_priority: c.priority ?? null,
            ai_category: c.category ?? null,
            ai_suggested_action: c.suggested_action ?? null,
            ai_conversation_stage: isConversationStage(c.ai_conversation_stage)
              ? c.ai_conversation_stage
              : null,
            user_conversation_stage: isConversationStage(c.user_conversation_stage)
              ? c.user_conversation_stage
              : null,
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load email");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [emailId]);

  async function handleStageChange(next: ConversationStage | null) {
    const prev = classification;
    setClassification((c) => (c ? { ...c, user_conversation_stage: next } : c));
    try {
      const res = await fetch("/api/classify-email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_id: emailId, user_conversation_stage: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Update failed (${res.status})`);
      }
      onStageChanged?.();
      toast.success(next ? "Stage updated" : "Stage override cleared");
    } catch (err) {
      setClassification(prev);
      toast.error(err instanceof Error ? err.message : "Could not update stage");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <button
        aria-label="Close drawer"
        className="flex-1 bg-black/30 transition-opacity"
        onClick={onClose}
      />
      <div className="w-full max-w-[640px] bg-white shadow-2xl flex flex-col h-full border-l border-zinc-200">
        <DrawerHeader
          email={email}
          loading={loading}
          classification={classification}
          onStageChange={handleStageChange}
          onClose={onClose}
        />

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-16 text-zinc-400 text-xs gap-2">
              <RefreshCw size={14} className="animate-spin" /> Loading thread...
            </div>
          )}
          {error && !loading && (
            <div className="p-4">
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {error}
              </div>
            </div>
          )}
          {email && !loading && (
            <DrawerBody email={email} classification={classification} mailbox={mailbox} />
          )}
        </div>

        <DrawerFooter emailId={emailId} />
      </div>
    </div>
  );
}

function DrawerHeader({
  email,
  loading,
  classification,
  onStageChange,
  onClose,
}: {
  email: FetchedEmail | null;
  loading: boolean;
  classification: Classification | null;
  onStageChange: (next: ConversationStage | null) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="px-4 py-3 border-b border-zinc-200 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-zinc-900 line-clamp-2">
          {loading ? "..." : email?.subject || "(no subject)"}
        </p>
        {!loading && email && (
          <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
            {email.fromName ? `${email.fromName} <${email.from}>` : email.from}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <ConversationStagePicker
            aiStage={classification?.ai_conversation_stage ?? null}
            userStage={classification?.user_conversation_stage ?? null}
            onChange={onStageChange}
          />
          {classification?.ai_priority && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600">
              {classification.ai_priority}
            </span>
          )}
          {classification?.ai_category && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600">
              {classification.ai_category}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onClose}
        className="p-1 rounded hover:bg-zinc-100 text-zinc-500"
        aria-label="Close"
      >
        <X size={16} />
      </button>
    </div>
  );
}

function DrawerBody({
  email,
  classification,
  mailbox,
}: {
  email: FetchedEmail;
  classification: Classification | null;
  mailbox: string;
}) {
  return (
    <div className="px-4 py-3 space-y-3">
      {classification?.ai_summary && (
        <div className="bg-blue-50 border border-blue-200 rounded p-2.5 text-[11px] text-zinc-700 space-y-1.5">
          <p className="font-medium text-blue-900">AI summary</p>
          <p>{classification.ai_summary}</p>
          {classification.ai_suggested_action && (
            <p className="pt-1 border-t border-blue-200">
              <span className="font-medium">Suggested:</span>{" "}
              {classification.ai_suggested_action}
            </p>
          )}
        </div>
      )}

      <div className="text-[10px] text-zinc-400">
        {new Date(email.date).toLocaleString("en-GB")}
        {(email.to || []).length > 0 ? ` - to ${email.to.join(", ")}` : ""}
      </div>

      <HtmlIframe html={email.body || ""} emailId={email.id} />

      {email.from && mailbox && (
        <DrawerReply
          toAddress={email.from}
          subject={email.subject}
          fromMailbox={mailbox}
          emailId={email.id}
        />
      )}
    </div>
  );
}

function DrawerFooter({ emailId }: { emailId: string }) {
  return (
    <div className="px-4 py-2 border-t border-zinc-200 bg-zinc-50 flex items-center justify-between">
      <span className="text-[10px] text-zinc-400">
        Reply / forward / attach files in the full inbox view
      </span>
      <Link
        href={`/email?id=${encodeURIComponent(emailId)}`}
        className="text-[11px] font-medium text-blue-700 hover:text-blue-800 inline-flex items-center gap-1"
      >
        Open in inbox <ExternalLink size={12} />
      </Link>
    </div>
  );
}
