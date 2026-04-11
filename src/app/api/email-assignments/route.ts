import { getAssignmentsForInbox, assignEmail, claimEmail, markDone, snoozeEmail } from "@/services/email-assignments";
import { apiResponse, apiError } from "@/lib/validation";
import { cookies } from "next/headers";

async function getSession() {
  const cookieStore = await cookies();
  const session = cookieStore.get("braiin_session");
  if (!session?.value) return null;
  try { return JSON.parse(session.value); } catch { return null; }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const inboxGroupId = parseInt(url.searchParams.get("inbox_group_id") || "0");
  if (!inboxGroupId) return apiError("inbox_group_id required", 400);

  try {
    const assignments = await getAssignmentsForInbox(inboxGroupId);
    return apiResponse({ assignments });
  } catch (e: any) {
    return apiError(e.message, 500);
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const { email_id, inbox_group_id, action, assign_to, snooze_until } = await req.json();
  if (!email_id || !inbox_group_id) return apiError("email_id and inbox_group_id required", 400);

  try {
    switch (action) {
      case "claim":
        await claimEmail(email_id, inbox_group_id, session.email);
        break;
      case "assign":
        if (!assign_to) return apiError("assign_to required", 400);
        await assignEmail(email_id, inbox_group_id, assign_to, session.email);
        break;
      case "done":
        await markDone(email_id, inbox_group_id, session.email);
        break;
      case "snooze":
        if (!snooze_until) return apiError("snooze_until required", 400);
        await snoozeEmail(email_id, inbox_group_id, snooze_until, session.email);
        break;
      default:
        // Default: assign
        await assignEmail(email_id, inbox_group_id, assign_to || session.email, session.email);
    }
    return apiResponse({ success: true });
  } catch (e: any) {
    return apiError(e.message, 500);
  }
}
