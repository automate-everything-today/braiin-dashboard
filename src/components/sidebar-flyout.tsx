"use client";

/**
 * Reusable sidebar flyout menu.
 *
 * Drop into SidebarNav as one icon. Click the icon to open a 320px panel
 * to the right of the sidebar, listing pages grouped into sections. Click
 * outside, hit Escape, or navigate to close.
 *
 * The same component powers the Dev menu, Sales menu, Clients menu, etc.
 * Each instance gets its own trigger icon, header, accent colour, and
 * sections. Active state = current pathname matches any page href.
 */

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { X, type LucideIcon } from "lucide-react";

export interface FlyoutPage {
  href: string;
  label: string;
  description?: string;
  icon: LucideIcon;
}

export interface FlyoutSection {
  label?: string;
  pages: FlyoutPage[];
}

export type FlyoutAccent = "violet" | "sky" | "emerald" | "amber" | "rose" | "indigo" | "zinc";

interface SidebarFlyoutProps {
  triggerIcon: LucideIcon;
  triggerLabel: string;
  headerSubtitle?: string;
  sections: FlyoutSection[];
  accent?: FlyoutAccent;
  footer?: React.ReactNode;
}

const ACCENT: Record<FlyoutAccent, { trigger: string; section: string; activeBg: string; activeBorder: string; activeIcon: string; activeText: string }> = {
  violet: {
    trigger: "bg-violet-500/30 ring-1 ring-violet-300/50",
    section: "text-violet-600",
    activeBg: "bg-violet-50/60",
    activeBorder: "border-l-violet-500",
    activeIcon: "text-violet-600",
    activeText: "text-violet-900",
  },
  sky: {
    trigger: "bg-sky-500/30 ring-1 ring-sky-300/50",
    section: "text-sky-600",
    activeBg: "bg-sky-50/60",
    activeBorder: "border-l-sky-500",
    activeIcon: "text-sky-600",
    activeText: "text-sky-900",
  },
  emerald: {
    trigger: "bg-emerald-500/30 ring-1 ring-emerald-300/50",
    section: "text-emerald-600",
    activeBg: "bg-emerald-50/60",
    activeBorder: "border-l-emerald-500",
    activeIcon: "text-emerald-600",
    activeText: "text-emerald-900",
  },
  amber: {
    trigger: "bg-amber-500/30 ring-1 ring-amber-300/50",
    section: "text-amber-600",
    activeBg: "bg-amber-50/60",
    activeBorder: "border-l-amber-500",
    activeIcon: "text-amber-600",
    activeText: "text-amber-900",
  },
  rose: {
    trigger: "bg-rose-500/30 ring-1 ring-rose-300/50",
    section: "text-rose-600",
    activeBg: "bg-rose-50/60",
    activeBorder: "border-l-rose-500",
    activeIcon: "text-rose-600",
    activeText: "text-rose-900",
  },
  indigo: {
    trigger: "bg-indigo-500/30 ring-1 ring-indigo-300/50",
    section: "text-indigo-600",
    activeBg: "bg-indigo-50/60",
    activeBorder: "border-l-indigo-500",
    activeIcon: "text-indigo-600",
    activeText: "text-indigo-900",
  },
  zinc: {
    trigger: "bg-white/15 ring-1 ring-white/20",
    section: "text-zinc-600",
    activeBg: "bg-zinc-100",
    activeBorder: "border-l-zinc-500",
    activeIcon: "text-zinc-700",
    activeText: "text-zinc-900",
  },
};

export function SidebarFlyout({
  triggerIcon: TriggerIcon,
  triggerLabel,
  headerSubtitle,
  sections,
  accent = "violet",
  footer,
}: SidebarFlyoutProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const colours = ACCENT[accent];

  const groupActive = sections.some((s) =>
    s.pages.some((p) => pathname === p.href || pathname.startsWith(p.href + "/")),
  );

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        title={triggerLabel}
        className={`group relative flex items-center justify-center w-10 h-10 rounded transition-colors shrink-0 ${
          open || groupActive
            ? `${colours.trigger} text-white`
            : "text-white/70 hover:bg-white/10 hover:text-white"
        }`}
        aria-label={`Open ${triggerLabel} menu`}
        aria-expanded={open}
        aria-controls={id}
      >
        <TriggerIcon size={20} className="text-white shrink-0" />
        {!open && (
          <span className="absolute left-full ml-2 px-2 py-1 bg-zinc-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-lg">
            {triggerLabel}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={id}
          className="fixed left-14 top-0 bottom-0 w-[320px] bg-white border-r border-zinc-200 shadow-2xl z-50 flex flex-col"
        >
          <div className="border-b px-4 py-3 flex items-center justify-between">
            <div>
              <div className={`text-xs uppercase tracking-wide font-medium inline-flex items-center gap-1.5 ${colours.section}`}>
                <TriggerIcon className="size-3" />
                {triggerLabel}
              </div>
              {headerSubtitle && (
                <div className="text-[11px] text-zinc-500 mt-0.5">{headerSubtitle}</div>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="size-7 inline-flex items-center justify-center rounded hover:bg-zinc-100 text-zinc-500"
              aria-label="Close menu"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {sections.map((section, i) => (
              <div key={section.label ?? `s-${i}`} className="mb-2">
                {section.label && (
                  <div className="px-4 py-1 text-[10px] uppercase tracking-wide text-zinc-400 font-medium">
                    {section.label}
                  </div>
                )}
                {section.pages.map((page) => {
                  const active = pathname === page.href || pathname.startsWith(page.href + "/");
                  const Icon = page.icon;
                  return (
                    <Link
                      key={page.href}
                      href={page.href}
                      className={`flex items-start gap-2.5 px-4 py-2 hover:bg-zinc-50 transition-colors border-l-2 ${
                        active ? `${colours.activeBg} ${colours.activeBorder}` : "border-l-transparent"
                      }`}
                    >
                      <Icon
                        className={`size-4 mt-0.5 shrink-0 ${active ? colours.activeIcon : "text-zinc-500"}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div
                          className={`text-sm leading-tight ${
                            active ? `font-medium ${colours.activeText}` : "text-zinc-700"
                          }`}
                        >
                          {page.label}
                        </div>
                        {page.description && (
                          <div className="text-[11px] text-zinc-500 mt-0.5 leading-snug">
                            {page.description}
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] text-zinc-400 font-mono shrink-0 mt-0.5">
                        {page.href.replace(/^\//, "")}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>

          {footer && (
            <div className="border-t px-4 py-2 text-[10px] text-zinc-400">{footer}</div>
          )}
        </div>
      )}
    </>
  );
}
