import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";

/**
 * Bumps usage_count + last_used_at on a reply_learnings row when the user
 * clicks a learned reply chip. Pure side-effect endpoint; nothing to return
 * beyond a success flag.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.email) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { learning_id } = await req.json();
  if (!learning_id || typeof learning_id !== "number") {
    return Response.json({ error: "Missing learning_id" }, { status: 400 });
  }

  // Scope update by user_email so users cannot touch each other's learnings
  const { data: current } = await supabase
    .from("reply_learnings")
    .select("usage_count")
    .eq("id", learning_id)
    .eq("user_email", session.email)
    .single();

  const nextCount = (current?.usage_count ?? 0) + 1;

  const { error } = await supabase
    .from("reply_learnings")
    .update({ usage_count: nextCount, last_used_at: new Date().toISOString() })
    .eq("id", learning_id)
    .eq("user_email", session.email);

  if (error) {
    console.error("[refine-replies/usage] update failed:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
