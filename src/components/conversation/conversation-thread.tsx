// src/components/conversation/conversation-thread.tsx
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { ConversationMessage } from "@/types";
import { RelevanceTagChips } from "@/components/email/relevance-tags";
import { ConversationStagePicker } from "@/components/email/conversation-stage-picker";
import { CategoryPicker } from "@/components/email/category-picker";
import { AILearningPanel } from "@/components/email/ai-learning-panel";
import { isConversationStage, type ConversationStage } from "@/lib/conversation-stages";

// Exported for testing
export function formatMessageTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function groupMessagesByDate(messages: ConversationMessage[]): { date: string; messages: ConversationMessage[] }[] {
  const groups: { date: string; messages: ConversationMessage[] }[] = [];
  let currentDate = "";
  for (const msg of messages) {
    const date = new Date(msg.timestamp).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    if (date !== currentDate) {
      currentDate = date;
      groups.push({ date, messages: [] });
    }
    groups[groups.length - 1].messages.push(msg);
  }
  return groups;
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function OutgoingBubble({ msg }: { msg: ConversationMessage }) {
  const [expanded, setExpanded] = useState(false);
  const displayText = (msg.content || "").includes("<") ? stripHtmlToText(msg.content || "") : (msg.content || "");
  const isLong = displayText.length > 300;
  const isDraft = msg.id.startsWith("draft-");

  return (
    <div className="flex justify-end mb-3">
      <div className={`max-w-[70%] px-4 py-2.5 rounded-2xl rounded-br-sm ${isDraft ? "bg-zinc-200 text-zinc-700 border border-dashed border-zinc-400" : "bg-zinc-900 text-white"}`}>
        {isDraft && (
          <button onClick={() => msg.onDraftClick?.()} className="text-[9px] font-medium mb-1 text-zinc-500 hover:text-zinc-700 underline">
            Draft - click to continue editing
          </button>
        )}
        <p className={`text-xs leading-relaxed whitespace-pre-wrap ${isLong && !expanded ? "line-clamp-4" : ""}`}>{displayText}</p>
        {isLong && !expanded && (
          <button onClick={() => setExpanded(true)} className={`text-[10px] mt-1 underline ${isDraft ? "text-zinc-500" : "text-zinc-400"}`}>Show full message</button>
        )}
        {isLong && expanded && (
          <button onClick={() => setExpanded(false)} className={`text-[10px] mt-1 underline ${isDraft ? "text-zinc-500" : "text-zinc-400"}`}>Collapse</button>
        )}
        {msg.structured_data && (
          <div className="bg-zinc-800 rounded-lg p-2.5 mt-2 space-y-1">
            {Object.entries(msg.structured_data).map(([k, v]) => (
              <div key={k} className="flex justify-between text-[10px]">
                <span className="text-zinc-400">{k}</span>
                <span className="font-medium">{v}</span>
              </div>
            ))}
          </div>
        )}
        {msg.attachments?.map((att, i) => (
          <div key={i} className="flex items-center gap-2 mt-2 bg-zinc-800 rounded-lg p-2 text-[10px]">
            <span>📎</span>
            <span className="truncate flex-1">{att.name}</span>
            <span className="text-zinc-400">{att.size}</span>
          </div>
        ))}
        <p className="text-[9px] text-zinc-500 mt-1 text-right">{formatMessageTime(msg.timestamp)}</p>
      </div>
    </div>
  );
}

function HtmlIframe({ html, emailId }: { html: string; emailId?: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  const [resolvedHtml, setResolvedHtml] = useState(html);
  const [attachments, setAttachments] = useState<any[]>([]);

  // Resolve cid: images via API on mount
  useEffect(() => {
    if (!emailId || !html.includes("cid:")) {
      setResolvedHtml(html);
      return;
    }
    fetch("/api/email-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: emailId, body: html }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.body) setResolvedHtml(data.body);
        if (data.attachments) setAttachments(data.attachments);
      })
      .catch(() => setResolvedHtml(html));
  }, [html, emailId]);

  const onLoad = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (doc) {
      // Force every link to open in a new browser tab. Without this a click
      // loads the destination INSIDE the iframe, wiping the email. We also
      // belt-and-braces mark individual anchors because some HTML emails
      // render links as JS onclick handlers or pseudo-buttons.
      if (!doc.head.querySelector('base[target="_blank"]')) {
        const base = doc.createElement("base");
        base.setAttribute("target", "_blank");
        doc.head.insertBefore(base, doc.head.firstChild);
      }
      doc.querySelectorAll("a[href]").forEach((a) => {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
      });

      const style = doc.createElement("style");
      style.textContent = "body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 13px; color: #3f3f46; margin: 0; padding: 0; overflow-x: hidden; } img { max-width: 100%; height: auto; } table { max-width: 100%; } a { color: #2563eb; }";
      doc.head.appendChild(style);
      const h = doc.body.scrollHeight;
      if (h > 0) setHeight(Math.min(h + 16, 1200));
    }
  }, []);

  function openInBrowser() {
    // Blob URL renders the full HTML in its own tab at full height, with
    // working links, as though opened in a standalone webmail window. Tab
    // keeps the blob URL until closed; browsers revoke it on tab close.
    const blob = new Blob([resolvedHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    // Free the URL after a delay so the new tab has time to load it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <div>
      <div className="flex justify-end mb-1">
        <button
          onClick={openInBrowser}
          className="text-[9px] text-zinc-400 hover:text-zinc-600 underline"
          title="Open this HTML email in a new browser tab"
        >
          Open in browser
        </button>
      </div>
      <iframe
        ref={iframeRef}
        srcDoc={resolvedHtml}
        onLoad={onLoad}
        // allow-popups lets target="_blank" actually open a new tab; without
        // it the browser silently swallows the click. allow-popups-to-escape
        // -sandbox keeps the opened page unsandboxed so external sites work.
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        className="w-full border-0 rounded-lg bg-white"
        style={{ height: `${height}px` }}
      />
      {attachments.length > 0 && (
        <div className="mt-2 space-y-1">
          {attachments.map((att: any, i: number) => (
            <a key={i}
              href={`/api/email-images?messageId=${emailId}&attachmentId=${att.id}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-2 py-1.5 bg-zinc-50 rounded border text-[10px] hover:bg-zinc-100">
              <span>📎</span>
              <span className="flex-1 truncate text-zinc-600">{att.name}</span>
              <span className="text-zinc-400 shrink-0">{att.size ? `${Math.round(att.size / 1024)}KB` : ""}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// Missing info checklist with "Other" field
function MissingInfoChecklist({ items, onDraft }: { items: string[]; onDraft?: (selected: string[]) => void }) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [otherText, setOtherText] = useState("");
  const [showOther, setShowOther] = useState(false);

  function toggle(item: string) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  }

  function handleDraft() {
    const selected = [...checked];
    if (otherText.trim()) {
      const extras = otherText.split(",").map(s => s.trim()).filter(Boolean);
      selected.push(...extras);
    }
    onDraft?.(selected);
  }

  const otherCount = otherText.trim() ? otherText.split(",").map(s => s.trim()).filter(Boolean).length : 0;
  const totalSelected = checked.size + otherCount;
  const hasSelection = totalSelected > 0;

  return (
    <div className="mt-2 pt-2 border-t border-zinc-200">
      <p className="text-[9px] font-medium text-zinc-500 mb-1.5">Missing info - tick items to include in your reply:</p>
      <div className="space-y-1">
        {items.map((item, i) => (
          <label key={i} className="flex items-start gap-2 cursor-pointer group">
            <input type="checkbox" checked={checked.has(item)} onChange={() => toggle(item)}
              className="mt-0.5 rounded border-zinc-300" />
            <span className={`text-[10px] ${checked.has(item) ? "text-zinc-900 font-medium" : "text-zinc-600"}`}>{item}</span>
          </label>
        ))}
        {showOther ? (
          <div className="flex gap-1 mt-1">
            <input value={otherText} onChange={e => setOtherText(e.target.value)}
              placeholder="e.g. HS code, loading date, special requirements (comma separated)"
              className="flex-1 px-2 py-1 border rounded text-[10px] bg-white"
              autoFocus
              onKeyDown={e => { if (e.key === "Enter" && hasSelection) handleDraft(); }} />
          </div>
        ) : (
          <button onClick={() => setShowOther(true)}
            className="text-[10px] text-zinc-400 hover:text-zinc-600 mt-0.5">
            + Other
          </button>
        )}
      </div>
      {hasSelection && (
        <button onClick={handleDraft}
          className="mt-2 px-3 py-1.5 bg-zinc-900 text-white rounded-lg text-[10px] font-medium hover:bg-zinc-800">
          Draft reply asking for {totalSelected} item{totalSelected > 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}

// Simple markdown: **bold**, *italic*, - bullets
function renderMarkdown(text: string): string {
  if (!text) return "";
  // Escape HTML first to prevent injection
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Then apply markdown
  html = html
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold">$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<div class="flex gap-1.5"><span class="text-zinc-400 shrink-0">-</span><span>$1</span></div>')
    .replace(/\{\{QUOTE_BADGE\}\}/g, '<span class="inline-block px-2.5 py-1 bg-zinc-900 text-white text-[10px] font-semibold rounded-md">Quote Request Detected</span>')
    .replace(/\n/g, "<br>");
  return html;
}

// Pastel colours for different people in a thread
const AVATAR_PASTELS = [
  { bg: "bg-blue-500", border: "border-blue-200", light: "bg-blue-50" },
  { bg: "bg-emerald-500", border: "border-emerald-200", light: "bg-emerald-50" },
  { bg: "bg-violet-500", border: "border-violet-200", light: "bg-violet-50" },
  { bg: "bg-amber-500", border: "border-amber-200", light: "bg-amber-50" },
  { bg: "bg-rose-500", border: "border-rose-200", light: "bg-rose-50" },
  { bg: "bg-cyan-500", border: "border-cyan-200", light: "bg-cyan-50" },
  { bg: "bg-pink-500", border: "border-pink-200", light: "bg-pink-50" },
  { bg: "bg-teal-500", border: "border-teal-200", light: "bg-teal-50" },
];

function getAvatarStyle(colorIndex?: string) {
  if (!colorIndex) return AVATAR_PASTELS[0];
  const idx = parseInt(colorIndex) % AVATAR_PASTELS.length;
  return AVATAR_PASTELS[idx];
}

function IncomingBubble({ msg }: { msg: ConversationMessage }) {
  const [showHtml, setShowHtml] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const content = msg.content || "";
  const hasHtml = !!msg.htmlBody && msg.htmlBody !== content;
  const isLong = content.length > 300;
  const avatarStyle = getAvatarStyle(msg.avatarColor);

  return (
    <div className="flex gap-2 mb-3">
      <div className={`w-6 h-6 rounded-full ${avatarStyle.bg} text-white flex items-center justify-center text-[8px] font-semibold shrink-0 mt-1`}>
        {msg.author_initials}
      </div>
      <div className={showHtml ? "flex-1 min-w-0" : "max-w-[70%]"}>
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-[10px] text-zinc-500 font-medium">{msg.author_name}</p>
          {hasHtml && (
            <button onClick={() => setShowHtml(!showHtml)}
              className="text-[9px] text-zinc-400 hover:text-zinc-600 underline">
              {showHtml ? "Text" : "HTML"}
            </button>
          )}
          {!showHtml && isLong && (
            <button onClick={() => setExpanded(!expanded)}
              className="text-[9px] text-zinc-400 hover:text-zinc-600 underline">
              {expanded ? "Collapse" : "Expand"}
            </button>
          )}
        </div>
        <div className={`bg-white border border-zinc-200 py-2.5 rounded-2xl rounded-tl-sm ${showHtml ? "px-2" : "px-4"}`}>
          {showHtml && msg.htmlBody ? (
            <HtmlIframe html={msg.htmlBody} emailId={msg.id.replace("email-", "")} />
          ) : (
            <div>
              <p className={`text-xs leading-relaxed text-zinc-700 whitespace-pre-wrap ${isLong && !expanded ? "line-clamp-4" : ""}`}>{content}</p>
              {isLong && !expanded && (
                <button onClick={() => setExpanded(true)} className="text-[10px] text-blue-600 hover:underline mt-1">Show full email</button>
              )}
              {isLong && expanded && (
                <button onClick={() => setExpanded(false)} className="text-[10px] text-blue-600 hover:underline mt-1">Collapse</button>
              )}
            </div>
          )}
          {msg.structured_data && (
            <div className="bg-zinc-50 rounded-lg p-2.5 mt-2 space-y-1">
              {Object.entries(msg.structured_data).map(([k, v]) => (
                <div key={k} className="flex justify-between text-[10px]">
                  <span className="text-zinc-400">{k}</span>
                  <span className="font-medium text-zinc-700">{v}</span>
                </div>
              ))}
            </div>
          )}
          {msg.attachments?.map((att, i) => {
            const isPdf = att.type?.includes("pdf") || att.name?.toLowerCase().endsWith(".pdf");
            const isImage = att.type?.startsWith("image/");
            const canPreview = isPdf || isImage;
            return (
              <div key={i} className="flex items-center gap-2 mt-2 bg-white rounded-lg p-2 text-[10px] border border-zinc-200">
                <span>{isPdf ? "📄" : isImage ? "🖼" : "📎"}</span>
                <span className="truncate flex-1 text-zinc-700 font-medium">{att.name}</span>
                <span className="text-zinc-400 shrink-0">{att.size}</span>
                {canPreview && (
                  <button onClick={() => window.open(att.url, "_blank")}
                    className="px-1.5 py-0.5 bg-zinc-100 hover:bg-zinc-200 rounded text-[9px] text-zinc-600 shrink-0">
                    Open
                  </button>
                )}
                <a href={att.url} download className="px-1.5 py-0.5 bg-zinc-100 hover:bg-zinc-200 rounded text-[9px] text-zinc-600 shrink-0">
                  Download
                </a>
              </div>
            );
          })}
          {msg.category === "marketing" && msg.onUnsubscribe && (
            <button onClick={msg.onUnsubscribe}
              className="flex items-center gap-1 mt-2 px-2.5 py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg text-[10px] text-red-600 transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
              Unsubscribe from this sender
            </button>
          )}
          <p className="text-[9px] text-zinc-400 mt-1">{formatMessageTime(msg.timestamp)}</p>
        </div>
      </div>
    </div>
  );
}

function InternalBubble({ msg }: { msg: ConversationMessage }) {
  return (
    <div className="flex justify-center mb-3">
      <div className="max-w-[80%] bg-amber-50 border border-amber-200 px-4 py-2 rounded-xl text-xs text-amber-900">
        <span className="whitespace-pre-wrap">{msg.content}</span>
        <span className="text-[9px] text-amber-600 ml-2">- {msg.author_name}, {formatMessageTime(msg.timestamp)}</span>
      </div>
    </div>
  );
}

function SystemBubble({ msg }: { msg: ConversationMessage }) {
  return (
    <div className="flex justify-center mb-3">
      <p className="text-[10px] text-zinc-400">{msg.content} - {formatMessageTime(msg.timestamp)}</p>
    </div>
  );
}

function AiBubble({ msg }: { msg: ConversationMessage }) {
  const [feedbackContext, setFeedbackContext] = useState("");
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [refineInput, setRefineInput] = useState("");
  const [refining, setRefining] = useState(false);

  async function submitRefine() {
    const text = refineInput.trim();
    if (!text || !msg.onRefineReplies || refining) return;
    setRefining(true);
    try {
      await msg.onRefineReplies(text);
      setRefineInput("");
    } finally {
      setRefining(false);
    }
  }

  return (
    <div className="flex justify-end gap-2 mb-3">
      <div className="max-w-[80%]">
        <div className="flex items-center gap-2 mb-0.5 justify-end">
          <p className="text-[10px] text-zinc-500">Braiin</p>
          {/* Feedback buttons with state */}
          {msg.onFeedback && (
            <div className="flex gap-0.5">
              <button onClick={() => { msg.onFeedback?.("good"); }}
                className={`p-0.5 rounded ${msg.feedbackGiven === "good" ? "bg-green-100 text-green-600" : "hover:bg-green-50 text-zinc-300 hover:text-green-600"}`} title="Good">
                <svg width="12" height="12" viewBox="0 0 24 24" fill={msg.feedbackGiven === "good" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
              </button>
              <button onClick={() => { setShowFeedbackInput(true); msg.onFeedback?.("bad"); }}
                className={`p-0.5 rounded ${msg.feedbackGiven === "bad" ? "bg-red-100 text-red-600" : "hover:bg-red-50 text-zinc-300 hover:text-red-600"}`} title="Wrong - add context">
                <svg width="12" height="12" viewBox="0 0 24 24" fill={msg.feedbackGiven === "bad" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
              </button>
            </div>
          )}
        </div>
        <div className="bg-zinc-50 border border-zinc-200 px-4 py-2.5 rounded-2xl rounded-tr-sm">
          <div className="text-xs leading-relaxed text-zinc-700" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content || "") }} />
          {(msg.aiTags || msg.userTags || msg.onTagsChange || msg.onStageChange) && (
            <div className="mt-2 pt-2 border-t border-zinc-200 flex items-center gap-2 flex-wrap">
              <RelevanceTagChips
                aiTags={msg.aiTags || []}
                userTags={msg.userTags ?? null}
                relevanceThumbs={msg.relevanceThumbs}
                onChange={msg.onTagsChange}
                onThumbsUp={msg.onRelevanceThumbsUp}
              />
              {msg.onStageChange && (
                <ConversationStagePicker
                  aiStage={isConversationStage(msg.aiConversationStage) ? (msg.aiConversationStage as ConversationStage) : null}
                  userStage={isConversationStage(msg.userConversationStage) ? (msg.userConversationStage as ConversationStage) : null}
                  onChange={(next) => msg.onStageChange?.(next)}
                />
              )}
            </div>
          )}
          {msg.structured_data && (
            <div className="bg-white rounded-lg p-2.5 mt-2 space-y-1">
              {Object.entries(msg.structured_data).map(([k, v]) => {
                // Replace the static Category row with a clickable picker
                // when an onCategoryChange handler is provided. The category
                // string is the snake_case key, not the display label - we
                // need the structured_data Category value, but msg.category
                // (snake) is what the picker writes back.
                if (k === "Category" && msg.onCategoryChange && msg.category) {
                  return (
                    <div key={k} className="flex justify-between items-center text-[10px]">
                      <span className="text-zinc-400">{k}</span>
                      <CategoryPicker
                        category={msg.category}
                        onChange={msg.onCategoryChange}
                      />
                    </div>
                  );
                }
                return (
                  <div key={k} className="flex justify-between text-[10px]">
                    <span className="text-zinc-400">{k}</span>
                    <span className="font-medium text-zinc-700">{v}</span>
                  </div>
                );
              })}
            </div>
          )}
          {/* Clickable reply options - one line summaries */}
          {msg.reply_options && msg.reply_options.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-zinc-200">
              {msg.reply_options.map((opt, i) => {
                // Show just the body (skip greeting, sign-off) as a one-line preview
                const lines = (opt || "").split("\n").filter(l => l.trim());
                const body = lines.find(l => !l.startsWith("Hi ") && !l.startsWith("Dear ") && l !== "Kind regards" && l !== "Best regards" && l !== "Thanks" && l !== "Regards") || lines[1] || opt;
                return (
                  <button key={i} onClick={() => msg.onReplyOptionClick?.(opt)}
                    className="px-2.5 py-1 bg-white border border-zinc-200 rounded-full text-[10px] text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300 transition-colors truncate max-w-full">
                    {body.trim().slice(0, 60)}{body.trim().length > 60 ? "..." : ""}
                  </button>
                );
              })}
            </div>
          )}
          {/* Refine replies input - rewrites the 3 suggestions to match
              the user's instruction (e.g. "make it more direct", "ask for
              a discount"). Only shown when there are replies to refine. */}
          {msg.reply_options && msg.reply_options.length > 0 && msg.onRefineReplies && (
            <div className="mt-2 pt-2 border-t border-zinc-200">
              <div className="flex gap-1 items-center">
                <input
                  value={refineInput}
                  onChange={(e) => setRefineInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !refining) submitRefine(); }}
                  disabled={refining}
                  placeholder="Refine replies - e.g. more direct, ask for discount, shorter..."
                  className="flex-1 px-2.5 py-1 border border-zinc-200 rounded-full text-[10px] bg-white focus:outline-none focus:border-zinc-400 disabled:bg-zinc-50"
                />
                <button
                  onClick={submitRefine}
                  disabled={refining || !refineInput.trim()}
                  className="px-2.5 py-1 bg-zinc-900 text-white rounded-full text-[10px] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {refining ? "..." : "Refine"}
                </button>
              </div>
            </div>
          )}
          {/* Incident detection - removed from here, shown as permanent banner below bubble */}
          {/* Feedback context input */}
          {showFeedbackInput && (
            <div className="mt-2 pt-2 border-t border-zinc-200">
              <p className="text-[9px] text-zinc-500 mb-1">What was wrong? This helps Braiin improve.</p>
              <div className="flex gap-1">
                <input value={feedbackContext} onChange={e => setFeedbackContext(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && feedbackContext.trim()) { msg.onFeedback?.("bad", feedbackContext); setShowFeedbackInput(false); setFeedbackContext(""); } }}
                  placeholder="e.g. wrong category, tone was off..."
                  className="flex-1 px-2 py-1 border rounded text-[10px] bg-white" autoFocus />
                <button onClick={() => { msg.onFeedback?.("bad", feedbackContext); setShowFeedbackInput(false); setFeedbackContext(""); }}
                  className="px-2 py-1 bg-zinc-900 text-white rounded text-[9px]">Send</button>
              </div>
            </div>
          )}
          {/* Missing info checklist */}
          {msg.missingInfo && msg.missingInfo.length > 0 && (
            <MissingInfoChecklist items={msg.missingInfo} onDraft={msg.onMissingInfoDraft} />
          )}
          {/* Action buttons */}
          {msg.actions && msg.actions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-zinc-200">
              {msg.actions.map((action, i) => (
                <button key={i} onClick={() => action.onClick?.()}
                  className="px-2.5 py-1 bg-white border border-zinc-200 rounded-lg text-[10px] text-zinc-700 hover:bg-zinc-100 transition-colors flex items-center gap-1">
                  {action.label}
                </button>
              ))}
            </div>
          )}
          {msg.isManager && <AILearningPanel />}
          <p className="text-[9px] text-zinc-400 mt-1 text-right">{formatMessageTime(msg.timestamp)}</p>
        </div>
      </div>
      <div className="w-6 h-6 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center shrink-0 mt-1">
        <img src="/brain-icon.png" alt="" className="w-3.5 h-3.5 brightness-0 invert" />
      </div>

      {/* Permanent incident banner - sits below the bubble, always visible */}
      {msg.incident_detected && (
        <div className={`mt-1 ml-auto max-w-[80%] rounded-lg px-3 py-2 text-xs ${
          msg.incidentStatus === "resolved"
            ? "bg-green-50 border border-green-200"
            : msg.incident_detected.severity === "black"
              ? "bg-zinc-900 text-white"
              : msg.incident_detected.severity === "red"
                ? "bg-red-50 border border-red-200"
                : "bg-amber-50 border border-amber-200"
        }`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {msg.incidentStatus === "resolved" ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-600"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={msg.incident_detected.severity === "black" ? "text-red-400" : msg.incident_detected.severity === "red" ? "text-red-600" : "text-amber-600"}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              )}
              <span className={`font-medium ${
                msg.incidentStatus === "resolved" ? "text-green-700" :
                msg.incident_detected.severity === "black" ? "text-white" :
                msg.incident_detected.severity === "red" ? "text-red-700" : "text-amber-700"
              }`}>
                {msg.incidentStatus === "resolved" ? "RESOLVED" : (msg.incident_detected.severity || "amber").toUpperCase()} EXCEPTION
              </span>
            </div>
            <span className={`text-[9px] px-1.5 py-0.5 rounded ${
              msg.incidentStatus === "resolved" ? "bg-green-100 text-green-700" :
              msg.incidentStatus === "raised" ? "bg-blue-100 text-blue-700" :
              msg.incidentStatus === "investigating" ? "bg-purple-100 text-purple-700" :
              msg.incident_detected.severity === "black" ? "bg-red-500 text-white" : "bg-white/50"
            }`}>
              {msg.incidentStatus === "resolved" ? "Resolved" :
               msg.incidentStatus === "raised" ? "Raised" :
               msg.incidentStatus === "investigating" ? "Investigating" :
               "Detected"}
            </span>
          </div>
          <p className={`text-[10px] mt-1 ${
            msg.incidentStatus === "resolved" ? "text-green-600" :
            msg.incident_detected.severity === "black" ? "text-zinc-300" : ""
          }`}>
            {msg.incident_detected.title}
          </p>
          {msg.incidentStatus !== "resolved" && msg.incidentStatus !== "raised" && msg.incidentStatus !== "investigating" && (
            <button onClick={() => msg.onRaiseIncident?.()}
              className={`mt-1.5 px-2.5 py-1 rounded text-[9px] font-medium ${
                msg.incident_detected.severity === "black"
                  ? "bg-red-500 text-white hover:bg-red-600"
                  : "bg-zinc-900 text-white hover:bg-zinc-800"
              }`}>
              Raise exception
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FileBubble({ msg }: { msg: ConversationMessage }) {
  return (
    <div className={`flex ${msg.type === "outgoing" ? "justify-end" : "gap-2"} mb-3`}>
      {msg.type !== "outgoing" && (
        <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-[8px] font-semibold shrink-0 mt-1">
          {msg.author_initials}
        </div>
      )}
      <div className={`max-w-[60%] px-4 py-2.5 rounded-2xl ${msg.type === "outgoing" ? "bg-zinc-900 text-white rounded-br-sm" : "bg-white border border-zinc-200 rounded-tl-sm"}`}>
        {msg.attachments?.map((att, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="text-lg">📄</span>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{att.name}</p>
              <p className={`text-[10px] ${msg.type === "outgoing" ? "text-zinc-400" : "text-zinc-400"}`}>{att.size}</p>
            </div>
          </div>
        ))}
        <p className={`text-[9px] mt-1 ${msg.type === "outgoing" ? "text-zinc-500 text-right" : "text-zinc-400"}`}>{formatMessageTime(msg.timestamp)}</p>
      </div>
    </div>
  );
}

function BubbleHoverMenu({ msg, children }: { msg: ConversationMessage; children: React.ReactNode }) {
  if (msg.type === "system") return <>{children}</>;

  return (
    <div className="group relative">
      {children}
      {/* Hover action menu */}
      <div className="absolute -top-6 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 bg-white border border-zinc-200 rounded-lg shadow-sm px-1 py-0.5 z-10">
        {msg.type === "incoming" && msg.onReply && (
          <button onClick={() => msg.onReply?.("")} className="p-1 hover:bg-zinc-100 rounded text-zinc-400 hover:text-zinc-600" title="Reply">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
          </button>
        )}
        {msg.onFeedback && (
          <>
            <button onClick={() => msg.onFeedback?.("good")} className="p-1 hover:bg-green-50 rounded text-zinc-400 hover:text-green-600" title="Good">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
            </button>
            <button onClick={() => msg.onFeedback?.("bad")} className="p-1 hover:bg-red-50 rounded text-zinc-400 hover:text-red-600" title="Wrong">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
            </button>
          </>
        )}
        {msg.onRaiseIncident && (
          <button onClick={() => msg.onRaiseIncident?.()} className="p-1 hover:bg-amber-50 rounded text-zinc-400 hover:text-amber-600" title="Raise incident">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </button>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ConversationMessage }) {
  const bubble = (() => {
    switch (msg.type) {
      case "outgoing": return <OutgoingBubble msg={msg} />;
      case "incoming": return <IncomingBubble msg={msg} />;
      case "internal": return <InternalBubble msg={msg} />;
      case "system": return <SystemBubble msg={msg} />;
      case "ai": return <AiBubble msg={msg} />;
      case "file": return <FileBubble msg={msg} />;
      default: return <IncomingBubble msg={msg} />;
    }
  })();

  return <BubbleHoverMenu msg={msg}>{bubble}</BubbleHoverMenu>;
}

type ConversationThreadProps = {
  messages: ConversationMessage[];
  emptyMessage?: string;
};

export function ConversationThread({ messages, emptyMessage }: ConversationThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const groups = groupMessagesByDate(messages);

  return (
    <div className="px-4 py-3">
      {groups.length === 0 ? (
        <p className="text-[10px] text-zinc-400 text-center py-8">{emptyMessage || "No messages yet"}</p>
      ) : (
        groups.map((group, gi) => (
          <div key={gi}>
            <div className="flex justify-center my-4">
              <span className="text-[9px] text-zinc-400 bg-zinc-100 px-3 py-0.5 rounded-full">{group.date}</span>
            </div>
            {group.messages.map(msg => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
