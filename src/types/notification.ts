export type NotificationType = "mention" | "incident" | "reply" | "escalation" | "system";

export interface Notification {
  id: number;
  user_email: string;
  type: NotificationType;
  title: string;
  body: string;
  severity: "amber" | "red" | "black" | null;
  source_type: string | null;
  source_id: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}
