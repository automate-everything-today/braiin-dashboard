import { supabase, ServiceError } from "./base";

export interface InboxGroup {
  id: number;
  name: string;
  description: string | null;
  group_type: "shared" | "personal";
  branch: string | null;
  department: string | null;
  bounce_threshold_minutes: number;
  is_active: boolean;
  channels: { id: number; channel_type: string; channel_address: string; display_name: string }[];
  unassigned_count?: number;
}

export async function getInboxGroups(userEmail: string): Promise<InboxGroup[]> {
  // Get groups user has access to
  const { data: access } = await supabase.from("inbox_group_access")
    .select("inbox_group_id").eq("user_email", userEmail);
  const groupIds = (access || []).map((a: any) => a.inbox_group_id);

  if (groupIds.length === 0) {
    // If no access configured, return all active groups (backwards compat)
    const { data, error } = await supabase.from("inbox_groups")
      .select("*, inbox_channels(*)").eq("is_active", true).order("name");
    if (error) throw new ServiceError("Failed to fetch inbox groups", error);
    return (data || []).map((g: any) => ({ ...g, channels: g.inbox_channels || [] }));
  }

  const { data, error } = await supabase.from("inbox_groups")
    .select("*, inbox_channels(*)").in("id", groupIds).eq("is_active", true).order("name");
  if (error) throw new ServiceError("Failed to fetch inbox groups", error);
  return (data || []).map((g: any) => ({ ...g, channels: g.inbox_channels || [] }));
}

export async function getUnassignedCounts(groupIds: number[]): Promise<Record<number, number>> {
  const { data } = await supabase.from("email_assignments")
    .select("inbox_group_id").eq("status", "unassigned").in("inbox_group_id", groupIds);
  const counts: Record<number, number> = {};
  for (const row of (data || [])) {
    if (row.inbox_group_id == null) continue;
    counts[row.inbox_group_id] = (counts[row.inbox_group_id] || 0) + 1;
  }
  return counts;
}

export async function createInboxGroup(input: {
  name: string; description?: string; branch?: string; department?: string; bounce_threshold_minutes?: number;
}): Promise<InboxGroup> {
  const { data, error } = await supabase.from("inbox_groups")
    .insert(input).select("*, inbox_channels(*)").single();
  if (error) throw new ServiceError("Failed to create inbox group", error);
  return { ...(data as any), channels: (data as any).inbox_channels || [] };
}

export async function addChannel(groupId: number, channelType: string, address: string, displayName?: string) {
  const { error } = await supabase.from("inbox_channels").insert({
    inbox_group_id: groupId, channel_type: channelType, channel_address: address, display_name: displayName || address,
  });
  if (error) throw new ServiceError("Failed to add channel", error);
}
