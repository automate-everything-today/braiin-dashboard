import { markMessageRead } from "@/services/messages";
import { apiResponse, apiError } from "@/lib/validation";
import { cookies } from "next/headers";

async function getSession() {
  const cookieStore = await cookies();
  const session = cookieStore.get("braiin_session");
  if (!session?.value) return null;
  try { return JSON.parse(session.value); } catch { return null; }
}

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
