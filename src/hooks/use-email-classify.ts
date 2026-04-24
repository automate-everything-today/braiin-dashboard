// src/hooks/use-email-classify.ts

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { Email } from "@/types";

export function useEmailClassify() {
  const [classifications, setClassifications] = useState<Record<string, any>>({});
  const [classifyingId, setClassifyingId] = useState<string | null>(null);
  const [feedbackModal, setFeedbackModal] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackRatings, setFeedbackRatings] = useState<Record<string, "good" | "bad">>({});
  // Tracks which email ids are already enqueued for background backfill so
  // we don't double-queue across re-renders.
  const backfillQueuedRef = useRef<Set<string>>(new Set());

  /**
   * Bulk-load classifications for the given email IDs from the DB and merge
   * them into local state. Called when the email list first renders (or
   * refreshes) so badges, tags, and the AI bubble show up immediately for
   * anything already classified. Skips IDs already present in state.
   */
  const hydrateClassifications = useCallback(
    async (emailIds: string[]): Promise<Record<string, any>> => {
      const merged: Record<string, any> = {};
      if (!Array.isArray(emailIds) || emailIds.length === 0) return merged;
      const unique = Array.from(new Set(emailIds.filter(Boolean)));
      if (unique.length === 0) return merged;
      try {
        // Batch in chunks of 500 (server-side cap). POST not GET because
        // Outlook message IDs are too long for a URL query string.
        for (let i = 0; i < unique.length; i += 500) {
          const batch = unique.slice(i, i + 500);
          const res = await fetch("/api/classify-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bulk: { ids: batch } }),
          });
          if (!res.ok) continue;
          const data = await res.json();
          if (data && data.classifications && typeof data.classifications === "object") {
            Object.assign(merged, data.classifications);
            // Merge: DB truth for anything NOT already in state. Don't clobber
            // optimistic updates from the current session (e.g. a user just
            // applied tags but the server write hasn't persisted yet).
            setClassifications((prev) => ({ ...data.classifications, ...prev }));
          }
        }
      } catch (err) {
        // Non-fatal: hydration is a convenience. Falls back to on-demand
        // classify when the user opens an email.
        console.warn("[useEmailClassify] hydrate failed:", err);
      }
      return merged;
    },
    [],
  );

  async function classifyEmail(email: Email) {
    setClassifyingId(email.id);
    try {
      const res = await fetch("/api/classify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email_id: email.id,
          subject: email.subject,
          from_email: email.from,
          from_name: email.fromName,
          preview: email.preview,
          // Pass the full body so the AI has proper context rather than just
          // the ~250 char bodyPreview. Server strips HTML and truncates.
          body: email.body,
          to: email.to,
          cc: email.cc,
        }),
      });
      const data = await res.json();
      if (data.classification) {
        setClassifications(prev => ({ ...prev, [email.id]: data.classification }));
      }
    } catch (err: any) {
      toast.error(`Classification failed: ${err?.message || "unknown error"}`);
    }
    setClassifyingId(null);
  }

  /**
   * Background backfill: for every email in the given list whose current
   * classification is missing stage or tags (legacy rows classified before
   * migrations 012/013), enqueue a re-classify. Processes sequentially with
   * a small gap so the 429 rate limiter never fires, and updates state as
   * each completes so pills and tags light up live in the UI without the
   * user needing to open each email.
   *
   * Fire-and-forget: caller shouldn't await this.
   */
  const backfillMissingMetadata = useCallback(
    async (emails: Email[], currentClassifications: Record<string, any>) => {
      if (!Array.isArray(emails) || emails.length === 0) return;
      // Decide pending up-front. Caller passes the map so we don't fight
      // React state-commit timing (setState updaters run later, not inline).
      const pending: Email[] = [];
      for (const email of emails) {
        if (!email?.id) continue;
        if (backfillQueuedRef.current.has(email.id)) continue;
        const cls = currentClassifications[email.id];
        // Missing if: no row at all, no stage signal, or no ai_tags array.
        const hasStage = !!cls?.ai_conversation_stage || !!cls?.user_conversation_stage;
        const hasTags = Array.isArray(cls?.ai_tags);
        if (!cls || !hasStage || !hasTags) {
          pending.push(email);
          backfillQueuedRef.current.add(email.id);
        }
      }

      if (pending.length === 0) return;

    for (const email of pending) {
      try {
        const res = await fetch("/api/classify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email_id: email.id,
            subject: email.subject,
            from_email: email.from,
            from_name: email.fromName,
            preview: email.preview,
            body: email.body,
            to: email.to,
            cc: email.cc,
          }),
        });
        if (res.status === 429) {
          // Rate limited: wait a beat then skip. Next page load will retry.
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        if (!res.ok) continue;
        const data = await res.json();
        if (data?.classification) {
          setClassifications((prev) => ({ ...prev, [email.id]: data.classification }));
        }
      } catch (err) {
        console.warn("[useEmailClassify] backfill failed for", email.id, err);
      }
      // Small gap to stay under the rate limiter and avoid saturating the
      // Anthropic API on a cold start.
      await new Promise((r) => setTimeout(r, 200));
    }
  }, []);

  async function rateClassification(emailId: string, rating: "good" | "bad") {
    setFeedbackRatings(prev => ({ ...prev, [emailId]: rating }));
    await fetch("/api/classify-email", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_id: emailId, rating }),
    });
    if (rating === "good") {
      toast.success("Thanks - noted");
    } else {
      setFeedbackModal(emailId);
    }
  }

  async function submitFeedback(emailId: string, overrideCategory?: string) {
    await fetch("/api/classify-email", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email_id: emailId,
        rating: "bad",
        feedback: feedbackText,
        override_category: overrideCategory || "",
      }),
    });
    setFeedbackModal(null);
    setFeedbackText("");
    toast.success("Feedback saved - AI will learn from this");
  }

  return {
    classifications,
    setClassifications,
    classifyingId,
    feedbackModal,
    feedbackText,
    feedbackRatings,
    setFeedbackText,
    setFeedbackModal,
    setFeedbackRatings,
    classifyEmail,
    rateClassification,
    submitFeedback,
    hydrateClassifications,
    backfillMissingMetadata,
  };
}
