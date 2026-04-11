"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as clientService from "@/services/clients";

export function useClientPerformance() {
  return useQuery({
    queryKey: ["client-performance"],
    queryFn: clientService.getClientPerformance,
  });
}

export function useClientResearch() {
  return useQuery({
    queryKey: ["client-research"],
    queryFn: clientService.getClientResearch,
  });
}

export function useClientNotes(accountCode: string | null) {
  return useQuery({
    queryKey: ["client-notes", accountCode],
    queryFn: () => clientService.getClientNotes(accountCode!),
    enabled: !!accountCode,
  });
}

export function useAddNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountCode, note, author }: { accountCode: string; note: string; author: string }) =>
      clientService.addClientNote(accountCode, note, author),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["client-notes", vars.accountCode] });
      toast.success("Note added");
    },
    onError: () => {
      toast.error("Failed to add note");
    },
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => clientService.deleteClientNote(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client-notes"] });
      toast.success("Note deleted");
    },
    onError: () => {
      toast.error("Failed to delete note");
    },
  });
}

export function useClientEmails(accountCode: string | null) {
  return useQuery({
    queryKey: ["client-emails", accountCode],
    queryFn: () => clientService.getClientEmails(accountCode!),
    enabled: !!accountCode,
  });
}

export function useTradeMatches(accountCodes: string[]) {
  return useQuery({
    queryKey: ["trade-matches", accountCodes.slice(0, 5).join(",")],
    queryFn: () => clientService.getTradeMatches(accountCodes),
    enabled: accountCodes.length > 0,
  });
}
