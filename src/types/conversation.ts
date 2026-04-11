// src/types/conversation.ts

export type MessageBubbleType = "outgoing" | "incoming" | "internal" | "system" | "file" | "ai" | "rate_card";

export type ChannelType = "email" | "whatsapp" | "wisor" | "internal" | "braiin";

export interface ConversationMessage {
  id: string;
  type: MessageBubbleType;
  author_name: string;
  author_email: string;
  author_initials: string;
  content: string;
  htmlBody?: string;
  structured_data?: Record<string, string>;
  channel: ChannelType;
  timestamp: string;
  attachments?: { name: string; size: string; url: string; type: string }[];
  is_read?: boolean;
  reply_options?: string[];
  incident_detected?: { severity: string; category: string; title: string; confidence: number };
  onReplyOptionClick?: (reply: string) => void;
  onFeedback?: (rating: "good" | "bad", context?: string) => void;
  onRaiseIncident?: () => void;
  onReply?: (content: string) => void;
  feedbackGiven?: "good" | "bad" | null;
  incidentStatus?: "detected" | "raised" | "investigating" | "resolved" | null;
  category?: string;
  onUnsubscribe?: () => void;
  avatarColor?: string;
  onDraftClick?: () => void;
  actions?: { id: string; label: string; icon: string; onClick?: () => void }[];
  missingInfo?: string[];
  onMissingInfoDraft?: (selectedItems: string[]) => void;
}

export interface Channel {
  id: ChannelType;
  label: string;
  icon: string;
  activeColor: string;
  placeholder: string;
  enabled: boolean;
}

export interface TabConfig {
  id: string;
  label: string;
  content: React.ReactNode;
  badge?: { type: "dot" | "count"; color: string; value?: number };
  bounce?: boolean;
}

export interface EntityListItem {
  id: string;
  title: string;
  subtitle: string;
  preview: string;
  timestamp: string;
  badges?: { label: string; color: string; variant?: "default" | "tag" }[];
  statusDot?: string; // colour or null
  isUnread?: boolean;
  assignee?: { name: string; initials: string } | null;
}

export interface FilterTab {
  key: string;
  label: string;
  count: number;
}
