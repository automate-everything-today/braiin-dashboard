import { getInboxGroups, getUnassignedCounts, createInboxGroup } from "@/services/email-inboxes";
import { apiResponse, apiError } from "@/lib/validation";
import { cookies } from "next/headers";

async function getSession() {
  const cookieStore = await cookies();
  const session = cookieStore.get("braiin_session");
  if (!session?.value) return null;
  try { return JSON.parse(session.value); } catch { return null; }
}

export async function GET() {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  try {
    const inboxes = await getInboxGroups(session.email);
    const groupIds = inboxes.map(g => g.id);
    const counts = groupIds.length > 0 ? await getUnassignedCounts(groupIds) : {};
    const enriched = inboxes.map(g => ({ ...g, unassigned_count: counts[g.id] || 0 }));
    return apiResponse({ inboxes: enriched });
  } catch (e: any) {
    return apiError(e.message, 500);
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.email) return apiError("Not authenticated", 401);

  const body = await req.json();
  if (!body.name) return apiError("Name is required", 400);

  try {
    const inbox = await createInboxGroup(body);
    return apiResponse({ inbox }, 201);
  } catch (e: any) {
    return apiError(e.message, 500);
  }
}
