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
  // Additional reply drafts surfaced from past refinements on similar
  // emails (same sender domain or category). Each entry includes the
  // original user instruction so the UI can show a hint and a learningId
  // used to record usage when clicked.
  learned_reply_options?: { reply: string; instruction: string; learningId: number }[];
  incident_detected?: { severity: string; category: string; title: string; confidence: number };
  onReplyOptionClick?: (reply: string) => void;
  onLearnedReplyClick?: (reply: string, learningId: number) => void;
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
  onRefineReplies?: (instruction: string) => Promise<void> | void;
  // Relevance tags detected by Claude (ai_tags) and the user's manual
  // override (user_tags). effective_tags is the runtime-resolved set
  // (override if set, else ai). thumbs is optional positive reinforcement
  // on the AI's tagging for the current email.
  aiTags?: string[];
  userTags?: string[] | null;
  relevanceThumbs?: "thumbs_up" | "thumbs_down" | null;
  onTagsChange?: (nextTags: string[] | null) => Promise<void> | void;
  onRelevanceThumbsUp?: () => Promise<void> | void;
  // Thread lifecycle stage. aiStage comes from Claude; userStage is the
  // manual override and wins when set. onStageChange persists the
  // override via PUT /api/classify-email.
  aiConversationStage?: string | null;
  userConversationStage?: string | null;
  onStageChange?: (next: string | null) => Promise<void> | void;
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
  badges?: { label: string; color: string; variant?: "default" | "tag" | "mode-icon" }[];
  statusDot?: string; // colour or null
  isUnread?: boolean;
  assignee?: { name: string; initials: string } | null;
}

export interface FilterTab {
  key: string;
  label: string;
  count: number;
}
