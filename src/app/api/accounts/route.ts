import { getAccounts, createAccount } from "@/services/accounts";
import { accountSchema, apiResponse, apiError, validationError } from "@/lib/validation";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || undefined;
  const relationship_type = url.searchParams.get("relationship_type") || undefined;
  const search = url.searchParams.get("search") || undefined;

  try {
    const accounts = await getAccounts({ status, relationship_type, search });
    return apiResponse({ accounts });
  } catch (e: any) {
    return apiError(e.message, 500);
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = accountSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const account = await createAccount(parsed.data);
    return apiResponse({ account }, 201);
  } catch (e: any) {
    return apiError(e.message, 500);
  }
}
