"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { isInternalEmail } from "@/config/customer";
import {
  Send, X, RefreshCw, Mail, Paperclip, Pin, Archive, Trash2,
  UserPlus, Kanban, Link, Lightbulb, Share2, Forward, Reply, ReplyAll,
  MoreHorizontal, ChevronRight, ThumbsUp, ThumbsDown, Ban, BellOff, MessageSquare, AlertTriangle,
  ChevronDown, Clock, Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageGuard, useSession } from "@/components/page-guard";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { IncidentForm } from "@/components/incident-form";
import { ConversationLayout } from "@/components/conversation/conversation-layout";
import { ConversationThread } from "@/components/conversation/conversation-thread";
import { ReplyBar, type ReplyBarHandle } from "@/components/conversation/reply-bar";
import { TabbedSidebar } from "@/components/conversation/tabbed-sidebar";
import { EntityList, type QuickAction } from "@/components/conversation/entity-list";
import { useEmailInboxes } from "@/hooks/use-email-inboxes";
import { useEmailAssignments, useAssignEmail } from "@/hooks/use-email-assignments";
import { useMessages } from "@/hooks/use-messages";
import type { ConversationMessage, ChannelType, FilterTab, EntityListItem } from "@/types";
import {
  type Email, type EmailFilter, type TagInfo,
  PARTY_COLORS, formatCategory, detectRefs, stripHtml,
  isUserInTo, isUserInCc, isFyiEmail, isMarketingEmail,
} from "@/types/email";
import { useEmailActions } from "@/hooks/use-email-actions";
import { TriageTrainer } from "@/components/email/triage-trainer";
import { useSenderIntel } from "@/hooks/use-sender-intel";
import { useEmailClassify } from "@/hooks/use-email-classify";
import {
  CONVERSATION_STAGES,
  STAGE_LABEL,
  STAGE_STYLE,
  STAGE_DESCRIPTION,
  isConversationStage,
  type ConversationStage,
} from "@/lib/conversation-stages";
import { buildEmailSidebarTabs } from "@/components/email/email-sidebar-tabs";
import { EmailHeader } from "@/components/email/email-header";
import { ComposePanel } from "@/components/email/compose-panel";

/**
 * Module-level cache keyed by (folder, inboxId) so navigating off the email
 * page and back doesn't force a full reload. Cache survives as long as the
 * app is mounted; a full browser refresh clears it.
 *
 * Fresh cache (< STALE_MS): render instantly, do NOT show loading state.
 * Stale cache: render instantly BUT show a background refresh indicator.
 * No cache: show loading state as usual.
 */
type EmailCacheEntry = {
  emails: Email[];
  nextPageLink: string | null;
  tags: Record<string, TagInfo[]>;
  ts: number;
};
const emailCache = new Map<string, EmailCacheEntry>();
const CACHE_STALE_MS = 60 * 1000; // 1 minute - beyond this, refresh on focus

function cacheKey(folder: string, inboxId: number | null): string {
  return `${folder}:${inboxId ?? ""}`;
}

/**
 * Reply-All CC = dedupe(original To + original CC) - the current user -
 * the original sender. Keeps internal colleagues (they usually SHOULD
 * stay copied on the reply) and just strips the recipient of this reply
 * (the sender) plus the user themselves (no self-CC).
 */
