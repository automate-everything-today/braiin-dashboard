"use client";

import { useState, useRef, useEffect } from "react";
import { Bell } from "lucide-react";
import { useNotifications, useMarkRead } from "@/hooks/use-notifications";
import { useRouter } from "next/navigation";

export function NotificationBell({ userEmail }: { userEmail: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { data } = useNotifications(userEmail);
  const markRead = useMarkRead();

  const notifications = data?.notifications || [];
  const unreadCount = data?.unreadCount || 0;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleClick(notification: any) {
    markRead.mutate({ id: notification.id });
    setOpen(false);
    if (notification.link) router.push(notification.link);
  }

  const severityColor = (s: string | null) => {
    if (s === "black") return "bg-zinc-900 text-white";
    if (s === "red") return "bg-red-50 border-red-200";
    if (s === "amber") return "bg-amber-50 border-amber-200";
    return "";
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="relative p-1.5 hover:bg-zinc-100 rounded-lg">
        <Bell size={16} className="text-zinc-600" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-white rounded-lg border shadow-xl z-50 max-h-[480px] flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <p className="text-xs font-semibold">Notifications</p>
            {unreadCount > 0 && (
              <button onClick={() => markRead.mutate({ mark_all_read: true })}
                className="text-[10px] text-zinc-400 hover:text-zinc-600">
                Mark all read
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="text-xs text-zinc-400 p-4 text-center">No notifications</p>
            ) : (
              notifications.map((n: any) => (
                <button key={n.id} onClick={() => handleClick(n)}
                  className={`w-full text-left px-3 py-2.5 border-b hover:bg-zinc-50 ${!n.is_read ? "bg-zinc-50" : ""} ${severityColor(n.severity)}`}>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs ${!n.is_read ? "font-semibold" : "text-zinc-600"}`}>
                        {n.title}
                      </p>
                      {n.body && <p className="text-[10px] text-zinc-400 truncate mt-0.5">{n.body}</p>}
                      <p className="text-[9px] text-zinc-300 mt-0.5">
                        {new Date(n.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    {!n.is_read && <div className="w-1.5 h-1.5 rounded-full bg-zinc-900 shrink-0 mt-1" />}
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="border-t px-3 py-2">
            <button onClick={() => { setOpen(false); router.push("/messages"); }}
              className="text-[10px] text-zinc-400 hover:text-zinc-600 w-full text-center">
              View all messages
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
