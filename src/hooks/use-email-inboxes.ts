import { useQuery } from "@tanstack/react-query";

export function useEmailInboxes(userEmail?: string) {
  return useQuery({
    queryKey: ["email-inboxes", userEmail],
    queryFn: async () => {
      const res = await fetch("/api/email-inboxes");
      const data = await res.json();
      return data.inboxes || [];
    },
    enabled: !!userEmail,
  });
}
