"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Render arbitrary HTML email content inside a sandboxed iframe.
 *
 * Email bodies come from external senders, so they are inherently
 * untrusted - rendering them via raw inner-HTML injection would be
 * an XSS vector. The sandbox attribute below intentionally OMITS
 * `allow-scripts`, so any inline scripts, event handlers, or
 * `javascript:` URLs in the email become inert.
 *
 * `allow-popups` lets target="_blank" links actually open new tabs;
 * without it the browser silently swallows the click. `allow-popups-
 * to-escape-sandbox` keeps the opened page unsandboxed so external
 * sites work normally.
 *
 * cid: image references are resolved via /api/email-images, which
 * fetches the inline attachments from Microsoft Graph and inlines
 * them as base64 data URLs.
 */

type Attachment = {
  id?: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
};

export function HtmlIframe({ html, emailId }: { html: string; emailId?: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  const [resolvedHtml, setResolvedHtml] = useState(html);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

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
      .then((r) => r.json())
      .then((data) => {
        if (data.body) setResolvedHtml(data.body);
        if (data.attachments) setAttachments(data.attachments as Attachment[]);
      })
      .catch(() => setResolvedHtml(html));
  }, [html, emailId]);

  const onLoad = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
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
    style.textContent =
      "body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 13px; color: #3f3f46; margin: 0; padding: 0; overflow-x: hidden; } img { max-width: 100%; height: auto; } table { max-width: 100%; } a { color: #2563eb; }";
    doc.head.appendChild(style);
    const h = doc.body.scrollHeight;
    if (h > 0) setHeight(Math.min(h + 16, 1200));
  }, []);

  function openInBrowser() {
    const blob = new Blob([resolvedHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
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
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        className="w-full border-0 rounded-lg bg-white"
        style={{ height: `${height}px` }}
      />
      {attachments.length > 0 && (
        <div className="mt-2 space-y-1">
          {attachments.map((att, i) => (
            <a
              key={att.id || i}
              href={`/api/email-images?messageId=${emailId}&attachmentId=${att.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-2 py-1.5 bg-zinc-50 rounded border text-[10px] hover:bg-zinc-100"
            >
              <span>{"\u{1F4CE}"}</span>
              <span className="flex-1 truncate text-zinc-600">{att.name}</span>
              <span className="text-zinc-400 shrink-0">
                {att.size ? `${Math.round(att.size / 1024)}KB` : ""}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
