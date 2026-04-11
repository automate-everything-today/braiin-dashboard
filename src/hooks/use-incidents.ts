"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function useIncidents(filters?: {
  severity?: string; status?: string; account_code?: string;
  supplier_account_code?: string; branch?: string;
}) {
  const params = new URLSearchParams();
  if (filters?.severity) params.set("severity", filters.severity);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.account_code) params.set("account_code", filters.account_code);
  if (filters?.supplier_account_code) params.set("supplier_account_code", filters.supplier_account_code);
  if (filters?.branch) params.set("branch", filters.branch);

  return useQuery({
    queryKey: ["incidents", filters],
    queryFn: async () => {
      const res = await fetch(`/api/incidents?${params}`);
      const data = await res.json();
      return data.incidents || [];
    },
  });
}

export function useCreateIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: any) => {
      const res = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data.incident;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incidents"] });
      toast.success("Incident raised");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: any) => {
      const res = await fetch(`/api/incidents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data.incident;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incidents"] });
      toast.success("Incident updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
