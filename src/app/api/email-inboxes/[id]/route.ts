import { createClient } from "@supabase/supabase-js";
import { apiResponse, apiError } from "@/lib/validation";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
