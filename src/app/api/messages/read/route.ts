import { markMessageRead } from "@/services/messages";
import { apiResponse, apiError } from "@/lib/validation";
import { getSession } from "@/lib/session";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const { message_id } = await req.json();
  if (!message_id) return apiError("Missing message_id", 400);

  try {
    await markMessageRead(message_id, session.email);
    return apiResponse({ success: true });
  } catch (e: any) {
    return apiError(e.message, 500);
  }
}
