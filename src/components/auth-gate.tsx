"use client";

import { useEffect, useState } from "react";
import { SidebarNav } from "./sidebar-nav";
import NextTopLoader from "nextjs-toploader";
import { QueryProvider } from "@/providers/query-provider";
import { Toaster } from "sonner";
import { ErrorBoundary } from "./error-boundary";
import { UserMenu } from "./user-menu";
import { BlackAlertBanner } from "./black-alert-banner";
import { supabase } from "@/lib/supabase";

type Session = {
  authenticated: boolean;
  email?: string;
  name?: string;
  role?: string;
  department?: string;
  branch?: string;
  is_staff?: boolean;
};

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/session")
      .then(r => r.json())
      .then(async (data) => {
        setSession(data);
        // Load font size preference
        if (data.email) {
          const { data: prefs } = await supabase.from("user_preferences")
            .select("font_size").eq("email", data.email).single();
          if (prefs?.font_size) {
            const scale = prefs.font_size === "small" ? "0.9" : prefs.font_size === "large" ? "1.1" : "1";
            document.documentElement.style.setProperty("--braiin-scale", scale);
          }
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950" />
    );
  }

  if (!session?.authenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-zinc-950">
        <a
          href="/api/auth/login"
          className="px-5 py-2 text-zinc-600 text-sm hover:text-zinc-400 transition-colors"
        >
          Sign in
        </a>
      </div>
    );
  }

  return (
    <QueryProvider>
      <div className="flex min-h-screen">
        <NextTopLoader color="#ff3366" height={3} showSpinner={false} />
        <Toaster position="top-right" richColors closeButton />
        <UserMenu />
        <SidebarNav />
        <main className="flex-1 overflow-auto bg-zinc-50 ml-14" style={{ zoom: "var(--braiin-scale, 1)" }}>
          <ErrorBoundary>
            {session.email && <BlackAlertBanner userEmail={session.email} />}
            <div className="p-6">
              {children}
            </div>
          </ErrorBoundary>
        </main>
      </div>
    </QueryProvider>
  );
}
