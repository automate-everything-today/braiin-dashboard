import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";
import { apiError, apiResponse } from "@/lib/validation";
import { isInternalEmail } from "@/config/customer";

/**
 * Returns the writing samples that are CURRENTLY eligible to feed the
 * classifier's reply suggestions. Same exclusion rules as the live
 * classify-email pipeline: respects each sender's ai_learning_enabled
 * + ai_learning_share_team toggles, drops internal-to-internal replies,
 * caps at 12 most recent.
 *
 * Manager-only - non-managers can hit /profile to see their own toggles
 * but they don't get visibility into other staff's reply patterns.
 */

async function isManager(email: string): Promise<boolean> {
  const { data } = await supabase
    .from("staff")
    .select("is_manager")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return Boolean((data as { is_manager?: boolean } | null)?.is_manager);
}

export async function GET() {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);
  if (session.role !== "super_admin" && !(await isManager(session.email))) {
    return apiError("Forbidden", 403);
  }

  const currentUserEmail = session.email.toLowerCase();
  const { data, error } = await supabase
    .from("ai_writing_samples")
    .select("id, user_email, original_email_subject, original_email_from, actual_reply, ai_suggested_reply, used_suggestion, created_at")
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) return apiError(error.message, 500);

  const sampleEmails = Array.from(
    new Set(((data || []) as Array<{ user_email?: string | null }>)
      .map((r) => (r.user_email || "").toLowerCase())
      .filter(Boolean)),
  );
  type StaffRow = { email?: string | null; name?: string | null; department?: string | null };
  type PrefsRow = { email?: string | null; ai_learning_enabled?: boolean | null; ai_learning_share_team?: boolean | null };
  const [{ data: staffRows }, { data: prefsRows }] = await Promise.all([
    sampleEmails.length > 0
      ? supabase.from("staff").select("email, name, department").in("email", sampleEmails)
      : Promise.resolve({ data: [] as StaffRow[] }),
    sampleEmails.length > 0
      ? (supabase.from("user_preferences") as unknown as { select: (s: string) => { in: (col: string, vals: string[]) => Promise<{ data: PrefsRow[] | null }> } })
          .select("email, ai_learning_enabled, ai_learning_share_team")
          .in("email", sampleEmails)
      : Promise.resolve({ data: [] as PrefsRow[] }),
  ]);
  const staffByEmail = new Map<string, StaffRow>();
  for (const r of (staffRows || []) as StaffRow[]) {
    if (r.email) staffByEmail.set(r.email.toLowerCase(), r);
  }
  const prefsByEmail = new Map<string, PrefsRow>();
  for (const r of (prefsRows || []) as PrefsRow[]) {
    if (r.email) prefsByEmail.set(r.email.toLowerCase(), r);
  }

  const eligible: Array<Record<string, unknown>> = [];
  for (const s of (data || []) as Array<Record<string, unknown>>) {
    const sampleSender = ((s.user_email as string | null) || "").toLowerCase();
    if (!sampleSender) continue;
    const isSelf = sampleSender === currentUserEmail;
    const prefs = prefsByEmail.get(sampleSender);
    const learningOn = prefs?.ai_learning_enabled !== false;
    const shareOn = prefs?.ai_learning_share_team !== false;
    if (!learningOn) continue;
    if (!isSelf && !shareOn) continue;
    if (isInternalEmail((s.original_email_from as string | null) || "")) continue;
    const staff = staffByEmail.get(sampleSender);
    eligible.push({
      ...s,
      sender_name: staff?.name || sampleSender.split("@")[0],
      sender_department: staff?.department || null,
    });
    if (eligible.length >= 12) break;
  }

  return apiResponse({ samples: eligible });
}
