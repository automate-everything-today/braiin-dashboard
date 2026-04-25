"use client";

import { useMemo, useState } from "react";
import { Plane, Ship, Truck, Warehouse } from "lucide-react";
import {
  DEPARTMENT_TAGS,
  MODE_TAGS,
  ALL_TAGS,
  type RelevanceTag,
  isDepartmentTag,
} from "@/lib/relevance-tags";

const DEPT_STYLE = "bg-blue-50 text-blue-700 border-blue-200";

// Mode icons + colour pairs. Same palette across the app so a blue plane
// always means Air etc. (matches entity-list MODE_ICON).
const MODE_ICON: Record<string, { Icon: React.ComponentType<{ size?: number; className?: string }>; tone: string }> = {
  Air: { Icon: Plane, tone: "text-blue-600 bg-blue-50 border-blue-200" },
  Sea: { Icon: Ship, tone: "text-green-600 bg-green-50 border-green-200" },
  Road: { Icon: Truck, tone: "text-red-600 bg-red-50 border-red-200" },
  Warehousing: { Icon: Warehouse, tone: "text-orange-600 bg-orange-50 border-orange-200" },
};

type Props = {
  aiTags: string[];
  userTags: string[] | null | undefined;
  relevanceThumbs?: "thumbs_up" | "thumbs_down" | null;
  onChange?: (nextTags: string[] | null) => Promise<void> | void;
  onThumbsUp?: () => Promise<void> | void;
  size?: "sm" | "xs";
};

/**
 * Clickable relevance-tag chips. The displayed set is user_tags when set,
 * otherwise ai_tags. Clicking a chip opens an inline picker of the full
 * controlled vocab - checking/unchecking writes back as a user override.
 * Re-allocation works at any lifecycle stage, not just on a correction.
 */
export function RelevanceTagChips({
  aiTags,
  userTags,
  relevanceThumbs,
  onChange,
  onThumbsUp,
  size = "sm",
}: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [thumbsSaving, setThumbsSaving] = useState(false);

  const effective = useMemo<RelevanceTag[]>(
    () =>
      (userTags && userTags.length > 0 ? userTags : aiTags).filter(
        (t): t is RelevanceTag => (ALL_TAGS as readonly string[]).includes(t),
      ),
    [aiTags, userTags],
  );

  const isOverride = userTags !== null && userTags !== undefined;

  async function toggleTag(tag: RelevanceTag) {
    if (saving || !onChange) return;
    const next = effective.includes(tag)
      ? effective.filter((t) => t !== tag)
      : [...effective, tag];
    setSaving(true);
    try {
      await onChange(next);
    } finally {
      setSaving(false);
    }
  }

  async function clearOverride() {
    if (saving || !onChange) return;
    setSaving(true);
    try {
      await onChange(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleThumbsUp() {
    if (thumbsSaving || !onThumbsUp) return;
    setThumbsSaving(true);
    try {
      await onThumbsUp();
    } finally {
      setThumbsSaving(false);
    }
  }

  const padding = size === "xs" ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]";

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {effective.length === 0 && !open && (
        <button
          onClick={() => setOpen(true)}
          className={`${padding} rounded-full border border-dashed border-zinc-300 text-zinc-400 hover:border-zinc-400 hover:text-zinc-500`}
        >
          + tag
        </button>
      )}
      {effective.map((tag) => {
        if (!isDepartmentTag(tag) && MODE_ICON[tag]) {
          const { Icon, tone } = MODE_ICON[tag];
          return (
            <span
              key={tag}
              title={`${tag}${isOverride ? " - manually set" : " - detected by AI"}`}
              className={`inline-flex items-center justify-center ${size === "xs" ? "w-4 h-4" : "w-5 h-5"} rounded border ${tone} ${isOverride ? "ring-1 ring-offset-0" : ""}`}
            >
              <Icon size={size === "xs" ? 9 : 11} />
            </span>
          );
        }
        return (
          <span
            key={tag}
            className={`${padding} rounded-full border ${DEPT_STYLE} ${isOverride ? "ring-1 ring-offset-0" : ""}`}
            title={isOverride ? "Manually set" : "Detected by AI"}
          >
            {tag}
          </span>
        );
      })}
      {onChange && (
        <button
          onClick={() => setOpen((v) => !v)}
          className={`${padding} rounded-full text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50`}
          title="Edit tags"
        >
          {open ? "done" : "edit"}
        </button>
      )}
      {onThumbsUp && !isOverride && effective.length > 0 && (
        <button
          onClick={handleThumbsUp}
          disabled={thumbsSaving}
          className={`${padding} rounded-full transition-colors ${
            relevanceThumbs === "thumbs_up"
              ? "bg-green-100 text-green-700"
              : "text-zinc-400 hover:text-green-600 hover:bg-green-50"
          } disabled:opacity-50`}
          title={
            relevanceThumbs === "thumbs_up"
              ? "Confirmed as correct"
              : "Confirm AI got these right"
          }
        >
          {relevanceThumbs === "thumbs_up" ? "✓" : "\u{1F44D}"}
        </button>
      )}
      {open && onChange && (
        <div className="w-full mt-1 p-2 bg-white border border-zinc-200 rounded-lg flex flex-col gap-1.5 shadow-sm">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[9px] uppercase tracking-wide text-zinc-400 w-16 shrink-0">
              Dept
            </span>
            {DEPARTMENT_TAGS.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                disabled={saving}
                className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors disabled:opacity-50 ${
                  effective.includes(tag)
                    ? DEPT_STYLE
                    : "border-zinc-200 text-zinc-500 hover:border-zinc-300"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[9px] uppercase tracking-wide text-zinc-400 w-16 shrink-0">
              Mode
            </span>
            {MODE_TAGS.map((tag) => {
              const cfg = MODE_ICON[tag];
              const Icon = cfg?.Icon;
              const active = effective.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  disabled={saving}
                  title={tag}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border transition-colors disabled:opacity-50 ${
                    active
                      ? cfg?.tone ?? "border-zinc-200"
                      : "border-zinc-200 text-zinc-500 hover:border-zinc-300"
                  }`}
                >
                  {Icon && <Icon size={10} />}
                  {tag}
                </button>
              );
            })}
          </div>
          {isOverride && (
            <div className="flex justify-between items-center pt-1 border-t border-zinc-100">
              <span className="text-[9px] text-zinc-400">Manually set</span>
              <button
                onClick={clearOverride}
                disabled={saving}
                className="text-[9px] text-zinc-500 hover:text-zinc-700 underline disabled:opacity-50"
              >
                reset to AI
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
