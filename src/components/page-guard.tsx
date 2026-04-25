"use client";

import { useEffect, useState } from "react";
import { Shield } from "lucide-react";

type Session = {
  authenticated: boolean;
  email?: string;
  name?: string;
  role?: string;
  department?: string;
  branch?: string;
  is_staff?: boolean;
  is_manager?: boolean;
  staff_id?: number;
  page_access?: string[];
};

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/session")
      .then(r => r.json())
      .then(data => { setSession(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return { session, loading };
}

export function PageGuard({ pageId, children }: { pageId: string; children: React.ReactNode }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then(r => r.json())
      .then(data => {
        if (!data.authenticated) {
          setAllowed(false);
          return;
        }
        // Super admins always have access
        if (data.role === "super_admin") {
          setAllowed(true);
          return;
        }
        // Check page_access array
        if (data.page_access && Array.isArray(data.page_access) && data.page_access.length > 0) {
          setAllowed(data.page_access.includes(pageId));
        } else {
          // No page_access set = allow (backwards compat)
          setAllowed(true);
        }
      })
      .catch(() => setAllowed(false));
  }, [pageId]);

  if (allowed === null) return null;

  if (!allowed) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Shield size={48} className="text-zinc-300 mb-4" />
        <h2 className="text-xl font-bold text-zinc-700 mb-2">Access Restricted</h2>
        <p className="text-sm text-zinc-400">You don't have permission to view this page.</p>
        <p className="text-xs text-zinc-400 mt-1">Contact your administrator to request access.</p>
      </div>
    );
  }

  return <>{children}</>;
}
