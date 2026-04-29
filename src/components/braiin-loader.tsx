"use client";

import { Brain } from "lucide-react";

interface BraiinLoaderProps {
  /** Short caption next to the brain. Keep it under 30 chars. */
  label?: string;
  /** Visual size: sm (12px) | md (16px) | lg (24px). Defaults to md. */
  size?: "sm" | "md" | "lg";
  /** Layout: inline (single row, used inside text) or block (centered card). */
  variant?: "inline" | "block";
}

/**
 * The pulsing Braiin brain logo used for every loading / waiting state in
 * the dashboard. Hard rule from the founder: no spinners, no skeletons -
 * the brain pulse signals "AI / system thinking".
 *
 * Picked Brain from lucide as a stand-in for the Braiin mark; if/when the
 * production logo is committed as an SVG component, replace the icon import
 * here and every loader updates in lock-step.
 */
export function BraiinLoader({
  label = "Loading...",
  size = "md",
  variant = "block",
}: BraiinLoaderProps) {
  const iconSize =
    size === "sm" ? "size-3" : size === "lg" ? "size-6" : "size-4";
  const textSize =
    size === "sm" ? "text-[10px]" : size === "lg" ? "text-sm" : "text-xs";

  if (variant === "inline") {
    return (
      <span className={`inline-flex items-center gap-1.5 ${textSize} text-zinc-500`}>
        <Brain className={`${iconSize} text-violet-600 animate-pulse`} />
        {label}
      </span>
    );
  }
  return (
    <div className="flex items-center justify-center gap-2 py-8">
      <Brain className={`${iconSize} text-violet-600 animate-pulse`} />
      <span className={`${textSize} text-zinc-500`}>{label}</span>
    </div>
  );
}
