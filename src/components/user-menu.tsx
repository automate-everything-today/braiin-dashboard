"use client";

import { useState, useEffect, useRef } from "react";
import { Settings, LogOut, User, Bell } from "lucide-react";
import Link from "next/link";
import { NotificationBell } from "./notification-bell";
import { supabase } from "@/lib/supabase";

type UserInfo = {
  name: string;
  email: string;
  photoUrl: string;
  role: string;
};

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then(r => r.json())
      .then(async (data) => {
        if (data.authenticated) {
          let photoUrl = "";
          if (data.email) {
            const { data: prefs } = await supabase.from("user_preferences")
              .select("photo_url").eq("email", data.email).single();
            if (prefs?.photo_url) photoUrl = prefs.photo_url;
          }
          setUser({
            name: data.name || data.email?.split("@")[0] || "",
            email: data.email || "",
            photoUrl,
            role: data.role || "",
          });
        }
      });
  }, []);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (!user) return null;

  const initials = user.name.split(" ").filter(Boolean).map(n => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <div ref={ref} className="fixed top-3 right-4 z-50 flex items-center gap-3">
      <NotificationBell userEmail={user.email} />
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 transition-colors">
        {user.photoUrl ? (
          <img src={user.photoUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
        ) : (
          <div className="w-7 h-7 rounded-full bg-zinc-900 text-white flex items-center justify-center text-[10px] font-medium">
            {initials}
          </div>
        )}
        <span className="text-xs text-zinc-600 hidden sm:block">{user.name.split(" ")[0]}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-lg border shadow-lg py-1 z-50">
          {/* User info */}
          <div className="px-4 py-3 border-b">
            <div className="flex items-center gap-3">
              {user.photoUrl ? (
                <img src={user.photoUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-zinc-900 text-white flex items-center justify-center text-sm font-medium">
                  {initials}
                </div>
              )}
              <div>
                <p className="text-sm font-medium">{user.name}</p>
                <p className="text-[10px] text-zinc-400">{user.email}</p>
                {user.role && <p className="text-[10px] text-zinc-400 capitalize">{user.role.replace(/_/g, " ")}</p>}
              </div>
            </div>
          </div>

          {/* Menu items */}
          <div className="py-1">
            <Link href="/profile" onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2 text-xs text-zinc-600 hover:bg-zinc-50">
              <User size={14} /> My Profile
            </Link>
            <Link href="/profile?tab=preferences" onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2 text-xs text-zinc-600 hover:bg-zinc-50">
              <Settings size={14} /> Preferences
            </Link>
            <Link href="/profile?tab=voice" onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2 text-xs text-zinc-600 hover:bg-zinc-50">
              <Bell size={14} /> Voice & Tone
            </Link>
          </div>

          {/* Logout */}
          <div className="border-t py-1">
            <a href="/api/auth/logout"
              className="flex items-center gap-2.5 px-4 py-2 text-xs text-zinc-600 hover:bg-zinc-50">
              <LogOut size={14} /> Sign out
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
