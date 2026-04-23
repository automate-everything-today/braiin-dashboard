"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, ThumbsUp, ThumbsDown, AlertTriangle } from "lucide-react";
import { isInternalEmail } from "@/config/customer";
import { IntelSection } from "@/components/intel-section";
import { MessageThread } from "@/components/message-thread";
import { IncidentForm } from "@/components/incident-form";
import { formatGBP } from "@/lib/utils";
import { ContactEnrichment } from "./contact-enrichment";
import type { TabConfig } from "@/types";
import type { ReplyBarHandle } from "@/components/conversation/reply-bar";
import {
  type Email, type SenderIntel, type TagInfo,
  PARTIES, PARTY_COLORS, CATEGORY_CONFIG,
  formatCategory, detectRefs,
} from "@/types/email";

// ---- Sub-components for each tab ----

function ContextTab({
  selected, senderIntel, userRole,
}: {
  selected: Email;
  senderIntel: SenderIntel | null;
  userRole: string;
}) {
  if (!senderIntel) {
    return (
      <div className="p-3 space-y-2">
        <ContactEnrichment
          key={selected.id}
          senderEmail={selected.from}
          senderName={selected.fromName || selected.from.split("@")[0]}
          matchedAccount={selected.matchedAccount}
          matchedCompany={selected.matchedCompany}
        />
        <p className="text-[10px] text-zinc-400">
          {isInternalEmail(selected.from) ? "Internal email" : "Loading sender intel..."}
        </p>
      </div>
    );
  }

  // Extract signature info from body
  const body = selected.body || "";
  const text = body.replace(/<[^>]+>/g, " ");
  const phones = text.match(/(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g);
  const titleMatch = text.match(/(?:Director|Manager|Coordinator|CEO|CFO|COO|MD|Head of|VP|President|Owner|Founder|Partner)[^,\n<]*/i);

  return (
    <div className="p-3 space-y-2">
      <ContactEnrichment
        key={selected.id}
        senderEmail={selected.from}
        senderName={selected.fromName || selected.from.split("@")[0]}
        matchedAccount={selected.matchedAccount}
        matchedCompany={selected.matchedCompany}
        userRole={userRole}
        emailBody={selected.body}
      />
      {/* Extra intel not covered by ContactEnrichment */}
      {senderIntel.commoditySummary && (
        <div className="text-[10px] text-zinc-600">
          <span className="text-zinc-400">Ships:</span> {senderIntel.commoditySummary}
        </div>
      )}
      {senderIntel.currentProvider && senderIntel.currentProvider !== "Unknown" && (
        <div className="text-[10px] text-zinc-600">
          <span className="text-zinc-400">Current provider:</span> {senderIntel.currentProvider}
        </div>
      )}
      {senderIntel.dealCount > 0 && (
        <div className="text-[10px] text-zinc-400">{senderIntel.dealCount} active deal{senderIntel.dealCount > 1 ? "s" : ""}</div>
      )}
    </div>
  );
}

function AssignTab({
  selected, isSharedInbox, assignments, staffList, selectedInboxId, userEmail, assignEmail,
}: {
  selected: Email;
  isSharedInbox: boolean;
  assignments: Record<string, any> | null;
  staffList: { name: string; email: string }[];
  selectedInboxId: number | null;
  userEmail: string;
  assignEmail: { mutate: (params: any) => void };
}) {
  if (!isSharedInbox) {
    return <div className="p-3"><p className="text-[10px] text-zinc-400">Personal inbox - no assignment needed</p></div>;
  }

  const a = assignments?.[selected.id];
  const status = a?.status || "unassigned";
  const assignedTo = a?.assigned_to;
  const assignedStaff = staffList.find(s => s.email === assignedTo);

  return (
    <div className="p-3 space-y-3">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${
            status === "unassigned" ? "bg-red-100 text-red-700" :
            status === "done" ? "bg-green-100 text-green-700" :
            "bg-zinc-100 text-zinc-700"
          }`}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
          {assignedStaff && <span className="text-xs text-zinc-600">{assignedStaff.name}</span>}
        </div>
        <button
          onClick={() => assignEmail.mutate({ email_id: selected.id, inbox_group_id: selectedInboxId!, assign_to: userEmail })}
          className="w-full px-3 py-2 bg-zinc-900 text-white rounded-lg text-xs font-medium hover:bg-zinc-800">
          Claim
        </button>
        <div>
          <p className="text-[10px] text-zinc-400 mb-1">Assign to</p>
          <select
            value={assignedTo || ""}
            onChange={e => {
              if (e.target.value) {
                assignEmail.mutate({ email_id: selected.id, inbox_group_id: selectedInboxId!, assign_to: e.target.value });
              }
            }}
            className="w-full px-2 py-1.5 border rounded text-xs">
            <option value="">Select staff...</option>
            {staffList.map(s => (
              <option key={s.email} value={s.email}>{s.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => assignEmail.mutate({ email_id: selected.id, inbox_group_id: selectedInboxId!, assign_to: "__done__" })}
          className="w-full px-3 py-1.5 border rounded-lg text-xs text-zinc-600 hover:bg-zinc-50">
          Mark Done
        </button>
      </div>
    </div>
  );
}

function TagsTab({
  selected, emailTags, tagInput, tagParty,
  setTagInput, setTagParty,
  addTag, removeTag, setTagPartyOnEmail, togglePrimary,
}: {
  selected: Email;
  emailTags: Record<string, TagInfo[]>;
  tagInput: string;
  tagParty: string;
  setTagInput: (v: string) => void;
  setTagParty: (v: string) => void;
  addTag: (emailId: string, tag: string, party?: string) => void;
  removeTag: (emailId: string, tag: string) => void;
  setTagPartyOnEmail: (emailId: string, tag: string, party: string) => void;
  togglePrimary: (emailId: string, tag: string) => void;
}) {
  return (
    <div className="p-3 space-y-3">
      <p className="text-[10px] text-zinc-400 font-medium uppercase">References - tag with job ref, PO, container, booking or invoice</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        {(emailTags[selected.id] || []).map((tagInfo, i) => (
          <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 border rounded text-[10px] font-medium ${tagInfo.is_primary ? "bg-zinc-900 text-white border-zinc-900" : "bg-white"}`}>
            {tagInfo.is_primary && <span className="text-[8px]">*</span>}
            {tagInfo.tag}
            {tagInfo.party && (
              <span className={`text-[7px] px-1 py-px rounded ${PARTY_COLORS[tagInfo.party] || "bg-zinc-100"}`}>{tagInfo.party}</span>
            )}
            <select
              value={tagInfo.party || ""}
              onChange={e => setTagPartyOnEmail(selected.id, tagInfo.tag, e.target.value)}
              onClick={e => e.stopPropagation()}
              className={`text-[8px] bg-transparent border-none outline-none cursor-pointer ${tagInfo.is_primary ? "text-zinc-300" : "text-zinc-400"}`}>
              <option value="">Party</option>
              {PARTIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <button onClick={() => togglePrimary(selected.id, tagInfo.tag)}
              className={`text-[8px] px-0.5 rounded ${tagInfo.is_primary ? "text-yellow-300" : "text-zinc-300 hover:text-zinc-600"}`}
              title={tagInfo.is_primary ? "Primary thread" : "Set as primary thread"}>
              {tagInfo.is_primary ? "\u2605" : "\u2606"}
            </button>
            <button onClick={() => removeTag(selected.id, tagInfo.tag)} className={`${tagInfo.is_primary ? "text-zinc-400 hover:text-zinc-200" : "text-zinc-400 hover:text-zinc-600"}`}>
              <X size={9} />
            </button>
          </span>
        ))}
        {/* Auto-detected refs */}
        {detectRefs(selected.preview + " " + selected.subject).filter(ref => !(emailTags[selected.id] || []).some(t => t.tag === ref)).map((ref, i) => (
          <button key={`auto-${i}`} onClick={() => addTag(selected.id, ref)}
            className="inline-flex items-center gap-1 px-2 py-0.5 border border-dashed border-zinc-300 rounded text-[10px] text-zinc-400 hover:text-zinc-600 hover:border-zinc-400">
            + {ref}
          </button>
        ))}
      </div>
      <div className="flex gap-1 mt-2">
        <input value={tagInput} onChange={e => setTagInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") addTag(selected.id, tagInput); }}
          placeholder="e.g. SI00032457"
          className="flex-1 px-2 py-1 border rounded text-[10px] bg-white" />
        <select value={tagParty} onChange={e => setTagParty(e.target.value)}
          className="px-1.5 py-1 border rounded text-[10px] bg-white text-zinc-500">
          <option value="">Party</option>
          {PARTIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button
          onClick={() => addTag(selected.id, tagInput)}
          disabled={!tagInput.trim()}
          className="px-2 py-1 bg-zinc-900 text-white rounded text-[10px] font-medium hover:bg-zinc-800 disabled:opacity-30">
          Add
        </button>
      </div>
    </div>
  );
}

