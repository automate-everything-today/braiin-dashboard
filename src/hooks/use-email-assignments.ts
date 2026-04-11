import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function useEmailAssignments(inboxGroupId?: number) {
  return useQuery({
    queryKey: ["email-assignments", inboxGroupId],
    queryFn: async () => {
      const res = await fetch(`/api/email-assignments?inbox_group_id=${inboxGroupId}`);
      const data = await res.json();
      return data.assignments || {};
    },
    enabled: !!inboxGroupId,
  });
}

export function useAssignEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email_id: string; inbox_group_id: number; assign_to: string }) => {
      const res = await fetch("/api/email-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-assignments"] });
      toast.success("Email assigned");
    },
    onError: () => toast.error("Failed to assign"),
  });
}
