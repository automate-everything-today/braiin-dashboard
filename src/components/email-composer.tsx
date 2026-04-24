"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { X, Send, Sparkles, Loader2 } from "lucide-react";

const EMAIL_PRESETS = [
  { id: "rate_review", label: "Rate Review", color: "bg-green-100 text-green-700" },
  { id: "meeting_request", label: "Meeting Request", color: "bg-blue-100 text-blue-700" },
  { id: "quarterly_review", label: "Quarterly Review", color: "bg-purple-100 text-purple-700" },
  { id: "follow_up", label: "Follow-up", color: "bg-yellow-100 text-yellow-700" },
  { id: "introduction", label: "Introduction", color: "bg-cyan-100 text-cyan-700" },
  { id: "thank_you", label: "Thank You", color: "bg-pink-100 text-pink-700" },
  { id: "service_expansion", label: "Service Expansion", color: "bg-orange-100 text-orange-700" },
  { id: "issue_resolution", label: "Issue Resolution", color: "bg-red-100 text-red-700" },
];

type Contact = {
  id: number;
  contact_name: string;
  email: string;
  job_title: string;
  is_default: boolean;
};

type SentEmail = {
  id: number;
  to_email: string;
  to_name: string;
  subject: string;
  from_name: string;
  sent_at: string;
};

type Props = {
  accountCode: string;
  clientName: string;
  onClose: () => void;
};

