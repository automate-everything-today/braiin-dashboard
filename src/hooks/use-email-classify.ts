// src/hooks/use-email-classify.ts

import { useState } from "react";
import { toast } from "sonner";
import type { Email } from "@/types";

export function useEmailClassify() {
  const [classifications, setClassifications] = useState<Record<string, any>>({});
  const [classifyingId, setClassifyingId] = useState<string | null>(null);
  const [feedbackModal, setFeedbackModal] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackRatings, setFeedbackRatings] = useState<Record<string, "good" | "bad">>({});

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
  };
}
