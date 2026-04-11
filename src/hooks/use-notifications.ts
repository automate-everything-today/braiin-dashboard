"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export function useNotifications(email?: string) {
  return useQuery({
    queryKey: ["notifications", email],
    queryFn: async () => {
      const res = await fetch("/api/notifications");
      const data = await res.json();
      return data;
    },
    enabled: !!email,
    refetchInterval: 15000, // Poll every 15s
  });
}

export function useBlackAlerts(email?: string) {
  return useQuery({
    queryKey: ["black-alerts", email],
    queryFn: async () => {
      const res = await fetch("/api/notifications?black_only=true");
      const data = await res.json();
      return data.alerts || [];
    },
    enabled: !!email,
    refetchInterval: 15000,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: number; mark_all_read?: boolean }) => {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["black-alerts"] });
    },
  });
}