export function EmailComposer({ accountCode, clientName, onClose }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [customTo, setCustomTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [sentEmails, setSentEmails] = useState<SentEmail[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    // Get logged-in user
    supabase.auth.getUser().then(({ data }) => {
      const email = data.user?.email || "";
      setUserEmail(email);
      // Derive name from email
      const name = email.split("@")[0].split(".").map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
      setUserName(name);
    });

    // Load contacts
    supabase.from("cargowise_contacts")
      .select("id, contact_name, email, job_title, is_default")
      .eq("account_code", accountCode)
      .not("email", "eq", "")
      .order("is_default", { ascending: false })
      .then(({ data }) => {
        const normalised: Contact[] = (data || [])
          .filter((c): c is typeof c & { email: string } => !!c.email)
          .map((c) => ({
            id: c.id,
            contact_name: c.contact_name ?? "",
            email: c.email,
            job_title: c.job_title ?? "",
            is_default: c.is_default ?? false,
          }));
        setContacts(normalised);
        const def = normalised.find((c) => c.is_default);
        if (def) setSelectedContact(def);
      });

    // Load sent email history
    supabase.from("client_emails")
      .select("id, to_email, to_name, subject, from_name, sent_at")
      .eq("account_code", accountCode)
      .order("sent_at", { ascending: false })
      .limit(10)
      .then(({ data }) => setSentEmails(
        (data || []).map((r) => ({
          id: r.id,
          to_email: r.to_email,
          to_name: r.to_name ?? "",
          subject: r.subject,
          from_name: r.from_name ?? "",
          sent_at: r.sent_at ?? "",
        })),
      ));
  }, [accountCode]);

  async function generateDraft(emailType: string) {
    setDrafting(true);
    setError("");
    try {
      const res = await fetch("/api/compose-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_code: accountCode,
          contact_name: selectedContact?.contact_name || "",
          contact_email: selectedContact?.email || customTo,
          email_type: emailType,
          custom_prompt: emailType === "custom" ? customPrompt : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSubject(data.subject || "");
        setBody(data.body || "");
      } else {
        setError(data.error || "Draft generation failed");
      }
    } catch {
      setError("Error generating draft");
    }
    setDrafting(false);
  }

  async function sendEmail() {
    const toEmail = selectedContact?.email || customTo;
    if (!toEmail || !subject || !body) {
      setError("Please fill in recipient, subject, and body");
      return;
    }
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_code: accountCode,
          to: toEmail,
          to_name: selectedContact?.contact_name || "",
          subject,
          body,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSent(true);
      } else {
        setError(data.error || "Send failed");
      }
    } catch {
      setError("Error sending email");
    }
    setSending(false);
  }

  if (sent) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 w-[500px] text-center">
          <div className="text-4xl mb-4">+</div>
          <h3 className="text-lg font-bold">Email Sent</h3>
          <p className="text-sm text-zinc-500 mt-2">
            Sent to {selectedContact?.contact_name || customTo} at {clientName}
          </p>
          <p className="text-xs text-zinc-400 mt-1">From: {userName} ({userEmail})</p>
          <p className="text-xs text-zinc-400">Logged on account and reply tracking active</p>
          <Button onClick={onClose} className="mt-4 bg-[#ff3366]">Close</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[720px] max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <h3 className="font-bold text-sm">Compose Email - {clientName}</h3>
            <p className="text-xs text-zinc-400">Sending as: {userName} ({userEmail})</p>
          </div>
          <div className="flex items-center gap-2">
            {sentEmails.length > 0 && (
              <button onClick={() => setShowHistory(!showHistory)}
                className="text-[10px] text-blue-600 hover:underline">
                {showHistory ? "Hide history" : `${sentEmails.length} previous emails`}
              </button>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-zinc-100 rounded">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Sent history */}
        {showHistory && sentEmails.length > 0 && (
          <div className="px-5 py-2 border-b bg-zinc-50 max-h-32 overflow-y-auto">
            {sentEmails.map((e) => (
              <div key={e.id} className="text-xs py-1 flex justify-between border-b last:border-0">
                <span className="text-zinc-600">{e.subject}</span>
                <span className="text-zinc-400">
                  {e.from_name} to {e.to_name || e.to_email} - {new Date(e.sent_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {/* Recipient */}
          <div className="px-5 py-3 border-b">
            <label className="text-[10px] text-zinc-500 font-medium uppercase">To</label>
            {contacts.length > 0 ? (
              <select
                value={selectedContact?.id || ""}
                onChange={(e) => {
                  const c = contacts.find((c) => c.id === Number(e.target.value));
                  setSelectedContact(c || null);
                  if (c) setCustomTo("");
                }}
                className="w-full mt-1 px-3 py-2 border rounded text-sm"
              >
                <option value="">Select a contact...</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.contact_name} - {c.email} {c.job_title ? `(${c.job_title})` : ""} {c.is_default ? "[Default]" : ""}
                  </option>
                ))}
              </select>
            ) : null}
            <input
              value={customTo}
              onChange={(e) => { setCustomTo(e.target.value); setSelectedContact(null); }}
              placeholder={contacts.length > 0 ? "Or type a different email..." : "Enter email address..."}
              className={`w-full mt-1.5 px-3 ${contacts.length > 0 ? "py-1.5 text-xs" : "py-2 text-sm"} border rounded text-zinc-500`}
            />
          </div>

          {/* Suggestions */}
          <div className="px-5 py-3 border-b">
            <label className="text-[10px] text-zinc-500 font-medium uppercase mb-2 block">
              What would you like to say? {drafting && <Loader2 size={10} className="inline animate-spin ml-1" />}
            </label>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {EMAIL_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => generateDraft(p.id)}
                  disabled={drafting}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium ${p.color} hover:opacity-80 disabled:opacity-50`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && customPrompt.trim()) generateDraft("custom"); }}
                placeholder="Or describe what you want to say..."
                className="flex-1 px-3 py-2 border rounded text-sm"
                disabled={drafting}
              />
              <Button
                size="sm"
                onClick={() => generateDraft("custom")}
                disabled={drafting || !customPrompt.trim()}
                className="bg-[#ff3366] hover:bg-[#e6004d] gap-1.5"
              >
                <Sparkles size={12} />
                Draft
              </Button>
            </div>
          </div>

          {/* Subject */}
          <div className="px-5 pt-3">
            <label className="text-[10px] text-zinc-500 font-medium uppercase">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject..."
              className="w-full mt-1 px-3 py-2 border rounded text-sm"
            />
          </div>

          {/* Body */}
          <div className="px-5 py-3">
            <label className="text-[10px] text-zinc-500 font-medium uppercase">Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Email body... Use the suggestions above to generate a draft, or write your own."
              className="w-full mt-1 px-3 py-2 border rounded text-sm min-h-[250px] resize-y leading-relaxed"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t flex items-center justify-between shrink-0">
          {error && <p className="text-xs text-[#ff3366] flex-1">{error}</p>}
          <div className="flex-1" />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              onClick={sendEmail}
              disabled={sending || (!selectedContact?.email && !customTo) || !subject || !body}
              className="bg-[#ff3366] hover:bg-[#e6004d] gap-1.5"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {sending ? "Sending..." : "Send Email"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
