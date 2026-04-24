"use client";

import { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { Send, Paperclip, Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Table as TableIcon, Clock } from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Underline } from "@tiptap/extension-underline";
import { Placeholder } from "@tiptap/extension-placeholder";
import { supabase } from "@/lib/supabase";
import type { Channel, ChannelType } from "@/types";

const DEFAULT_CHANNELS: Channel[] = [
  { id: "email", label: "E", icon: "mail", activeColor: "bg-zinc-900 text-white", placeholder: "Reply via email...", enabled: true },
  { id: "whatsapp", label: "W", icon: "phone", activeColor: "bg-green-600 text-white", placeholder: "Send WhatsApp...", enabled: false },
  { id: "wisor", label: "R", icon: "zap", activeColor: "bg-blue-600 text-white", placeholder: "Rate request to Wisor...", enabled: true },
  { id: "internal", label: "N", icon: "message-circle", activeColor: "bg-amber-100 text-amber-900", placeholder: "Internal note... @ to mention", enabled: true },
  { id: "braiin", label: "brain", icon: "brain", activeColor: "bg-zinc-900 text-white", placeholder: "Ask Braiin: summarise this, what are the issues, suggest next steps...", enabled: true },
];

type Props = {
  channels?: Channel[];
  defaultChannel?: ChannelType;
  onSend: (content: string, channel: ChannelType, options?: {
    to?: string; cc?: string; bcc?: string; subject?: string; scheduledAt?: string; attachments?: File[];
    originalSuggestion?: string; suggestionType?: string; editDistance?: number; editReasons?: string[]; editReasonText?: string;
  }) => void;
  disabled?: boolean;
  contextLabel?: string;
  defaultTo?: string;
  defaultSubject?: string;
  defaultCc?: string[];
};

export type ReplyBarHandle = {
  setContent: (html: string, type?: string) => void;
  focus: () => void;
  getContent: () => string;
  getText: () => string;
  clear: () => void;
  setCc: (emails: string[]) => void;
};

