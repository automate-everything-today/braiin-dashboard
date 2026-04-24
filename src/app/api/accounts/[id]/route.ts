import { getAccountById, updateAccount, liftBlacklist } from "@/services/accounts";
import { accountSchema, apiResponse, apiError, validationError } from "@/lib/validation";
import { getSession } from "@/lib/session";

const ADMIN_ROLES = new Set(["admin", "super_admin", "branch_md"]);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const { id } = await params;
  const numId = parseInt(id);
  if (isNaN(numId)) return apiError("Invalid ID", 400);
  try {
    const account = await getAccountById(numId);
    if (!account) return apiError("Account not found", 404);
    return apiResponse({ account });
  } catch (e: any) {
    return apiError(e.message, 500);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const { id } = await params;
  const numId = parseInt(id);
  if (isNaN(numId)) return apiError("Invalid ID", 400);
  const body = await req.json();

  // Special action: lift blacklist - admin-only, because removing a blacklist
  // after a bad-payment or fraud incident is a high-trust action.
  if (body.action === "lift_blacklist") {
    if (!ADMIN_ROLES.has(session.role)) {
      console.warn(
        `[accounts] Non-admin ${session.email} (role=${session.role}) attempted to lift blacklist on account ${numId}`,
      );
      return apiError("Insufficient privileges", 403);
    }
    try {
      const account = await liftBlacklist(numId);
      console.info(`[accounts] Blacklist lifted on account ${numId} by ${session.email}`);
      return apiResponse({ account });
    } catch (e: any) {
      return apiError(e.message, 500);
    }
  }

  const parsed = accountSchema.partial().safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const account = await updateAccount(numId, parsed.data);
    return apiResponse({ account });
  } catch (e: any) {
    return apiError(e.message, 500);
  }
}