function BraiinTab({
  selected, classifications, classifyingId, feedbackModal, feedbackText,
  emailTags, replyBarRef,
  setFeedbackText, setShowIncidentForm,
  rateClassification, submitFeedback, createDealFromEmail,
}: {
  selected: Email;
  classifications: Record<string, any>;
  classifyingId: string | null;
  feedbackModal: string | null;
  feedbackText: string;
  emailTags: Record<string, TagInfo[]>;
  replyBarRef: React.RefObject<ReplyBarHandle | null>;
  setFeedbackText: (v: string) => void;
  setShowIncidentForm: (v: boolean) => void;
  rateClassification: (emailId: string, rating: "good" | "bad") => void;
  submitFeedback: (emailId: string, overrideCategory?: string) => void;
  createDealFromEmail: () => void;
}) {
  const cls = classifications[selected.id];

  return (
    <div className="p-3 space-y-3">
      {/* Classification */}
      {cls && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Badge className={`text-[9px] ${formatCategory(cls.category).className}`}>{formatCategory(cls.category).label}</Badge>
              {cls.priority && cls.priority !== "normal" && (
                <Badge className={`text-[9px] ${cls.priority === "urgent" ? "bg-red-100 text-red-700" : cls.priority === "high" ? "bg-orange-100 text-orange-700" : "bg-zinc-100 text-zinc-600"}`}>
                  {(cls.priority || "").charAt(0).toUpperCase() + (cls.priority || "").slice(1)}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => rateClassification(selected.id, "good")} className="p-1 hover:bg-green-50 rounded text-zinc-300 hover:text-green-600" title="Good"><ThumbsUp size={11} /></button>
              <button onClick={() => rateClassification(selected.id, "bad")} className="p-1 hover:bg-red-50 rounded text-zinc-300 hover:text-red-600" title="Wrong"><ThumbsDown size={11} /></button>
            </div>
          </div>
          <p className="text-[10px] text-zinc-600">{cls.summary}</p>
          <p className="text-[9px] text-zinc-400">{cls.suggested_action}</p>

          {/* Quick reply options */}
          {cls.reply_options?.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1 border-t">
              {cls.reply_options.map((opt: string, i: number) => (
                <button key={i} onClick={() => {
                    const html = (opt || "").split(/\n\n+/).map((p: string) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
                    replyBarRef.current?.setContent(html);
                  }}
                  className="px-2 py-0.5 bg-white border rounded text-[9px] hover:bg-zinc-100 whitespace-nowrap">
                  {(opt || "").split("\n")[0].slice(0, 40)}{(opt || "").length > 40 ? "..." : ""}
                </button>
              ))}
            </div>
          )}

          {/* Feedback modal */}
          {feedbackModal === selected.id && (
            <div className="pt-2 border-t space-y-2">
              <p className="text-[9px] text-zinc-500">What should this be?</p>
              <div className="flex flex-wrap gap-1">
                {Object.keys(CATEGORY_CONFIG).map(cat => (
                  <button key={cat} onClick={() => submitFeedback(selected.id, cat)}
                    className={`px-2 py-0.5 rounded text-[9px] ${formatCategory(cat).className}`}>{formatCategory(cat).label}</button>
                ))}
              </div>
              <div className="flex gap-1">
                <input value={feedbackText} onChange={e => setFeedbackText(e.target.value)}
                  placeholder="What was wrong?" className="flex-1 px-2 py-1 border rounded text-[9px]" />
                <button onClick={() => submitFeedback(selected.id)} className="px-2 py-1 bg-zinc-900 text-white rounded text-[9px]">Send</button>
              </div>
            </div>
          )}
        </div>
      )}
      {classifyingId === selected.id && (
        <p className="text-[10px] text-zinc-400 animate-pulse">Classifying...</p>
      )}

      {/* Incident detection */}
      {cls?.incident_detected && (
        <div className={`p-2.5 rounded-lg border ${
          cls.incident_detected.severity === "black" ? "bg-zinc-900 text-white border-zinc-700" :
          cls.incident_detected.severity === "red" ? "bg-red-50 border-red-200" :
          "bg-amber-50 border-amber-200"
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <AlertTriangle size={12} />
              <span className="text-[10px] font-medium">
                {(cls.incident_detected.severity || "amber").toUpperCase()} incident
              </span>
            </div>
            <button onClick={() => setShowIncidentForm(true)}
              className="px-2 py-0.5 bg-white text-zinc-900 rounded text-[9px] font-medium hover:bg-zinc-100">
              Raise
            </button>
          </div>
          <p className="text-[10px] mt-1 opacity-80">{cls.incident_detected.title}</p>
        </div>
      )}

      {/* Incident form - shown inline in sidebar */}
      {/* Note: IncidentForm is rendered directly by page.tsx via showIncidentForm state */}

      {/* Quote detection */}
      {cls?.quote_details?.is_quote && (() => {
        const q = cls.quote_details;
        return (
          <div className="space-y-1.5 pt-2 border-t">
            <p className="text-[10px] font-medium uppercase text-zinc-500">Quote Request</p>
            {q.origin && <div className="flex justify-between text-[10px]"><span className="text-zinc-400">Origin</span><span className="font-medium">{q.origin}</span></div>}
            {q.destination && <div className="flex justify-between text-[10px]"><span className="text-zinc-400">Destination</span><span className="font-medium">{q.destination}</span></div>}
            {q.mode && <div className="flex justify-between text-[10px]"><span className="text-zinc-400">Mode</span><span className="font-medium">{q.mode}</span></div>}
            {q.container_type && <div className="flex justify-between text-[10px]"><span className="text-zinc-400">Container</span><span className="font-medium">{q.container_type}</span></div>}
            {q.volume && <div className="flex justify-between text-[10px]"><span className="text-zinc-400">Volume</span><span className="font-medium">{q.volume}</span></div>}
            {q.commodity && <div className="flex justify-between text-[10px]"><span className="text-zinc-400">Commodity</span><span className="font-medium">{q.commodity}</span></div>}
            {q.incoterms && <div className="flex justify-between text-[10px]"><span className="text-zinc-400">Incoterms</span><span className="font-medium">{q.incoterms}</span></div>}
            {q.urgency && <div className="flex justify-between text-[10px]"><span className="text-zinc-400">Urgency</span><span className="font-medium">{q.urgency}</span></div>}
            {!q.origin && !q.destination && !q.mode && (
              <p className="text-[10px] text-zinc-400">No route details extracted</p>
            )}
            {q.missing?.length > 0 && (
              <div className="pt-1.5 border-t">
                <p className="text-[9px] font-medium text-zinc-500 mb-1">Missing info:</p>
                {q.missing.map((m: string, i: number) => (
                  <p key={i} className="text-[10px] text-zinc-600">- {m}</p>
                ))}
              </div>
            )}
            <div className="pt-1.5 border-t space-y-1.5">
              <Button size="sm" className="w-full bg-zinc-900 hover:bg-zinc-800 text-[10px]" onClick={async () => {
                const details = `Origin: ${q.origin || "?"}\nDestination: ${q.destination || "?"}\nMode: ${q.mode || "?"}\nContainer: ${q.container_type || "?"}\nVolume: ${q.volume || "?"}\nCommodity: ${q.commodity || "?"}\nIncoterms: ${q.incoterms || "?"}`;
                await fetch("/api/email-sync", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ to: "quote@wisor.ai", subject: `Rate request - ${selected.fromName} - ${q.origin || "?"} to ${q.destination || "?"}`, body: `Please quote:\n\n${details}\n\nOriginal email from: ${selected.from}\nSubject: ${selected.subject}` }),
                });
                const { supabase } = await import("@/lib/supabase");
                await supabase.from("quote_requests").insert({
                  company_name: selected.matchedCompany || selected.fromName || "",
                  contact_name: selected.fromName || "",
                  account_code: selected.matchedAccount || "",
                  origin: q.origin || "",
                  destination: q.destination || "",
                  mode: q.mode || "",
                  container_type: q.container_type || "",
                  volume: q.volume || "",
                  source: "email",
                  wisor_forwarded: true,
                });
                const { toast } = await import("sonner");
                toast.success("Sent to Wisor for pricing");
              }}>
                Send to Wisor
              </Button>
              <Button size="sm" variant="outline" className="w-full text-[10px]" onClick={createDealFromEmail}>
                Create Deal
              </Button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ---- Main export: build sidebar tabs ----

export interface EmailSidebarTabsProps {
  selected: Email | null;
  senderIntel: SenderIntel | null;
  classifications: Record<string, any>;
  classifyingId: string | null;
  feedbackModal: string | null;
  feedbackText: string;
  emailTags: Record<string, TagInfo[]>;
  tagInput: string;
  tagParty: string;
  isSharedInbox: boolean;
  assignments: Record<string, any> | null;
  staffList: { name: string; email: string }[];
  selectedInboxId: number | null;
  userEmail: string;
  userRole: string;
  showIncidentForm: boolean;
  replyBarRef: React.RefObject<ReplyBarHandle | null>;
  assignEmail: { mutate: (params: any) => void };
  setTagInput: (v: string) => void;
  setTagParty: (v: string) => void;
  setFeedbackText: (v: string) => void;
  setShowIncidentForm: (v: boolean) => void;
  addTag: (emailId: string, tag: string, party?: string) => void;
  removeTag: (emailId: string, tag: string) => void;
  setTagPartyOnEmail: (emailId: string, tag: string, party: string) => void;
  togglePrimary: (emailId: string, tag: string) => void;
  rateClassification: (emailId: string, rating: "good" | "bad") => void;
  submitFeedback: (emailId: string, overrideCategory?: string) => void;
  createDealFromEmail: () => void;
}

export function buildEmailSidebarTabs(props: EmailSidebarTabsProps): TabConfig[] {
  const {
    selected, senderIntel, classifications, classifyingId, feedbackModal, feedbackText,
    emailTags, tagInput, tagParty, isSharedInbox, assignments, staffList,
    selectedInboxId, userEmail, replyBarRef, assignEmail,
    setTagInput, setTagParty, setFeedbackText, setShowIncidentForm,
    addTag, removeTag, setTagPartyOnEmail, togglePrimary,
    rateClassification, submitFeedback, createDealFromEmail,
  } = props;

  const cls = classifications[selected?.id || ""];
  const hasIncident = !!cls?.incident_detected;
  const emptyState = <div className="p-3 text-[10px] text-zinc-400">Select an email</div>;

  return [
    {
      id: "context",
      label: "Context",
      content: selected ? (
        <ContextTab selected={selected} senderIntel={senderIntel} userRole={props.userRole} />
      ) : emptyState,
    },
    {
      id: "chat",
      label: "Chat",
      badge: { type: "dot" as const, color: "bg-zinc-900" },
      content: selected ? (
        <MessageThread
          contextType="email"
          contextId={selected.id}
          contextSummary={`${selected.subject} - ${selected.fromName || selected.from}`}
          contextUrl="/email"
        />
      ) : emptyState,
    },
    {
      id: "assign",
      label: "Assign",
      badge: isSharedInbox && selected && (!assignments?.[selected.id] || assignments?.[selected.id]?.status === "unassigned")
        ? { type: "dot" as const, color: "bg-red-500" }
        : undefined,
      content: selected ? (
        <AssignTab
          selected={selected}
          isSharedInbox={isSharedInbox}
          assignments={assignments}
          staffList={staffList}
          selectedInboxId={selectedInboxId}
          userEmail={userEmail}
          assignEmail={assignEmail}
        />
      ) : emptyState,
    },
    {
      id: "tags",
      label: "Tags",
      content: selected ? (
        <TagsTab
          selected={selected}
          emailTags={emailTags}
          tagInput={tagInput}
          tagParty={tagParty}
          setTagInput={setTagInput}
          setTagParty={setTagParty}
          addTag={addTag}
          removeTag={removeTag}
          setTagPartyOnEmail={setTagPartyOnEmail}
          togglePrimary={togglePrimary}
        />
      ) : emptyState,
    },
    {
      id: "ai",
      label: "Braiin",
      badge: hasIncident ? { type: "dot" as const, color: "bg-red-500" } : undefined,
      bounce: hasIncident,
      content: selected ? (
        <BraiinTab
          selected={selected}
          classifications={classifications}
          classifyingId={classifyingId}
          feedbackModal={feedbackModal}
          feedbackText={feedbackText}
          emailTags={emailTags}
          replyBarRef={replyBarRef}
          setFeedbackText={setFeedbackText}
          setShowIncidentForm={setShowIncidentForm}
          rateClassification={rateClassification}
          submitFeedback={submitFeedback}
          createDealFromEmail={createDealFromEmail}
        />
      ) : emptyState,
    },
  ];
}
