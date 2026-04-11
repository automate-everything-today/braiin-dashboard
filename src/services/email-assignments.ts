import { supabase, ServiceError } from "./base";

export interface EmailAssignment {
  id: number;
  email_id: string;
  inbox_group_id: number;
  channel_address: string | null;
  assigned_to: string | null;
  status: "unassigned" | "assigned" | "snoozed" | "done";
  snoozed_until: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  done_at: string | null;
}

export async function getAssignment(emailId: string, inboxGroupId: number): Promise<EmailAssignment | null> {
  const { data } = await supabase.from("email_assignments")
    .select("*").eq("email_id", emailId).eq("inbox_group_id", inboxGroupId).single();
  return (data as EmailAssignment) || null;
}

export async function getAssignmentsForInbox(inboxGroupId: number): Promise<Record<string, EmailAssignment>> {
  const { data } = await supabase.from("email_assignments")
    .select("*").eq("inbox_group_id", inboxGroupId);
  const map: Record<string, EmailAssignment> = {};
  for (const a of (data || [])) map[a.email_id] = a as EmailAssignment;
  return map;
}

export async function assignEmail(
  emailId: string, inboxGroupId: number, assignTo: string, assignedBy: string, channelAddress?: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from("email_assignments").upsert({
    email_id: emailId, inbox_group_id: inboxGroupId, assigned_to: assignTo,
    status: "assigned", assigned_by: assignedBy, assigned_at: now,
    channel_address: channelAddress || null, updated_at: now,
  }, { onConflict: "email_id,inbox_group_id" });
  if (error) throw new ServiceError("Failed to assign email", error);

  await supabase.from("email_assignment_log").insert({
    email_id: emailId, action: "assigned", to_user: assignTo, performed_by: assignedBy,
  });
}

export async function claimEmail(emailId: string, inboxGroupId: number, userEmail: string): Promise<void> {
  await assignEmail(emailId, inboxGroupId, userEmail, userEmail);
}

export async function markDone(emailId: string, inboxGroupId: number, userEmail: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from("email_assignments").upsert({
    email_id: emailId, inbox_group_id: inboxGroupId, status: "done", done_at: now, updated_at: now,
  }, { onConflict: "email_id,inbox_group_id" });
  if (error) throw new ServiceError("Failed to mark done", error);

  await supabase.from("email_assignment_log").insert({
    email_id: emailId, action: "done", performed_by: userEmail,
  });
}

export async function snoozeEmail(emailId: string, inboxGroupId: number, until: string, userEmail: string): Promise<void> {
  const { error } = await supabase.from("email_assignments").upsert({
    email_id: emailId, inbox_group_id: inboxGroupId, status: "snoozed",
    snoozed_until: until, updated_at: new Date().toISOString(),
  }, { onConflict: "email_id,inbox_group_id" });
  if (error) throw new ServiceError("Failed to snooze email", error);

  await supabase.from("email_assignment_log").insert({
    email_id: emailId, action: "snoozed", performed_by: userEmail, note: `Until ${until}`,
  });
}

export async function ensureAssignment(emailId: string, inboxGroupId: number, channelAddress?: string): Promise<EmailAssignment> {
  const existing = await getAssignment(emailId, inboxGroupId);
  if (existing) return existing;

  // Create as unassigned
  const { data, error } = await supabase.from("email_assignments").insert({
    email_id: emailId, inbox_group_id: inboxGroupId, status: "unassigned",
    channel_address: channelAddress || null,
  }).select().single();
  if (error) throw new ServiceError("Failed to create assignment", error);
  return data as EmailAssignment;
}
