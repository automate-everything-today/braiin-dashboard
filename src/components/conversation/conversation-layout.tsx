// src/components/conversation/conversation-layout.tsx
"use client";

import { useState, useCallback } from "react";
import { Eye, EyeOff, X } from "lucide-react";

type Props = {
  leftPanel: React.ReactNode;
  threadHeader: React.ReactNode;
  threadContent: React.ReactNode;
  replyBar: React.ReactNode;
  rightPanel: React.ReactNode;
  showFocusToggle?: boolean;
  onFocusModeChange?: (active: boolean) => void;
  onFileDrop?: (files: File[]) => void;
};

export function ConversationLayout({
  leftPanel, threadHeader, threadContent, replyBar, rightPanel,
  showFocusToggle, onFocusModeChange, onFileDrop,
}: Props) {
  const [focusMode, setFocusMode] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function toggleFocus() {
    setFocusMode(!focusMode);
    onFocusModeChange?.(!focusMode);
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && onFileDrop) {
      onFileDrop(files);
    }
  }, [onFileDrop]);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left panel */}
      {leftPanel}

      {/* Middle - conversation */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden"
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        {/* Thread header */}
        <div className="flex items-center justify-between px-4 py-2 border-b shrink-0 bg-white">
          <div className="flex-1 min-w-0">{threadHeader}</div>
          {showFocusToggle && (
            <button onClick={toggleFocus}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] ml-2 shrink-0 ${
                focusMode ? "bg-zinc-900 text-white" : "text-zinc-400 hover:bg-zinc-100"
              }`}>
              {focusMode ? <EyeOff size={12} /> : <Eye size={12} />}
              {focusMode ? "Focus" : ""}
            </button>
          )}
        </div>

        {/* Drop overlay */}
        {dragging && (
          <div className="absolute inset-0 bg-blue-50/80 border-2 border-dashed border-blue-400 rounded-lg z-30 flex items-center justify-center">
            <p className="text-blue-600 font-medium text-sm">Drop files to attach</p>
          </div>
        )}

        {/* Thread content */}
        <div className="flex-1 overflow-y-auto" style={{ background: "linear-gradient(to right, #ebebeb 1px, transparent 1px), linear-gradient(to bottom, #ebebeb 1px, transparent 1px)", backgroundSize: "6px 6px", backgroundColor: "#fafafa" }}>
          {threadContent}
        </div>

        {/* Reply bar */}
        <div className="shrink-0">
          {replyBar}
        </div>
      </div>

      {/* PDF Preview Modal */}
      {previewUrl && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setPreviewUrl(null)}>
          <div className="bg-white rounded-lg shadow-xl w-[80vw] h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <p className="text-sm font-medium">Document Preview</p>
              <button onClick={() => setPreviewUrl(null)} className="p-1 hover:bg-zinc-100 rounded"><X size={16} /></button>
            </div>
            <iframe src={previewUrl} className="flex-1 w-full" />
          </div>
        </div>
      )}

      {/* Right panel */}
      {rightPanel}
    </div>
  );
}

// Export for child components to trigger preview
export const PreviewContext = { setPreviewUrl: null as ((url: string | null) => void) | null };
