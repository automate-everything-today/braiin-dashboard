"use client";

import { useState, useRef, useEffect, type ReactNode, type ReactElement, cloneElement } from "react";

type Placement = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  placement?: Placement;
  delay?: number;
}

/**
 * Lightweight accessible tooltip. Shows on hover after `delay` ms and on focus
 * immediately. Uses a portal-free absolute-positioned element anchored to the
 * trigger's bounding rect.
 *
 * Usage:
 *   <Tooltip content="Reply">
 *     <button onClick={...}><ReplyIcon /></button>
 *   </Tooltip>
 */
export function Tooltip({ content, children, placement = "top", delay = 250 }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const timeoutRef = useRef<number | null>(null);

  function show() {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      positionTooltip();
      setOpen(true);
    }, delay);
  }

  function hide() {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    setOpen(false);
  }

  function positionTooltip() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const offset = 6;
    let top = 0;
    let left = 0;
    switch (placement) {
      case "top":
        top = rect.top - offset;
        left = rect.left + rect.width / 2;
        break;
      case "bottom":
        top = rect.bottom + offset;
        left = rect.left + rect.width / 2;
        break;
      case "left":
        top = rect.top + rect.height / 2;
        left = rect.left - offset;
        break;
      case "right":
        top = rect.top + rect.height / 2;
        left = rect.right + offset;
        break;
    }
    setCoords({ top, left });
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onScrollOrResize() {
      positionTooltip();
    }
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  const childProps = children.props as {
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseLeave?: (e: React.MouseEvent) => void;
    onFocus?: (e: React.FocusEvent) => void;
    onBlur?: (e: React.FocusEvent) => void;
  };
  const trigger = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      // Preserve any existing ref on the child
      const childRef = (children as { ref?: unknown }).ref;
      if (typeof childRef === "function") childRef(node);
      else if (childRef && typeof childRef === "object") {
        (childRef as { current: HTMLElement | null }).current = node;
      }
    },
    onMouseEnter: (e: React.MouseEvent) => {
      childProps.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      childProps.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      childProps.onFocus?.(e);
      positionTooltip();
      setOpen(true);
    },
    onBlur: (e: React.FocusEvent) => {
      childProps.onBlur?.(e);
      hide();
    },
  } as Record<string, unknown>);

  const transform =
    placement === "top"
      ? "translate(-50%, -100%)"
      : placement === "bottom"
      ? "translate(-50%, 0)"
      : placement === "left"
      ? "translate(-100%, -50%)"
      : "translate(0, -50%)";

  return (
    <>
      {trigger}
      {open && coords && (
        <div
          ref={tooltipRef}
          role="tooltip"
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            transform,
            zIndex: 10000,
            pointerEvents: "none",
          }}
          className="bg-zinc-900 text-white text-[11px] font-medium px-2 py-1 rounded shadow-lg whitespace-nowrap"
        >
          {content}
        </div>
      )}
    </>
  );
}
