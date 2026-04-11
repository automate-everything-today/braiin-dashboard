// src/services/messages.ts
import { supabase, ServiceError } from "./base";
import type { PlatformMessage } from "@/types";
import { createNotification } from "./notifications";

export async function getMessages(filters: {
  context_type?: string;
  context_id?: string;
  parent_id?: number | null;
  mentions?: string;
  limit?: number;
}): Promise<PlatformMessage[]> {
  let query = supabase.from("platform_messages").select("*")
    .order("created_at", { ascending: true });

  if (filters.context_type && filters.context_id) {
    query = query.eq("context_type", filters.context_type).eq("context_id", filters.context_id);
  }
  if (filters.parent_id !== undefined) {
    query = filters.parent_id === null
      ? query.is("parent_id", null)
      : query.eq("parent_id", filters.parent_id);
  }
  if (filters.mentions) {
    query = query.contains("mentions", [filters.mentions]);
  }

  const { data, error } = await query.limit(filters.limit || 100);
  if (error) throw new ServiceError("Failed to fetch messages", error);
  return (data || []) as PlatformMessage[];
}

export async function getMyMentions(
  userEmail: string,
  limit = 50
): Promise<PlatformMessage[]> {
  const { data, error } = await supabase.from("platform_messages")
    .select("*")
    .contains("mentions", [userEmail])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new ServiceError("Failed to fetch mentions", error);
  return (data || []) as PlatformMessage[];
}

export async function createMessage(input: {
  author_email: string;
  author_name: string;
  content: string;
  context_type: string;
  context_id?: string;
  context_summary?: string;
  context_url?: string;
  parent_id?: number | null;
  mentions?: string[];
}): Promise<PlatformMessage> {
  const { data, error } = await supabase.from("platform_messages")
    .insert({
      author_email: input.author_email,
      author_name: input.author_name,
      content: input.content,
      context_type: input.context_type,
      context_id: input.context_id || null,
      context_summary: input.context_summary || null,
      context_url: input.context_url || null,
      parent_id: input.parent_id || null,
      mentions: input.mentions || [],
    })
    .select().single();
  if (error) throw new ServiceError("Failed to create message", error, "MESSAGE_CREATE");

  const message = data as PlatformMessage;

  // Notify each mentioned user
  for (const email of (input.mentions || [])) {
    if (email === input.author_email) continue; // Don't notify yourself
    await createNotification({
      user_email: email,
      type: input.parent_id ? "reply" : "mention",
      title: `${input.author_name} mentioned you`,
      body: input.content.slice(0, 200),
      source_type: "message",
      source_id: String(message.id),
      link: input.context_url || `/messages`,
    });
  }

  return message;
}

export async function markMessageRead(messageId: number, userEmail: string): Promise<void> {
  const { error } = await supabase.from("message_read_receipts")
    .upsert({ message_id: messageId, user_email: userEmail }, { onConflict: "message_id,user_email" });
  if (error) throw new ServiceError("Failed to mark message read", error);
}

export function parseMentions(content: string): string[] {
  const matches = content.match(/@([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.slice(1).toLowerCase()))];
}
