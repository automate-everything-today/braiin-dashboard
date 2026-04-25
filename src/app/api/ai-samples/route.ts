import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";
import { apiError, apiResponse } from "@/lib/validation";

/**
 * Manager review of the AI writing-voice corpus. The corpus drives the
 * classifier's reply-suggestion tone, so visibility + the ability to
 * remove off-pattern samples is governance-critical. Hidden from non-
 * managers because it includes other staff members' actual replies.
 *
 * GET    ?sender=&q=&days=&limit=&offset=  list samples
 * DELETE ?id=                              remove a single sample
 */

async function isManager(email: string): Promise<boolean> {
  const { data } = await supabase
    .from("staff")
    .select("is_manager")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return Boolean((data as { is_manager?: boolean } | null)?.is_manager);
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);
  if (session.role !== "super_admin" && !(await isManager(session.email))) {
    return apiError("Forbidden", 403);
  }

  const url = new URL(req.url);
  const sender = url.searchParams.get("sender") || "";
  const q = url.searchParams.get("q") || "";
  const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get("days") || "30")));
  const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get("limit") || "50")));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0"));

  let query = supabase
    .from("ai_writing_samples")
    .select("id, user_email, original_email_subject, original_email_from, actual_reply, ai_suggested_reply, used_suggestion, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (sender) query = query.eq("user_email", sender.toLowerCase());
  if (q) query = query.ilike("original_email_subject", `%${q}%`);
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  query = query.gte("created_at", sinceIso);

  const { data, error, count } = await query;
  if (error) return apiError(error.message, 500);

  // Attach staff name + department to each sample so the table reads as
  // "Adrienne Solyom (Sales)" not just an opaque email.
  const senderEmails = Array.from(
    new Set(((data || []) as Array<{ user_email?: string | null }>)
      .map((r) => (r.user_email || "").toLowerCase())
      .filter(Boolean)),
  );
  const { data: staffRows } = senderEmails.length > 0
    ? await supabase.from("staff").select("email, name, department").in("email", senderEmails)
    : { data: [] as Array<{ email?: string | null; name?: string | null; department?: string | null }> };
  const staffByEmail = new Map<string, { name: string | null; department: string | null }>();
  for (const r of (staffRows || []) as Array<{ email?: string | null; name?: string | null; department?: string | null }>) {
    if (r.email) staffByEmail.set(r.email.toLowerCase(), { name: r.name ?? null, department: r.department ?? null });
  }

  const samples = ((data || []) as Array<Record<string, unknown>>).map((r) => {
    const ue = (r.user_email as string | null)?.toLowerCase() || "";
    const staff = staffByEmail.get(ue);
    return {
      ...r,
      sender_name: staff?.name || ue.split("@")[0] || "?",
      sender_department: staff?.department || null,
    };
  });

  return apiResponse({ samples, total: count ?? 0 });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);
  if (session.role !== "super_admin" && !(await isManager(session.email))) {
    return apiError("Forbidden", 403);
  }
  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0");
  if (!id) return apiError("id required", 400);
  const { error } = await supabase.from("ai_writing_samples").delete().eq("id", id);
  if (error) return apiError(error.message, 500);
  return apiResponse({ success: true });
}
