"use client";

/**
 * Floating "Suggest a change" button shown on every /dev/* page.
 *
 * Clicking opens a slide-in form: title, description, priority,
 * paste-or-pick screenshot upload. Source page is auto-captured from
 * window.location.pathname.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Lightbulb, Paperclip, Send, Sparkles, X } from "lucide-react";

const PILL_SM =
  "text-[10px] px-1.5 py-0 leading-[18px] h-[18px] font-normal tracking-normal";

type Priority = "low" | "medium" | "high" | "urgent";

interface Attachment {
  url: string;
  filename: string;
  content_type: string;
  size: number;
  uploaded_at: string;
}

export function ChangeRequestWidget() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [tags, setTags] = useState("");
  const [name, setName] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Paste image support: when the form is open + textarea focused,
  // a Cmd+V with image data uploads it as an attachment.
  useEffect(() => {
    if (!open) return;
    function onPaste(e: ClipboardEvent) {
      if (!e.clipboardData) return;
      for (const item of e.clipboardData.items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            uploadFile(file);
          }
        }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open]);

  function reset() {
    setTitle("");
    setDescription("");
    setPriority("medium");
    setTags("");
    setAttachments([]);
    setError(null);
    setSubmitted(false);
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/change-requests/upload", {
        method: "POST",
        body: fd,
      });
      const data = await r.json();
      if (!r.ok || data.error) {
        setError(data.error ?? "Upload failed");
      } else {
        setAttachments((a) => [...a, data.attachment]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!title.trim() || !description.trim()) {
      setError("Title and description are required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/change-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // Full URL (host + path + search + hash) so the CTO can
          // jump straight to the exact context the request was raised
          // from. Falls back to pathname server-side.
          source_page:
            typeof window !== "undefined" ? window.location.href : "unknown",
          title: title.trim(),
          description: description.trim(),
          priority,
          tags: tags
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          raised_by_name: name.trim() || null,
          attachments,
        }),
      });
      const data = await r.json();
      if (!r.ok || data.error) {
        setError(data.error ?? "Submit failed");
      } else {
        setSubmitted(true);
        setTimeout(() => {
          reset();
          setOpen(false);
        }, 1800);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Floating trigger */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 px-3 h-10 rounded-full bg-violet-600 text-white text-xs font-medium shadow-lg hover:bg-violet-700 transition-colors"
          title="Raise a change request"
        >
          <Lightbulb className="size-4" />
          Suggest a change
        </button>
      )}

      {/* Slide-in form */}
      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="flex-1 bg-zinc-900/30 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
          />
          <div className="w-[560px] bg-white border-l border-zinc-200 flex flex-col shadow-2xl">
            <div className="border-b px-5 py-4 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                  <Lightbulb className="size-3.5 text-violet-600" />
                  Suggest a change
                </div>
                <div className="font-medium">What should we build / fix?</div>
                <div className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                  Page captured:{" "}
                  <span className="font-mono text-zinc-700 break-all">
                    {typeof window !== "undefined" ? window.location.href : ""}
                  </span>
                  <br />
                  Paste a screenshot with Cmd+V or use the paperclip below.
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="size-8 inline-flex items-center justify-center rounded hover:bg-zinc-100 text-zinc-500"
              >
                <X className="size-4" />
              </button>
            </div>

            {submitted ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
                <Sparkles className="size-10 text-emerald-600 mb-3" />
                <div className="font-medium">Submitted</div>
                <div className="text-xs text-zinc-500 mt-1 max-w-xs">
                  Lands in{" "}
                  <Link
                    href="/dev/change-requests"
                    className="underline text-violet-700"
                  >
                    /dev/change-requests
                  </Link>{" "}
                  for review. CTO will brainstorm and decide.
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-600 block">Title</label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Short summary, e.g. 'Charge code dropdown should remember last selection'"
                      className="w-full h-9 px-2 rounded border border-zinc-300 text-sm bg-white"
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-600 block">
                      Description / context / insight
                    </label>
                    <textarea
                      ref={textareaRef}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={6}
                      placeholder="What's the change? Why does it matter? Who benefits? Paste a screenshot if useful."
                      className="w-full px-2 py-2 rounded border border-zinc-300 text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-violet-200"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] text-zinc-600 block">
                        Priority
                      </label>
                      <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value as Priority)}
                        className="w-full h-9 px-2 rounded border border-zinc-300 text-sm bg-white"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-zinc-600 block">
                        Your name (optional)
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Rob"
                        className="w-full h-9 px-2 rounded border border-zinc-300 text-sm bg-white"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-zinc-600 block">
                      Tags (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={tags}
                      onChange={(e) => setTags(e.target.value)}
                      placeholder="ux, backend, ai"
                      className="w-full h-9 px-2 rounded border border-zinc-300 text-sm bg-white"
                    />
                  </div>

                  {/* Attachments */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] text-zinc-600">
                        Attachments ({attachments.length})
                      </label>
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="inline-flex items-center gap-1 text-[11px] text-violet-700 hover:bg-violet-50 px-2 py-1 rounded"
                      >
                        <Paperclip className="size-3" />
                        Add file
                      </button>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadFile(f);
                          if (fileRef.current) fileRef.current.value = "";
                        }}
                      />
                    </div>
                    {uploading && (
                      <div className="text-[11px] text-zinc-500 italic">
                        Uploading...
                      </div>
                    )}
                    {attachments.length > 0 && (
                      <div className="grid grid-cols-3 gap-2">
                        {attachments.map((a, i) => (
                          <div
                            key={i}
                            className="border rounded overflow-hidden bg-zinc-50"
                          >
                            {a.content_type.startsWith("image/") ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={a.url}
                                alt={a.filename}
                                className="w-full h-24 object-cover"
                              />
                            ) : (
                              <div className="h-24 flex items-center justify-center text-zinc-500 text-xs">
                                <Paperclip className="size-4 mr-1" />
                                {a.filename}
                              </div>
                            )}
                            <div className="text-[10px] text-zinc-500 truncate px-1 py-0.5 border-t bg-white">
                              {a.filename}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {error && (
                    <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
                      {error}
                    </div>
                  )}
                </div>

                <div className="border-t px-5 py-3 flex items-center justify-between bg-zinc-50">
                  <Link
                    href="/dev/change-requests"
                    className="text-[11px] text-zinc-500 hover:text-zinc-800 underline"
                  >
                    View all change requests
                  </Link>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="px-3 h-8 rounded text-xs border border-zinc-300 hover:bg-zinc-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={submit}
                      disabled={submitting || !title.trim() || !description.trim()}
                      className="inline-flex items-center gap-1.5 px-3 h-8 rounded text-xs bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Send className="size-3" />
                      {submitting ? "Submitting..." : "Submit request"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Re-export the pill class so consumer pages can match the visual.
export const CHANGE_REQUEST_PILL_SM = PILL_SM;
