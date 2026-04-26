import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";
import { apiError, apiResponse } from "@/lib/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { z } from "zod";

/**
 * Manager-side override for any staff member's AI learning toggles.
 * Used by /settings/ai-learning so a manager can disable cross-team
 * sharing for specific staff members (e.g. someone leaving, or a junior
 * whose voice we don't want to seed the corpus yet) without waiting
 * for that user to update their own profile preferences.
 *
 * GET   list every staff member with their current toggles
 * PATCH { email, ai_learning_enabled?, ai_learning_share_team? }
 */

const patchSchema = z.object({
  email: z.string().email(),
  ai_learning_enabled: z.boolean().optional(),
  ai_learning_share_team: z.boolean().optional(),
});

async function getStaffMeta(email: string): Promise<{ isManager: boolean; department: string | null }> {
  const { data } = await supabase
    .from("staff")
    .select("is_manager, department")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  const row = data as { is_manager?: boolean; department?: string | null } | null;
  return {
    isManager: Boolean(row?.is_manager),
    department: row?.department ?? null,
  };
}

export async function GET() {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const isAdmin = session.role === "super_admin";
  const meta = isAdmin ? { isManager: true, department: null } : await getStaffMeta(session.email);
  if (!isAdmin && !meta.isManager) return apiError("Forbidden", 403);

  // Managers see only their own department; super_admin sees everyone.
  // Mirrors the visibility model used by the tasks API (manager scope =
  // own team only). Prevents cross-department overrides, intentional
  // or accidental.
  let staffQuery = supabase
    .from("staff")
    .select("email, name, department, is_manager")
    .eq("is_active", true)
    .not("email", "is", null)
    .order("name", { ascending: true });
  if (!isAdmin && meta.department) {
    staffQuery = staffQuery.eq("department", meta.department);
  }
  const { data: staff, error: e1 } = await staffQuery;
  if (e1) return apiError(e1.message, 500);

  const emails = ((staff || []) as Array<{ email?: string | null }>)
    .map((s) => (s.email || "").toLowerCase())
    .filter(Boolean);
  const { data: prefs, error: e2 } = emails.length > 0
    ? await supabase
        .from("user_preferences")
        .select("email, ai_learning_enabled, ai_learning_share_team")
        .in("email", emails)
    : { data: [] as Array<Record<string, unknown>>, error: null };
  if (e2) return apiError(e2.message, 500);

  const prefsByEmail = new Map<string, { ai_learning_enabled: boolean; ai_learning_share_team: boolean }>();
  for (const p of (prefs || []) as Array<{ email?: string | null; ai_learning_enabled?: boolean | null; ai_learning_share_team?: boolean | null }>) {
    if (p.email) {
      prefsByEmail.set(p.email.toLowerCase(), {
        ai_learning_enabled: p.ai_learning_enabled !== false,
        ai_learning_share_team: p.ai_learning_share_team !== false,
      });
    }
  }

  const rows = ((staff || []) as Array<Record<string, unknown>>).map((s) => {
    const e = ((s.email as string | null) || "").toLowerCase();
    const p = prefsByEmail.get(e) || { ai_learning_enabled: true, ai_learning_share_team: true };
    return {
      email: e,
      name: s.name,
      department: s.department,
      is_manager: s.is_manager,
      ai_learning_enabled: p.ai_learning_enabled,
      ai_learning_share_team: p.ai_learning_share_team,
    };
  });

  return apiResponse({ staff: rows });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const isAdmin = session.role === "super_admin";
  const meta = isAdmin ? { isManager: true, department: null } : await getStaffMeta(session.email);
  if (!isAdmin && !meta.isManager) return apiError("Forbidden", 403);

  if (!(await checkRateLimit(`staff-ai-prefs-write:${session.email.toLowerCase()}`, 60))) {
    return apiError("Too many requests. Please slow down.", 429);
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      `Validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
      400,
    );
  }
  const { email, ai_learning_enabled, ai_learning_share_team } = parsed.data;
  const targetEmail = email.toLowerCase();

  // Department scope: managers can only modify staff in their own
  // department. super_admin is unrestricted. A manager attempting to
  // PATCH cross-department gets 403 with the same shape as the
  // un-authorised case so the API doesn't reveal department layout.
  if (!isAdmin) {
    if (!meta.department) {
      // Manager rows that pre-date the department column will fall
      // here on every PATCH and the UI will look broken without
      // explanation. Log loudly so this misconfig is diagnosable
      // from server logs without changing the response shape.
      console.warn(
        `[staff-ai-prefs] manager ${session.email} has no department set on staff row - all PATCHes will 403`,
      );
      return apiError("Forbidden", 403);
    }
    const { data: target } = await supabase
      .from("staff")
      .select("department")
      .eq("email", targetEmail)
      .maybeSingle();
    const targetDept = (target as { department?: string | null } | null)?.department ?? null;
    if (!targetDept || meta.department !== targetDept) {
      return apiError("Forbidden", 403);
    }
  }

  const updates: {
    email: string;
    updated_at: string;
    ai_learning_enabled?: boolean;
    ai_learning_share_team?: boolean;
  } = {
    email: targetEmail,
    updated_at: new Date().toISOString(),
  };
  if (ai_learning_enabled !== undefined) updates.ai_learning_enabled = ai_learning_enabled;
  if (ai_learning_share_team !== undefined) updates.ai_learning_share_team = ai_learning_share_team;

  const { error } = await supabase
    .from("user_preferences")
    .upsert(updates, { onConflict: "email" });
  if (error) {
    console.error("[staff-ai-prefs] upsert failed:", error.message);
    return apiError("Update failed. Please try again.", 500);
  }
  return apiResponse({ success: true });
}
