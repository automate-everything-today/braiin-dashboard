// src/components/conversation/entity-list.tsx
"use client";

import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import type { EntityListItem, FilterTab } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Clock, Trash2, Archive, AlertTriangle, Tag, Plane, Ship, Truck, Warehouse } from "lucide-react";

/**
 * Mode icons - one icon per freight mode, no background. Fixed colour
 * across the whole app so muscle memory builds: blue plane, green ship,
 * red truck, orange warehouse.
 */
const MODE_ICON: Record<string, { Icon: React.ComponentType<{ size?: number; className?: string }>; tone: string; title: string }> = {
  Air: { Icon: Plane, tone: "text-blue-600", title: "Air" },
  Sea: { Icon: Ship, tone: "text-green-600", title: "Sea" },
  Road: { Icon: Truck, tone: "text-red-600", title: "Road" },
  Warehousing: { Icon: Warehouse, tone: "text-orange-600", title: "Warehousing" },
};

export type SwipeAction = "snooze" | "delete" | "archive" | "exception" | "tag";

export type QuickAction = {
  id: SwipeAction;
  label: string;
  icon: React.ReactNode;
  color: string;
  onClick: (itemId: string) => void;
};

type Props = {
  header?: React.ReactNode;
  selector?: React.ReactNode;
  primaryAction?: React.ReactNode;
  filterTabs?: FilterTab[];
  activeFilter?: string;
  onFilterChange?: (key: string) => void;
  items: EntityListItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  footer?: React.ReactNode;
  quickActions?: QuickAction[];
  swipeLeftAction?: SwipeAction;
  swipeRightAction?: SwipeAction;
  snoozeDropdownId?: string | null;
  onSnooze?: (itemId: string, until: Date, label: string) => void;
  // Multi-select. When selectedIds is provided, each card renders a leading
  // checkbox. onToggleSelect fires on click; the second arg is true when
  // the user held shift (caller handles range-select against the last
  // toggled id). bulkActionBar is rendered above the list and stays visible
  // for as long as any item is selected.
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string, shiftKey: boolean) => void;
  bulkActionBar?: React.ReactNode;
};

const SWIPE_COLORS: Record<SwipeAction, string> = {
  snooze: "bg-blue-500",
  delete: "bg-red-500",
  archive: "bg-zinc-500",
  exception: "bg-amber-500",
  tag: "bg-purple-500",
};

const SWIPE_ICONS: Record<SwipeAction, React.ReactNode> = {
  snooze: <Clock size={14} className="text-white" />,
  delete: <Trash2 size={14} className="text-white" />,
  archive: <Archive size={14} className="text-white" />,
  exception: <AlertTriangle size={14} className="text-white" />,
  tag: <Tag size={14} className="text-white" />,
};

function SwipeableItem({
  children, onSwipeLeft, onSwipeRight, swipeLeftAction, swipeRightAction,
}: {
  children: React.ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  swipeLeftAction?: SwipeAction;
  swipeRightAction?: SwipeAction;
}) {
  const startX = useRef(0);
  const currentX = useRef(0);
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const threshold = 80;

  function handleTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX;
    currentX.current = startX.current;
    setSwiping(true);
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!swiping) return;
    currentX.current = e.touches[0].clientX;
    const diff = currentX.current - startX.current;
    // Only allow swipe in directions that have actions
    if (diff > 0 && !swipeRightAction) return;
    if (diff < 0 && !swipeLeftAction) return;
    setOffset(Math.max(-120, Math.min(120, diff)));
  }

  function handleTouchEnd() {
    setSwiping(false);
    if (offset > threshold && onSwipeRight) {
      onSwipeRight();
    } else if (offset < -threshold && onSwipeLeft) {
      onSwipeLeft();
    }
    setOffset(0);
  }

  return (
    <div className="relative overflow-visible">
      {/* Left swipe background (swipe right reveals this) */}
      {swipeRightAction && offset > 0 && (
        <div className={`absolute inset-y-0 left-0 ${SWIPE_COLORS[swipeRightAction]} flex items-center px-4`}
          style={{ width: `${Math.abs(offset)}px` }}>
          {Math.abs(offset) > 40 && SWIPE_ICONS[swipeRightAction]}
        </div>
      )}
      {/* Right swipe background (swipe left reveals this) */}
      {swipeLeftAction && offset < 0 && (
        <div className={`absolute inset-y-0 right-0 ${SWIPE_COLORS[swipeLeftAction]} flex items-center justify-end px-4`}
          style={{ width: `${Math.abs(offset)}px` }}>
          {Math.abs(offset) > 40 && SWIPE_ICONS[swipeLeftAction]}
        </div>
      )}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ transform: `translateX(${offset}px)`, transition: swiping ? "none" : "transform 0.2s ease-out" }}
        className="relative bg-white z-0"
      >
        {children}
      </div>
    </div>
  );
}

