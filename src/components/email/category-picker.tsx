"use client";

import { useState } from "react";
import { CATEGORY_CONFIG, formatCategory } from "@/types/email";

const ALL_CATEGORIES = Object.keys(CATEGORY_CONFIG);

type Props = {
  category: string;
  onChange?: (next: string) => Promise<void> | void;
};

/**
 * Compact category pill that opens a dropdown of every category on click.
 * Selecting one writes back via PUT user_override_category. The chosen
 * category feeds the classifier's "LEARNING FROM PAST CORRECTIONS" block,
 * so wrong-category corrections improve future classifications without
 * any extra wiring.
 */
export function CategoryPicker({ category, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const cat = formatCategory(category);

  async function select(next: string) {
    if (saving || !onChange) return;
    setSaving(true);
    try {
      await onChange(next);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={!onChange}
        className={`px-2 py-0.5 rounded-full text-[10px] border border-transparent ${cat.className} ${onChange ? "hover:brightness-95 cursor-pointer" : "cursor-default"}`}
        title={onChange ? "Click to correct category" : "Category"}
      >
        {cat.label}
      </button>
      {open && onChange && (
        <div
          className="absolute z-20 mt-1 right-0 w-48 bg-white border border-zinc-200 rounded-lg shadow-md p-1 max-h-72 overflow-y-auto"
          onMouseLeave={() => setOpen(false)}
        >
          {ALL_CATEGORIES.map((key) => {
            const item = formatCategory(key);
            const active = category === key;
            return (
              <button
                key={key}
                onClick={() => select(key)}
                disabled={saving}
                className={`w-full text-left flex items-center justify-between gap-2 px-2 py-1.5 rounded text-[11px] transition-colors ${
                  active ? "bg-zinc-100 font-medium" : "hover:bg-zinc-50"
                } disabled:opacity-50`}
              >
                <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] ${item.className}`}>
                  {item.label}
                </span>
                {active && <span className="text-[9px] text-zinc-400">current</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
