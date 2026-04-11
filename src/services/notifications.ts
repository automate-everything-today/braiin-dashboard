// src/services/notifications.ts
import { supabase, ServiceError } from "./base";
import type { Notification } from "@/types";

export async function getNotifications(
  userEmail: string,
  limit = 50
): Promise<{ notifications: Notification[]; unreadCount: number }> {
  const { data, error } = await supabase.from("notifications")
    .select("*")
    .eq("user_email", userEmail)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new ServiceError("Failed to fetch notifications", error);

  const notifications = (data || []) as Notification[];
  const unreadCount = notifications.filter(n => !n.is_read).length;
  return { notifications, unreadCount };
}

export async function markAsRead(id: number, userEmail: string): Promise<void> {
  const { error } = await supabase.from("notifications")
    .update({ is_read: true })
    .eq("id", id)
    .eq("user_email", userEmail);
  if (error) throw new ServiceError("Failed to mark notification as read", error);
}

export async function markAllAsRead(userEmail: string): Promise<void> {
  const { error } = await supabase.from("notifications")
    .update({ is_read: true })
    .eq("user_email", userEmail)
    .eq("is_read", false);
  if (error) throw new ServiceError("Failed to mark all as read", error);
}

export async function createNotification(input: {
  user_email: string;
  type: string;
  title: string;
  body?: string;
  severity?: string | null;
  source_type?: string;
  source_id?: string;
  link?: string;
}): Promise<void> {
  const { error } = await supabase.from("notifications").insert(input);
  if (error) throw new ServiceError("Failed to create notification", error);
}

export async function notifyUsers(
  emails: string[],
  notification: Omit<Parameters<typeof createNotification>[0], "user_email">
): Promise<void> {
  const rows = emails.map(email => ({ user_email: email, ...notification }));
  const { error } = await supabase.from("notifications").insert(rows);
  if (error) throw new ServiceError("Failed to notify users", error);
}

export async function getUnreadBlackIncidents(userEmail: string): Promise<Notification[]> {
  const { data, error } = await supabase.from("notifications")
    .select("*")
    .eq("user_email", userEmail)
    .eq("type", "incident")
    .eq("severity", "black")
    .eq("is_read", false)
    .order("created_at", { ascending: false });
  if (error) throw new ServiceError("Failed to fetch black incidents", error);
  return (data || []) as Notification[];
}
