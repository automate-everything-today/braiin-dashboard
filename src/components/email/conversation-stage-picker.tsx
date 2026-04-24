"use client";

import { useState } from "react";
import {
  CONVERSATION_STAGES,
  STAGE_LABEL,
  STAGE_STYLE,
  STAGE_DESCRIPTION,
  type ConversationStage,
} from "@/lib/conversation-stages";

type Props = {
  aiStage: ConversationStage | null;
  userStage: ConversationStage | null;
  onChange?: (next: ConversationStage | null) => Promise<void> | void;
  size?: "sm" | "xs";
};

/**
 * Stage pill for the AI bubble. Shows the effective stage (user override
 * if set, else AI detection). Click to open a dropdown of every stage;
 * pick one to record a manual override, or "Clear override" to fall back
 * to the AI's detection. Disabled when the email has no stage signal
 * yet (e.g. legacy row still hydrating) - click "set stage" to assign
 * one manually.
 */
export function ConversationStagePicker({
  aiStage,
  userStage,
  onChange,
  size = "sm",
}: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const effective = userStage ?? aiStage;
  const isOverride = userStage !== null;
  const padding = size === "xs" ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]";

  async function select(stage: ConversationStage | null) {
    if (saving || !onChange) return;
    setSaving(true);
    try {
      await onChange(stage);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative inline-block">
      {effective ? (
        <button
          onClick={() => setOpen((v) => !v)}
          className={`${padding} rounded-full border transition-colors ${STAGE_STYLE[effective]} ${isOverride ? "ring-1 ring-offset-0" : ""} hover:brightness-95`}
          title={`${STAGE_DESCRIPTION[effective]}${isOverride ? " - manually set" : " - detected by AI"}`}
        >
          {STAGE_LABEL[effective]}
        </button>
      ) : (
        <button
          onClick={() => setOpen((v) => !v)}
          className={`${padding} rounded-full border border-dashed border-zinc-300 text-zinc-400 hover:border-zinc-400 hover:text-zinc-600`}
        >
          + stage
        </button>
      )}

      {open && onChange && (
        <div
          className="absolute z-20 mt-1 right-0 w-56 bg-white border border-zinc-200 rounded-lg shadow-md p-1 max-h-80 overflow-y-auto"
          onMouseLeave={() => setOpen(false)}
        >
          {CONVERSATION_STAGES.map((stage) => {
            const active = effective === stage;
            return (
              <button
                key={stage}
                onClick={() => select(stage)}
                disabled={saving}
                className={`w-full text-left flex items-center justify-between gap-2 px-2 py-1.5 rounded text-[11px] transition-colors ${
                  active
                    ? "bg-zinc-100 font-medium"
                    : "hover:bg-zinc-50"
                } disabled:opacity-50`}
              >
                <span className={`inline-flex px-1.5 py-0.5 rounded-full border text-[10px] ${STAGE_STYLE[stage]}`}>
                  {STAGE_LABEL[stage]}
                </span>
                {active && isOverride && (
                  <span className="text-[9px] text-zinc-400">set</span>
                )}
              </button>
            );
          })}
          {isOverride && (
            <>
              <div className="my-1 border-t border-zinc-100" />
              <button
                onClick={() => select(null)}
                disabled={saving}
                className="w-full text-left px-2 py-1.5 rounded text-[10px] text-zinc-500 hover:bg-zinc-50 disabled:opacity-50"
              >
                Clear override (use AI)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