export function EntityList({
  header, selector, primaryAction, filterTabs, activeFilter, onFilterChange,
  items, activeId, onSelect, loading, footer, quickActions, swipeLeftAction, swipeRightAction,
  snoozeDropdownId, onSnooze, selectedIds, onToggleSelect, bulkActionBar,
}: Props) {

  function getSwipeHandler(action: SwipeAction | undefined, itemId: string) {
    if (!action || !quickActions) return undefined;
    const qa = quickActions.find(a => a.id === action);
    return qa ? () => qa.onClick(itemId) : undefined;
  }

  return (
    <div className="w-96 border-r flex flex-col shrink-0 h-full">
      {/* Header */}
      {header && <div className="shrink-0">{header}</div>}

      {/* Selector */}
      {selector && <div className="px-3 py-2 border-b shrink-0">{selector}</div>}

      {/* Primary action */}
      {primaryAction && <div className="px-3 py-2 border-b shrink-0">{primaryAction}</div>}

      {/* Filter tabs */}
      {filterTabs && filterTabs.length > 0 && (
        <div className="px-3 py-2 border-b flex flex-wrap gap-1 shrink-0">
          {filterTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => onFilterChange?.(tab.key)}
              className={`px-2 py-0.5 rounded text-[9px] font-medium flex items-center gap-1 transition-colors ${
                activeFilter === tab.key
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-500 hover:bg-zinc-100"
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className={`text-[8px] rounded-full px-1 ${
                  activeFilter === tab.key ? "bg-zinc-700 text-zinc-200" : "bg-zinc-100 text-zinc-400"
                }`}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Bulk action bar - shown when caller passes selectedIds with any
          items selected. Lives above the list so it doesn't scroll out
          of view when the user picks more items lower down. */}
      {bulkActionBar && selectedIds && selectedIds.size > 0 && (
        <div className="shrink-0 border-b bg-zinc-900 text-white">
          {bulkActionBar}
        </div>
      )}

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 bg-zinc-100 rounded-lg mx-3 mt-3">
            <div className="relative">
              <img src="/brain-icon.png" alt="Braiin" className="w-14 h-14 animate-pulse" style={{ animationDuration: "1.5s" }} />
              <div className="absolute inset-0 rounded-full bg-zinc-900/5 animate-ping" style={{ animationDuration: "2s" }} />
            </div>
            <p className="text-[10px] text-zinc-400 mt-3 animate-pulse">Loading emails...</p>
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-zinc-400 p-4">No items</p>
        ) : (
          items.map(item => {
            const isActive = activeId === item.id;
            const isSelected = selectedIds?.has(item.id) ?? false;
            const selectionEnabled = !!onToggleSelect;
            return (
              <SwipeableItem
                key={item.id}
                swipeLeftAction={swipeLeftAction}
                swipeRightAction={swipeRightAction}
                onSwipeLeft={getSwipeHandler(swipeLeftAction, item.id)}
                onSwipeRight={getSwipeHandler(swipeRightAction, item.id)}
              >
                <button
                  onClick={() => onSelect(item.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-l-2 ${
                    isSelected
                      ? "bg-blue-50/40 border-l-blue-500"
                      : isActive
                        ? "bg-zinc-100 border-l-zinc-900"
                        : item.isUnread
                          ? "bg-white border-l-transparent transition-colors hover:border-l-zinc-300 hover:bg-zinc-50"
                          : "bg-zinc-50/30 border-l-transparent transition-colors hover:border-l-zinc-300 hover:bg-zinc-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    {selectionEnabled && (
                      <span
                        // The button is the parent click target (opens email),
                        // so the checkbox needs to stop propagation. We use
                        // a span (not nested button - illegal) styled as a
                        // checkbox + onMouseDown to avoid a 200ms button
                        // focus delay flicker on click.
                        role="checkbox"
                        tabIndex={0}
                        aria-checked={isSelected}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          onToggleSelect?.(item.id, e.shiftKey);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === " " || e.key === "Enter") {
                            e.preventDefault();
                            e.stopPropagation();
                            onToggleSelect?.(item.id, e.shiftKey);
                          }
                        }}
                        className={`mt-0.5 shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-blue-500 border-blue-500 text-white"
                            : "bg-white border-zinc-300 hover:border-zinc-400 opacity-60 group-hover:opacity-100"
                        }`}
                      >
                        {isSelected && (
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {item.statusDot && (
                          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: item.statusDot }} />
                        )}
                        <span className={`text-[11px] truncate ${item.isUnread || isActive ? "font-semibold text-zinc-900" : "text-zinc-600"}`}>
                          {item.title}
                        </span>
                      </div>
                      <p className={`text-[10px] truncate mt-0.5 ${item.isUnread || isActive ? "font-medium text-zinc-800" : "text-zinc-500"}`}>
                        {item.subtitle}
                      </p>
                      <p className="text-[9px] text-zinc-400 truncate mt-0.5">{item.preview}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[9px] text-zinc-400">{item.timestamp}</p>
                      {item.assignee && (
                        <div className="flex items-center gap-1 mt-0.5 justify-end">
                          <div className="w-4 h-4 rounded-full bg-zinc-900 text-white flex items-center justify-center text-[7px]">
                            {item.assignee.initials}
                          </div>
                        </div>
                      )}
                      {item.badges && item.badges.length > 0 && (
                        <div className="flex items-center justify-end gap-1 flex-wrap mt-0.5">
                          {item.badges.map((badge, i) => {
                            if (badge.variant === "mode-icon") {
                              const cfg = MODE_ICON[badge.label];
                              if (!cfg) return null;
                              const { Icon, tone, title } = cfg;
                              return (
                                <span
                                  key={i}
                                  title={title}
                                  className={`inline-flex items-center justify-center ${tone}`}
                                >
                                  <Icon size={14} />
                                </span>
                              );
                            }
                            if (badge.variant === "tag") {
                              return (
                                <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-zinc-900 text-white text-[7px] font-semibold tracking-wide">
                                  <span className="w-1 h-1 rounded-full bg-white/60" />{badge.label}
                                </span>
                              );
                            }
                            return (
                              <Badge key={i} variant="secondary" className={`text-[7px] ${badge.color}`}>{badge.label}</Badge>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </button>

                {/* Quick actions - icons only on active item */}
                {isActive && quickActions && quickActions.length > 0 && (
                  <div className="relative z-10">
                    <div className="flex items-center gap-0.5 px-2 py-1 bg-zinc-100 border-b border-l-2 border-l-zinc-900">
                      {quickActions.map((action, idx) => (
                        <button
                          key={`${action.id}-${idx}`}
                          onClick={(e) => { e.stopPropagation(); action.onClick(item.id); }}
                          className={`p-1.5 rounded transition-colors ${action.color}`}
                          title={action.label}
                        >
                          {action.icon}
                        </button>
                      ))}
                    </div>
                    {/* Snooze dropdown rendered at component root level below */}
                  </div>
                )}
              </SwipeableItem>
            );
          })
        )}
      </div>

      {/* Footer */}
      {footer && <div className="border-t shrink-0">{footer}</div>}

      {/* Snooze dropdown - portalled to body to escape all overflow/transform parents */}
      {snoozeDropdownId && onSnooze && typeof document !== "undefined" && createPortal(
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 9998 }} onClick={() => onSnooze(snoozeDropdownId, new Date(), "__close__")} />
          <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 9999, width: 220 }}
            className="bg-white border rounded-lg shadow-2xl py-1">
            <p className="px-3 py-1.5 text-[9px] text-zinc-400 font-medium uppercase border-b">Snooze until</p>
            <button onClick={() => onSnooze(snoozeDropdownId, new Date(Date.now() + 60 * 60 * 1000), "1 hour")}
              className="w-full text-left px-3 py-2.5 text-xs hover:bg-zinc-50 flex items-center gap-2">
              <Clock size={12} className="text-blue-500" /> 1 hour
            </button>
            <button onClick={() => onSnooze(snoozeDropdownId, new Date(Date.now() + 3 * 60 * 60 * 1000), "3 hours")}
              className="w-full text-left px-3 py-2.5 text-xs hover:bg-zinc-50 flex items-center gap-2">
              <Clock size={12} className="text-blue-500" /> 3 hours
            </button>
            <button onClick={() => { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(8, 0, 0, 0); onSnooze(snoozeDropdownId, t, "tomorrow 8am"); }}
              className="w-full text-left px-3 py-2.5 text-xs hover:bg-zinc-50 flex items-center gap-2">
              <Clock size={12} className="text-blue-500" /> Tomorrow 8am
            </button>
            <button onClick={() => { const m = new Date(); m.setDate(m.getDate() + ((8 - m.getDay()) % 7 || 7)); m.setHours(8, 0, 0, 0); onSnooze(snoozeDropdownId, m, "Monday 8am"); }}
              className="w-full text-left px-3 py-2.5 text-xs hover:bg-zinc-50 flex items-center gap-2">
              <Clock size={12} className="text-blue-500" /> Next Monday 8am
            </button>
            <div className="border-t my-1" />
            <div className="px-3 py-1.5">
              <p className="text-[9px] text-zinc-400 mb-1">Custom</p>
              <input type="datetime-local" className="w-full px-2 py-1.5 border rounded text-[10px]"
                onChange={e => { if (e.target.value) onSnooze(snoozeDropdownId, new Date(e.target.value), new Date(e.target.value).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })); }} />
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
