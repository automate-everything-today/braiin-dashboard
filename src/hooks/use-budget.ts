"use client";

import { useQuery } from "@tanstack/react-query";
import * as budgetService from "@/services/budget";

export function useBudget(branchId: number = 1) {
  return useQuery({
    queryKey: ["budget", branchId],
    queryFn: () => budgetService.getBudget(branchId),
  });
}
