import { getNotifications, markAsRead, markAllAsRead, getUnreadBlackIncidents } from "@/services/notifications";
import { apiResponse, apiError } from "@/lib/validation";
import { getSession } from "@/lib/session";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const url = new URL(req.url);
  const blackOnly = url.searchParams.get("black_only") === "true";

  try {
    if (blackOnly) {
      const alerts = await getUnreadBlackIncidents(session.email);
      return apiResponse({ alerts });
    }
    const result = await getNotifications(session.email);
    return apiResponse(result);
  } catch (e: any) {
    return apiError(e.message, 500);
  }
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const body = await req.json();

  try {
    if (body.mark_all_read) {
      await markAllAsRead(session.email);
    } else if (body.id) {
      await markAsRead(body.id, session.email);
    } else {
      return apiError("Provide id or mark_all_read", 400);
    }
    return apiResponse({ success: true });
  } catch (e: any) {
    return apiError(e.message, 500);
  }
}
