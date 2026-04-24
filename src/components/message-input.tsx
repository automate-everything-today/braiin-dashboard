"use client";

import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";
import { useSendMessage } from "@/hooks/use-messages";
import { supabase } from "@/lib/supabase";

type Props = {
  contextType: string;
  contextId?: string;
  contextSummary?: string;
  contextUrl?: string;
  parentId?: number | null;
  onSent?: () => void;
};

export function MessageInput({ contextType, contextId, contextSummary, contextUrl, parentId, onSent }: Props) {
  const [content, setContent] = useState("");
  const [showMentions, setShowMentions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState("");
  const [staffList, setStaffList] = useState<{ name: string; email: string }[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useSendMessage();

  useEffect(() => {
    supabase.from("staff").select("name, email").eq("is_active", true)
      .then(({ data }) => setStaffList(
        (data || [])
          .filter((s): s is { name: string; email: string } => !!s.email)
          .map((s) => ({ name: s.name, email: s.email })),
      ));
  }, []);

  function handleInput(value: string) {
    setContent(value);
    // Detect @ trigger
    const beforeCursor = value.slice(0, inputRef.current?.selectionStart || value.length);
    const atMatch = beforeCursor.match(/@(\w*)$/);
    if (atMatch) {
      setShowMentions(true);
      setMentionSearch(atMatch[1].toLowerCase());
    } else {
      setShowMentions(false);
    }
  }

  function insertMention(staff: { name: string; email: string }) {
    const beforeCursor = content.slice(0, inputRef.current?.selectionStart || content.length);
    const afterCursor = content.slice(inputRef.current?.selectionStart || content.length);
    const beforeAt = beforeCursor.replace(/@\w*$/, "");
    setContent(`${beforeAt}@${staff.email} ${afterCursor}`);
    setShowMentions(false);
    inputRef.current?.focus();
  }

  function handleSend() {
    if (!content.trim()) return;
    sendMessage.mutate({
      content: content.trim(),
      context_type: contextType,
      context_id: contextId,
      context_summary: contextSummary,
      context_url: contextUrl,
      parent_id: parentId || null,
    }, {
      onSuccess: () => {
        setContent("");
        onSent?.();
      },
    });
  }

  const filteredStaff = staffList.filter(s =>
    s.name.toLowerCase().includes(mentionSearch) || s.email.toLowerCase().includes(mentionSearch)
  ).slice(0, 6);

  return (
    <div className="relative">
      {showMentions && filteredStaff.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border rounded-lg shadow-lg py-1 max-h-48 overflow-y-auto z-50">
          {filteredStaff.map(s => (
            <button key={s.email} onClick={() => insertMention(s)}
              className="w-full text-left px-3 py-1.5 hover:bg-zinc-50 flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-zinc-900 text-white flex items-center justify-center text-[9px] font-medium">
                {s.name.split(" ").filter(Boolean).map(n => n[0]).join("").slice(0, 2)}
              </div>
              <div>
                <p className="text-xs font-medium">{s.name}</p>
                <p className="text-[10px] text-zinc-400">{s.email}</p>
              </div>
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-1.5 items-end">
        <textarea
          ref={inputRef}
          value={content}
          onChange={e => handleInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Type a message... use @ to mention someone"
          className="flex-1 px-3 py-2 border rounded-lg text-xs resize-none min-h-[36px] max-h-[120px]"
          rows={1}
        />
        <button onClick={handleSend} disabled={!content.trim() || sendMessage.isPending}
          className="px-3 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 disabled:opacity-30">
          <Send size={12} />
        </button>
      </div>
    </div>
  );
}