function computeReplyAllCc(
  email: { from?: string | null; to?: string[] | null; cc?: string[] | null } | null,
  userEmail: string,
): string[] {
  if (!email) return [];
  const pool = [...(email.to || []), ...(email.cc || [])];
  const seen = new Set<string>();
  const out: string[] = [];
  const sender = (email.from || "").trim().toLowerCase();
  const self = (userEmail || "").trim().toLowerCase();
  for (const raw of pool) {
    const trimmed = (raw || "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (key === sender || key === self || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export default function EmailPage() {
  const { session } = useSession();
  const userEmail = session?.email || "";

  // Inbox state
  const [selectedInboxId, setSelectedInboxId] = useState<number | null>(null);
  const [showInboxDropdown, setShowInboxDropdown] = useState(false);
  const { data: inboxGroups } = useEmailInboxes(userEmail);
  const { data: assignments } = useEmailAssignments(selectedInboxId || undefined);
  const assignEmail = useAssignEmail();

  // Email state - seed from cache so returning to the page is instant
  const initialFolder = "inbox";
  const initialCacheEntry = emailCache.get(cacheKey(initialFolder, null)) || null;
  const [emails, setEmails] = useState<Email[]>(() => initialCacheEntry?.emails || []);
  const [loading, setLoading] = useState(!initialCacheEntry);
  const [selected, setSelected] = useState<Email | null>(null);
  const { data: internalMessages } = useMessages(selected ? "email" : undefined, selected?.id);
  const [folder, setFolder] = useState(initialFolder);
  const [emailFilter, setEmailFilter] = useState<EmailFilter>("all");
  const [showCompose, setShowCompose] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [replyType, setReplyType] = useState<"reply" | "replyall" | "forward">("reply");
  const [compose, setCompose] = useState({ to: "", subject: "", body: "", cc: "" });
  const [actionModal, setActionModal] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState("");
  const [showActions, setShowActions] = useState(false);
  const [pinnedEmails, setPinnedEmails] = useState<Set<string>>(new Set());
  const [archivedEmails, setArchivedEmails] = useState<Set<string>>(new Set());
  const [snoozedEmails, setSnoozedEmails] = useState<Map<string, Date>>(new Map());
  const [processedEmails, setProcessedEmails] = useState<Set<string>>(new Set());
  const [emailTags, setEmailTags] = useState<Record<string, TagInfo[]>>({});
  const [tagInput, setTagInput] = useState("");
  const [tagParty, setTagParty] = useState("");
  const [searchTag, setSearchTag] = useState("");
  const [emailSearch, setEmailSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [taggedEmailIds, setTaggedEmailIds] = useState<string[]>([]);
  const [nextPageLink, setNextPageLink] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tagSummary, setTagSummary] = useState<string | null>(null);
  const [tagSummaryLoading, setTagSummaryLoading] = useState(false);
  const [tagSummaryContext, setTagSummaryContext] = useState("");
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [emailAttachments, setEmailAttachments] = useState<{ id: string; name: string; contentType: string; size: number }[]>([]);
  const [sentReplies, setSentReplies] = useState<ConversationMessage[]>([]);
  const [threadSentEmails, setThreadSentEmails] = useState<Email[]>([]);
  const [focusMode, setFocusMode] = useState(false);
  const [staffList, setStaffList] = useState<{ name: string; email: string }[]>([]);

  // Custom hooks
  const { senderIntel, loadSenderIntel } = useSenderIntel();
  const {
    classifications, setClassifications,
    classifyingId, feedbackModal, feedbackText, feedbackRatings,
    setFeedbackText, setFeedbackModal, setFeedbackRatings,
    classifyEmail, rateClassification, submitFeedback,
    hydrateClassifications, backfillMissingMetadata,
  } = useEmailClassify();

  // Hydrate classification state from the DB whenever the email list changes
  // so category badges, tag chips, stage pills, quote indicators etc. are
  // visible immediately on page load - not only after re-classifying in the
  // current session.
  //
  // After hydrate, kick off a background backfill for any rows that came
  // back without a stage or tags (legacy rows classified before migrations
  // 012/013). The backfill re-classifies sequentially with a 200ms gap
  // between calls so the rate limiter never fires, and updates state as
  // each completes - stage pills and tag chips light up live in the UI.
  useEffect(() => {
    if (!emails.length) return;
    const ids = emails.map((e) => e.id).filter(Boolean);
    if (ids.length === 0) return;
    (async () => {
      const hydrated = await hydrateClassifications(ids);
      void backfillMissingMetadata(emails, hydrated);
    })();
    // Only fire when the set of visible email ids changes. Stringify keeps
    // the dep stable even when the emails array is re-created with the same
    // ids by an upstream refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emails.map((e) => e.id).join("|")]);

  const emailActions = useEmailActions({
    selected, senderIntel, emailTags, tagParty, actionNote,
    setEmailTags, setTagInput, setTagParty, setEmails, setSelected,
    setProcessedEmails, setArchivedEmails, setPinnedEmails,
    setActionModal, setActionNote, pinnedEmails, session,
  });

  const emailIdsRef = useRef(new Set<string>());
  const replyBarRef = useRef<ReplyBarHandle>(null);
  const draftsRef = useRef<Map<string, string>>(new Map());
  const prevSelectedRef = useRef<string | null>(null);

  // Load staff for assignment dropdown
  useEffect(() => {
    supabase.from("staff").select("name, email").eq("is_active", true)
      .then(({ data }) => setStaffList(
        (data || [])
          .filter((s): s is { name: string; email: string } => !!s.email)
          .map((s) => ({ name: s.name, email: s.email })),
      ));
  }, []);

  // Load persisted pins for this user
  useEffect(() => {
    if (!userEmail) return;
    supabase.from("email_pins").select("email_id").eq("user_email", userEmail)
      .then(({ data, error }) => {
        if (error) {
          console.error("[email] Failed to load pins:", error.message);
          return;
        }
        setPinnedEmails(new Set((data || []).map((r) => r.email_id)));
      });
  }, [userEmail]);

  useEffect(() => { fetchEmails(); }, [folder, selectedInboxId]);

  useEffect(() => {
    emailIdsRef.current = new Set(emails.map(e => e.id));
  }, [emails]);

  // Keep the cache in sync with local mutations (archive, delete, unsubscribe
  // filter the list) so navigating away and back shows the current state.
  useEffect(() => {
    const key = cacheKey(folder, selectedInboxId);
    const existing = emailCache.get(key);
    if (existing) {
      emailCache.set(key, { ...existing, emails, ts: existing.ts });
    }
  }, [emails, folder, selectedInboxId]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't fire when typing in inputs/textareas/editors
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selected) {
          e.preventDefault();
          emailActions.deleteEmail();
        }
      }
      if (e.key === "e" && !e.metaKey && !e.ctrlKey) {
        if (selected) {
          e.preventDefault();
          emailActions.archiveEmail();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selected, emailActions]);

  // Auto-refresh every 60s
  useEffect(() => {
    if (searching) return;
    const interval = setInterval(async () => {
      try {
        const emailParam = getEmailParam();
        const url = emailParam
          ? `/api/email-sync?folder=${folder}&days=1&top=20&email=${encodeURIComponent(emailParam)}`
          : `/api/email-sync?folder=${folder}&days=1&top=20`;
        const res = await fetch(url);
        const data = await res.json();
        const newEmails = (data.emails || [])
          .map((e: any) => ({ ...e, cc: e.cc || [] }))
          .filter((e: any) => !emailIdsRef.current.has(e.id));
        if (newEmails.length > 0) {
          setEmails(prev => [...newEmails, ...prev]);
          toast.success(`${newEmails.length} new email${newEmails.length > 1 ? "s" : ""}`);
        }
      } catch (err: any) {
        toast.error(`Auto-refresh failed: ${err?.message || "unknown error"}`);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [folder, selectedInboxId, searching]);

  // Save/restore drafts when switching emails
  useEffect(() => {
    if (selected) {
      // Save draft from previous email
      const prevId = prevSelectedRef.current;
      if (prevId && prevId !== selected.id) {
        const currentContent = replyBarRef.current?.getText() || "";
        if (currentContent) {
          draftsRef.current.set(prevId, replyBarRef.current?.getContent() || "");
        }
        // Clear editor for new email
        replyBarRef.current?.clear();
      }
      // Restore draft if one exists for this email
      const existingDraft = draftsRef.current.get(selected.id);
      if (existingDraft) {
        setTimeout(() => replyBarRef.current?.setContent(existingDraft, "draft"), 100);
      }
      prevSelectedRef.current = selected.id;
    }
  }, [selected?.id]);

  // Mark as read in Outlook when selecting an unread email. Updates local
  // state immediately so counts reflect the change; the Graph API call runs
  // in the background and logs if it fails.
  useEffect(() => {
    if (!selected || selected.isRead) return;
    const id = selected.id;
    // Optimistic local update
    setEmails(prev => prev.map(e => e.id === id ? { ...e, isRead: true } : e));
    fetch("/api/email-sync", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_id: id, action: "mark_read", user_email: userEmail }),
    })
      .then(res => {
        if (!res.ok) {
          console.error("[email] Failed to mark read in Outlook, HTTP", res.status);
        }
      })
      .catch(err => console.error("[email] mark_read network error:", err));
  }, [selected?.id, selected?.isRead, userEmail]);

  // Load intel + attachments + classify on email select
  useEffect(() => {
    if (selected) {
      loadSenderIntel(selected);
      setSentReplies([]);
      if (selected.conversationId) {
        fetch(`/api/email-sync?folder=sentitems&days=7&top=50&email=${encodeURIComponent(userEmail)}`)
          .then(r => r.json())
          .then(data => {
            const sent = (data.emails || [])
              .map((e: any) => ({ ...e, cc: e.cc || [] }))
              .filter((e: any) => e.conversationId === selected.conversationId);
            setThreadSentEmails(sent);
          })
          .catch(() => setThreadSentEmails([]));
      } else {
        setThreadSentEmails([]);
      }
      if (!classifications[selected.id]) classifyEmail(selected);
      if (selected.hasAttachments) {
        fetch("/api/email-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: selected.id, body: "" }),
        })
          .then(r => r.json())
          .then(data => setEmailAttachments(data.attachments || []))
          .catch(() => setEmailAttachments([]));
      } else {
        setEmailAttachments([]);
      }
    }
  }, [selected?.id]);

  // ---- Data fetching helpers ----
  function getEmailParam(): string {
    if (selectedInboxId === null) return "";
    const group = (inboxGroups || []).find((g: any) => g.id === selectedInboxId);
    if (!group) return "";
    return group.channels.map((c: any) => c.channel_address).join(",");
  }

  async function fetchEmails() {
    const key = cacheKey(folder, selectedInboxId);
    const cached = emailCache.get(key);
    const isFresh = cached && Date.now() - cached.ts < CACHE_STALE_MS;

    // If we have any cache, seed immediately and don't show the full loading
    // state - the background refetch replaces the data silently.
    if (cached) {
      setEmails(cached.emails);
      setNextPageLink(cached.nextPageLink);
      setEmailTags(cached.tags);
      setLoading(false);
      if (isFresh) return; // Skip the network call entirely
    } else {
      setLoading(true);
    }

    try {
      const emailParam = getEmailParam();
      const url = emailParam
        ? `/api/email-sync?folder=${folder}&days=7&email=${encodeURIComponent(emailParam)}`
        : `/api/email-sync?folder=${folder}&days=7`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const loadedEmails = (data.emails || []).map((e: any) => ({ ...e, cc: e.cc || [] }));
      setEmails(loadedEmails);
      setNextPageLink(data.nextLink || null);

      const { data: tagData } = await supabase.from("email_tags").select("email_id, tag, party, is_primary").order("created_at").limit(500);
      const tags: Record<string, TagInfo[]> = {};
      for (const t of (tagData || [])) {
        if (!tags[t.email_id]) tags[t.email_id] = [];
        tags[t.email_id].push({ tag: t.tag, party: t.party || null, is_primary: t.is_primary || false });
      }

      const tagWritePromises: Promise<Response>[] = [];
      for (const email of loadedEmails) {
        const refs = detectRefs(email.subject + " " + email.preview);
        for (const ref of refs) {
          if (!tags[email.id]?.some(t => t.tag === ref)) {
            tagWritePromises.push(fetch("/api/email-tags", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email_id: email.id, tag: ref, tag_type: "job_ref", auto_tagged: true }),
            }));
            if (!tags[email.id]) tags[email.id] = [];
            tags[email.id].push({ tag: ref, party: null, is_primary: false });
          }
        }
      }
      if (tagWritePromises.length > 0) await Promise.all(tagWritePromises);
      setEmailTags(tags);

      // Write to cache for next mount
      emailCache.set(key, {
        emails: loadedEmails,
        nextPageLink: data.nextLink || null,
        tags,
        ts: Date.now(),
      });
    } catch {
      toast.error("Failed to load emails");
    }
    setLoading(false);
  }

  async function searchEmails(query: string) {
    if (!query.trim()) { fetchEmails(); return; }
    setSearching(true);
    setLoading(true);
    try {
      const emailParam = getEmailParam();
      const buildUrl = (f: string) => emailParam
        ? `/api/email-sync?folder=${f}&search=${encodeURIComponent(query)}&email=${encodeURIComponent(emailParam)}`
        : `/api/email-sync?folder=${f}&search=${encodeURIComponent(query)}`;

      // Search inbox, archive, and sent items in parallel
      const [inboxRes, archiveRes, sentRes] = await Promise.all([
        fetch(buildUrl("inbox")),
        fetch(buildUrl("archive")),
        fetch(buildUrl("sentitems")),
      ]);

      const inboxData = inboxRes.ok ? await inboxRes.json() : { emails: [] };
      const archiveData = archiveRes.ok ? await archiveRes.json() : { emails: [] };
      const sentData = sentRes.ok ? await sentRes.json() : { emails: [] };

      // Merge and deduplicate by id, sort by date
      const seen = new Set<string>();
      const allEmails = [...(inboxData.emails || []), ...(archiveData.emails || []), ...(sentData.emails || [])]
        .map((e: any) => ({ ...e, cc: e.cc || [] }))
        .filter((e: any) => { if (seen.has(e.id)) return false; seen.add(e.id); return true; })
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

      setEmails(allEmails);
      setNextPageLink(null);
    } catch {
      toast.error("Search failed");
    }
    setLoading(false);
  }

  function clearSearch() {
    setEmailSearch("");
    setSearching(false);
    fetchEmails();
  }

  async function loadMoreEmails() {
    if (!nextPageLink || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/email-sync?folder=${folder}&nextLink=${encodeURIComponent(nextPageLink)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const moreEmails = (data.emails || []).map((e: any) => ({ ...e, cc: e.cc || [] }));
      setEmails(prev => [...prev, ...moreEmails]);
      setNextPageLink(data.nextLink || null);

      const newTags = { ...emailTags };
      const moreTagWritePromises: Promise<Response>[] = [];
      for (const email of moreEmails) {
        const refs = detectRefs(email.subject + " " + email.preview);
        for (const ref of refs) {
          if (!newTags[email.id]?.some(t => t.tag === ref)) {
            moreTagWritePromises.push(fetch("/api/email-tags", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email_id: email.id, tag: ref, tag_type: "job_ref", auto_tagged: true }),
            }));
            if (!newTags[email.id]) newTags[email.id] = [];
            newTags[email.id].push({ tag: ref, party: null, is_primary: false });
          }
        }
      }
      if (moreTagWritePromises.length > 0) await Promise.all(moreTagWritePromises);
      setEmailTags(newTags);
    } catch {
      toast.error("Failed to load more emails");
    }
    setLoadingMore(false);
  }

  async function searchByTag(tag: string) {
    setSearchTag(tag);
    const res = await fetch(`/api/email-tags?tag=${encodeURIComponent(tag)}`);
    const data = await res.json();
    setTaggedEmailIds((data.tagged_emails || []).map((t: any) => t.email_id));
  }

  function clearTagSearch() {
    setSearchTag("");
    setTaggedEmailIds([]);
    setTagSummary(null);
    setTagSummaryContext("");
  }

  async function summariseTag() {
    if (!searchTag || taggedEmailIds.length === 0) return;
    setTagSummaryLoading(true);
    setTagSummary(null);
    try {
      const taggedEmails = emails.filter(e => taggedEmailIds.includes(e.id));
      const res = await fetch("/api/tag-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tag: searchTag,
          emails: taggedEmails.map(e => ({
            from: e.from, fromName: e.fromName, to: e.to, cc: e.cc,
            date: e.date, subject: e.subject, body: e.body, preview: e.preview,
          })),
          userContext: tagSummaryContext || undefined,
        }),
      });
      const data = await res.json();
      if (data.summary) {
        setTagSummary(data.summary);
      } else {
        toast.error(data.error || "Summary failed");
      }
    } catch {
      toast.error("Failed to generate summary");
    }
    setTagSummaryLoading(false);
  }

  // ---- Email send/reply ----
  async function sendEmail() {
    if (!compose.to || !compose.subject || !compose.body) return;
    try {
      const res = await fetch("/api/email-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: compose.to, subject: compose.subject, body: compose.body,
          cc: compose.cc || undefined,
          account_code: selected?.matchedAccount || senderIntel?.accountCode || "",
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Email sent");
        setShowCompose(false);
        setShowReply(false);
        setCompose({ to: "", subject: "", body: "", cc: "" });
        if (selected) setProcessedEmails(prev => new Set([...prev, selected.id]));
      } else {
        toast.error(data.error || "Failed to send");
      }
    } catch {
      toast.error("Send failed");
    }
  }

  function startReply(type: "reply" | "replyall" | "forward" = "reply") {
    if (!selected) return;
    setReplyType(type);
    if (type === "forward") {
      setCompose({ to: "", subject: `Fwd: ${selected.subject}`, body: `\n\n---------- Forwarded message ----------\nFrom: ${selected.fromName} (${selected.from})\nDate: ${new Date(selected.date).toLocaleDateString("en-GB")}\nSubject: ${selected.subject}\n\n${selected.preview}`, cc: "" });
      replyBarRef.current?.setCc([]);
    } else {
      const cc = type === "replyall" ? computeReplyAllCc(selected, userEmail) : [];
      setCompose({
        to: selected.from,
        subject: `Re: ${selected.subject}`,
        body: "",
        cc: cc.join(", "),
      });
      // Push the computed CC list through to the ReplyBar. Reply clears CC;
      // Reply-All preserves everyone copied on the original thread (including
      // colleagues) minus the user and the original sender.
      replyBarRef.current?.setCc(cc);
    }
    setShowReply(true);
  }

  async function sendDirectReply(to: string, subject: string, body: string, cc?: string) {
    try {
      const res = await fetch("/api/email-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to, subject, body,
          cc: cc || undefined,
          account_code: selected?.matchedAccount || senderIntel?.accountCode || "",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSentReplies(prev => [...prev, {
          id: `sent-${Date.now()}`,
          type: "outgoing" as const,
          author_name: session?.name || "You",
          author_email: userEmail,
          author_initials: (session?.name || "Y").split(" ").filter(Boolean).map(n => n[0]).join("").slice(0, 2).toUpperCase(),
          content: body,
          channel: "email" as const,
          timestamp: new Date().toISOString(),
        }]);
        toast.success("Email sent");
        if (selected) setProcessedEmails(prev => new Set([...prev, selected.id]));
        return true;
      } else {
        toast.error(data.error || "Failed to send");
        return false;
      }
    } catch {
      toast.error("Send failed");
      return false;
    }
  }

  function handleReplySend(content: string, channel: ChannelType, options?: any) {
    if (!selected) return;

    if (options?.originalSuggestion) {
      fetch("/api/ai-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email_id: selected.id, user_email: userEmail,
          suggestion_type: options.suggestionType || "suggested",
          suggestion_content: options.originalSuggestion,
          was_selected: true, was_sent: true,
          edit_distance: options.editDistance || 0,
          final_content: content,
          edit_reasons: options.editReasons || [],
          edit_reason_text: options.editReasonText || "",
        }),
      }).catch(() => {});
    }

    switch (channel) {
      case "email":
        sendDirectReply(options?.to || selected.from, options?.subject || `Re: ${selected.subject}`, content, options?.cc);
        break;
      case "internal":
        fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context_type: "email", context_id: selected.id, content,
            author_name: session?.name || "Unknown", author_email: userEmail,
          }),
        }).then(() => toast.success("Internal note posted"));
        break;
      case "wisor": {
        const q = classifications[selected.id]?.quote_details;
        const details = q
          ? `Origin: ${q.origin || "?"}\nDestination: ${q.destination || "?"}\nMode: ${q.mode || "?"}\nContainer: ${q.container_type || "?"}`
          : "";
        fetch("/api/email-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: "quote@wisor.ai",
            subject: `Rate request - ${selected.fromName} - ${selected.subject}`,
            body: `${content}\n\n${details}\n\nOriginal email from: ${selected.from}\nSubject: ${selected.subject}`,
          }),
        }).then(() => toast.success("Sent to Wisor"));
        break;
      }
      case "braiin": {
        setSentReplies(prev => [...prev, {
          id: `braiin-q-${Date.now()}`,
          type: "outgoing" as const,
          author_name: session?.name || "You",
          author_email: userEmail,
          author_initials: (session?.name || "Y").split(" ").filter(Boolean).map(n => n[0]).join("").slice(0, 2).toUpperCase(),
          content, channel: "braiin" as const, timestamp: new Date().toISOString(),
        }]);

        const threadSummary = (selectedThread?.emails || [selected])
          .map(e => `From: ${e.fromName || e.from}\nSubject: ${e.subject}\n${stripHtml(e.body || "").slice(0, 300)}`)
          .join("\n---\n");

        fetch("/api/braiin-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: content, context_type: "email", context_id: selected.id,
            thread_summary: threadSummary,
            account_code: selected.matchedAccount || senderIntel?.accountCode || "",
            user_email: userEmail,
          }),
        })
          .then(r => r.json())
          .then(data => {
            if (data.answer) {
              const actionHandlers = (data.actions || []).map((a: any) => ({
                ...a,
                onClick: () => {
                  switch (a.id) {
                    case "draft_email":
                      replyBarRef.current?.setContent(`<p>${data.answer.split("\n")[0]}</p>`);
                      break;
                    case "send_wisor": {
                      const q = classifications[selected.id]?.quote_details;
                      const details = q ? `Origin: ${q.origin || "?"}\nDestination: ${q.destination || "?"}\nMode: ${q.mode || "?"}` : "";
                      fetch("/api/email-sync", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ to: "quote@wisor.ai", subject: `Rate request - ${selected.fromName} - ${selected.subject}`, body: details }),
                      }).then(() => toast.success("Sent to Wisor"));
                      break;
                    }
                    case "log_deal":
                      emailActions.createDealFromEmail();
                      break;
                    case "log_note": {
                      const accountCode = selected.matchedAccount || senderIntel?.accountCode;
                      if (accountCode) {
                        supabase.from("client_notes").insert({
                          account_code: accountCode,
                          note: `[Braiin] ${data.answer.slice(0, 300)}`,
                          author: session?.name || "Braiin",
                        }).then(() => toast.success("Note saved"));
                      }
                      break;
                    }
                    case "log_quote":
                      toast.success("Quote logged");
                      break;
                    case "create_company":
                    case "create_contact":
                      emailActions.createContactFromEmail();
                      break;
                    case "enrich":
                      toast.success("Enrichment requested");
                      break;
                  }
                },
              }));

              setSentReplies(prev => [...prev, {
                id: `braiin-a-${Date.now()}`,
                type: "ai" as const,
                author_name: "Braiin", author_email: "ai@braiin.io", author_initials: "B",
                content: data.answer, channel: "braiin" as const,
                timestamp: new Date().toISOString(), actions: actionHandlers,
              }]);
            } else {
              toast.error(data.error || "Braiin could not answer");
            }
          })
          .catch(() => toast.error("Failed to reach Braiin"));
        break;
      }
      default:
        break;
    }
  }

  // ---- Filtering ----
  const isSharedInbox = selectedInboxId !== null;

  const visibleEmails = useMemo(() => emails.filter(e => {
    if (archivedEmails.has(e.id)) return false;
    if (taggedEmailIds.length > 0 && !taggedEmailIds.includes(e.id)) return false;
    if (emailFilter !== "pinned" && pinnedEmails.has(e.id)) return false;
    if (emailFilter !== "snoozed" && snoozedEmails.has(e.id)) return false;
    if (emailFilter === "snoozed" && !snoozedEmails.has(e.id)) return false;
    return true;
  }), [emails, archivedEmails, taggedEmailIds, emailFilter, pinnedEmails, snoozedEmails]);

  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = { all: visibleEmails.length, direct: 0, action: 0, cc: 0, fyi: 0, marketing: 0, pinned: 0, snoozed: snoozedEmails.size, mine: 0, unassigned: 0 };
    for (const e of visibleEmails) {
      if (isUserInTo(e, userEmail) && !isUserInCc(e, userEmail)) counts.direct++;
      if (!e.isRead && isUserInTo(e, userEmail) && !isUserInCc(e, userEmail)) counts.action++;
      if (isUserInCc(e, userEmail) && !isUserInTo(e, userEmail)) counts.cc++;
      if (isFyiEmail(e)) counts.fyi++;
      if (isMarketingEmail(e, classifications[e.id]?.category)) counts.marketing++;
      if (assignments) {
        const a = (assignments as Record<string, any>)[e.id];
        if (a?.assigned_to === userEmail) counts.mine++;
        if (!a || a.status === "unassigned") counts.unassigned++;
      }
    }
    // Pinned count comes from the FULL email list (minus archived), because
    // visibleEmails hides pinned items on every tab except the Pinned tab.
    // Without this, the Pinned counter would read 0 on every other tab.
    for (const e of emails) {
      if (!archivedEmails.has(e.id) && pinnedEmails.has(e.id)) {
        counts.pinned++;
      }
    }
    return counts;
  }, [visibleEmails, emails, archivedEmails, pinnedEmails, assignments, userEmail, classifications]);

  const filteredEmails = useMemo(() => {
    switch (emailFilter) {
      case "direct": return visibleEmails.filter(e => isUserInTo(e, userEmail) && !isUserInCc(e, userEmail));
      case "action": return visibleEmails.filter(e => !e.isRead && isUserInTo(e, userEmail) && !isUserInCc(e, userEmail));
      case "cc": return visibleEmails.filter(e => isUserInCc(e, userEmail) && !isUserInTo(e, userEmail));
      case "fyi": return visibleEmails.filter(e => isFyiEmail(e));
      case "marketing": return visibleEmails.filter(e => isMarketingEmail(e, classifications[e.id]?.category));
      case "pinned": return visibleEmails.filter(e => pinnedEmails.has(e.id));
      case "snoozed": return visibleEmails; // already filtered in visibleEmails
      case "mine": return visibleEmails.filter(e => { const a = (assignments as Record<string, any>)?.[e.id]; return a?.assigned_to === userEmail; });
      case "unassigned": return visibleEmails.filter(e => { const a = (assignments as Record<string, any>)?.[e.id]; return !a || a.status === "unassigned"; });
      default: return visibleEmails;
    }
  }, [visibleEmails, emailFilter, pinnedEmails, assignments, userEmail, classifications]);

  // Group by conversation thread
  type EmailThreadType = { latest: Email; emails: Email[]; count: number; conversationId: string };
  const threads: EmailThreadType[] = useMemo(() => {
    const threadMap = new Map<string, Email[]>();
    for (const e of filteredEmails) {
      const key = e.conversationId || e.id;
      if (!threadMap.has(key)) threadMap.set(key, []);
      threadMap.get(key)!.push(e);
    }
    return Array.from(threadMap.values()).map(group => {
      const sorted = group.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      return { latest: sorted[0], emails: sorted.reverse(), count: sorted.length, conversationId: sorted[0].conversationId || sorted[0].id };
    }).sort((a, b) => new Date(b.latest.date).getTime() - new Date(a.latest.date).getTime());
  }, [filteredEmails]);

  const selectedThread = useMemo(() => {
    if (!selected) return null;
    return threads.find(t => t.emails.some(e => e.id === selected.id)) || null;
  }, [selected, threads]);

  // Inbox zero gamification
  const totalCount = visibleEmails.length;
  const processedCount = visibleEmails.filter(e => processedEmails.has(e.id)).length;
  const pct = totalCount > 0 ? Math.round((processedCount / totalCount) * 100) : 0;

  // ---- Build filter tabs ----
  const entityFilterTabs: FilterTab[] = useMemo(() => {
    const tabs: FilterTab[] = [{ key: "all", label: "All", count: filterCounts.all }];
    if (isSharedInbox) {
      tabs.push({ key: "mine", label: "Mine", count: filterCounts.mine });
      tabs.push({ key: "unassigned", label: "Unassigned", count: filterCounts.unassigned });
    }
    tabs.push({ key: "direct", label: "Direct", count: filterCounts.direct });
    tabs.push({ key: "cc", label: "CC'd", count: filterCounts.cc });
    tabs.push({ key: "marketing", label: "Marketing", count: filterCounts.marketing });
    tabs.push({ key: "pinned", label: "Pinned", count: filterCounts.pinned });
    if (snoozedEmails.size > 0) tabs.push({ key: "snoozed", label: "Snoozed", count: snoozedEmails.size });
    return tabs;
  }, [filterCounts, isSharedInbox, snoozedEmails.size]);

  // ---- Convert emails to EntityListItem ----
  const entityItems: EntityListItem[] = useMemo(() => {
    return threads.map(thread => {
      const email = thread.latest;
      const a = (assignments as Record<string, any>)?.[email.id];
      const badges: { label: string; color: string; variant?: "default" | "tag" }[] = [];
      if (email.matchedAccount) badges.push({ label: email.matchedAccount, color: "" });
      // Thread stage pill: effective stage (user override beats AI). Colour
      // from the shared STAGE_STYLE palette so a given stage looks the same
      // everywhere (list card, AI bubble, dashboard column header).
      const stageCode = classifications[email.id]?.effective_conversation_stage
        ?? classifications[email.id]?.ai_conversation_stage
        ?? null;
      const stageLabel = isConversationStage(stageCode) ? STAGE_LABEL[stageCode] : null;
      // Category badge: suppress when the category's display label matches
      // the stage's (e.g. `quote_request` exists as both). The stage pill
      // carries more information (lifecycle position) so it wins.
      if (classifications[email.id]?.category) {
        const cat = formatCategory(classifications[email.id].category);
        if (cat.label !== stageLabel) {
          badges.push({ label: cat.label, color: cat.className });
        }
      }
      if (stageLabel && isConversationStage(stageCode)) {
        badges.push({
          label: stageLabel,
          color: STAGE_STYLE[stageCode],
        });
      }
      if (thread.count > 1) badges.push({ label: `${thread.count}`, color: "bg-zinc-200 text-zinc-600" });
      const tags = emailTags[email.id] || [];
      for (const t of tags) {
        // Skip a tag that matches the matchedAccount - we already show that
        // as the account badge and don't want a duplicate chip.
        if (email.matchedAccount && t.tag === email.matchedAccount) continue;
        badges.push({
          label: t.tag,
          color: "bg-zinc-900 text-white",
          variant: "tag" as const,
        });
        if (t.party) {
          badges.push({
            label: t.party.charAt(0).toUpperCase() + t.party.slice(1),
            color: PARTY_COLORS[t.party] || "bg-zinc-100",
          });
        }
      }

      let statusDot: string | undefined;
      const hasUnread = thread.emails.some(e => !e.isRead);
      const snoozeUntil = snoozedEmails.get(email.id);
      if (snoozeUntil) {
        statusDot = "#3b82f6"; // blue for snoozed
        const timeStr = snoozeUntil.toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        badges.push({ label: `Snoozed until ${timeStr}`, color: "bg-blue-100 text-blue-700" });
      } else if (isSharedInbox && (!a || a.status === "unassigned")) statusDot = "#ef4444";
      else if (thread.emails.every(e => processedEmails.has(e.id))) statusDot = "#22c55e";
      else if (hasUnread) statusDot = "#18181b";

      let assignee: { name: string; initials: string } | null = null;
      if (a?.assigned_to) {
        const staff = staffList.find(s => s.email === a.assigned_to);
        const name = staff?.name || a.assigned_to;
        assignee = { name, initials: name.split(" ").filter(Boolean).map((n: string) => n[0]).join("").slice(0, 2).toUpperCase() };
      }

      const participants = [...new Set(thread.emails.map(e => e.fromName || e.from.split("@")[0]))];
      const title = thread.count > 1 ? participants.join(", ") : (email.fromName || email.from);

      return {
        id: email.id, title, subtitle: email.subject, preview: email.preview,
        timestamp: (() => {
          const d = new Date(email.date);
          const now = new Date();
          const isToday = d.toDateString() === now.toDateString();
          const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
          if (isToday) return time;
          return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${time}`;
        })(),
        badges, statusDot, isUnread: !email.isRead, assignee,
      };
    });
  }, [filteredEmails, classifications, emailTags, assignments, processedEmails, pinnedEmails, isSharedInbox, staffList]);

  // ---- Quick actions ----
  // Snooze helper
  function snoozeEmail(id: string, until: Date, label: string) {
    fetch("/api/email-assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_id: id, inbox_group_id: selectedInboxId || 0, action: "snooze", snooze_until: until.toISOString() }),
    });
    setSnoozedEmails(prev => new Map(prev).set(id, until));
    setProcessedEmails(prev => new Set([...prev, id]));
    if (selected?.id === id) setSelected(null);
    toast.success(`Snoozed until ${label}`);
  }

  // Auto-unsnooze emails when their time arrives
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setSnoozedEmails(prev => {
        const next = new Map(prev);
        let changed = false;
        for (const [id, until] of next) {
          if (until <= now) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Snooze dropdown state
  const [snoozeDropdownId, setSnoozeDropdownId] = useState<string | null>(null);
  const [forceSidebarTab, setForceSidebarTab] = useState<string | null>(null);

  // 4D Triage Actions - icons only
  // Archive/delete both go through emailActions so the Graph API is called
  // and the change persists in Outlook, not just the Braiin UI.
  const emailQuickActions: QuickAction[] = [
    { id: "archive", label: "Archive", icon: <Archive size={13} />, color: "text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700",
      onClick: (id) => { emailActions.archiveEmail(id); } },
    { id: "delete", label: "Delete", icon: <Trash2 size={13} />, color: "text-zinc-500 hover:bg-red-50 hover:text-red-500",
      onClick: (id) => { emailActions.deleteEmail(id); } },
    { id: "snooze" as const, label: "Delegate", icon: <Forward size={13} />, color: "text-zinc-500 hover:bg-indigo-50 hover:text-indigo-600",
      onClick: (id) => {
        const email = emails.find(e => e.id === id);
        if (email) { setSelected(email); replyBarRef.current?.setContent(`<p>FYI - can you handle this?</p>`); }
      } },
    { id: "snooze", label: "Snooze", icon: <Clock size={13} />, color: "text-zinc-500 hover:bg-blue-50 hover:text-blue-600",
      onClick: (id) => setSnoozeDropdownId(snoozeDropdownId === id ? null : id) },
    { id: "exception", label: "Exception", icon: <AlertTriangle size={13} />, color: "text-zinc-500 hover:bg-amber-50 hover:text-amber-600",
      onClick: (id) => { const email = emails.find(e => e.id === id); if (email) { setSelected(email); setShowIncidentForm(true); } } },
    { id: "tag", label: "Tag", icon: <Tag size={13} />, color: "text-zinc-500 hover:bg-purple-50 hover:text-purple-600",
      onClick: (id) => { const email = emails.find(e => e.id === id); if (email) { setSelected(email); setForceSidebarTab("tags"); setTimeout(() => setForceSidebarTab(null), 100); } } },
  ];

  // ---- Conversation messages ----
  const conversationMessages: ConversationMessage[] = useMemo(() => {
    if (!selected) return [];
    const msgs: ConversationMessage[] = [];
    const baseTime = new Date(selected.date).getTime();

    const threadEmails = selectedThread?.emails || [selected];
    const allThreadEmails = [...threadEmails];
    const existingIds = new Set(allThreadEmails.map(e => e.id));
    for (const sent of threadSentEmails) {
      if (!existingIds.has(sent.id)) allThreadEmails.push(sent);
    }
    allThreadEmails.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const senderColorMap = new Map<string, string>();
    let colorIdx = 0;
    for (const e of allThreadEmails) {
      const from = e.from || "";
      if (from.toLowerCase() !== userEmail.toLowerCase() && !senderColorMap.has(from)) {
        senderColorMap.set(from, String(colorIdx++));
      }
    }

    for (const email of allThreadEmails) {
      const from = email.from || "";
      const isFromUser = from.toLowerCase() === userEmail.toLowerCase();
      const initials = (email.fromName || from.split("@")[0] || "?")
        .split(" ").filter(Boolean).map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

      msgs.push({
        id: `email-${email.id}`, type: isFromUser ? "outgoing" : "incoming",
        author_name: email.fromName || from, author_email: from, author_initials: initials,
        content: stripHtml(email.body || ""), htmlBody: email.body || "", channel: "email", timestamp: email.date || new Date().toISOString(),
        avatarColor: isFromUser ? undefined : senderColorMap.get(from),
        attachments: email.id === selected.id ? emailAttachments.map(att => ({
          name: att.name, size: att.size ? `${Math.round(att.size / 1024)}KB` : "",
          url: `/api/email-images?messageId=${selected.id}&attachmentId=${att.id}`, type: att.contentType,
        })) : undefined,
        onReply: !isFromUser ? () => { replyBarRef.current?.focus(); } : undefined,
        category: classifications[email.id]?.category || undefined,
        onUnsubscribe: (classifications[email.id]?.category === "marketing") ? () => {
          if (email.unsubscribeUrl) { window.open(email.unsubscribeUrl, "_blank"); toast.success("Unsubscribe link opened"); }
          else { toast.success("No unsubscribe link - use Block Sender in the menu to stop these"); }
        } : undefined,
      });
    }

    // AI classification bubble
    const cls = classifications[selected.id];
    if (cls) {
      const aiParts: string[] = [];
      if (cls.summary) aiParts.push(cls.summary);
      if (cls.suggested_action && cls.suggested_action !== "No action needed") aiParts.push(`**Suggested action:** ${cls.suggested_action}`);

      const structuredData: Record<string, string> = {};
      structuredData["Category"] = formatCategory(cls.category).label;
      structuredData["Priority"] = cls.priority ? cls.priority.charAt(0).toUpperCase() + cls.priority.slice(1) : "Normal";

      if (cls.quote_details?.is_quote) {
        const q = cls.quote_details;
        aiParts.push(""); aiParts.push("{{QUOTE_BADGE}}");
        if (q.origin) structuredData["Origin"] = q.origin;
        if (q.destination) structuredData["Destination"] = q.destination;
        if (q.mode) structuredData["Mode"] = q.mode;
        if (q.container_type) structuredData["Container"] = q.container_type;
        if (q.volume) structuredData["Volume"] = q.volume;
        if (q.commodity) structuredData["Commodity"] = q.commodity;
        if (q.incoterms) structuredData["Incoterms"] = q.incoterms;
        if (q.urgency) structuredData["Urgency"] = q.urgency;
        if (q.missing?.length > 0) aiParts.push("**Missing info needed to quote:**");
      }

      msgs.push({
        id: `ai-classify-${selected.id}`, type: "ai",
        author_name: "Braiin", author_email: "ai@braiin.io", author_initials: "B",
        content: aiParts.join("\n"), structured_data: structuredData,
        channel: "braiin", timestamp: new Date(baseTime + 500).toISOString(),
        reply_options: cls.reply_options || [],
        incident_detected: cls.incident_detected || undefined,
        feedbackGiven: feedbackRatings[selected.id] || null,
        missingInfo: cls.quote_details?.missing || undefined,
        onMissingInfoDraft: (selectedItems: string[]) => {
          const name = selected.fromName?.split(" ")[0] || "Hi";
          const draft = `<p>Hi ${name},</p><p>Thanks for your enquiry. To provide an accurate quotation, could you please confirm the following:</p><p>${selectedItems.map(item => `- ${item}`).join("<br>")}</p><p>Once we have these details, we will revert with pricing.</p>`;
          replyBarRef.current?.setContent(draft);
          const originalMissing = cls.quote_details?.missing || [];
          const addedItems = selectedItems.filter(item => !originalMissing.includes(item));
          if (addedItems.length > 0) {
            fetch("/api/ai-feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email_id: selected.id, user_email: userEmail, feedback_context: `User added missing items not detected by AI: ${addedItems.join(", ")}`, explicit_rating: "correction" }) }).catch(() => {});
          }
        },
        onReplyOptionClick: (reply: string) => {
          // Convert plain text into proper HTML email with paragraph spacing
          const paragraphs = reply.split(/\n\n+/).filter(p => p.trim());
          const html = paragraphs.map(p => {
            const lines = p.split(/\n/).map(l => l.trim()).filter(Boolean);
            return `<p>${lines.join("<br>")}</p>`;
          }).join("<p></p>"); // Empty p for visual spacing between paragraphs
          replyBarRef.current?.setContent(html);
        },
        onFeedback: (rating: "good" | "bad", context?: string) => {
          setFeedbackRatings(prev => ({ ...prev, [selected.id]: rating }));
          rateClassification(selected.id, rating);
          if (context) submitFeedback(selected.id, undefined);
        },
        aiTags: cls.ai_tags || [],
        userTags: cls.user_tags ?? null,
        relevanceThumbs: cls.relevance_feedback || null,
        onTagsChange: async (nextTags: string[] | null) => {
          const prevCls = cls;
          // Optimistic update
          setClassifications((prev: Record<string, any>) => ({
            ...prev,
            [selected.id]: {
              ...(prev[selected.id] || {}),
              user_tags: nextTags,
              effective_tags: nextTags && nextTags.length > 0 ? nextTags : (prev[selected.id]?.ai_tags || []),
            },
          }));
          try {
            const res = await fetch("/api/classify-email", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email_id: selected.id, user_tags: nextTags }),
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
          } catch (e: unknown) {
            // Rollback
            setClassifications((prev: Record<string, any>) => ({
              ...prev,
              [selected.id]: { ...(prev[selected.id] || {}), user_tags: prevCls.user_tags ?? null },
            }));
            toast.error(`Tag update failed: ${e instanceof Error ? e.message : "unknown error"}`);
          }
        },
        aiConversationStage: cls.ai_conversation_stage ?? null,
        userConversationStage: cls.user_conversation_stage ?? null,
        onStageChange: async (next: string | null) => {
          const prevUser = cls.user_conversation_stage ?? null;
          const prevAi = cls.ai_conversation_stage ?? null;
          setClassifications((prev: Record<string, any>) => ({
            ...prev,
            [selected.id]: {
              ...(prev[selected.id] || {}),
              user_conversation_stage: next,
              effective_conversation_stage: next ?? prevAi,
            },
          }));
          try {
            const res = await fetch("/api/classify-email", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email_id: selected.id, user_conversation_stage: next }),
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
          } catch (e: unknown) {
            setClassifications((prev: Record<string, any>) => ({
              ...prev,
              [selected.id]: {
                ...(prev[selected.id] || {}),
                user_conversation_stage: prevUser,
                effective_conversation_stage: prevUser ?? prevAi,
              },
            }));
            toast.error(`Stage update failed: ${e instanceof Error ? e.message : "unknown error"}`);
          }
        },
        onRelevanceThumbsUp: async () => {
          const prevFeedback = cls.relevance_feedback;
          setClassifications((prev: Record<string, any>) => ({
            ...prev,
            [selected.id]: { ...(prev[selected.id] || {}), relevance_feedback: "thumbs_up" },
          }));
          try {
            const res = await fetch("/api/classify-email", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email_id: selected.id, relevance_feedback: "thumbs_up" }),
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
          } catch (e: unknown) {
            setClassifications((prev: Record<string, any>) => ({
              ...prev,
              [selected.id]: { ...(prev[selected.id] || {}), relevance_feedback: prevFeedback ?? null },
            }));
            toast.error(`Save failed: ${e instanceof Error ? e.message : "unknown error"}`);
          }
        },
        onRefineReplies: async (instruction: string) => {
          try {
            const res = await fetch("/api/refine-replies", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email_id: selected.id,
                instruction,
                subject: selected.subject,
                from_email: selected.from,
                from_name: selected.fromName,
                preview: selected.preview,
                body: selected.body,
              }),
            });
            if (!res.ok) {
              const errBody = await res.json().catch(() => ({}));
              toast.error(`Refine failed: ${errBody.error || res.statusText}`);
              return;
            }
            const data = await res.json();
            if (Array.isArray(data.reply_options) && data.reply_options.length > 0) {
              // Update the classifications state so the bubble re-renders
              // with the refined reply chips.
              setClassifications((prev: Record<string, any>) => ({
                ...prev,
                [selected.id]: {
                  ...(prev[selected.id] || {}),
                  reply_options: data.reply_options,
                },
              }));
              toast.success("Replies refined");
            }
          } catch (err) {
            console.error("[refine-replies] network error:", err);
            toast.error("Refine failed - network error");
          }
        },
        onRaiseIncident: () => { setShowIncidentForm(true); },
        // Triage recommendations based on category
        actions: (() => {
          const cat = cls.category;
          const triageActions: { id: string; label: string; icon: string; onClick: () => void }[] = [];

          // Marketing: unsubscribe + archive. Use the heuristic fallback too,
          // so the shortcut appears even before AI classification runs on the
          // email (previously it only showed when cat === "marketing" landed,
          // which could be seconds to never depending on classification).
          if (isMarketingEmail(selected, cat)) {
            triageActions.push({
              id: "unsubscribe", label: "Unsubscribe & Archive", icon: "bell-off",
              onClick: () => {
                if (selected.unsubscribeUrl) window.open(selected.unsubscribeUrl, "_blank");
                emailActions.archiveEmail(selected.id);
              },
            });
          }

          // FYI: archive
          if (cat === "fyi" || cat === "cc") {
            triageActions.push({
              id: "archive", label: "Archive", icon: "archive",
              onClick: () => { emailActions.archiveEmail(selected.id); },
            });
          }

          // Recruiter: delete
          if (cat === "recruiter") {
            triageActions.push({
              id: "delete", label: "Delete", icon: "trash",
              onClick: () => { emailActions.deleteEmail(selected.id); },
            });
          }

          // Action/Direct/Quote/RFQ: reply (already have reply options above)
          if (["action", "direct", "quote_request", "rfq", "agent_request"].includes(cat)) {
            triageActions.push({
              id: "reply", label: "Reply", icon: "reply",
              onClick: () => replyBarRef.current?.focus(),
            });
          }

          // Rates: review + forward to team
          if (cat === "rates") {
            triageActions.push({
              id: "delegate", label: "Forward to team", icon: "forward",
              onClick: () => replyBarRef.current?.setContent(`<p>FYI - new rates received. Please review.</p>`),
            });
          }

          // Internal: reply
          if (cat === "internal") {
            triageActions.push({
              id: "reply", label: "Reply", icon: "reply",
              onClick: () => replyBarRef.current?.focus(),
            });
          }

          // Always offer snooze and delegate
          triageActions.push({
            id: "snooze", label: "Snooze 1hr", icon: "clock",
            onClick: () => snoozeEmail(selected.id, new Date(Date.now() + 60 * 60 * 1000), "1 hour"),
          });
          triageActions.push({
            id: "delegate", label: "Delegate", icon: "forward",
            onClick: () => replyBarRef.current?.setContent(`<p>FYI - can you handle this?</p>`),
          });
          triageActions.push({
            id: "exception", label: "Raise Exception", icon: "alert",
            onClick: () => setShowIncidentForm(true),
          });

          return triageActions;
        })(),
      });
    }

    if (internalMessages?.length > 0) {
      for (const msg of internalMessages) {
        msgs.push({
          id: `msg-${msg.id}`, type: "internal",
          author_name: msg.author_name, author_email: msg.author_email,
          author_initials: (msg.author_name || "?").split(" ").filter(Boolean).map((n: string) => n[0]).join("").slice(0, 2).toUpperCase(),
          content: msg.content, channel: "internal", timestamp: msg.created_at,
        });
      }
    }

    for (const sent of sentReplies) {
      if (selected && sent.id.startsWith("sent-")) msgs.push(sent);
    }

    // Show draft bubble if one exists for this email
    const draftHtml = draftsRef.current.get(selected.id);
    if (draftHtml) {
      const draftText = draftHtml.replace(/<[^>]+>/g, "").trim();
      if (draftText) {
        msgs.push({
          id: `draft-${selected.id}`,
          type: "outgoing",
          author_name: session?.name || "You",
          author_email: userEmail,
          author_initials: (session?.name || "Y").split(" ").filter(Boolean).map(n => n[0]).join("").slice(0, 2).toUpperCase(),
          content: draftText,
          channel: "email",
          timestamp: new Date().toISOString(),
          onDraftClick: () => {
            replyBarRef.current?.setContent(draftHtml, "draft");
            draftsRef.current.delete(selected.id);
          },
        });
      }
    }

    return msgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [selected, classifications, internalMessages, emailAttachments, feedbackRatings, sentReplies, selectedThread, threadSentEmails, userEmail]);

  // ---- Sidebar tabs ----
  const sidebarTabs = useMemo(() => buildEmailSidebarTabs({
    selected, senderIntel, classifications, classifyingId, feedbackModal, feedbackText,
    emailTags, tagInput, tagParty, isSharedInbox,
    assignments: assignments as Record<string, any> | null,
    staffList, selectedInboxId, userEmail, userRole: session?.role || "", showIncidentForm, replyBarRef, assignEmail,
    setTagInput, setTagParty, setFeedbackText, setShowIncidentForm,
    addTag: emailActions.addTag, removeTag: emailActions.removeTag,
    setTagPartyOnEmail: emailActions.setTagPartyOnEmail,
    togglePrimary: emailActions.togglePrimary,
    rateClassification, submitFeedback,
    createDealFromEmail: emailActions.createDealFromEmail,
  }), [selected?.id, senderIntel, classifications, emailTags, feedbackModal, feedbackText, classifyingId, showIncidentForm, assignments, staffList, selectedInboxId, tagInput, tagParty]);

  // ---- Inbox selector ----
  const inboxSelector = (
    <div className="relative">
      <button onClick={() => setShowInboxDropdown(!showInboxDropdown)} className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-medium bg-zinc-50 rounded hover:bg-zinc-100">
        <span className="truncate">{selectedInboxId === null ? "My Inbox" : (inboxGroups || []).find((g: any) => g.id === selectedInboxId)?.name || "Inbox"}</span>
        <ChevronDown size={12} className="text-zinc-400 shrink-0" />
      </button>
      {showInboxDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg py-1 z-50 max-h-60 overflow-y-auto">
          <button onClick={() => { setSelectedInboxId(null); setShowInboxDropdown(false); setEmailFilter("all"); }} className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50 ${selectedInboxId === null ? "font-semibold bg-zinc-50" : ""}`}>My Inbox</button>
          {(inboxGroups || []).map((g: any) => (
            <button key={g.id} onClick={() => { setSelectedInboxId(g.id); setShowInboxDropdown(false); setEmailFilter("all"); }} className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50 flex items-center justify-between ${selectedInboxId === g.id ? "font-semibold bg-zinc-50" : ""}`}>
              <span>{g.name}</span>
              {g.unassigned_count > 0 && <span className="text-[9px] bg-red-100 text-red-600 px-1.5 rounded-full">{g.unassigned_count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // ---- Compose button + search ----
  const composeButton = (
    <div className="space-y-2">
      <button onClick={() => { setShowCompose(true); setCompose({ to: "", subject: "", body: "", cc: "" }); }} className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-lg text-xs font-medium hover:bg-zinc-800 w-full justify-center">
        <Mail size={14} /> Compose
      </button>
      <div className="flex gap-1">
        <input value={emailSearch} onChange={e => setEmailSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && emailSearch.trim()) searchEmails(emailSearch); }} placeholder="Search all emails..." className="flex-1 px-2.5 py-1.5 border rounded-lg text-xs bg-white" />
        {searching ? (
          <button onClick={clearSearch} className="px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-600 border rounded-lg"><X size={12} /></button>
        ) : (
          <button onClick={() => { if (emailSearch.trim()) searchEmails(emailSearch); }} className="px-2 py-1.5 text-xs text-zinc-400 hover:text-zinc-600 border rounded-lg"><ChevronRight size={12} /></button>
        )}
      </div>
      {searching && <p className="text-[9px] text-zinc-400">Searching all history - <button onClick={clearSearch} className="underline">clear</button></p>}
    </div>
  );

  // ---- Left footer ----
  const leftFooter = (
    <div>
      <div className="px-3 py-2 border-b">
        <div className="flex gap-1">
          <input value={searchTag} onChange={e => setSearchTag(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && searchTag.trim()) searchByTag(searchTag.trim().toUpperCase()); }} placeholder="Search by reference..." className="flex-1 px-2 py-1 border rounded text-[10px]" />
          {searchTag && <button onClick={clearTagSearch} className="px-1.5 py-1 text-[10px] text-zinc-400 hover:text-zinc-600">Clear</button>}
        </div>
        {searchTag && taggedEmailIds.length > 0 && (
          <div className="mt-1 space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-[9px] text-zinc-400">{taggedEmailIds.length} emails tagged with <span className="font-semibold text-zinc-600">{searchTag}</span></p>
              <button
                onClick={summariseTag}
                disabled={tagSummaryLoading}
                className="text-[9px] px-2 py-0.5 bg-zinc-900 text-white rounded hover:bg-zinc-800 disabled:opacity-50 font-medium"
              >
                {tagSummaryLoading ? "Summarising..." : "Summarise"}
              </button>
            </div>
            {!tagSummary && !tagSummaryLoading && (
              <input
                value={tagSummaryContext}
                onChange={e => setTagSummaryContext(e.target.value)}
                placeholder="Add context (optional) e.g. This is about a delayed shipment..."
                className="w-full px-2 py-1 border rounded text-[9px] bg-white"
              />
            )}
          </div>
        )}
      </div>
      {/* Inbox zero progress moved to TriageTrainer header */}
      {nextPageLink && (
        <button onClick={loadMoreEmails} disabled={loadingMore} className="w-full py-2 text-[10px] text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 font-medium">
          {loadingMore ? "Loading..." : `Load more (${emails.length} loaded)`}
        </button>
      )}
    </div>
  );

  // ---- Quick actions bar ----
  const quickActions = selected ? (
    <div className="px-3 py-1.5 border-b bg-white flex flex-wrap gap-1">
      <button onClick={() => startReply("reply")} className="px-1.5 py-0.5 hover:bg-zinc-100 rounded text-[9px] text-zinc-600 flex items-center gap-0.5"><Reply size={9} /> Reply</button>
      <button onClick={emailActions.createContactFromEmail} className="px-1.5 py-0.5 hover:bg-zinc-100 rounded text-[9px] text-zinc-600 flex items-center gap-0.5"><UserPlus size={9} /> Contact</button>
      <button onClick={emailActions.createDealFromEmail} className="px-1.5 py-0.5 hover:bg-zinc-100 rounded text-[9px] text-zinc-600 flex items-center gap-0.5"><Kanban size={9} /> Deal</button>
      <button onClick={() => setActionModal("add_to_deal")} className="px-1.5 py-0.5 hover:bg-zinc-100 rounded text-[9px] text-zinc-600 flex items-center gap-0.5"><Link size={9} /> Add to Deal</button>
      <button onClick={emailActions.saveAsInsight} className="px-1.5 py-0.5 hover:bg-zinc-100 rounded text-[9px] text-zinc-600 flex items-center gap-0.5"><Lightbulb size={9} /> Insight</button>
      <button onClick={emailActions.shareWithTeam} className="px-1.5 py-0.5 hover:bg-zinc-100 rounded text-[9px] text-zinc-600 flex items-center gap-0.5"><Share2 size={9} /> Share</button>
    </div>
  ) : null;

  // ---- Thread content ----
  const threadContent = showCompose ? (
    <ComposePanel compose={compose} setCompose={setCompose} onSend={sendEmail} onClose={() => setShowCompose(false)} />
  ) : selected ? (
    <>
      <ConversationThread messages={conversationMessages} emptyMessage="No messages in this thread" />
      {actionModal === "add_to_deal" && (
        <div className="px-4 pb-2">
          <div className="p-3 border rounded bg-zinc-50">
            <p className="text-xs text-zinc-500 mb-2">Enter deal ID to attach this email:</p>
            <div className="flex gap-2">
              <input value={actionNote} onChange={e => setActionNote(e.target.value)} type="number" className="flex-1 px-2 py-1.5 border rounded text-sm" placeholder="Deal ID" autoFocus />
              <Button size="sm" onClick={emailActions.addEmailToDeal} className="bg-zinc-900 hover:bg-zinc-800 text-xs">Attach</Button>
              <Button size="sm" variant="outline" onClick={() => { setActionModal(null); setActionNote(""); }} className="text-xs">Cancel</Button>
            </div>
          </div>
        </div>
      )}
      {showIncidentForm && selected && (
        <div className="px-4 pb-2">
          <div className="border rounded-lg bg-zinc-50 p-3">
            <IncidentForm
              prefill={{
                severity: classifications[selected.id]?.incident_detected?.severity || "amber",
                category: classifications[selected.id]?.incident_detected?.category || "other",
                title: classifications[selected.id]?.incident_detected?.title || "",
                account_code: selected.matchedAccount || "",
                supplier_account_code: "",
                job_reference: (emailTags[selected.id] || [])[0]?.tag || "",
                source: "email_ai", source_id: selected.id,
              }}
              emailContext={{
                from: selected.from,
                fromName: selected.fromName,
                subject: selected.subject,
                preview: selected.preview,
                matchedCompany: selected.matchedCompany || undefined,
              }}
              onClose={() => setShowIncidentForm(false)}
            />
          </div>
        </div>
      )}
    </>
  ) : (
    tagSummary ? (
      <div className="flex-1 overflow-y-auto p-6 max-w-3xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 bg-zinc-900 text-white rounded-full text-[10px] font-semibold">{searchTag}</span>
            <h2 className="text-sm font-semibold text-zinc-900">Summary - {taggedEmailIds.length} emails</h2>
          </div>
          <button onClick={() => setTagSummary(null)} className="text-[10px] text-zinc-400 hover:text-zinc-600 underline">Close summary</button>
        </div>
        <div className="bg-white border rounded-lg p-5 text-sm leading-relaxed text-zinc-700 whitespace-pre-wrap">
          {tagSummary}
        </div>
        {tagSummaryContext && (
          <p className="text-[9px] text-zinc-400 mt-2">Context provided: {tagSummaryContext}</p>
        )}
      </div>
    ) : (
      <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">Select an email to read</div>
    )
  );

  const replyBarElement = selected && !showCompose ? (
    <ReplyBar
      ref={replyBarRef}
      defaultChannel="email"
      onSend={handleReplySend}
      contextLabel={selected.fromName || selected.from}
      defaultTo={selected.from}
      defaultSubject={`Re: ${selected.subject}`}
      defaultCc={computeReplyAllCc(selected, userEmail)}
    />
  ) : null;

  return (
    <PageGuard pageId="email">
    <ErrorBoundary>
    <div className="h-[calc(100vh-48px)] flex flex-col overflow-hidden -m-6">
      <div className="flex items-center gap-3 px-4 py-2 border-b shrink-0 bg-white">
        <h1 className="text-lg font-semibold">Email</h1>
        <div className="flex gap-1">
          {["inbox", "sentitems"].map(f => (
            <button key={f} onClick={() => setFolder(f)} className={`px-2.5 py-1 rounded text-xs ${folder === f ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-100"}`}>
              {f === "inbox" ? "Inbox" : "Sent"}
            </button>
          ))}
        </div>
        <span className="text-xs text-zinc-400">{filteredEmails.length} shown{pinnedEmails.size > 0 ? ` - ${pinnedEmails.size} pinned` : ""}</span>
        <button onClick={fetchEmails} className="p-1.5 hover:bg-zinc-100 rounded ml-1" title="Refresh"><RefreshCw size={14} className="text-zinc-500" /></button>
      </div>

      <ConversationLayout
        leftPanel={
          <EntityList
            header={<>{folder === "inbox" && <TriageTrainer totalEmails={visibleEmails.length} processedCount={visibleEmails.filter(e => processedEmails.has(e.id)).length} />}{quickActions}</>}
            selector={inboxSelector}
            primaryAction={composeButton}
            filterTabs={entityFilterTabs}
            activeFilter={emailFilter}
            onFilterChange={(key) => setEmailFilter(key as EmailFilter)}
            items={entityItems}
            activeId={selected?.id || null}
            onSelect={(id) => {
              const email = filteredEmails.find(e => e.id === id);
              if (email) { setSelected(email); setShowReply(false); setActionModal(null); setShowCompose(false); }
            }}
            loading={loading}
            footer={leftFooter}
            quickActions={emailQuickActions}
            snoozeDropdownId={snoozeDropdownId}
            onSnooze={(id, until, label) => { if (label === "__close__") { setSnoozeDropdownId(null); } else { snoozeEmail(id, until, label); setSnoozeDropdownId(null); } }}
            swipeRightAction="archive"
            swipeLeftAction="delete"
          />
        }
        threadHeader={
          <EmailHeader
            selected={selected}
            pinnedEmails={pinnedEmails}
            showActions={showActions}
            setShowActions={setShowActions}
            startReply={startReply}
            pinEmail={emailActions.pinEmail}
            archiveEmail={emailActions.archiveEmail}
            deleteEmail={emailActions.deleteEmail}
            unsubscribe={emailActions.unsubscribe}
            blockSender={emailActions.blockSender}
            blockDomain={emailActions.blockDomain}
            createDealFromEmail={emailActions.createDealFromEmail}
            createContactFromEmail={emailActions.createContactFromEmail}
            setActionModal={setActionModal}
          />
        }
        threadContent={threadContent}
        replyBar={replyBarElement || <div />}
        rightPanel={
          <TabbedSidebar tabs={sidebarTabs} defaultTab="context" focusMode={focusMode} forceTab={forceSidebarTab} />
        }
        showFocusToggle
        onFocusModeChange={setFocusMode}
      />
    </div>
    </ErrorBoundary>
    </PageGuard>
  );
}
