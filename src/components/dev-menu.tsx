"use client";

/**
 * Sidebar dev menu - flyout panel listing every /dev/* page.
 *
 * Sits at the bottom of SidebarNav under a separator. Click toggles the
 * panel; click outside or hit Escape to close. Highlights the current
 * /dev path so you can see which page you're on.
 *
 * Pages are grouped by purpose so the list stays scannable as more get
 * added. Each entry shows the icon used by that page's header so the
 * sidebar lookup feels consistent with the page itself.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Activity,
  Code2,
  History,
  Inbox,
  Layers,
  Lightbulb,
  ListChecks,
  Map as MapIcon,
  MessageCircle,
  Percent,
  Settings as SettingsIcon,
  ShieldCheck,
  Ship,
  Truck,
  Users,
  X,
} from "lucide-react";

interface DevPage {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface DevSection {
  label: string;
  pages: DevPage[];
}

const SECTIONS: DevSection[] = [
  {
    label: "Quoting engine",
    pages: [
      {
        href: "/dev/quote-inbox",
        label: "RFQ inbox",
        description: "Air-traffic control across all open RFQs",
        icon: Inbox,
      },
      {
        href: "/dev/quote-preview",
        label: "Quote workspace",
        description: "Per-quote sourcing + recommendation",
        icon: Ship,
      },
      {
        href: "/dev/quote-split-review",
        label: "Split review",
        description: "Low-confidence sibling-split safety valve",
        icon: Layers,
      },
      {
        href: "/dev/charge-codes",
        label: "Charge codes",
        description: "Canonical Braiin dictionary + TMS mapping",
        icon: ListChecks,
      },
      {
        href: "/dev/margins",
        label: "Margin rules",
        description: "Per-line margin engine + test calculator",
        icon: Percent,
      },
      {
        href: "/dev/carriers",
        label: "Carriers rolodex",
        description: "AI selection oracle directory",
        icon: Users,
      },
    ],
  },
  {
    label: "TMS + integrations",
    pages: [
      {
        href: "/dev/cargowise",
        label: "Cargowise",
        description: "Adapter, subscriptions, recent events",
        icon: Truck,
      },
      {
        href: "/dev/llm",
        label: "LLM gateway",
        description: "Model routing + prompt diagnostics",
        icon: MessageCircle,
      },
      {
        href: "/dev/activity",
        label: "Activity",
        description: "Live event stream",
        icon: Activity,
      },
    ],
  },
  {
    label: "Founder surface",
    pages: [
      {
        href: "/dev/change-requests",
        label: "Change requests",
        description: "CTO triage + brainstorm + decisions",
        icon: Lightbulb,
      },
      {
        href: "/dev/build-log",
        label: "Build log",
        description: "Running ledger of everything shipped",
        icon: History,
      },
      {
        href: "/dev/roadmap",
        label: "Roadmap",
        description: "CTO mind map - private",
        icon: MapIcon,
      },
      {
        href: "/dev/security",
        label: "Security",
        description: "Posture + findings + event stream",
        icon: ShieldCheck,
      },
    ],
  },
];

export function DevMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
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

  // Close on navigation
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isOnDevPage = pathname.startsWith("/dev/");

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        title="Dev pages"
        className={`group relative flex items-center justify-center w-10 h-10 rounded transition-colors ${
          open || isOnDevPage
            ? "bg-violet-500/30 text-white ring-1 ring-violet-300/50"
            : "text-white/70 hover:bg-white/10 hover:text-white"
        }`}
        aria-label="Open dev menu"
        aria-expanded={open}
      >
        <Code2 size={20} className="text-white shrink-0" />
        {!open && (
          <span className="absolute left-full ml-2 px-2 py-1 bg-zinc-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-lg">
            Dev pages
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="fixed left-14 top-0 bottom-0 w-[320px] bg-white border-r border-zinc-200 shadow-2xl z-50 flex flex-col"
        >
          <div className="border-b px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-violet-600 font-medium inline-flex items-center gap-1.5">
                <Code2 className="size-3" />
                Dev pages
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                Internal tools, mocks, founder surfaces
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="size-7 inline-flex items-center justify-center rounded hover:bg-zinc-100 text-zinc-500"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {SECTIONS.map((section) => (
              <div key={section.label} className="mb-2">
                <div className="px-4 py-1 text-[10px] uppercase tracking-wide text-zinc-400 font-medium">
                  {section.label}
                </div>
                {section.pages.map((page) => {
                  const active = pathname === page.href || pathname.startsWith(page.href + "/");
                  const Icon = page.icon;
                  return (
                    <Link
                      key={page.href}
                      href={page.href}
                      className={`flex items-start gap-2.5 px-4 py-2 hover:bg-zinc-50 transition-colors border-l-2 ${
                        active
                          ? "bg-violet-50/60 border-l-violet-500"
                          : "border-l-transparent"
                      }`}
                    >
                      <Icon
                        className={`size-4 mt-0.5 shrink-0 ${
                          active ? "text-violet-600" : "text-zinc-500"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div
                          className={`text-sm leading-tight ${
                            active ? "font-medium text-zinc-900" : "text-zinc-700"
                          }`}
                        >
                          {page.label}
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-0.5 leading-snug">
                          {page.description}
                        </div>
                      </div>
                      <span className="text-[10px] text-zinc-400 font-mono shrink-0 mt-0.5">
                        {page.href.replace("/dev/", "")}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="border-t px-4 py-2 text-[10px] text-zinc-400 inline-flex items-center gap-1.5">
            <SettingsIcon className="size-3" />
            Each page has the floating change-request widget bottom-right.
          </div>
        </div>
      )}
    </>
  );
}
