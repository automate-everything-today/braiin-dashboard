import { supabase } from "@/services/base";

export async function POST(req: Request) {
  const body = await req.json();
  const {
    email_id, user_email, suggestion_type, suggestion_content,
    was_selected, was_sent, edit_distance, final_content,
    explicit_rating, feedback_context, edit_reasons, edit_reason_text,
    time_to_respond_ms,
  } = body;

  if (!email_id || !user_email) {
    return Response.json({ error: "Missing email_id or user_email" }, { status: 400 });
  }

  const { error } = await supabase.from("ai_response_feedback").insert({
    email_id,
    user_email,
    suggestion_type: suggestion_type || null,
    suggestion_content: suggestion_content || null,
    was_selected: was_selected || false,
    was_sent: was_sent || false,
    edit_distance: edit_distance || null,
    final_content: final_content || null,
    explicit_rating: explicit_rating || null,
    feedback_context: feedback_context || null,
    edit_reasons: edit_reasons || [],
    edit_reason_text: edit_reason_text || null,
    time_to_respond_ms: time_to_respond_ms || null,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true });
}
