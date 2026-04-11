"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as staffService from "@/services/staff";

export function useStaff() {
  return useQuery({
    queryKey: ["staff"],
    queryFn: staffService.getActiveStaff,
  });
}

export function useUpdateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: any }) =>
      staffService.updateStaff(id, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      toast.success("Staff updated");
    },
    onError: () => {
      toast.error("Failed to update staff");
    },
  });
}

export function useAddStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (staff: any) => staffService.addStaff(staff),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      toast.success("Staff member added");
    },
    onError: () => {
      toast.error("Failed to add staff");
    },
  });
}

export function useDeactivateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => staffService.deactivateStaff(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      toast.success("Staff member deactivated");
    },
    onError: () => {
      toast.error("Failed to deactivate staff");
    },
  });
}

export function useBonusConfig(year: number) {
  return useQuery({
    queryKey: ["bonus-config", year],
    queryFn: () => staffService.getBonusConfig(year),
  });
}

export function useUpdateBonusConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ year, config }: { year: number; config: any }) =>
      staffService.updateBonusConfig(year, config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bonus-config"] });
      toast.success("Bonus config updated");
    },
    onError: () => {
      toast.error("Failed to update bonus config");
    },
  });
}

export function useApplyBonusToAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: any) => staffService.applyBonusToAllStaff(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      toast.success("Bonus applied to all staff");
    },
    onError: () => {
      toast.error("Failed to apply bonuses");
    },
  });
}
