"use client";

import { useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Bold, Italic, List, ListOrdered, Send, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/**
 * Inline reply composer for the stages drawer. Deliberately scoped down
 * vs the full /email ReplyBar - no channels, no drafts, no AI panels,
 * no internal-note mode. Just the path: type a quick reply, send.
 *
 * Defaults the recipient to the sender of the email being viewed and
 * the subject to "Re: <subject>". Reply All / Forward / attachments
 * are out of scope; for those the user clicks "Open in inbox" in the
 * drawer footer and uses the full composer.
 */

type Props = {
  toAddress: string;
  subject: string;
  fromMailbox: string;
  emailId: string;
  onSent?: () => void;
};

export function DrawerReply({ toAddress, subject, fromMailbox, emailId, onSent }: Props) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Type a quick reply..." }),
    ],
    content: "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none focus:outline-none min-h-[80px] px-2 py-1.5 text-[12px] text-zinc-800",
      },
    },
  });

  async function send() {
    if (!editor || sending) return;
    const html = editor.getHTML();
    const text = editor.getText().trim();
    if (text.length === 0) {
      toast.error("Reply cannot be empty");
      return;
    }
    setSending(true);
    try {
      const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
      const res = await fetch("/api/email-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_email: fromMailbox,
          to: toAddress,
          subject: replySubject,
          body: html,
          reply_to_email: { id: emailId, subject },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Send failed (${res.status})`);
      }
      editor.commands.clearContent();
      setOpen(false);
      toast.success("Reply sent");
      onSent?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send reply");
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left text-[11px] text-zinc-400 hover:text-zinc-600 px-2 py-2 border border-zinc-200 rounded bg-zinc-50 hover:bg-zinc-100 transition-colors"
      >
        Quick reply to {toAddress}...
      </button>
    );
  }

  return (
    <div className="border border-zinc-200 rounded bg-white">
      <div className="px-2 py-1 border-b border-zinc-100 flex items-center justify-between text-[10px] text-zinc-500">
        <span className="truncate">
          Reply to <span className="text-zinc-800">{toAddress}</span>
        </span>
        <button
          onClick={() => {
            editor?.commands.clearContent();
            setOpen(false);
          }}
          className="text-zinc-400 hover:text-zinc-700"
        >
          Cancel
        </button>
      </div>
      <EditorContent editor={editor} />
      <div className="px-1.5 py-1 border-t border-zinc-100 flex items-center justify-between bg-zinc-50">
        <div className="flex items-center gap-0.5">
          <ToolbarButton
            active={editor?.isActive("bold")}
            onClick={() => editor?.chain().focus().toggleBold().run()}
            label="Bold"
          >
            <Bold size={12} />
          </ToolbarButton>
          <ToolbarButton
            active={editor?.isActive("italic")}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            label="Italic"
          >
            <Italic size={12} />
          </ToolbarButton>
          <ToolbarButton
            active={editor?.isActive("bulletList")}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            label="Bulleted list"
          >
            <List size={12} />
          </ToolbarButton>
          <ToolbarButton
            active={editor?.isActive("orderedList")}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            label="Numbered list"
          >
            <ListOrdered size={12} />
          </ToolbarButton>
        </div>
        <button
          onClick={send}
          disabled={sending}
          className="text-[11px] font-medium px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 inline-flex items-center gap-1"
        >
          {sending ? (
            <RefreshCw size={11} className="animate-spin" />
          ) : (
            <Send size={11} />
          )}
          {sending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}

function ToolbarButton({
  children,
  active,
  onClick,
  label,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`p-1 rounded ${active ? "bg-zinc-200 text-zinc-900" : "text-zinc-500 hover:bg-zinc-100"}`}
    >
      {children}
    </button>
  );
}
