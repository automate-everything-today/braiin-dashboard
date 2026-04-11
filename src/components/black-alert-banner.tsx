"use client";

import { useBlackAlerts, useMarkRead } from "@/hooks/use-notifications";
import { AlertTriangle, X } from "lucide-react";
import { useRouter } from "next/navigation";

export function BlackAlertBanner({ userEmail }: { userEmail: string }) {
  const { data: alerts } = useBlackAlerts(userEmail);
  const markRead = useMarkRead();
  const router = useRouter();

  if (!alerts || alerts.length === 0) return null;

  return (
    <div className="space-y-0">
      {alerts.map((alert: any) => (
        <div key={alert.id}
          className="bg-zinc-900 text-white px-4 py-2 flex items-center gap-3 text-xs">
          <AlertTriangle size={14} className="text-red-400 shrink-0" />
          <button onClick={() => { if (alert.link) router.push(alert.link); }}
            className="flex-1 text-left hover:underline font-medium">
            BLACK INCIDENT: {alert.title}
          </button>
          <span className="text-zinc-400 shrink-0">
            {new Date(alert.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
          <button onClick={() => markRead.mutate({ id: alert.id })}
            className="p-0.5 hover:bg-zinc-700 rounded shrink-0">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
