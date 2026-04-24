import { supabase } from "@/services/base";
import { getSession } from "@/lib/session";
import { apiError, apiResponse } from "@/lib/validation";
import { z } from "zod";

/**
 * CRUD for layered reply_rules. Read is open to any authenticated user so
 * the reply composer could one day display the active rules inline. Create /
 * update / delete are restricted to managers and super admins.
 *
 * Access control rules:
 * - super_admin role: full access to all scopes.
 * - is_manager staff: can create/update/toggle/delete every scope EXCEPT
 *   scope_type='user' for a different user. They can still manage their own
 *   user-scoped rules.
 * - Everyone else: read only.
 */

const SCOPE_TYPES = ["user", "category", "mode", "department", "branch", "global"] as const;
const SOURCE_TYPES = ["learned", "set"] as const;

const createSchema = z.object({
  scope_type: z.enum(SCOPE_TYPES),
  scope_value: z.string().min(1),
  instruction: z.string().min(1).max(500),
  source: z.enum(SOURCE_TYPES).default("set"),
  active: z.boolean().default(true),
});

const updateSchema = z.object({
  id: z.number().int().positive(),
  instruction: z.string().min(1).max(500).optional(),
  active: z.boolean().optional(),
  scope_type: z.enum(SCOPE_TYPES).optional(),
  scope_value: z.string().min(1).optional(),
});

async function getStaffFlags(email: string): Promise<{ isManager: boolean }> {
  const { data } = await supabase
    .from("staff")
    .select("is_manager")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return { isManager: Boolean((data as { is_manager?: boolean } | null)?.is_manager) };
}

function canWrite(session: { email: string; role: string }, isManager: boolean): boolean {
  if (session.role === "super_admin") return true;
  return isManager;
}

export async function GET() {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const { data, error } = await supabase
    .from("reply_rules")
    .select("*")
    .order("scope_type", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) return apiError(error.message, 500);
  return apiResponse({ rules: data ?? [] });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const { isManager } = await getStaffFlags(session.email);
  if (!canWrite(session, isManager)) return apiError("Forbidden", 403);

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      `Validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
      400,
    );
  }
  const input = parsed.data;

  // Non-super-admin managers cannot author user-scoped rules for someone else.
  if (
    input.scope_type === "user" &&
    session.role !== "super_admin" &&
    input.scope_value.toLowerCase() !== session.email.toLowerCase()
  ) {
    return apiError("Only super admins can author user-scoped rules for another user", 403);
  }

  if (input.scope_type === "global" && input.scope_value !== "global") {
    return apiError("Global rules must have scope_value='global'", 400);
  }

  const { data, error } = await supabase
    .from("reply_rules")
    .insert({
      scope_type: input.scope_type,
      scope_value:
        input.scope_type === "user" ? input.scope_value.toLowerCase() : input.scope_value,
      instruction: input.instruction.trim(),
      source: input.source,
      active: input.active,
      created_by: session.email.toLowerCase(),
    })
    .select()
    .single();

  if (error) return apiError(error.message, 500);
  return apiResponse({ rule: data });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const { isManager } = await getStaffFlags(session.email);
  if (!canWrite(session, isManager)) return apiError("Forbidden", 403);

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      `Validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
      400,
    );
  }
  const { id, ...updates } = parsed.data;

  // When a manager edits a rule they need to respect the same scope rules.
  if (updates.scope_type === "user" && updates.scope_value && session.role !== "super_admin") {
    if (updates.scope_value.toLowerCase() !== session.email.toLowerCase()) {
      return apiError("Only super admins can retarget user-scoped rules to another user", 403);
    }
  }

  const payload: Record<string, unknown> = {};
  if (updates.instruction !== undefined) payload.instruction = updates.instruction.trim();
  if (updates.active !== undefined) payload.active = updates.active;
  if (updates.scope_type !== undefined) payload.scope_type = updates.scope_type;
  if (updates.scope_value !== undefined) {
    payload.scope_value =
      updates.scope_type === "user"
        ? updates.scope_value.toLowerCase()
        : updates.scope_value;
  }

  const { data, error } = await supabase
    .from("reply_rules")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) return apiError(error.message, 500);
  return apiResponse({ rule: data });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const { isManager } = await getStaffFlags(session.email);
  if (!canWrite(session, isManager)) return apiError("Forbidden", 403);

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id") || "0");
  if (!id) return apiError("id required", 400);

  const { error } = await supabase.from("reply_rules").delete().eq("id", id);
  if (error) return apiError(error.message, 500);
  return apiResponse({ success: true });
}
