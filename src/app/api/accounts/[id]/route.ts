import { getAccountById, updateAccount, liftBlacklist } from "@/services/accounts";
import { accountSchema, apiResponse, apiError, validationError } from "@/lib/validation";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const { id } = await params;
  const numId = parseInt(id);
  if (isNaN(numId)) return apiError("Invalid ID", 400);
  const body = await req.json();

  // Special action: lift blacklist
  if (body.action === "lift_blacklist") {
    try {
      const account = await liftBlacklist(numId);
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
