"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as branchService from "@/services/branches";

export function useBranches() {
  return useQuery({
    queryKey: ["branches"],
    queryFn: branchService.getBranches,
  });
}

export function useUpdateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: any }) =>
      branchService.updateBranch(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      toast.success("Branch updated");
    },
    onError: () => {
      toast.error("Failed to update branch");
    },
  });
}

export function useAddBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (branch: any) => branchService.addBranch(branch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      toast.success("Branch added");
    },
    onError: () => {
      toast.error("Failed to add branch");
    },
  });
}

export function useToggleBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, currentActive }: { id: number; currentActive: boolean }) =>
      branchService.toggleBranch(id, currentActive),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      toast.success("Branch status changed");
    },
    onError: () => {
      toast.error("Failed to update branch");
    },
  });
}
