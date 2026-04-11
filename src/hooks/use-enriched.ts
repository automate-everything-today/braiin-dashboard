"use client";

import { useQuery } from "@tanstack/react-query";
import * as enrichedService from "@/services/enriched";

export function useEnrichedAccounts(statusFilter?: string) {
  return useQuery({
    queryKey: ["enriched", statusFilter],
    queryFn: () => enrichedService.getEnrichedAccounts(statusFilter),
  });
}

export function useAppScores(companyIds: number[]) {
  return useQuery({
    queryKey: ["app-scores", companyIds.slice(0, 5).join(",")],
    queryFn: () => enrichedService.getAppScores(companyIds),
    enabled: companyIds.length > 0,
  });
}
