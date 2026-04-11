// src/components/conversation/tabbed-sidebar.tsx
"use client";

import { useState, useEffect } from "react";
import type { TabConfig } from "@/types";

type Props = {
  tabs: TabConfig[];
  defaultTab?: string;
  focusMode?: boolean;
  forceTab?: string | null;
};

export function TabbedSidebar({ tabs, defaultTab, focusMode, forceTab }: Props) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id || "");

  useEffect(() => {
    if (forceTab) setActiveTab(forceTab);
  }, [forceTab]);

  const activeContent = tabs.find(t => t.id === activeTab)?.content;

  return (
    <div className="w-60 border-l flex flex-col shrink-0 overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b shrink-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 text-center py-2 text-[9px] font-medium relative transition-colors ${
              activeTab === tab.id
                ? "border-b-2 border-zinc-900 text-zinc-900"
                : "text-zinc-400 hover:text-zinc-600"
            }`}
          >
            {tab.label}
            {/* Badge dot */}
            {tab.badge && tab.badge.type === "dot" && (
              <span
                className={`absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full ${tab.badge.color} ${
                  tab.bounce && !focusMode ? "animate-bounce-tab" : ""
                }`}
              />
            )}
            {/* Badge count */}
            {tab.badge && tab.badge.type === "count" && tab.badge.value && tab.badge.value > 0 && (
              <span className={`absolute -top-0.5 right-1 text-[7px] px-1 rounded-full ${tab.badge.color} ${
                tab.bounce && !focusMode ? "animate-bounce-tab" : ""
              }`}>
                {tab.badge.value}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeContent}
      </div>

      <style jsx global>{`
        @keyframes bounce-tab {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        .animate-bounce-tab {
          animation: bounce-tab 1s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