export const ReplyBar = forwardRef<ReplyBarHandle, Props>(function ReplyBar({ channels = DEFAULT_CHANNELS, defaultChannel = "email", onSend, disabled, contextLabel, defaultTo, defaultSubject, defaultCc }: Props, ref) {
  const [activeChannel, setActiveChannel] = useState<ChannelType>(defaultChannel);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState("");
  const [staffList, setStaffList] = useState<{ name: string; email: string }[]>([]);
  const [showGuide, setShowGuide] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [ccEmails, setCcEmails] = useState<string[]>(defaultCc || []);
  const [replyTo, setReplyTo] = useState("");
  const [replySubject, setReplySubject] = useState("");
  const [replyBcc, setReplyBcc] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isEmpty, setIsEmpty] = useState(true);
  const [originalSuggestion, setOriginalSuggestion] = useState<string | null>(null);
  const [suggestionType, setSuggestionType] = useState<string | null>(null);
  const [showEditExplain, setShowEditExplain] = useState(false);
  const [editReasons, setEditReasons] = useState<string[]>([]);
  const [editReasonText, setEditReasonText] = useState("");
  const pendingSendRef = useRef<{ content: string; channel: ChannelType; options: any; scheduledAt?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeConfig = channels.find(c => c.id === activeChannel) || channels[0];
  const enabledChannels = channels.filter(c => c.enabled);

  useEffect(() => {
    supabase.from("staff").select("name, email").eq("is_active", true)
      .then(({ data }) => setStaffList(
        (data || [])
          .filter((s): s is { name: string; email: string } => !!s.email)
          .map((s) => ({ name: s.name, email: s.email })),
      ));
  }, []);

  // Update CC when switching emails
  useEffect(() => {
    setCcEmails(defaultCc || []);
  }, [defaultCc]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Underline,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Placeholder.configure({
        placeholder: " ", // We use a custom overlay instead
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none text-xs leading-relaxed text-zinc-700",
        style: expanded ? "min-height: 120px; padding: 8px 12px;" : "min-height: 36px; max-height: 120px; padding: 8px 12px;",
      },
      handleKeyDown: (view, event) => {
        // Cmd/Ctrl+Enter to send
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          handleSend();
          return true;
        }
        // Check for @ mention trigger
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      setIsEmpty(editor.isEmpty);
      const text = editor.getText();
      const atMatch = text.match(/@(\w*)$/);
      if (atMatch) {
        setShowMentions(true);
        setMentionSearch(atMatch[1].toLowerCase());
      } else {
        setShowMentions(false);
      }
    },
  });

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    setContent: (html: string, type?: string) => {
      if (editor) {
        editor.commands.setContent(html);
        editor.commands.focus("end");
        setExpanded(true);
        setIsEmpty(false);
        const text = html.replace(/<[^>]+>/g, "").trim();
        setOriginalSuggestion(text);
        setSuggestionType(type || "suggested");
      }
    },
    focus: () => {
      editor?.commands.focus("end");
    },
    getContent: () => {
      return editor?.getHTML() || "";
    },
    getText: () => {
      return editor?.getText().trim() || "";
    },
    clear: () => {
      editor?.commands.clearContent();
      setIsEmpty(true);
      setOriginalSuggestion(null);
      setSuggestionType(null);
    },
    setCc: (emails: string[]) => {
      // Dedupe + normalise whitespace; ReplyBar expects already-filtered
      // values (callers remove self + sender).
      const seen = new Set<string>();
      const next: string[] = [];
      for (const raw of emails || []) {
        const trimmed = (raw || "").trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(trimmed);
      }
      setCcEmails(next);
      // Auto-expand so the user can see the CC list they're about to send to.
      if (next.length > 0) setExpanded(true);
    },
  }), [editor]);

  // Dynamic placeholder text based on active channel
  const placeholderText = contextLabel && activeChannel !== "braiin"
    ? `${activeConfig.placeholder.replace("...", "")} ${contextLabel}...`
    : activeConfig.placeholder;

  function insertMention(staff: { name: string; email: string }) {
    if (!editor) return;
    const text = editor.getText();
    const beforeAt = text.replace(/@\w*$/, "");

    if (activeChannel === "email" || activeChannel === "wisor") {
      // In email mode: add to CC and insert name in text
      if (!ccEmails.includes(staff.email)) {
        setCcEmails(prev => [...prev, staff.email]);
      }
      editor.commands.setContent(`<p>${beforeAt}${staff.name.split(" ")[0]} </p>`);
    } else {
      // In internal/braiin mode: insert @email as mention
      editor.commands.setContent(`<p>${beforeAt}@${staff.email} </p>`);
    }
    setShowMentions(false);
    editor.commands.focus("end");
  }

  // Simple edit distance: ratio of changed characters to total
  function calcEditDistance(original: string, edited: string): number {
    if (!original || original === edited) return 0;
    const maxLen = Math.max(original.length, edited.length);
    if (maxLen === 0) return 0;
    let changes = 0;
    for (let i = 0; i < maxLen; i++) {
      if ((original[i] || "") !== (edited[i] || "")) changes++;
    }
    return Math.round((changes / maxLen) * 100) / 100;
  }

  function handleSend(scheduledAt?: string) {
    if (!editor || disabled) return;
    const html = editor.getHTML();
    const text = editor.getText().trim();
    if (!text) return;
    const content = (activeChannel === "internal" || activeChannel === "braiin") ? text : html;

    const options = {
      to: replyTo || defaultTo || undefined,
      cc: ccEmails.length > 0 ? ccEmails.join(", ") : undefined,
      bcc: replyBcc || undefined,
      subject: replySubject || defaultSubject || undefined,
      scheduledAt,
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    // Check if a suggestion was edited - show explain prompt
    if (originalSuggestion && text !== originalSuggestion) {
      const distance = calcEditDistance(originalSuggestion, text);
      if (distance > 0.05) { // More than 5% changed
        pendingSendRef.current = { content, channel: activeChannel, options, scheduledAt };
        setShowEditExplain(true);
        return;
      }
    }

    // Send directly
    completeSend(content, activeChannel, options);
  }

  function completeSend(content: string, channel: ChannelType, options: any) {
    onSend(content, channel, {
      ...options,
      // Include training data
      originalSuggestion: originalSuggestion || undefined,
      suggestionType: suggestionType || undefined,
      editDistance: originalSuggestion ? calcEditDistance(originalSuggestion, editor?.getText().trim() || "") : undefined,
      editReasons: editReasons.length > 0 ? editReasons : undefined,
      editReasonText: editReasonText || undefined,
    });
    editor?.commands.clearContent();
    setIsEmpty(true);
    setCcEmails([]);
    setAttachments([]);
    setExpanded(false);
    setShowSchedule(false);
    setShowEditExplain(false);
    setOriginalSuggestion(null);
    setSuggestionType(null);
    setEditReasons([]);
    setEditReasonText("");
  }

  function sendWithExplanation() {
    if (!pendingSendRef.current) return;
    const { content, channel, options } = pendingSendRef.current;
    completeSend(content, channel, options);
    pendingSendRef.current = null;
  }

  function skipExplanation() {
    if (!pendingSendRef.current) return;
    const { content, channel, options } = pendingSendRef.current;
    setEditReasons([]);
    setEditReasonText("");
    completeSend(content, channel, options);
    pendingSendRef.current = null;
  }

  const filteredStaff = staffList.filter(s =>
    s.name.toLowerCase().includes(mentionSearch) || s.email.toLowerCase().includes(mentionSearch)
  ).slice(0, 6);

  return (
    <div className="relative border-t bg-white">
      {/* Mention dropdown */}
      {showMentions && filteredStaff.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 mx-3 bg-white border rounded-lg shadow-lg py-1 max-h-48 overflow-y-auto z-50">
          {filteredStaff.map(s => (
            <button key={s.email} onClick={() => insertMention(s)}
              className="w-full text-left px-3 py-1.5 hover:bg-zinc-50 flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-zinc-900 text-white flex items-center justify-center text-[9px] font-medium">
                {s.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
              </div>
              <div>
                <p className="text-xs font-medium">{s.name}</p>
                <p className="text-[10px] text-zinc-400">{s.email}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Guide tooltip */}
      {showGuide && (
        <div className="absolute bottom-full left-3 right-3 mb-2 bg-zinc-900 text-white rounded-xl p-4 shadow-xl z-50">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold">How messaging works</p>
            <button onClick={() => setShowGuide(false)} className="text-zinc-400 hover:text-white text-xs">Got it</button>
          </div>
          <div className="space-y-2.5 text-[11px] leading-relaxed">
            <div className="flex items-start gap-2.5">
              <span className="w-6 h-6 rounded-lg bg-zinc-700 flex items-center justify-center text-[9px] font-bold shrink-0">E</span>
              <div><span className="font-medium">Email</span> - reply directly to the sender via email.</div>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="w-6 h-6 rounded-lg bg-blue-600 flex items-center justify-center text-[9px] font-bold shrink-0">R</span>
              <div><span className="font-medium">Wisor</span> - send a rate request with shipment details pre-filled.</div>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="w-6 h-6 rounded-lg bg-amber-100 text-amber-900 flex items-center justify-center text-[9px] font-bold shrink-0">N</span>
              <div><span className="font-medium">Internal note</span> - team only. Use <span className="bg-zinc-700 px-1 rounded">@name</span> to mention.</div>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="w-6 h-6 rounded-lg bg-zinc-200 text-zinc-900 flex items-center justify-center text-[9px] font-bold shrink-0">B</span>
              <div><span className="font-medium">Braiin AI</span> - ask about clients, deals, jobs, or rates.</div>
            </div>
          </div>
          <p className="text-[9px] text-zinc-500 mt-3">Cmd+Enter to send</p>
          <div className="absolute bottom-0 left-6 w-3 h-3 bg-zinc-900 rotate-45 translate-y-1.5" />
        </div>
      )}

      {/* Email fields - shown when expanded in email mode */}
      {expanded && (activeChannel === "email" || activeChannel === "wisor") && (
        <div className="px-3 py-1.5 border-b space-y-1 bg-white">
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-zinc-400 w-8">To</span>
            <input value={replyTo || defaultTo || ""} onChange={e => setReplyTo(e.target.value)}
              className="flex-1 px-2 py-1 border rounded text-xs bg-white" placeholder={defaultTo || "email@company.com"} />
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-zinc-400 w-8">CC</span>
            <div className="flex-1 flex items-center gap-1 flex-wrap">
              {ccEmails.map((email, i) => (
                <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-zinc-100 rounded text-[9px]">
                  {email}
                  <button onClick={() => setCcEmails(prev => prev.filter((_, j) => j !== i))} className="text-zinc-400 hover:text-zinc-600">x</button>
                </span>
              ))}
              <input
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.target as HTMLInputElement).value.includes("@")) {
                    e.preventDefault();
                    setCcEmails(prev => [...prev, (e.target as HTMLInputElement).value]);
                    (e.target as HTMLInputElement).value = "";
                  }
                }}
                className="flex-1 min-w-[100px] px-2 py-1 border rounded text-xs bg-white" placeholder="Add CC..." />
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-zinc-400 w-8">BCC</span>
            <input value={replyBcc} onChange={e => setReplyBcc(e.target.value)}
              className="flex-1 px-2 py-1 border rounded text-xs bg-white" placeholder="BCC..." />
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-zinc-400 w-8">Subj</span>
            <input value={replySubject || defaultSubject || ""} onChange={e => setReplySubject(e.target.value)}
              className="flex-1 px-2 py-1 border rounded text-xs bg-white" placeholder={defaultSubject || "Subject"} />
          </div>
        </div>
      )}

      {/* CC badges - shown inline when not expanded but CCs exist */}
      {!expanded && ccEmails.length > 0 && (
        <div className="px-3 py-1 border-b flex items-center gap-1 flex-wrap">
          <span className="text-[9px] text-zinc-400">CC:</span>
          {ccEmails.map((email, i) => (
            <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-zinc-100 rounded text-[9px]">
              {email}
              <button onClick={() => setCcEmails(prev => prev.filter((_, j) => j !== i))} className="text-zinc-400 hover:text-zinc-600">x</button>
            </span>
          ))}
        </div>
      )}

      {/* Formatting toolbar - shown when expanded or email channel */}
      {(expanded || activeChannel === "email" || activeChannel === "wisor") && editor && (
        <div className="flex items-center gap-0.5 px-3 py-1 border-b bg-zinc-50">
          <button type="button" onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1 rounded ${editor.isActive("bold") ? "bg-zinc-200 text-zinc-900" : "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"}`}>
            <Bold size={12} />
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1 rounded ${editor.isActive("italic") ? "bg-zinc-200 text-zinc-900" : "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"}`}>
            <Italic size={12} />
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={`p-1 rounded ${editor.isActive("underline") ? "bg-zinc-200 text-zinc-900" : "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"}`}>
            <UnderlineIcon size={12} />
          </button>
          <div className="w-px h-3.5 bg-zinc-200 mx-0.5" />
          <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`p-1 rounded ${editor.isActive("bulletList") ? "bg-zinc-200 text-zinc-900" : "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"}`}>
            <List size={12} />
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`p-1 rounded ${editor.isActive("orderedList") ? "bg-zinc-200 text-zinc-900" : "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"}`}>
            <ListOrdered size={12} />
          </button>
          <div className="w-px h-3.5 bg-zinc-200 mx-0.5" />
          <button type="button" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
            className="p-1 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100">
            <TableIcon size={12} />
          </button>
          <div className="flex-1" />
          <button onClick={() => setExpanded(!expanded)}
            className="text-[9px] text-zinc-400 hover:text-zinc-600">
            {expanded ? "Compact" : "Expand"}
          </button>
        </div>
      )}

      {/* Edit-and-explain prompt */}
      {showEditExplain && (
        <div className="px-3 py-3 border-b bg-amber-50 space-y-2">
          <p className="text-xs font-medium text-amber-900">You edited the AI suggestion. Quick note on why?</p>
          <p className="text-[9px] text-amber-700">This helps Braiin learn your preferences and write better replies.</p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: "tone_wrong", label: "Tone was wrong" },
              { id: "missing_info", label: "Missing information" },
              { id: "too_formal", label: "Too formal" },
              { id: "too_casual", label: "Too casual" },
              { id: "wrong_context", label: "Wrong context" },
              { id: "added_detail", label: "Added client detail" },
              { id: "shorter", label: "Made it shorter" },
              { id: "longer", label: "Made it longer" },
            ].map(reason => (
              <button key={reason.id}
                onClick={() => setEditReasons(prev => prev.includes(reason.id) ? prev.filter(r => r !== reason.id) : [...prev, reason.id])}
                className={`px-2 py-1 rounded text-[10px] transition-colors ${
                  editReasons.includes(reason.id)
                    ? "bg-amber-200 text-amber-900 font-medium"
                    : "bg-white border border-amber-200 text-amber-700 hover:bg-amber-100"
                }`}>
                {reason.label}
              </button>
            ))}
          </div>
          <input value={editReasonText} onChange={e => setEditReasonText(e.target.value)}
            placeholder="Any other details? (optional)"
            className="w-full px-2 py-1.5 border border-amber-200 rounded text-xs bg-white"
            onKeyDown={e => { if (e.key === "Enter") sendWithExplanation(); }} />
          <div className="flex gap-2">
            <button onClick={sendWithExplanation}
              className="px-3 py-1.5 bg-zinc-900 text-white rounded text-xs font-medium hover:bg-zinc-800">
              Save & Send
            </button>
            <button onClick={skipExplanation}
              className="px-3 py-1.5 text-zinc-500 text-xs hover:text-zinc-700">
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Editor area */}
      <div className="px-3 py-2">
        <div className={`bg-zinc-50 rounded-xl overflow-hidden relative ${expanded ? "" : "max-h-[120px] overflow-y-auto"}`}
          onClick={() => { editor?.commands.focus(); }}>
          {isEmpty && (
            <div className="absolute inset-0 px-3 py-2 text-xs text-zinc-400 pointer-events-none truncate z-0">
              {placeholderText}
            </div>
          )}
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Attachment preview */}
      {attachments.length > 0 && (
        <div className="px-3 py-1.5 border-t flex flex-wrap gap-1.5">
          {attachments.map((file, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-zinc-100 rounded text-[10px]">
              <Paperclip size={10} className="text-zinc-400" />
              <span className="truncate max-w-[120px]">{file.name}</span>
              <span className="text-zinc-400">{Math.round(file.size / 1024)}KB</span>
              <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                className="text-zinc-400 hover:text-zinc-600 ml-0.5">x</button>
            </span>
          ))}
        </div>
      )}

      {/* Bottom row: channels + actions */}
      <div className="flex items-center justify-between px-3 pb-2">
        <div className="flex gap-1">
          {enabledChannels.map(ch => (
            <button key={ch.id} onClick={() => setActiveChannel(ch.id)}
              title={ch.placeholder}
              className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold transition-colors ${
                ch.label === "brain"
                  ? activeChannel === ch.id ? "bg-zinc-900" : "bg-zinc-100 hover:bg-zinc-200"
                  : activeChannel === ch.id ? ch.activeColor : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
              }`}>
              {ch.label === "brain" ? (
                <img src="/brain-icon.png" alt="Braiin"
                  className={`w-3.5 h-3.5 ${activeChannel === ch.id ? "brightness-0 invert" : ""}`} />
              ) : ch.label}
            </button>
          ))}
          <button onClick={() => setShowGuide(!showGuide)}
            className="w-5 h-5 rounded-full bg-zinc-100 flex items-center justify-center text-[9px] text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 mt-0.5"
            title="How messaging works">
            ?
          </button>
        </div>
        <div className="flex gap-1 relative">
          <input ref={fileInputRef} type="file" multiple className="hidden"
            onChange={e => {
              if (e.target.files) {
                setAttachments(prev => [...prev, ...Array.from(e.target.files!)]);
                setExpanded(true);
              }
              e.target.value = "";
            }} />
          <button onClick={() => fileInputRef.current?.click()}
            className="w-7 h-7 rounded-lg bg-zinc-100 flex items-center justify-center hover:bg-zinc-200" title="Attach file">
            <Paperclip size={13} className={attachments.length > 0 ? "text-zinc-900" : "text-zinc-500"} />
          </button>
          <button onClick={() => handleSend()} disabled={isEmpty || disabled}
            className="w-7 h-7 rounded-full bg-zinc-900 flex items-center justify-center hover:bg-zinc-800 disabled:opacity-30"
            title="Send now (Cmd+Enter)">
            <Send size={12} className="text-white" />
          </button>
          <button onClick={() => setShowSchedule(!showSchedule)} disabled={isEmpty || disabled}
            className="w-7 h-7 rounded-lg bg-zinc-100 flex items-center justify-center hover:bg-zinc-200 disabled:opacity-30"
            title="Send later">
            <Clock size={12} className="text-zinc-500" />
          </button>
          {showSchedule && (
            <div className="absolute bottom-full right-0 mb-1 bg-white border rounded-lg shadow-lg py-1 w-48 z-50">
              <p className="px-3 py-1 text-[9px] text-zinc-400 font-medium uppercase">Send later</p>
              <button onClick={() => handleSend(new Date(Date.now() + 60 * 60 * 1000).toISOString())}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50">In 1 hour</button>
              <button onClick={() => handleSend(new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString())}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50">In 2 hours</button>
              <button onClick={() => {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(8, 0, 0, 0);
                handleSend(tomorrow.toISOString());
              }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50">Tomorrow 8:00 AM</button>
              <button onClick={() => {
                const monday = new Date();
                monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
                monday.setHours(8, 0, 0, 0);
                handleSend(monday.toISOString());
              }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50">Next Monday 8:00 AM</button>
              <div className="border-t my-1" />
              <div className="px-3 py-1.5">
                <input type="datetime-local" className="w-full px-2 py-1 border rounded text-[10px]"
                  onChange={e => { if (e.target.value) handleSend(new Date(e.target.value).toISOString()); }} />
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        .tiptap p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #a1a1aa;
          pointer-events: none;
          height: 0;
          font-size: 12px;
        }
        .tiptap table { border-collapse: collapse; width: 100%; margin: 4px 0; }
        .tiptap th, .tiptap td { border: 1px solid #e4e4e7; padding: 2px 6px; font-size: 11px; }
        .tiptap th { background: #f4f4f5; font-weight: 600; }
        .tiptap ul { padding-left: 20px; margin: 4px 0; list-style-type: disc; }
        .tiptap ol { padding-left: 20px; margin: 4px 0; list-style-type: decimal; }
        .tiptap li { font-size: 12px; margin: 2px 0; }
        .tiptap li p { margin: 0; }
        .tiptap p { margin: 1px 0; }
      `}</style>
    </div>
  );
});
