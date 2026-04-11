"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function useMessages(contextType?: string, contextId?: string) {
  return useQuery({
    queryKey: ["messages", contextType, contextId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (contextType) params.set("context_type", contextType);
      if (contextId) params.set("context_id", contextId);
      const res = await fetch(`/api/messages?${params}`);
      const data = await res.json();
      return data.messages || [];
    },
    enabled: !!contextType,
    refetchInterval: 30000, // Poll every 30s
  });
}

export function useMyMentions(email?: string) {
  return useQuery({
    queryKey: ["my-mentions", email],
    queryFn: async () => {
      const res = await fetch(`/api/messages?mentions=${encodeURIComponent(email!)}`);
      const data = await res.json();
      return data.messages || [];
    },
    enabled: !!email,
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: any) => {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data.message;
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["messages", variables.context_type, variables.context_id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
