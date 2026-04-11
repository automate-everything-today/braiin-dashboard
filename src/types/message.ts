export type ContextType = "email" | "deal" | "account" | "incident" | "general";

export interface PlatformMessage {
  id: number;
  author_email: string;
  author_name: string;
  content: string;
  context_type: ContextType;
  context_id: string | null;
  context_summary: string | null;
  context_url: string | null;
  parent_id: number | null;
  mentions: string[];
  created_at: string;
}

export interface MessageReadReceipt {
  id: number;
  message_id: number;
  user_email: string;
  read_at: string;
}
