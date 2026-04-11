"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Underline } from "@tiptap/extension-underline";
import { Placeholder } from "@tiptap/extension-placeholder";
import { TextAlign } from "@tiptap/extension-text-align";
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Table as TableIcon, AlignLeft, AlignCenter, Undo, Redo, Minus } from "lucide-react";

type Props = {
  content?: string;
  placeholder?: string;
  onChange?: (html: string) => void;
  onSubmit?: () => void;
  minHeight?: string;
  compact?: boolean;
};

function ToolbarButton({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: React.ReactNode; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1 rounded transition-colors ${active ? "bg-zinc-200 text-zinc-900" : "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"}`}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({ content, placeholder, onChange, onSubmit, minHeight = "120px", compact }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Placeholder.configure({ placeholder: placeholder || "Write your message..." }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: content || "",
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: `prose prose-sm max-w-none focus:outline-none text-xs leading-relaxed text-zinc-700`,
        style: `min-height: ${minHeight}; padding: 8px 12px;`,
      },
      handleKeyDown: (view, event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          onSubmit?.();
          return true;
        }
        return false;
      },
    },
  });

  if (!editor) return null;

  return (
    <div className="border rounded-lg bg-white overflow-hidden">
      {/* Toolbar */}
      <div className={`flex items-center gap-0.5 px-2 border-b bg-zinc-50 ${compact ? "py-1" : "py-1.5"}`}>
        <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold (Cmd+B)">
          <Bold size={13} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic (Cmd+I)">
          <Italic size={13} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline (Cmd+U)">
          <UnderlineIcon size={13} />
        </ToolbarButton>

        <div className="w-px h-4 bg-zinc-200 mx-1" />

        <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
          <List size={13} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
          <ListOrdered size={13} />
        </ToolbarButton>

        <div className="w-px h-4 bg-zinc-200 mx-1" />

        <ToolbarButton active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Align left">
          <AlignLeft size={13} />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Align center">
          <AlignCenter size={13} />
        </ToolbarButton>

        <div className="w-px h-4 bg-zinc-200 mx-1" />

        <ToolbarButton onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert table">
          <TableIcon size={13} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal line">
          <Minus size={13} />
        </ToolbarButton>

        <div className="flex-1" />

        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} title="Undo (Cmd+Z)">
          <Undo size={13} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} title="Redo (Cmd+Shift+Z)">
          <Redo size={13} />
        </ToolbarButton>

        <p className="text-[8px] text-zinc-300 ml-2">Cmd+Enter to send</p>
      </div>

      {/* Editor */}
      <EditorContent editor={editor} />

      <style jsx global>{`
        .tiptap p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #a1a1aa;
          pointer-events: none;
          height: 0;
          font-size: 12px;
        }
        .tiptap table {
          border-collapse: collapse;
          width: 100%;
          margin: 8px 0;
        }
        .tiptap th, .tiptap td {
          border: 1px solid #e4e4e7;
          padding: 4px 8px;
          font-size: 11px;
        }
        .tiptap th {
          background: #f4f4f5;
          font-weight: 600;
        }
        .tiptap ul, .tiptap ol {
          padding-left: 20px;
          margin: 4px 0;
        }
        .tiptap li {
          font-size: 12px;
        }
        .tiptap h2 {
          font-size: 16px;
          font-weight: 600;
          margin: 8px 0 4px;
        }
        .tiptap h3 {
          font-size: 14px;
          font-weight: 600;
          margin: 6px 0 4px;
        }
        .tiptap hr {
          border: none;
          border-top: 1px solid #e4e4e7;
          margin: 8px 0;
        }
        .tiptap p {
          margin: 2px 0;
        }
      `}</style>
    </div>
  );
}

// Helper to get editor content as HTML
export function useRichTextContent(editor: ReturnType<typeof useEditor>) {
  return editor?.getHTML() || "";
}
