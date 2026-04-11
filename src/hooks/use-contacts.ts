"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as contactService from "@/services/contacts";

export function useContacts(accountCode: string | null) {
  return useQuery({
    queryKey: ["contacts", accountCode],
    queryFn: () => contactService.getContactsByAccount(accountCode!),
    enabled: !!accountCode,
  });
}

export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: any }) =>
      contactService.updateContact(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Contact updated");
    },
    onError: () => {
      toast.error("Failed to update contact");
    },
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => contactService.deleteContact(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Contact deleted");
    },
    onError: () => {
      toast.error("Failed to delete contact");
    },
  });
}
