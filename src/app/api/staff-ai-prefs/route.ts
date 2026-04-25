import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";
import { apiError, apiResponse } from "@/lib/validation";
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

  const { data: staff, error: e1 } = await supabase
    .from("staff")
    .select("email, name, department, is_manager")
    .eq("is_active", true)
    .not("email", "is", null)
    .order("name", { ascending: true });
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
  if (session.role !== "super_admin" && !(await isManager(session.email))) {
    return apiError("Forbidden", 403);
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

  const updates: Record<string, unknown> = {
    email: email.toLowerCase(),
    updated_at: new Date().toISOString(),
  };
  if (ai_learning_enabled !== undefined) updates.ai_learning_enabled = ai_learning_enabled;
  if (ai_learning_share_team !== undefined) updates.ai_learning_share_team = ai_learning_share_team;

  const { error } = await supabase
    .from("user_preferences")
    .upsert(updates as never, { onConflict: "email" });
  if (error) return apiError(error.message, 500);
  return apiResponse({ success: true });
}
