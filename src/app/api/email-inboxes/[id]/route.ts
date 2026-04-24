import { supabase } from "@/services/base";
import { apiResponse, apiError } from "@/lib/validation";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numId = parseInt(id);
  if (isNaN(numId)) return apiError("Invalid ID", 400);
  const body = await req.json();
  const allowed = ["name", "description", "default_assignee", "is_active"];
  const updates: Record<string, any> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  const { data, error } = await supabase.from("inbox_groups")
    .update(updates).eq("id", numId).select().single();
  if (error) return apiError(error.message, 500);
  return apiResponse({ inbox: data });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numId = parseInt(id);
  if (isNaN(numId)) return apiError("Invalid ID", 400);
  const { error } = await supabase.from("inbox_groups")
    .update({ is_active: false }).eq("id", numId);
  if (error) return apiError(error.message, 500);
  return apiResponse({ success: true });
}
